"""Reviewed transactions stay reviewed through provider resets and rule passes."""
import asyncio
from datetime import datetime, timedelta

from app.routers import analytics
from app.services.own_account_transfers import reconcile_own_account_transfers
from test_g377_own_account_transfers import _service_collections
from test_transfer_pairs import UID, _run_confirm, _run_apply_rules_bulk, _setup_pair_and_series, _t


def confirmed(monkeypatch, *, days=150, locked=False):
    date = datetime.utcnow() - timedelta(days=days)
    rows = [
        _t('credit', ttype='credit', amount=25.0, date=date, account_id='destination',
           desc='XFER', category='Income'),
        _t('debit', ttype='debit', amount=25.0, date=date, account_id='source',
           desc='BGC', category='Other', custom_category='Transfer' if locked else None),
    ]
    result = _run_confirm(monkeypatch, rows, 'credit', 'debit')
    assert result['ok'] and not result['learned']
    accounts = [{'_id': a, 'user_id': UID, 'currency': 'GBP', 'type': 'current'}
                for a in ('source', 'destination')]
    return rows, accounts


def test_old_confirmation_survives_provider_reset_and_reconciliation(monkeypatch):
    rows, accounts = confirmed(monkeypatch)
    rows[0]['category'], rows[1]['category'] = 'Income', 'Other'
    asyncio.run(reconcile_own_account_transfers(UID, **_service_collections(rows, accounts)))
    assert [r['category'] for r in rows] == ['Transfer', 'Transfer']
    assert all(r['own_transfer_match']['confirmed'] for r in rows)


def test_old_confirmation_keeps_manual_movement_anchor(monkeypatch):
    rows, accounts = confirmed(monkeypatch, locked=True)
    rows[0]['category'] = 'Income'
    asyncio.run(reconcile_own_account_transfers(UID, **_service_collections(rows, accounts)))
    assert rows[0]['category'] == 'Transfer'
    assert rows[1]['custom_category'] == 'Transfer'


def test_changed_bank_facts_invalidate_old_confirmation(monkeypatch):
    rows, accounts = confirmed(monkeypatch)
    rows[0]['amount'] = 26.0
    asyncio.run(reconcile_own_account_transfers(UID, **_service_collections(rows, accounts)))
    assert all('own_transfer_match' not in r for r in rows)
    assert rows[0]['category'] == 'Income'


def test_confirmation_survives_real_rules_pass_without_broad_merchant_rule(monkeypatch):
    rows, _ = confirmed(monkeypatch)
    _run_apply_rules_bulk(monkeypatch, rows)
    assert all(r['category'] == 'Transfer' for r in rows)
    other = {**rows[1], '_id': 'unrelated', 'amount': 10, 'category': 'Other'}
    other.pop('own_transfer_match')
    rows.append(other)
    _run_apply_rules_bulk(monkeypatch, rows)
    assert other['category'] != 'Transfer'


def test_review_read_during_provider_reset_does_not_repeat_confirmation(monkeypatch):
    rows = _setup_pair_and_series(monkeypatch)
    _run_confirm(monkeypatch, rows, 'c1', 'd1')
    rows[0]['category'], rows[1]['category'] = 'Income', 'Shopping'
    assert asyncio.run(analytics._transfer_pair_suggestions(UID)) == []
    assert [r['_id'] for r in asyncio.run(analytics._flagged_miscategorised(UID))] == ['d2']


def test_series_dismissal_stays_dismissed_when_sync_finds_a_counterpart(monkeypatch):
    rows = _setup_pair_and_series(monkeypatch)
    asyncio.run(analytics.dismiss_miscategorised_series({'series_key': 'To Kevin Maingi'}, {'email': UID}))
    rows[0]['category'], rows[1]['category'] = 'Income', 'Other'
    assert asyncio.run(analytics._transfer_pair_suggestions(UID)) == []
    assert asyncio.run(analytics._flagged_miscategorised(UID)) == []


def test_manual_spending_choice_is_not_flagged_again(monkeypatch):
    rows = _setup_pair_and_series(monkeypatch)
    rows[1]['custom_category'] = rows[2]['custom_category'] = 'Shopping'
    assert asyncio.run(analytics._flagged_miscategorised(UID)) == []
    assert asyncio.run(analytics._transfer_pair_suggestions(UID)) == []


def test_not_same_pair_survives_category_refresh_without_hiding_unclassified_debit(monkeypatch):
    rows = _setup_pair_and_series(monkeypatch)
    asyncio.run(analytics.dismiss_transfer_pair({'pair_key': 'c1:d1'}, {'email': UID}))
    rows[0]['category'], rows[1]['category'] = 'Income', 'Other'
    assert asyncio.run(analytics._transfer_pair_suggestions(UID)) == []
    # Not the same is not a spending decision: the debit can still need review.
    assert {r['_id'] for r in asyncio.run(analytics._flagged_miscategorised(UID))} == {'d1', 'd2'}


def test_nonstructural_rules_do_not_undo_explicit_confirmation(monkeypatch):
    from app.services import categorisation, own_account_transfers
    rows, _ = confirmed(monkeypatch)
    _run_apply_rules_bulk(monkeypatch, rows)
    rows[0]['category'], rows[1]['category'] = 'Income', 'Other'
    monkeypatch.setattr(own_account_transfers, 'get_category_kinds', categorisation.get_category_kinds)
    asyncio.run(categorisation.apply_rules_bulk(UID, structural=False))
    assert all(r['category'] == 'Transfer' for r in rows)


def test_review_only_reads_debit_candidates_and_their_exact_counterparts(monkeypatch):
    rows = _setup_pair_and_series(monkeypatch)
    _run_confirm(monkeypatch, rows, 'c1', 'd1')
    rows[1]['category'] = 'Shopping'
    collection = analytics.transactions_col
    queries = []
    original = collection.find
    def record(query, projection=None):
        queries.append(query)
        return original(query, projection)
    monkeypatch.setattr(collection, 'find', record)
    asyncio.run(analytics._flagged_miscategorised(UID))
    assert queries[0]['transaction_type'] == 'debit'
    assert queries[0]['custom_category'] is None
    assert '$nin' in queries[0]['category']
    assert queries[1]['_id'] == {'$in': ['c1']}
    assert all(q['user_id'] == UID for q in queries)
