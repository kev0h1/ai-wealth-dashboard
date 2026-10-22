"""G280 (Kevin, 2026-10-17): Rent built-in, Cash/Charity/Other to Free.

Fixed (commitment): Bills, Mortgage, Rent, Car finance, Groceries, Transport,
Software, plus any detected loan repayment. Free (discretionary): Eating Out,
Entertainment, Shopping, Subscriptions, Health, Beauty, Travel, Cash, Charity,
Other. Moved: Savings, Investment, Debt, Transfer. Income stays income.

Pure tests: no network, no real database.
"""
import asyncio
from datetime import date
from pathlib import Path

import pytest

import app.services.categories as categories
from app.services.categories import (
    BUILTIN_CATEGORIES,
    BUILTIN_CATEGORY_KINDS,
    COMMITMENT,
    DISCRETIONARY,
    INCOME,
    MOVEMENT,
    CategoryKinds,
    get_category_kinds,
    is_commitment,
    is_discretionary,
    is_non_spend,
    is_spend,
    kind_of,
)
from app.services.categorisation import (
    MERCHANT_PATTERNS,
    VALID_CATEGORIES,
    is_rent_payee,
    rule_categorise,
)
from app.services.money_shape import bucket_period
from app.services.spending import classify_flow, SPEND, REFUND, MOVED

FIXED = ["Bills", "Mortgage", "Rent", "Car finance", "Groceries", "Transport", "Software"]
FREE = ["Eating Out", "Entertainment", "Shopping", "Subscriptions", "Health", "Beauty",
        "Travel", "Cash", "Charity", "Other"]
MOVED_CATS = ["Savings", "Investment", "Debt", "Transfer"]

# The table as it stood on main before G280, to prove nothing else moved.
OLD_TABLE = {
    "Groceries": COMMITMENT, "Eating Out": DISCRETIONARY, "Transport": COMMITMENT,
    "Entertainment": DISCRETIONARY, "Shopping": DISCRETIONARY, "Bills": COMMITMENT,
    "Mortgage": COMMITMENT, "Car finance": COMMITMENT, "Subscriptions": DISCRETIONARY,
    "Health": DISCRETIONARY, "Beauty": DISCRETIONARY, "Travel": DISCRETIONARY,
    "Software": COMMITMENT, "Savings": MOVEMENT, "Investment": MOVEMENT, "Debt": MOVEMENT,
    "Transfer": MOVEMENT, "Income": INCOME, "Cash": COMMITMENT, "Charity": COMMITMENT,
    "Other": COMMITMENT,
}

KINDS = CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))


# ── Kinds ────────────────────────────────────────────────────────────────────

def test_kind_table_matches_kevins_lists():
    for c in FIXED:
        assert kind_of(KINDS, c) == COMMITMENT and is_commitment(KINDS, c), c
    for c in FREE:
        assert kind_of(KINDS, c) == DISCRETIONARY and is_discretionary(KINDS, c), c
    for c in MOVED_CATS:
        assert kind_of(KINDS, c) == MOVEMENT and is_non_spend(KINDS, c), c
    assert kind_of(KINDS, "Income") == INCOME
    assert set(BUILTIN_CATEGORY_KINDS) == set(FIXED + FREE + MOVED_CATS + ["Income"])


def test_only_cash_charity_other_changed_kind_and_rent_added():
    changed = {c for c in OLD_TABLE if BUILTIN_CATEGORY_KINDS[c] != OLD_TABLE[c]}
    assert changed == {"Cash", "Charity", "Other"}
    assert set(BUILTIN_CATEGORY_KINDS) - set(OLD_TABLE) == {"Rent"}


def test_unknown_and_unmapped_categories_default_to_discretionary():
    assert kind_of(KINDS, "Nonsense") == DISCRETIONARY
    assert kind_of(KINDS, None) == DISCRETIONARY
    assert kind_of(dict(BUILTIN_CATEGORY_KINDS), "Nonsense") == DISCRETIONARY
    assert is_spend(KINDS, "Nonsense")


