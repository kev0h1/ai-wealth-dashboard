"""Tests for app.services.description_match — the shared equals/contains
comparison extracted so app.services.manual_account_rules (offline-account
mirror rules) and app.routers.allocations (envelope fill rules) cannot drift
apart (owner decision, 2026-08-29: "the same rule we have for the offline
account is what we should reuse here").

Also exercises app.services.manual_account_rules._matches directly as a
shared-helper regression: the refactor to delegate to description_match must
leave its behaviour byte-identical (no dedicated test file existed for it
before this change).
"""
from datetime import datetime

import app.services.manual_account_rules as manual_account_rules
from app.services.description_match import matches_contains, matches_equals


# ── matches_equals ────────────────────────────────────────────────────────

def test_equals_exact_match():
    assert matches_equals("Tesco Stores", "Tesco Stores") is True


def test_equals_case_insensitive():
    assert matches_equals("TESCO STORES", "tesco stores") is True


def test_equals_trims_whitespace():
    assert matches_equals("  Tesco Stores  ", "Tesco Stores") is True


def test_equals_rejects_partial_match():
    assert matches_equals("Tesco Stores Ltd", "Tesco Stores") is False


def test_equals_empty_match_value_never_matches():
    assert matches_equals("", "") is False
    assert matches_equals("Tesco", "") is False


def test_equals_handles_none_candidate():
    assert matches_equals(None, "Tesco") is False


# ── matches_contains ─────────────────────────────────────────────────────

def test_contains_matches_description_substring():
    assert matches_contains("tesco", "TESCO STORES 1234", None) is True


def test_contains_matches_merchant_substring():
    assert matches_contains("saving challenge", "", "Saving Challenge (2026)") is True


def test_contains_case_insensitive_and_trimmed():
    assert matches_contains("  SAVING  ", "saving challenge deposit", None) is True


def test_contains_rejects_no_substring():
    assert matches_contains("freelance", "Tesco Stores 1234", "Tesco") is False


def test_contains_empty_match_value_never_matches():
    assert matches_contains("", "anything", "anything") is False


# ── manual_account_rules._matches regression (shared-helper wiring) ──────

def _txn(description="", merchant_name=None, category=None, account_id="acc-1"):
    return {
        "description": description, "merchant_name": merchant_name,
        "category": category, "account_id": account_id,
        "date": datetime.now(),
    }


def _rule(match_type, match_value, match_field=None, source_account_id=None):
    return {
        "match_type": match_type, "match_value": match_value,
        "match_field": match_field, "source_account_id": source_account_id,
        "applies_from": None,
    }


def test_manual_rule_description_equals_exact_only():
    rule = _rule("description_equals", "Tesco Stores")
    assert manual_account_rules._matches(rule, _txn(description="Tesco Stores")) is True
    assert manual_account_rules._matches(rule, _txn(description="Tesco Stores Ltd")) is False


def test_manual_rule_description_equals_case_and_trim():
    rule = _rule("description_equals", "  TESCO stores  ")
    assert manual_account_rules._matches(rule, _txn(description="tesco stores")) is True


def test_manual_rule_description_equals_merchant_field():
    rule = _rule("description_equals", "Saving Challenge", match_field="merchant")
    assert manual_account_rules._matches(rule, _txn(merchant_name="Saving Challenge", description="ignored")) is True
    assert manual_account_rules._matches(rule, _txn(merchant_name="ignored", description="Saving Challenge")) is False


def test_manual_rule_description_contains_searches_description_and_merchant():
    rule = _rule("description_contains", "saving")
    assert manual_account_rules._matches(rule, _txn(description="Daily Saving Challenge")) is True
    assert manual_account_rules._matches(rule, _txn(description="", merchant_name="Saving Challenge (2026)")) is True
    assert manual_account_rules._matches(rule, _txn(description="Tesco", merchant_name="Tesco")) is False


def test_manual_rule_category_still_equals_exact():
    rule = _rule("category", "Groceries")
    assert manual_account_rules._matches(rule, _txn(category="Groceries")) is True
    assert manual_account_rules._matches(rule, _txn(category="groceries")) is True
    assert manual_account_rules._matches(rule, _txn(category="Grocery")) is False


def test_manual_rule_empty_match_value_never_matches():
    rule = _rule("description_contains", "")
    assert manual_account_rules._matches(rule, _txn(description="anything")) is False


def test_manual_rule_source_account_scope_still_enforced():
    rule = _rule("description_contains", "tesco", source_account_id="acc-1")
    assert manual_account_rules._matches(rule, _txn(description="Tesco", account_id="acc-1")) is True
    assert manual_account_rules._matches(rule, _txn(description="Tesco", account_id="acc-2")) is False
