"""Generate fictional preview facts through G492's real pure calculator.

Run with backend/.venv/bin/python. This imports no live user inputs and makes
no database calls. All outputs live inside the temporary design round.
"""
import json
import os
from pathlib import Path
import secrets
import sys
import time
from datetime import date, datetime

ROOT = Path(__file__).resolve().parents[4]
os.environ['MONGO_DB'] = f'wealth_test_{int(time.time())}_{secrets.token_hex(4)}'
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.card_plan_progress import build_plan_facts  # noqa: E402
from app.services.card_repayment_plans import fixed_schedule  # noqa: E402

TODAY = date(2026, 11, 23)
CFG = {'type': 'last_friday'}


def money(value):
    return f'£{value:,.2f}'.removesuffix('.00')


def long_date(value):
    d = date.fromisoformat(value)
    return f'{d.day} {d:%b %Y}'


def make(key, name, amount, start, count, target, balance, until, payments):
    p = {'_id': key, 'user_id': 'fictional-preview', 'plan_kind': 'card_repayment',
         'card_account_id': key + '-card', 'source_account_id': 'fictional-current',
         'created_at': datetime(2026, 10, 1),
         'schedule': fixed_schedule(amount, date.fromisoformat(start), count)}
    p['paused'] = key == 'paused'
    as_of = '2026-11-22' if start > TODAY.isoformat() else '2026-10-04'
    facts, _baseline = build_plan_facts(p, {'name': name, 'balance': -balance, 'currency': 'GBP'},
                                      {'status': 'confirmed', 'promos': [{'id': key + '-offer', 'kind': 'balance_transfer',
                                       'apr_pct': 0, 'balance': target, 'until': until, 'as_of': as_of}]},
                                      CFG, TODAY, [(date.fromisoformat(d), a) for d, a in payments])
    promo = facts['promo']
    progress = promo['progress']
    assert progress['status'] in ('ready', 'not_started'), facts
    starts_later = facts['schedule_state'] == 'not_started'
    scheduled = 'Contributions paused' if p['paused'] else f'{money(facts["display_period_planned"])} each pay period'
    if starts_later:
        scheduled += f' from {long_date(facts["starts_on"])}'
    row = {
        'id': key, 'name': name, 'scheduledLine': scheduled,
        'progressFigure': f'{money(progress["paid"])} of {money(progress["target"])}',
        'offerDeadline': f'Offer ends {long_date(until)}',
        'progressLine': f'{money(progress["paid"])} of {money(progress["target"])} · offer ends {long_date(until)}',
        'progressAria': (f'{money(progress["paid"])} in matched repayments towards the recorded single-offer target of '
                         f'{money(progress["target"])}. Balance evidence as of {long_date(as_of)}.'),
        'progressPercent': progress['paid_percent'], 'progressWidth': f'{progress["paid_percent"]}%',
        'progressTone': ('neutral' if p['paused'] or starts_later else
                         'behind' if promo['outlook'] in ('short', 'behind') else 'onPace'),
        'markerPercent': progress['expected_percent'], 'markerLeft': f'{progress["expected_percent"]}%',
        'markerLabel': f'Expected by now {money(progress["expected_by_now"])}',
        'status': ('Plan paused.' if p['paused'] else f'Would not clear by {long_date(until)}.' if promo['outlook'] == 'short' else
                   f'Would clear before {long_date(until)}.'),
        'caution': promo['outlook'] in ('short', 'behind'),
        'detailIntro': ('These repayments reconcile to the balance on one confirmed 0% offer. '
                        'Progress is an estimate based on the bank data available.'),
        'evidence': [
            {'label': 'Recorded offer balance date', 'value': long_date(as_of)},
            {'label': 'Recorded target' if starts_later else 'Offer target at tracking start', 'value': money(progress['target'])},
            {'label': 'Plan starts', 'value': long_date(start)},
            {'label': 'Planned from paying account this period', 'value': money(facts['this_period_planned'])},
            {'label': 'Paid to this card this period', 'value': money(facts['paid_this_period'])},
            {'label': 'Repayments matched since plan start', 'value': money(facts['paid_since_start'])},
            {'label': 'Still reserved in paying account', 'value': money(facts['reserved_from_source_this_period'])},
            {'label': 'Card balance owed', 'value': money(facts['balance_owed'])},
            {'label': 'Expected by now', 'value': money(progress['expected_by_now'])},
            {'label': 'Future scheduled payments before offer end', 'value': money(promo['planned_by_end'])},
            {'label': 'Projected balance left at offer end', 'value': money(promo['residual_at_end'])},
        ],
    }
    if starts_later:
        row['detailIntro'] += ' The target is provisional before the plan starts and is not retained as a future starting balance.'
    return row, facts


rows, facts = {}, {}
cases = [
    ('onTrack', 'Northbridge travel rewards repayment plan', 120000, '2026-10-05', 6, 5691, 4491, '2027-05-31', [('2026-10-10', 78000), ('2026-11-02', 42000)]),
    ('shortfall', 'Everyday card repayment plan', 6270, '2026-10-05', 20, 7402, 6775, '2027-08-31', [('2026-10-10', 62700)]),
    ('futureFirst', 'Card repayment plan starting after payday', 3071, '2026-11-27', 120, 3024, 3024, '2027-05-31', []),
    ('futureSecond', 'Second card repayment plan beginning next pay period', 6270, '2026-11-27', 120, 7402, 7402, '2027-08-31', []),
    ('paused', 'Northbridge travel rewards repayment plan', 120000, '2026-10-05', 6, 5691, 4491, '2027-05-31', [('2026-10-10', 78000), ('2026-11-02', 42000)]),
]
for case in cases:
    rows[case[0]], facts[case[0]] = make(*case)

unavailable_balance = 1200
totals = {
    'ready': money(facts['onTrack']['balance_owed'] + facts['shortfall']['balance_owed'] + unavailable_balance),
    'future': money(facts['futureFirst']['balance_owed'] + facts['futureSecond']['balance_owed'] + unavailable_balance),
}
out = Path(__file__).with_name('generated-fixtures.json')
out.write_text(json.dumps({'asOf': TODAY.isoformat(), 'rows': rows, 'facts': facts,
                          'debtTotals': totals, 'unavailableCardBalance': money(unavailable_balance)}, indent=2) + '\n')
print(f'Generated {len(rows)} fictional rows through build_plan_facts: {out.name}')