def test_spend_vs_non_spend_set_is_unchanged_so_spending_totals_cannot_shift():
    """Cash, Charity and Other move between two SPEND kinds, so every consumer
    that asks only 'is this spend?' (Safe to Spend, pace totals, Out, cashflow)
    sees exactly the old answer. Only Rent is new, and it is spend."""
    old_non_spend = {c for c, k in OLD_TABLE.items() if k in (MOVEMENT, INCOME)}
    new_non_spend = {c for c, k in BUILTIN_CATEGORY_KINDS.items() if k in (MOVEMENT, INCOME)}
    assert old_non_spend == new_non_spend
    for c in OLD_TABLE:
        old = CategoryKinds(dict(OLD_TABLE))
        for is_debit in (True, False):
            assert classify_flow(KINDS, c, is_debit).kind == classify_flow(old, c, is_debit).kind, c
    assert is_spend(KINDS, "Rent")


def test_rent_is_spending_through_the_g268_helper():
    assert classify_flow(KINDS, "Rent", True).kind == SPEND
    assert classify_flow(KINDS, "Rent", False).kind == REFUND
    # Rent in Transfer is the defect this fixes: Transfer never counts.
    assert classify_flow(KINDS, "Transfer", True).kind == MOVED


def test_builtin_kind_wins_over_a_same_named_stored_entry(monkeypatch):
    """There is no per-user override of a BUILT-IN's kind: a stored custom
    entry named like a built-in is ignored (custom_categories filters the
    collision), so Cash stays Free whatever an old document says. A custom
    category keeps its own kind."""
    doc = {"categories": [
        {"name": "Cash", "kind": "commitment"},
        {"name": "Rent", "kind": "discretionary"},
        {"name": "Golf", "kind": "commitment"},
    ]}

    class _Col:
        async def find_one(self, *_a, **_k):
            return doc

    monkeypatch.setattr(categories, "user_categories_col", _Col())
    kinds = asyncio.run(get_category_kinds("u"))
    assert kind_of(kinds, "Cash") == DISCRETIONARY
    assert kind_of(kinds, "Rent") == COMMITMENT
    assert kind_of(kinds, "Golf") == COMMITMENT


# ── Money shape ──────────────────────────────────────────────────────────────

def _t(i, amount, cat, debit=True):
    return {"_id": i, "amount": amount, "category": cat, "date": "2026-07-05",
            "account_id": "current", "is_debit": debit}


def test_money_shape_rent_is_fixed_and_reclassified_categories_are_free():
    txns = [_t("i", 3000.0, "Income", False), _t("r", 900.0, "Rent")]
    txns += [_t(f"f{n}", 10.0, c) for n, c in enumerate(["Cash", "Charity", "Other", "Subscriptions"])]
    b = bucket_period(txns, KINDS, set(), date(2026, 7, 1), date(2026, 7, 31))
    assert b["fixed"] == 900.0
    assert b["free"] == 40.0
    assert set(b["categories"]["fixed"]) == {"Rent"}
    assert set(b["categories"]["free"]) == {"Cash", "Charity", "Other", "Subscriptions"}
    assert b["moved"] == 0.0
    assert sum(b["shares"].values()) == 100


def test_money_shape_rent_in_transfer_would_not_be_spending():
    txns = [_t("i", 3000.0, "Income", False), _t("r", 900.0, "Transfer")]
    b = bucket_period(txns, KINDS, set(), date(2026, 7, 1), date(2026, 7, 31))
    assert b["fixed"] == 0.0 and b["free"] == 0.0


