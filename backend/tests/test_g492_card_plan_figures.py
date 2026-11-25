"""G492: reported figures, one unpaid schedule and honest offer evidence.

Pure/fake data only. These fixtures reproduce the reported rounded figures,
not an assertion about any user's current saved record.
"""
from datetime import date, datetime
import asyncio

import pytest

from app.services import card_plan_progress as progress, card_repayment_plans as crp, goal_schedule
from app.services import plan_fulfilment as pf

TODAY = date(2026, 11, 23)
CFG = {'type': 'last_friday'}


def plan(pence=3071, start='2026-11-27', **extra):
    return {'_id': 'plan-a', 'user_id': 'g492-fictional', 'plan_kind': crp.PLAN_KIND,
            'name': 'Northbridge Platinum repayment plan', 'card_account_id': 'card-a',
            'source_account_id': 'current-a', 'status': 'active',
            'created_at': datetime(2026, 11, 20),
            'schedule': crp.fixed_schedule(pence, date.fromisoformat(start), 120), **extra}


def card(balance=3024):
    return {'_id': 'card-a', 'name': 'NORTHBRIDGE PLATINUM', 'type': 'credit_card',
            'balance': -balance, 'currency': 'GBP', 'provider': 'northbridge'}


def offer(balance=3024, until='2027-05-31', **extra):
    return {'id': 'offer-a', 'kind': 'balance_transfer', 'offer_type': 'balance_transfer',
            'apr_pct': 0, 'balance': balance, 'until': until, **extra}


@pytest.mark.parametrize('amount,balance,until,projected,left', [
    (3071, 3024, '2027-05-31', 214.97, 2809.03),
    (6270, 7402, '2027-08-31', 627.0, 6775.0),
])
def test_reported_zero_is_this_period_not_the_recurring_payment(amount, balance, until, projected, left):
    facts, baseline = progress.build_plan_facts(plan(amount), card(balance), {'status': 'confirmed', 'promos': [offer(balance, until)]}, CFG, TODAY, [])
    assert facts['this_period_planned'] == 0
    assert facts['schedule_state'] == 'not_started'
    assert facts['display_period_planned'] == amount / 100
    assert facts['starts_on'] == facts['next_payment_date'] == '2026-11-27'
    assert facts['paid_this_period'] == facts['paid_since_start'] == 0
    assert facts['promo']['planned_by_end'] == projected
    assert facts['promo']['residual_at_end'] == left
    assert facts['promo']['outlook'] == 'short'
    assert facts['promo']['progress'] == {'status': 'unavailable', 'reason': 'starting_balance_unknown'}
    assert baseline is None


def test_unpaid_current_period_event_is_not_lost_after_its_nominal_date():
    sched = crp.fixed_schedule(10000, date(2026, 10, 1), 3)
    events = crp.remaining_plan_events(sched, CFG, TODAY)
    assert events == [(TODAY, 10000), (date(2026, 11, 27), 10000)]
    assert crp.remaining_plan_events(sched, CFG, TODAY, paid_this_period_pence=4000) == [
        (TODAY, 6000), (date(2026, 11, 27), 10000),
    ]
    assert crp.remaining_plan_events(sched, CFG, TODAY, paid_this_period_pence=10000) == [(date(2026, 11, 27), 10000)]
    assert sum(crp.plan_month_amounts(sched, CFG, TODAY, 12, paid_this_period_pence=4000).values()) == 160


def test_paid_is_once_since_start_and_future_projection_excludes_it():
    p = plan(10000, '2026-10-01')
    paid = [(date(2026, 9, 29), 8000), (date(2026, 10, 2), 10000), (date(2026, 11, 2), 10000)]
    f, _ = progress.build_plan_facts(p, card(800), {'status': 'confirmed', 'promos': [offer(1000, '2027-02-28', as_of='2026-09-30')]}, CFG, TODAY, paid)
    assert f['paid_since_start'] == 200 and f['paid_this_period'] == 100
    assert f['this_period_planned'] == 100
    assert f['promo']['balance'] == 800
    assert f['promo']['planned_by_end'] == 400
    assert f['promo']['residual_at_end'] == 400
    assert f['promo']['progress']['paid'] == 200
    assert f['promo']['progress']['paid_percent'] == 20


