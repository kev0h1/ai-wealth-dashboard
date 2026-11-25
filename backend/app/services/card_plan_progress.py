"""G492: card-plan money facts, computed on input changes, never on reads.

The store calls this after sync/edit and at London day rollover. Every amount
and bar position is authored here. A repayment is counted once, on the paying
debit, from the plan's start; an explicit reconciled card identity wins over
text. The current-period reservation and the future schedule are distinct.

An offer bar is a repayment target, not an invented allocation of a card's
payments between several offers. It needs one recorded zero-rate offer, a
known starting balance and no evidence of other debt. Missing or ambiguous
evidence produces unavailable progress, never a zero or an on-track claim.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, time, timedelta, timezone
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from app.core import timeutil
from app.services import card_repayment_plans as crp, goal_schedule, plan_fulfilment as pf
from app.services.pay_period import get_pay_period_for_date, period_rhythm_label


def _day(value) -> date | None:
    if isinstance(value, datetime):
        return timeutil.to_user_date(value)
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _valid_payoff_month(value, today: date) -> bool:
    """A debt forecast month must be a real current-or-future calendar month.

    The debt engine normally guarantees this.  The stored progress boundary
    nevertheless treats stale or malformed cached input as unavailable rather
    than handing it to a display formatter or presenting a past finish.
    """
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-(?:0[1-9]|1[0-2])', value):
        return False
    try:
        year = int(value[:4])
        date(year, int(value[5:]), 1)
    except ValueError:
        return False
    return value >= today.strftime('%Y-%m')


def _has_repayment_plan_forecast(debt_card: dict | None) -> bool:
    return isinstance(debt_card, dict) and isinstance(debt_card.get('repayment_plan'), dict) and bool(debt_card['repayment_plan'])


def _pence(value) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        n = Decimal(str(value))
        return int((n * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP)) if n.is_finite() else None
    except (InvalidOperation, ValueError, OverflowError):
        return None


def _pounds(pence: int) -> float:
    return pence / 100


def _linked_card(row: dict) -> str:
    marker = row.get('own_transfer_match')
    link = marker.get('card_repayment') if isinstance(marker, dict) else None
    return str(link.get('card_account_id') or '') if isinstance(link, dict) else ''


def repayment_rows(plan: dict, plans: list[dict], rows: list[dict], cfg: dict) -> list[tuple[date, int]]:
    """Select one paying debit, never both legs or another card's payment.

    Unlinked text matches retain the existing earliest/exact-amount ownership
    rule, using the schedule of the payment's own pay period. Reconciled links
    are authoritative even when a different card shares the bank's wording.
    Rows before start are retained only to reconcile a dated offer baseline;
    the public paid figures explicitly filter them out below.
    """
    source = str(plan.get('source_account_id') or '')
    out: list[tuple[date, int]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        if str(row.get('account_id') or '') != source or row.get('transaction_type') != 'debit':
            continue
        day, pence = _day(row.get('date')), _pence(row.get('amount'))
        if day is None or pence is None or not pf.payment_matches(plan, row):
            continue
        identifier = row.get('_id')
        if identifier is not None:
            key = (source, str(identifier))
            if key in seen:
                continue
            seen.add(key)
        if not _linked_card(row):
            ps, pe = get_pay_period_for_date(day, cfg)
            due = goal_schedule.period_amount(plan['schedule'], ps, pe, cfg)
            rivals = []
            for other in plans:
                if other is plan or str(other.get('source_account_id') or '') != source:
                    continue
                begins = pf.tracking_start(other)
                if begins is not None and day < begins:
                    continue
                if not other.get('fill_rule'):
                    continue
                rivals.append({'doc': other, 'rule': other['fill_rule'],
                               'expected_pence': goal_schedule.period_amount(other['schedule'], ps, pe, cfg)})
            me = {'doc': plan, 'rule': plan.get('fill_rule'), 'expected_pence': due}
            if not pf.claims_debit(me, rivals, row, due):
                continue
        out.append((day, abs(pence)))
    return sorted(out)


def card_payment_rows(plan: dict, plans: list[dict], rows: list[dict], cfg: dict, owned_ids: set[str]) -> list[tuple[date, int]]:
    """All explicit card-linked debits count, even from another owned source.

    A nominated-source narrative rule still recognises its own payments; that
    rule is never applied to an unrelated source. Both card legs cannot count.
    """
    out = repayment_rows(plan, plans, [r for r in rows if not _linked_card(r)], cfg)
    seen = set()
    for row in rows:
        source = str(row.get('account_id') or '')
        if source not in owned_ids or row.get('transaction_type') != 'debit' or _linked_card(row) != str(plan.get('card_account_id') or ''):
            continue
        identifier = row.get('_id')
        key = (source, str(identifier)) if identifier is not None else None
        if key is not None and key in seen:
            continue
        if key is not None:
            seen.add(key)
        day, amount = _day(row.get('date')), _pence(row.get('amount'))
        if day is not None and amount is not None:
            out.append((day, abs(amount)))
    return sorted(out)


def _offer_baseline(
    plan: dict, offer: dict, payments: list[tuple[date, int]], today: date,
    previous: dict | None,
) -> tuple[dict | None, str]:
    start = pf.tracking_start(plan)
    balance = _pence(offer.get('balance'))
    if start is None or balance is None or balance <= 0:
        return None, 'offer_balance_unknown'
    as_of = _day(offer.get('as_of'))
    if as_of is None:
        return None, 'starting_balance_unknown'
    if as_of > today:
        return None, 'offer_date_unknown'
    if any(d == as_of for d, _a in payments):
        return None, 'offer_day_payment_ambiguous'
    key = hashlib.sha256(json.dumps({
        'card': plan.get('card_account_id'), 'start': start.isoformat(),
        'offer': offer.get('id') or {k: offer.get(k) for k in ('kind', 'offer_type', 'until', 'apr_pct')},
    }, sort_keys=True, default=str).encode()).hexdigest()
    prior_target = (previous or {}).get('target_pence')
    if (previous and previous.get('key') == key and previous.get('start_date') == start.isoformat()
            and isinstance(prior_target, int) and not isinstance(prior_target, bool) and prior_target > 0):
        return previous, ''
    if as_of is not None:
        # A day-only statement has no cutoff time. Do not guess whether a
        # payment on that same day was already included in its balance.
        if as_of < start:
            target = balance - sum(a for d, a in payments if as_of < d < start)
        else:
            # The statement balance already includes payments through its day.
            target = balance + sum(a for d, a in payments if start <= d <= as_of)
    else:
        return None, 'starting_balance_unknown'
    if target <= 0:
        return None, 'starting_balance_unknown'
    return {'key': key, 'target_pence': target, 'start_date': start.isoformat(), 'balance_as_of': as_of.isoformat()}, ''


def build_plan_facts(
    plan: dict, card: dict, terms: dict, cfg: dict, today: date,
    payments: list[tuple[date, int]], *, previous_baseline: dict | None = None,
    debt_card: dict | None = None, source_payments: list[tuple[date, int]] | None = None,
    other_card_activity: bool = False,
    source_paid_current_pence: int | None = None, source_reserved_current_pence: int | None = None,
) -> tuple[dict, dict | None]:
    """Pure, penny-exact facts used by the durable store and regression tests."""
    schedule = plan['schedule']
    ps, pe = get_pay_period_for_date(today, cfg)
    start = pf.tracking_start(plan)
    events = sorted(goal_schedule.events(schedule, cfg))
    after_start = [(d, a) for d, a in payments if start is not None and start <= d <= today]
    paid = sum(a for _d, a in after_start)
    paid_period = sum(a for d, a in after_start if ps <= d <= pe)
    nominated = after_start if source_payments is None else [(d, a) for d, a in source_payments if start is not None and start <= d <= today]
    source_paid = sum(a for d, a in nominated if ps <= d <= pe)
    if source_paid_current_pence is not None:
        other_paid = max(0, paid_period - source_paid)
        source_paid = max(0, source_paid_current_pence)
        paid_period = source_paid + other_paid
    due = goal_schedule.period_amount(schedule, ps, pe, cfg)
    paused = plan.get('paused') is True
    owed = _pence(crp.signed_card_balance(card))
    owed = max(0, -owed) if owed is not None else None
    state = 'paused' if paused else 'not_started' if start and start > today else 'active'
    if events and goal_schedule.end_date(schedule, cfg) < today:
        state = 'ended'
    future = [] if paused else crp.remaining_plan_events(schedule, cfg, today, paid_this_period_pence=source_paid)
    next_event = next(((d, a) for d, a in future if a > 0), None)
    amounts = {a for _d, a in events}
    fixed = len(amounts) == 1
    planned = 0 if paused else min(due, source_paid + owed) if owed is not None else due
    if source_reserved_current_pence is not None and not paused:
        planned = min(due, source_paid + max(0, source_reserved_current_pence))
    display_due = 0 if paused else ((due or (next_event[1] if next_event else 0)) if state == 'not_started' else planned)
    facts = {
        'status': 'ready', 'as_of': today.isoformat(), 'card_name': crp.safe_card_name(card),
        'balance_owed': _pounds(owed) if owed is not None else None,
        'this_period_planned': _pounds(planned), 'paid_this_period': _pounds(paid_period),
        'paid_since_start': _pounds(paid), 'tracking_start': start.isoformat() if start else None,
        'paid_from_source_this_period': _pounds(source_paid),
        'reserved_from_source_this_period': _pounds(max(0, planned - source_paid)),
        'display_period_planned': _pounds(display_due), 'amount_varies': not fixed,
        'final_period_amount': planned != due,
        'period_label': period_rhythm_label(cfg), 'schedule_state': state,
        'next_payment': _pounds(next_event[1]) if next_event else None,
        'next_payment_date': next_event[0].isoformat() if next_event else None,
        'starts_on': start.isoformat() if start else None,
        'would_clear_by_month': None, 'would_clear_by': None,
        # This is deliberately separate from the legacy debt-plan month.  A
        # row may only present it when this calculation can prove the saved
        # plan clears before its one reconciled 0% offer ends.
        'finish_estimate': {'status': 'unavailable', 'reason': 'offer_progress_unavailable'},
        'promo': None, 'offers': [],
    }
    if state == 'not_started':
        facts['finish_estimate'] = {'status': 'unavailable', 'reason': 'future_plan'}
    elif state == 'paused':
        facts['finish_estimate'] = {'status': 'unavailable', 'reason': 'paused'}
    elif state == 'ended':
        facts['finish_estimate'] = {'status': 'unavailable', 'reason': 'ended'}
    elif owed == 0:
        facts['finish_estimate'] = {'status': 'unavailable', 'reason': 'balance_cleared'}
    # A future plan's current debt forecast still follows the usual payment.
    # Do not mislabel that date as a projection from the future plan.
    if state in ('active', 'not_started') and owed and _has_repayment_plan_forecast(debt_card):
        from app.services.debt_plan import month_label_to_human
        month = debt_card.get('payoff_month')
        if _valid_payoff_month(month, today):
            facts.update(would_clear_by_month=month, would_clear_by=month_label_to_human(month))
    if (card.get('currency') or 'GBP').upper() != 'GBP':
        return {'status': 'unavailable', 'reason': 'currency_unsupported', 'card_name': facts['card_name']}, None
    if terms.get('status') != 'confirmed':
        facts['offer_status'] = 'unconfirmed'
        return facts, None
    offers = [dict(o) for o in terms.get('promos') or [] if _day(o.get('until')) is not None and _day(o['until']) >= today]
    baseline = None
    for offer in sorted(offers, key=lambda o: str(o['until'])):
        until = _day(offer['until'])
        item = {'id': offer.get('id'), 'until': until.isoformat(), 'balance': offer.get('balance'),
                'balance_is_offer': offer.get('balance') is not None,
                'progress': {'status': 'unavailable', 'reason': 'allocation_unknown'}}
        facts['offers'].append(item)
        # Never count the same card repayment towards several offer balances.
        if len(offers) != 1:
            continue
        apr = _pence(offer.get('apr_pct'))
        if apr is None or apr != 0:
            item['progress']['reason'] = 'interest_projection_unknown'
            continue
        baseline, reason = _offer_baseline(plan, offer, payments, today, previous_baseline)
        if baseline is None:
            item['progress']['reason'] = reason
            # A future schedule can be compared with the recorded current
            # offer balance without pretending it is a starting-balance bar.
            raw = _pence(offer.get('balance'))
            if state == 'not_started' and raw is not None and owed is not None and abs(raw - owed) <= 1:
                planned_future = sum(a for d, a in future if d < until)
                item.update(planned_by_end=_pounds(planned_future), residual_at_end=_pounds(max(0, raw - planned_future)),
                            clears_before_end=planned_future >= raw, outlook='short' if planned_future < raw else 'on_track')
                facts['promo'] = item
            continue
        target = baseline['target_pence']
        remaining = max(0, target - paid)
        recorded_day = _day(offer.get('as_of'))
        if recorded_day is not None and recorded_day >= start:
            recorded_remaining = max(0, target - sum(a for d, a in after_start if d < recorded_day))
            if abs((_pence(offer.get('balance')) or 0) - recorded_remaining) > 1:
                item['progress']['reason'] = 'offer_balance_changed'
                continue
        # Other/new card debt cannot be silently assigned to this offer.
        if owed is None or abs(owed - remaining) > 1 or other_card_activity:
            item['progress']['reason'] = 'allocation_unknown'
            continue
        planned = sum(a for d, a in future if d < until)
        residual = max(0, remaining - planned)
        days = max(1, (until - start).days)
        elapsed = max(0, min(days, (today - start).days))
        expected = (target * elapsed + days // 2) // days
        paid_pct = round(min(100, max(0, paid * 100 / target)), 4)
        expected_pct = round(min(100, max(0, expected * 100 / target)), 4)
        item.update(balance=_pounds(remaining), planned_by_end=_pounds(planned),
                    residual_at_end=_pounds(residual), clears_before_end=residual == 0)
        item['progress'] = {
            'status': 'not_started' if start > today else 'ready',
            'basis': 'reconciled_single_offer', 'start_date': start.isoformat(),
            'balance_as_of': baseline.get('balance_as_of'),
            'target': _pounds(target), 'paid': _pounds(paid), 'expected_by_now': _pounds(expected),
            'paid_percent': paid_pct, 'expected_percent': expected_pct,
        }
        item['outlook'] = 'paused' if paused else 'short' if residual else 'behind' if paid < expected else 'on_track'
        facts['promo'] = item
    # Today's record is not a promise about a future starting balance.  The
    # legacy would_clear_by field above is intentionally broader than this
    # offer-bound estimate and remains for its existing consumers.
    promo = facts.get('promo')
    if state == 'active' and owed and isinstance(promo, dict) and (promo.get('progress') or {}).get('status') == 'ready':
        if not _has_repayment_plan_forecast(debt_card) or 'payoff_month' not in debt_card:
            facts['finish_estimate'] = {'status': 'unavailable', 'reason': 'forecast_unavailable'}
        else:
            month = debt_card.get('payoff_month')
            if month is None:
                facts['finish_estimate'] = {'status': 'unavailable', 'reason': 'no_payoff'}
            elif not _valid_payoff_month(month, today):
                facts['finish_estimate'] = {'status': 'unavailable', 'reason': 'forecast_unavailable'}
            elif month >= promo['until'][:7]:
                facts['finish_estimate'] = {'status': 'unavailable', 'reason': 'offer_boundary'}
            else:
                from app.services.debt_plan import month_label_to_human
                facts['finish_estimate'] = {
                    'status': 'ready', 'month': month, 'label': month_label_to_human(month),
                    'basis': 'before_offer_end',
                }
    return facts, baseline if start is not None and start <= today else None


async def compute_progress(uid: str, previous: dict | None = None) -> dict:
    """Called only by the store's worker/change path. No writes to user plans."""
    from app.db import collections as c
    from app.services.account_plan_sources import owned_account_map
    from app.services.debt_plan import get_debt_plan_cached
    import app.routers.commitments as commitment_engine

    today = timeutil.user_today()
    all_plans = await c.commitments_col.find({'user_id': uid, 'status': 'active'}).to_list(None)
    plans = [p for p in all_plans if crp.is_card_plan(p) and goal_schedule.is_scheduled(p.get('schedule'))]
    if not plans:
        return {'plans': {}, 'baselines': {}}
    cfg = ((await c.preferences_col.find_one({'user_id': uid}) or {}).get('pay_period_config') or {'type': 'calendar_month'})
    accounts = await owned_account_map(uid)
    ids = [str(p.get('card_account_id') or '') for p in plans]
    terms = {str(t['account_id']): t for t in await c.card_terms_col.find({'user_id': uid, 'account_id': {'$in': ids}}).to_list(None)}
    starts = [pf.tracking_start(p) for p in plans if pf.tracking_start(p) is not None]
    starts += [_day(o['as_of']) for t in terms.values() for o in t.get('promos') or [] if _day(o.get('as_of')) is not None]
    first = min(starts, default=today)
    owned_ids = set(accounts)
    source_ids = {str(p.get('source_account_id') or '') for p in plans} & owned_ids
    # Booked Mongo datetimes are UTC. Bound by the user's London calendar,
    # including the final second and microseconds of the last day.
    lo = datetime.combine(first, time.min, timeutil.LONDON).astimezone(timezone.utc).replace(tzinfo=None)
    hi = datetime.combine(today + timedelta(days=1), time.min, timeutil.LONDON).astimezone(timezone.utc).replace(tzinfo=None)
    rows = []
    query = {'user_id': uid, 'account_id': {'$in': sorted(owned_ids)}, 'transaction_type': 'debit', 'date': {'$gte': lo, '$lt': hi}}
    for col in (c.transactions_col, c.yapily_transactions_col):
        rows.extend(await col.find(query, {'account_id': 1, 'transaction_type': 1, 'amount': 1, 'date': 1,
                                          'description': 1, 'merchant_name': 1, 'own_transfer_match': 1}).to_list(None))
    debt = await get_debt_plan_cached(uid)
    debt_cards = {str(d.get('account_id')): d for d in debt.get('cards') or []}
    activity = []
    for col in (c.transactions_col, c.yapily_transactions_col):
        activity.extend(await col.find({'user_id': uid, 'account_id': {'$in': ids}, 'date': {'$gte': lo, '$lt': hi}},
                                       {'account_id': 1, 'date': 1, 'amount': 1, 'transaction_type': 1, 'own_transfer_match': 1}).to_list(None))
    output, baselines = {}, {}
    old = (previous or {}).get('baselines') or {}
    ledger = await commitment_engine.compute_pot_ledger(uid, docs=all_plans)
    for plan in plans:
        pid, card_id = str(plan['_id']), str(plan.get('card_account_id') or '')
        card = accounts.get(card_id)
        if not card or str(plan.get('source_account_id') or '') not in source_ids:
            output[pid] = {'status': 'unavailable', 'reason': 'account_unavailable'}
            continue
        source = accounts[str(plan.get('source_account_id') or '')]
        if (source.get('currency') or 'GBP').upper() != 'GBP':
            output[pid] = {'status': 'unavailable', 'reason': 'source_currency_unsupported'}
            continue
        nominated = repayment_rows(plan, plans, rows, cfg)
        matched = card_payment_rows(plan, plans, rows, cfg, owned_ids)
        source_info = await commitment_engine._pot_progress_and_slice(plan, cfg, ledger, today)
        fulfilment = source_info.get('fulfilment')
        if fulfilment is None and plan.get('paused') is not True:
            output[pid] = {'status': 'unavailable', 'reason': 'payment_data_unavailable'}
            continue
        source_current_paid = int((fulfilment or {}).get('matched_pence') or 0) if fulfilment is not None else sum(a for d, a in nominated if get_pay_period_for_date(today, cfg)[0] <= d <= today)
        source_reserved = _pence(source_info.get('per_period_slice'))
        # A broad unlinked rule that also matches another saved plan cannot
        # establish historical card attribution. Current source fulfilment
        # still comes from the shared reservation engine, but no cumulative
        # offer progress is invented from that ambiguous history.
        ambiguous = any(
            not _linked_card(r) and pf.payment_matches(plan, r)
            and str(r.get('account_id') or '') == str(plan.get('source_account_id') or '')
            and any(o['_id'] != plan['_id'] and o.get('fill_rule')
                    and str(o.get('source_account_id') or '') == str(plan.get('source_account_id') or '')
                    and pf.rule_matches(o['fill_rule'], r) for o in all_plans)
            for r in rows
        )
        begins = pf.tracking_start(plan)
        other_activity = any(str(r.get('account_id')) == card_id and _day(r.get('date')) is not None
                             and begins is not None and begins <= _day(r['date']) <= today
                             and _pence(r.get('amount')) not in (None, 0) and not pf.card_link_matches(card_id, r)
                             for r in activity)
        output[pid], baseline = build_plan_facts(plan, card, terms.get(card_id) or {}, cfg, today, matched,
                                               previous_baseline=old.get(pid), debt_card=debt_cards.get(card_id),
                                               source_payments=nominated, other_card_activity=other_activity or ambiguous,
                                               source_paid_current_pence=source_current_paid,
                                               source_reserved_current_pence=source_reserved)
        if ambiguous:
            output[pid]['paid_since_start'] = None
            output[pid]['progress_reason'] = 'ambiguous_payment_history'
        if baseline is not None:
            baselines[pid] = baseline
    return {'plans': output, 'baselines': baselines}