# ── Rent triggers ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("merchant,desc", [
    ("Foxtons", "CARD"), ("Savills Lettings", "FASTER PAYMENT"), ("OPENRENT", ""),
    ("Connells Residential", "DD"), ("Sanctuary Housing Association", "DD"),
    ("Clarion Housing Group", "DD"), ("Peabody Trust", ""), ("Notting Hill Genesis", ""),
    ("", "STANDING ORDER RENT JAN"), ("", "STO RENT FLAT 2"),
    ("MR J SMITH", "RENT FIRST FLOOR FLAT"), ("Acme Lettings Ltd", ""),
    ("Council housing rents", ""), ("Landlord J Brown", "FPO"),
])
def test_rent_triggers_match_landlords_agents_and_housing_associations(merchant, desc):
    assert is_rent_payee(f"{merchant} {desc}")
    assert rule_categorise(merchant, desc) == "Rent"


@pytest.mark.parametrize("merchant,desc", [
    ("Enterprise Rent-A-Car", ""), ("Rent a car", "x"), ("Hertz car rental", ""),
    ("Rentokil Initial", ""), ("PARENTAL leave pay", ""), ("Rent The Runway", ""),
    ("Current account", ""), ("Landlord insurance", ""), ("Rightmove", ""),
    ("Rent pot transfer", "to pot"), ("Car rent", ""),
])
def test_rent_triggers_do_not_match_car_hire_rentokil_parental_and_pots(merchant, desc):
    assert rule_categorise(merchant, desc) != "Rent"


def test_rent_rule_sits_ahead_of_every_transfer_rule():
    idx_rent = next(i for i, (_, c) in enumerate(MERCHANT_PATTERNS) if c == "Rent")
    first_transfer_standing = next(
        i for i, (p, c) in enumerate(MERCHANT_PATTERNS) if c == "Transfer" and "standing order" in p.pattern
    )
    faster = next(i for i, (p, c) in enumerate(MERCHANT_PATTERNS) if c == "Transfer" and "faster payment" in p.pattern)
    assert idx_rent < first_transfer_standing and idx_rent < faster
    assert rule_categorise("", "FASTER PAYMENT RENT") == "Rent"


# ── Lists kept in sync ───────────────────────────────────────────────────────

def test_rent_is_in_every_builtin_list():
    from app.routers.analytics import DEFAULT_RECURRING_CATEGORIES

    assert "Rent" in BUILTIN_CATEGORIES
    assert "Rent" in VALID_CATEGORIES
    assert list(VALID_CATEGORIES) == [c for c in BUILTIN_CATEGORIES]
    assert "Rent" in DEFAULT_RECURRING_CATEGORIES
    from scripts.jev_eval import options
    assert list(options.VALID_CATEGORIES) == list(VALID_CATEGORIES)


def test_frontend_builtin_lists_include_rent():
    root = Path(__file__).resolve().parents[2] / "frontend" / "lib"
    cats = (root / "categories.ts").read_text()
    icons = (root / "categoryIcons.ts").read_text()
    assert '  "Rent",' in cats and "Rent:          \"#" in cats
    assert 'Rent:             "KeyRound"' in icons and "KeyRound," in icons
    assert "#49be37" in cats and cats.count("#d4a373") == 1  # distinct from Mortgage green


def test_penny_category_vocabulary_comes_from_builtins():
    src = (Path(__file__).resolve().parents[1] / "app" / "services" / "penny_agent.py").read_text()
    assert "BUILTIN_CATEGORIES" in src


# ── Carve-outs that must NOT change ──────────────────────────────────────────

def test_carve_outs_unchanged():
    import app.routers.analytics as analytics
    import app.services.behaviour as behaviour

    root = Path(__file__).resolve().parents[1] / "app"
    # analytics _avg_monthly_burn skips only Transfer.
    assert analytics.SKIP_BURN_CATS == {"Transfer"}
    # challenges: a fixed list, never is_discretionary, Bills not eligible.
    ch = (root / "routers" / "challenges.py").read_text()
    assert "is_discretionary(" not in ch
    from app.routers.challenges import CHALLENGE_CATS
    assert CHALLENGE_CATS == {"Eating Out", "Entertainment", "Shopping", "Groceries", "Transport", "Subscriptions"}
    assert "Bills" not in CHALLENGE_CATS and "Rent" not in CHALLENGE_CATS
    # cards.py reads the kind map (is_non_spend), not a hardcoded set.
    cards = (root / "routers" / "cards.py").read_text()
    assert "is_non_spend(kind_map" in cards and "_EXCLUDE_CATEGORIES =" not in cards
    # behaviour gambling check.
    assert behaviour._GAMBLING_CATEGORIES == {"Gambling"}