def debit(identifier, day, amount, linked='card-a', **extra):
    return {'_id': identifier, 'user_id': 'g492-fictional', 'account_id': 'current-a',
            'date': datetime.combine(day, datetime.min.time()), 'amount': amount,
            'transaction_type': 'debit', 'description': 'NORTHBRIDGE CARD PAYMENT',
            'own_transfer_match': {'card_repayment': {'card_account_id': linked}}, **extra}


def test_reconciled_identity_wins_and_two_legs_or_duplicate_records_never_double_count():
    p = plan(10000, '2026-11-01', fill_rule={'match_type': 'description_contains', 'match_value': 'NORTHBRIDGE'})
    a = debit('a', date(2026, 11, 2), 40)
    rows = [a, dict(a), debit('b', date(2026, 11, 3), 90, linked='card-b'),
            debit('c', date(2026, 11, 3), 50, account_id='other-source'),
            debit('d', date(2026, 11, 3), 40, transaction_type='credit')]
    assert progress.repayment_rows(p, [p], rows, CFG) == [(date(2026, 11, 2), 4000)]
    assert pf.payment_matches(p, rows[2]) is False
    assert pf.payment_matches(p, a) is True


def test_two_text_rules_cannot_both_claim_an_unlinked_payment():
    rule = {'match_type': 'description_contains', 'match_value': 'NORTHBRIDGE'}
    a = plan(10000, '2026-11-01', fill_rule=rule)
    b = plan(20000, '2026-11-01', _id='plan-b', card_account_id='card-b', fill_rule=rule)
    row = debit('a', date(2026, 11, 2), 200, own_transfer_match={})
    assert progress.repayment_rows(a, [a, b], [row], CFG) == []
    assert progress.repayment_rows(b, [a, b], [row], CFG) == [(date(2026, 11, 2), 20000)]


@pytest.mark.parametrize('payment_day,winner', [(23, 'a'), (25, 'b'), (26, 'b')])
def test_future_rival_cannot_swallow_an_earlier_payment_in_reserve_or_forecast(monkeypatch, payment_day, winner):
    from tests.test_plan_fulfilment import _Txns
    rule = {'match_type': 'description_contains', 'match_value': 'NORTHBRIDGE'}
    a = plan(10000, '2026-11-01', fill_rule=rule)
    b = plan(20000, '2026-11-25', _id='plan-b', card_account_id='card-b', fill_rule=rule)
    row = debit('unlinked', date(2026, 11, payment_day), 200, own_transfer_match={})
    monkeypatch.setattr(pf, 'transactions_col', _Txns([row]))
    monkeypatch.setattr(pf, 'yapily_transactions_col', _Txns())
    monkeypatch.setattr(pf.timeutil, 'user_today', lambda: date(2026, 11, 26))
    for current, rival, key, expected in [(a, b, 'a', 10000), (b, a, 'b', 20000)]:
        matched = progress.repayment_rows(current, [a, b], [row], CFG)
        result = asyncio.run(pf.period_fulfilment(
            current['user_id'], current, expected / 100, 'current-a',
            date(2026, 10, 30), date(2026, 11, 26),
            [{'doc': rival, 'rule': rule, 'expected_pence': 30000 - expected}], exact=True))
        paid = 20000 if key == winner else 0
        assert sum(amount for _day, amount in matched) == result['matched_pence'] == paid
        assert result['unmet_pence'] == max(0, expected - paid)
        # The debt engine consumes this same canonical nominated-source total.
        events = crp.remaining_plan_events(current['schedule'], CFG, date(2026, 11, 26),
                                           paid_this_period_pence=result['matched_pence'])
        assert sum(amount for day, amount in events if day <= date(2026, 11, 26)) == max(0, expected - paid)