def test_signature_pleasure_now_considers_all_free_categories():
    """Intended: Subscriptions, Cash, Charity and Other are Free, so the Mirror's
    signature_pleasure trait (is_discretionary) may now anchor on them. Rent,
    like every Fixed category, never can."""
    for c in ("Subscriptions", "Cash", "Charity", "Other"):
        assert is_discretionary(KINDS, c)
    assert not is_discretionary(KINDS, "Rent")


# ── Cache bumps ──────────────────────────────────────────────────────────────

def test_cache_version_stamps_bumped_past_main_values():
    from app.services import cashflow, money_shape, pace, response_cache
    from app.services.behaviour import PORTRAIT_VERSION

    assert response_cache.SHAPE_VERSION >= 6      # main: 5
    assert cashflow.MONTHLY_CF_VERSION >= 3       # main: 2
    assert pace._SPEND_DEF_VERSION >= 3           # main: 2
    assert money_shape.SCHEMA_VERSION >= 6        # main: 5
    assert PORTRAIT_VERSION >= 1                  # main: unversioned


def test_mirror_recomputes_an_unversioned_cached_portrait(monkeypatch):
    import app.routers.behaviour as router
    from datetime import datetime, timezone

    fresh = datetime.now(timezone.utc).isoformat()
    stored = {"_id": "u", "computed_at": fresh, "status": "ok", "traits": []}

    class _Col:
        async def find_one(self, *_a, **_k):
            return dict(stored)

        async def replace_one(self, *_a, **_k):
            return None

    calls = []

    async def fake_compute(uid):
        calls.append(uid)
        return {"status": "ok", "traits": [], "portrait_version": router.PORTRAIT_VERSION}

    monkeypatch.setattr(router, "behaviour_portrait_col", _Col())
    monkeypatch.setattr(router, "compute_portrait", fake_compute)
    asyncio.run(router.get_mirror(refresh=False, user={"email": "u"}))
    assert calls == ["u"]

    stored["portrait_version"] = router.PORTRAIT_VERSION
    calls.clear()
    asyncio.run(router.get_mirror(refresh=False, user={"email": "u"}))
    assert calls == []


# ── Credit direction guard is shared by ingest and bulk re-run ───────────────

def test_rent_credit_is_income_and_debit_is_rent_through_the_shared_helper():
    from app.services.categorisation import rule_categorise_directed as d

    assert d("", "RENT REFUND", is_credit=True) == "Income"
    assert d("", "RENT REFUND", is_credit=False) == "Rent"
    # Other rule matches are unchanged for credits (a merchant refund nets).
    assert d("Tesco", "", is_credit=True) == "Groceries"
    assert d("nothing known", "", is_credit=True) is None


def test_every_ingest_path_and_bulk_rerun_use_the_directed_helper():
    root = Path(__file__).resolve().parents[1] / "app"
    for rel in ("services/truelayer_sync.py", "services/finexer_sync.py",
                "routers/statements.py"):
        src = (root / rel).read_text()
        assert "rule_categorise_directed(" in src or "credit_guard(" in src, rel
        # no direct credit-path call left behind
        for line in src.splitlines():
            if "rule_categorise(" in line and "import" not in line and "credit_guard(" not in line:
                assert "is_credit" not in line, (rel, line)
    bulk = (root / "services" / "categorisation.py").read_text()
    assert "rule_categorise_directed(merchant, description, is_credit=True)" in bulk