def test_active_undated_offer_does_not_invent_a_starting_balance():
    f, baseline = progress.build_plan_facts(plan(10000, '2026-11-01'), card(900), {'status': 'confirmed', 'promos': [offer(1000)]}, CFG, TODAY, [(date(2026, 11, 2), 10000)])
    assert f['paid_since_start'] == 100
    assert f['promo'] is None and baseline is None
    assert f['offers'][0]['progress'] == {'status': 'unavailable', 'reason': 'starting_balance_unknown'}


def test_first_baseline_survives_later_syncs_without_recounting_payments():
    p = plan(10000, '2026-11-27')
    terms = {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-11-22')]}
    _f, initial = progress.build_plan_facts(p, card(1000), terms, CFG, TODAY, [])
    f, kept = progress.build_plan_facts(p, card(900), terms, CFG, date(2026, 11, 28), [(date(2026, 11, 27), 10000)], previous_baseline=initial)
    assert initial is None, 'a future starting balance is never sealed early'
    assert kept['target_pence'] == 100000
    assert f['promo']['progress']['target'] == 1000
    assert f['promo']['progress']['paid'] == 100
    assert f['promo']['balance'] == 900


def test_pre_start_payments_update_the_provisional_target_before_it_is_sealed():
    p = plan(10000, '2026-11-27')
    terms = {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-11-22')]}
    f, baseline = progress.build_plan_facts(p, card(900), terms, CFG, date(2026, 11, 26), [(date(2026, 11, 25), 10000)])
    assert baseline is None
    assert f['promo']['progress']['status'] == 'not_started'
    assert f['promo']['progress']['target'] == 900
    assert f['paid_since_start'] == 0
    f, baseline = progress.build_plan_facts(p, card(850), terms, CFG, date(2026, 11, 28), [(date(2026, 11, 25), 10000), (date(2026, 11, 27), 5000)])
    assert baseline['target_pence'] == 90000
    assert f['promo']['progress']['target'] == 900 and f['promo']['progress']['paid'] == 50


def test_paused_plans_do_not_show_a_live_planned_contribution():
    f, _ = progress.build_plan_facts(plan(10000, '2026-11-01', paused=True), card(900),
                                     {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-10-31')]}, CFG, TODAY,
                                     [(date(2026, 11, 2), 10000)])
    assert f['schedule_state'] == 'paused'
    assert f['this_period_planned'] == f['display_period_planned'] == 0
    assert f['next_payment'] is None
    assert f['paid_this_period'] == 100
    assert f['reserved_from_source_this_period'] == 0


def test_all_owned_card_links_count_but_the_nominated_source_rule_does_not_spread():
    p = plan(10000, '2026-11-01')
    rows = [debit('a', date(2026, 11, 2), 100), debit('b', date(2026, 11, 3), 50, account_id='second-owned'),
            debit('c', date(2026, 11, 3), 500, account_id='not-owned')]
    nominated = progress.repayment_rows(p, [p], rows, CFG)
    all_card = progress.card_payment_rows(p, [p], rows, CFG, {'current-a', 'second-owned'})
    assert sum(a for _d, a in nominated) == 10000
    assert sum(a for _d, a in all_card) == 15000
    f, _ = progress.build_plan_facts(p, card(850), {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-10-31')]}, CFG, TODAY,
                                     all_card, source_payments=nominated)
    assert f['paid_this_period'] == f['paid_since_start'] == 150
    assert f['paid_from_source_this_period'] == 100
    assert f['reserved_from_source_this_period'] == 0


def test_unconfirmed_and_same_day_ambiguous_offer_balances_cannot_create_progress():
    p = plan(10000, '2026-11-01')
    payments = [(date(2026, 11, 2), 10000)]
    f, _ = progress.build_plan_facts(p, card(900), {'status': 'draft', 'promos': [offer(1000, as_of='2026-10-31')]}, CFG, TODAY, payments)
    assert f['offers'] == [] and f['offer_status'] == 'unconfirmed'
    f, _ = progress.build_plan_facts(p, card(900), {'status': 'confirmed', 'promos': [offer(900, as_of='2026-11-02')]}, CFG, TODAY, payments)
    assert f['promo'] is None
    assert f['offers'][0]['progress']['reason'] == 'offer_day_payment_ambiguous'


@pytest.mark.parametrize('bad_target', [0, -1, True])
def test_malformed_retained_target_is_not_trusted(bad_target):
    p = plan(10000, '2026-11-01')
    terms = {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-10-31')]}
    _f, baseline = progress.build_plan_facts(p, card(900), terms, CFG, TODAY, [(date(2026, 11, 2), 10000)])
    corrupted = {**baseline, 'target_pence': bad_target}
    f, repaired = progress.build_plan_facts(p, card(900), terms, CFG, TODAY, [(date(2026, 11, 2), 10000)], previous_baseline=corrupted)
    assert repaired['target_pence'] == 100000
    assert f['promo']['progress']['paid_percent'] == 10


def test_refunds_or_other_balance_differences_do_not_become_offer_repayments():
    f, _ = progress.build_plan_facts(plan(10000, '2026-11-01'), card(700),
                                     {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-10-31')]}, CFG, TODAY,
                                     [(date(2026, 11, 2), 20000)])
    assert f['promo'] is None
    assert f['offers'][0]['progress']['reason'] == 'allocation_unknown'


def test_card_balance_fallback_and_reservation_share_the_same_value():
    c = {**card(1000), 'balance': None, 'current_balance': -1000}
    f, _ = progress.build_plan_facts(plan(), c, {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-11-22')]}, CFG, TODAY, [])
    assert f['balance_owed'] == 1000
    assert f['promo']['progress']['target'] == 1000


def test_future_forecast_switches_at_the_first_plan_period_and_retains_only_prior_bills():
    import app.services.debt_plan as engine
    sched = crp.fixed_schedule(3071, date(2026, 11, 27), 3)
    prior = engine._payments_before_plan([
        {'amount': 100, 'next_date': '2026-11-24', '_fixed_monthly': True},
    ], TODAY, date(2026, 11, 27))
    assert prior == [(date(2026, 11, 24), 10000)]
    months = crp.plan_month_amounts(sched, CFG, TODAY, 5, prior_payments=prior)
    assert months == {1: 161.42, 2: 30.71, 3: 0, 4: 0, 5: 0}


@pytest.mark.parametrize('terms,expected_reason', [
    ({'status': 'confirmed', 'promos': [offer(None)]}, 'offer_balance_unknown'),
    ({'status': 'confirmed', 'promos': [offer(1000), offer(500, '2027-08-31', id='offer-b')]}, 'allocation_unknown'),
    ({'status': 'confirmed', 'promos': [offer(1000, apr_pct=3.9)]}, 'interest_projection_unknown'),
])
def test_unknown_or_multiple_offers_do_not_receive_false_progress(terms, expected_reason):
    f, _ = progress.build_plan_facts(plan(), card(1000), terms, CFG, TODAY, [])
    assert f['promo'] is None
    assert all(o['progress']['status'] == 'unavailable' for o in f['offers'])
    assert f['offers'][0]['progress']['reason'] == expected_reason
    assert all('paid_percent' not in o['progress'] for o in f['offers'])


def test_other_card_debt_does_not_become_progress_on_the_one_known_offer():
    f, _ = progress.build_plan_facts(plan(), card(1500), {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-11-22')]}, CFG, TODAY, [])
    assert f['promo'] is None
    assert f['offers'][0]['progress']['reason'] == 'allocation_unknown'


def test_expiry_day_is_not_an_assumed_zero_rate_payment_slot():
    p = plan(10000, '2027-05-31')
    f, _ = progress.build_plan_facts(p, card(100), {'status': 'confirmed', 'promos': [offer(100, '2027-05-31')]}, {'type': 'calendar_month'}, date(2027, 5, 30), [])
    assert f['promo']['planned_by_end'] == 0
    assert f['promo']['residual_at_end'] == 100


def test_marker_is_the_clearing_target_by_now_not_an_inadequate_plan_schedule():
    p = plan(10000, '2026-11-01')
    f, _ = progress.build_plan_facts(p, card(800), {'status': 'confirmed', 'promos': [offer(1000, '2026-11-29', as_of='2026-10-31')]}, {'type': 'calendar_month'}, date(2026, 11, 15), [(date(2026, 11, 2), 20000)])
    assert f['promo']['progress']['expected_by_now'] == 500
    assert f['promo']['progress']['expected_percent'] == 50
    assert f['promo']['progress']['paid_percent'] == 20


def _active_finish_facts(*, payoff_month='2027-04', terms=None, card_balance=900, plan_doc=None):
    """One reconciled active 0% offer, with a debt-plan payoff supplied separately."""
    p = plan_doc or plan(10000, '2026-11-01')
    terms = terms or {'status': 'confirmed', 'promos': [offer(1000, '2027-05-31', as_of='2026-10-31')]}
    debt = {'repayment_plan': {'schedule': p['schedule']}, 'payoff_month': payoff_month}
    return progress.build_plan_facts(p, card(card_balance), terms, CFG, TODAY,
                                     [(date(2026, 11, 2), 10000)], debt_card=debt)[0]


def test_finish_estimate_is_a_pre_offer_month_from_the_persisted_debt_forecast():
    f = _active_finish_facts()
    assert f['finish_estimate'] == {
        'status': 'ready', 'month': '2027-04', 'label': 'Apr 2027', 'basis': 'before_offer_end',
    }


@pytest.mark.parametrize('payoff_month', ['2027-05', '2027-06'])
def test_finish_estimate_never_claims_the_offer_boundary_or_after(payoff_month):
    f = _active_finish_facts(payoff_month=payoff_month)
    assert f['finish_estimate'] == {'status': 'unavailable', 'reason': 'offer_boundary'}


@pytest.mark.parametrize('payoff_month', ['2027-5', '2027-13', '0000-01', '2026-10', 202705, True])
def test_finish_estimate_rejects_malformed_forecast_months(payoff_month):
    f = _active_finish_facts(payoff_month=payoff_month)
    assert f['finish_estimate'] == {'status': 'unavailable', 'reason': 'forecast_unavailable'}
    assert f['would_clear_by'] is None


def test_finish_estimate_distinguishes_a_missing_forecast_from_an_explicit_no_payoff():
    p = plan(10000, '2026-11-01')
    terms = {'status': 'confirmed', 'promos': [offer(1000, '2027-05-31', as_of='2026-10-31')]}
    f, _ = progress.build_plan_facts(p, card(900), terms, CFG, TODAY, [(date(2026, 11, 2), 10000)])
    assert f['finish_estimate'] == {'status': 'unavailable', 'reason': 'forecast_unavailable'}
    kwargs = {'debt_card': {'repayment_plan': {'schedule': p['schedule']}}}
    f, _ = progress.build_plan_facts(p, card(900), terms, CFG, TODAY, [(date(2026, 11, 2), 10000)], **kwargs)
    assert f['finish_estimate'] == {'status': 'unavailable', 'reason': 'forecast_unavailable'}
    f = _active_finish_facts(payoff_month=None)
    assert f['finish_estimate'] == {'status': 'unavailable', 'reason': 'no_payoff'}


@pytest.mark.parametrize('repayment_plan', ['saved plan', True, []])
def test_finish_estimate_requires_a_nonempty_repayment_plan_object(repayment_plan):
    p = plan(10000, '2026-11-01')
    f, _ = progress.build_plan_facts(
        p, card(900), {'status': 'confirmed', 'promos': [offer(1000, '2027-05-31', as_of='2026-10-31')]},
        CFG, TODAY, [(date(2026, 11, 2), 10000)],
        debt_card={'repayment_plan': repayment_plan, 'payoff_month': '2027-04'},
    )
    assert f['finish_estimate'] == {'status': 'unavailable', 'reason': 'forecast_unavailable'}
    assert f['would_clear_by'] is None


def test_finish_estimate_names_non_live_schedule_states_without_a_date():
    future, _ = progress.build_plan_facts(
        plan(10000, '2026-11-27'), card(1000),
        {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-11-22')]}, CFG, TODAY, [],
        debt_card={'repayment_plan': {'schedule': {}}, 'payoff_month': '2027-02'},
    )
    paused, _ = progress.build_plan_facts(
        plan(10000, '2026-11-01', paused=True), card(900),
        {'status': 'confirmed', 'promos': [offer(1000, as_of='2026-10-31')]}, CFG, TODAY,
        [(date(2026, 11, 2), 10000)], debt_card={'repayment_plan': {'schedule': {}}, 'payoff_month': '2027-02'},
    )
    ended_plan = plan(10000, '2026-01-01')
    ended_plan['schedule'] = crp.fixed_schedule(10000, date(2026, 1, 1), 1)
    ended, _ = progress.build_plan_facts(ended_plan, card(900), {'status': 'confirmed', 'promos': [offer(1000, as_of='2025-12-31')]}, CFG, TODAY, [])
    cleared = _active_finish_facts(card_balance=0)
    assert future['finish_estimate'] == {'status': 'unavailable', 'reason': 'future_plan'}
    assert paused['finish_estimate'] == {'status': 'unavailable', 'reason': 'paused'}
    assert ended['finish_estimate'] == {'status': 'unavailable', 'reason': 'ended'}
    assert cleared['finish_estimate'] == {'status': 'unavailable', 'reason': 'balance_cleared'}


@pytest.mark.parametrize('terms,card_balance', [
    ({'status': 'confirmed', 'promos': [offer(1000, '2027-05-31', as_of='2026-10-31', apr_pct=3.9)]}, 900),
    ({'status': 'confirmed', 'promos': [offer(1000, '2027-05-31', as_of='2026-10-31')]}, 700),
])
def test_finish_estimate_needs_reconciled_zero_rate_offer_progress(terms, card_balance):
    f = _active_finish_facts(terms=terms, card_balance=card_balance)
    assert f['finish_estimate'] == {'status': 'unavailable', 'reason': 'offer_progress_unavailable'}


def test_daily_challenge_correct_and_old_schedules_are_distinct_stored_inputs():
    # G357 records the earlier confirmed 812.80/December draft. G492's
    # 61/871/January shape follows a different, 65-day schedule. A read must
    # neither reinterpret the old record nor rewrite it without a user edit.
    correct = {'type': 'arithmetic', 'start_pence': 1212, 'step_pence': 4, 'step_unit': 'day',
               'start_date': '2026-11-13', 'count': 65, 'end_date': None}
    old = {**correct, 'start_pence': 1144, 'start_date': '2026-10-29', 'count': None, 'end_date': '2026-12-31'}
    before = dict(old)
    view = goal_schedule.preview(correct, CFG, TODAY)
    assert view['total'] == 871 and view['end_date'] == '2027-01-16'
    assert sum(a for d, a in goal_schedule.events(correct, CFG) if d <= date(2026, 11, 17)) / 100 == 61
    prior = goal_schedule.preview(old, CFG, TODAY)
    assert prior['total'] == 812.8 and prior['end_date'] == '2026-12-31'
    assert old == before


@pytest.mark.parametrize('state', ['pending', 'stale', 'unavailable'])
def test_plan_reader_preserves_missing_readiness_instead_of_zero_paid(monkeypatch, state):
    import app.routers.commitments as commitments
    from app.services import card_plan_store

    async def read(uid):
        return {'status': state, 'as_of': None, 'plans': {}}

    monkeypatch.setattr(card_plan_store, 'read', read)
    p, item = plan(), {}
    asyncio.run(commitments._attach_card_plans('g492-fictional', [item], [p], CFG, TODAY))
    assert item['card_plan'] == {'status': state, 'as_of': None}
    assert 'paid_this_period' not in item['card_plan']


def test_worker_calculation_scopes_the_user_source_and_london_start_day(monkeypatch):
    import app.db.collections as c
    import app.services.account_plan_sources as sources
    import app.services.debt_plan as debt_plan
    import app.routers.commitments as commitment_engine

    p = plan(10000, '2026-07-10')
    uid = p['user_id']
    rows = [
        debit('before', date(2026, 7, 9), 80, date=datetime(2026, 7, 9, 22, 30)),
        # This UTC instant is already the first day of the plan in London.
        debit('included', date(2026, 7, 9), 100, date=datetime(2026, 7, 9, 23, 30)),
        debit('other-user', date(2026, 7, 10), 200, user_id='someone-else'),
        debit('other-source', date(2026, 7, 10), 300, account_id='other-account'),
        debit('other-card', date(2026, 7, 10), 400, linked='card-b'),
    ]

    class Col:
        def __init__(self, docs):
            self.docs = docs

        def find(self, query, *_args):
            def matches(d):
                for key, value in query.items():
                    actual = d.get(key)
                    if isinstance(value, dict):
                        if '$in' in value and actual not in value['$in']:
                            return False
                        if '$gte' in value and actual < value['$gte']:
                            return False
                        if '$lt' in value and actual >= value['$lt']:
                            return False
                    elif actual != value:
                        return False
                return True

            selected = [dict(d) for d in self.docs if matches(d)]

            class Cursor:
                async def to_list(self, _n):
                    return selected
            return Cursor()

        async def find_one(self, query):
            return next((dict(d) for d in self.docs if all(d.get(k) == v for k, v in query.items())), None)

    monkeypatch.setattr(c, 'commitments_col', Col([p]))
    monkeypatch.setattr(c, 'preferences_col', Col([{'user_id': uid, 'pay_period_config': {'type': 'calendar_month'}}]))
    monkeypatch.setattr(c, 'card_terms_col', Col([{'user_id': uid, 'account_id': 'card-a', 'status': 'confirmed', 'promos': [offer(1000, as_of='2026-07-09')]}]))
    monkeypatch.setattr(c, 'transactions_col', Col(rows))
    monkeypatch.setattr(c, 'yapily_transactions_col', Col([]))
    monkeypatch.setattr(progress.timeutil, 'user_today', lambda: date(2026, 7, 10))

    async def accounts(owner):
        assert owner == uid
        return {'card-a': card(900), 'current-a': {'_id': 'current-a', 'currency': 'GBP'}}

    async def debt(owner):
        assert owner == uid
        return {'cards': []}

    monkeypatch.setattr(sources, 'owned_account_map', accounts)
    monkeypatch.setattr(debt_plan, 'get_debt_plan_cached', debt)

    async def ledger(owner, docs=None):
        assert owner == uid
        return {}

    async def source_info(doc, cfg, balances, today):
        assert doc == p
        return {'fulfilment': {'matched_pence': 10000}, 'per_period_slice': 0}

    monkeypatch.setattr(commitment_engine, 'compute_pot_ledger', ledger)
    monkeypatch.setattr(commitment_engine, '_pot_progress_and_slice', source_info)
    facts = asyncio.run(progress.compute_progress(uid))['plans'][p['_id']]
    assert facts['paid_since_start'] == facts['paid_this_period'] == 100
    assert facts['promo'] is None, 'a payment on the statement day has no known closing cutoff'
    assert facts['offers'][0]['progress']['reason'] == 'offer_day_payment_ambiguous'
    assert facts['card_name'] == 'Northbridge Platinum'


def test_shared_reservation_matcher_uses_the_same_london_tracking_day(monkeypatch):
    from tests.test_plan_fulfilment import _Txns
    p = plan(10000, '2026-07-10')
    rows = [debit('before', date(2026, 7, 9), 80, date=datetime(2026, 7, 9, 22, 30)),
            debit('on-start', date(2026, 7, 9), 100, date=datetime(2026, 7, 9, 23, 30))]
    monkeypatch.setattr(pf, 'transactions_col', _Txns(rows))
    monkeypatch.setattr(pf, 'yapily_transactions_col', _Txns())
    monkeypatch.setattr(pf.timeutil, 'user_today', lambda: date(2026, 7, 10))
    f = asyncio.run(pf.period_fulfilment(p['user_id'], p, 100, 'current-a', date(2026, 7, 1), date(2026, 7, 31), exact=True))
    assert f['matched_pence'] == 10000 and f['unmet_pence'] == 0
    assert f['matched'][0]['date'] == '2026-07-10'


def test_real_debt_engine_adopts_both_future_plans_without_dropping_the_current_bill(monkeypatch):
    import app.services.debt_plan as engine
    import app.services.card_statements as statements
    import app.routers.commitments as commitments

    uid = 'g492-engine-fictional'
    a = {**plan(3071), 'user_id': uid}
    b = {**plan(6270), '_id': 'plan-b', 'card_account_id': 'card-b', 'user_id': uid}
    cards = [{**card(3024), 'user_id': uid}, {**card(7402), '_id': 'card-b', 'user_id': uid, 'name': 'Northbridge Beta'}]

    class Cursor:
        def __init__(self, docs): self.docs = docs
        async def to_list(self, _n): return self.docs
        def __aiter__(self):
            async def rows():
                for item in self.docs:
                    yield dict(item)
            return rows()

    class Col:
        def __init__(self, docs): self.docs = docs
        def find(self, query, *args): return Cursor(self.docs)
        async def find_one(self, query, *args): return self.docs[0] if self.docs else None

    monkeypatch.setattr(engine, 'accounts_col', Col(cards))
    monkeypatch.setattr(engine, 'transactions_col', Col([]))
    monkeypatch.setattr(engine, 'preferences_col', Col([{'user_id': uid, 'pay_period_config': CFG}]))
    monkeypatch.setattr(engine, 'card_terms_col', Col([
        {'user_id': uid, 'account_id': 'card-a', 'status': 'confirmed', 'apr_pct': 0, 'promos': [offer(3024)]},
        {'user_id': uid, 'account_id': 'card-b', 'status': 'confirmed', 'apr_pct': 0, 'promos': [offer(7402, '2027-08-31')]},
    ]))
    monkeypatch.setattr(engine.timeutil, 'user_today', lambda: TODAY)

    async def plans(owner, *_args, **_kwargs):
        assert owner == uid
        return {'card-a': a, 'card-b': b}

    async def mapped(*_args):
        return ({'card-a': {1: 200}, 'card-b': {1: 100}},
                {'card-a': [{'amount': 100, 'next_date': '2026-11-24', '_fixed_monthly': True}],
                 'card-b': [{'amount': 50, 'next_date': '2026-11-24', '_fixed_monthly': True}]}, set())

    async def no_statements(*_args, **_kwargs): return {}
    async def not_yet_due(doc, due, *_args, **_kwargs):
        assert due == 0
        return {'matched_pence': 0}

    monkeypatch.setattr(crp, 'forecast_card_plans', plans)
    monkeypatch.setattr(engine, '_map_upcoming_bills_to_cards', mapped)
    monkeypatch.setattr(statements, 'load_statement_bills', no_statements)
    monkeypatch.setattr(commitments, '_plan_fulfilment', not_yet_due)
    real_amortise = engine._amortise
    used = {}

    def record(balance, *args, **kwargs):
        used[balance] = dict(kwargs.get('predicted_by_month') or {})
        return real_amortise(balance, *args, **kwargs)

    monkeypatch.setattr(engine, '_amortise', record)
    result = asyncio.run(engine.compute_debt_plan(uid))
    assert used[3024][1] == 161.42 and used[3024][2] == 30.71
    assert used[7402][1] == 175.4 and used[7402][2] == 62.7
    assert all(c['near_term_source'] == 'repayment plan' for c in result['cards'])
    assert all(c['repayment_plan']['starts_on'] == '2026-11-27' for c in result['cards'])
