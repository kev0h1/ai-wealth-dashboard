"""Tests for B25 (scripts/stripe_bootstrap.py — idempotent Stripe TEST-mode
product/price bring-up for B5/B22 billing).

No real `stripe` package is called anywhere in this file — `stripe` is
monkeypatched onto stripe_bootstrap.stripe directly with a small fake built
by `_make_fake_stripe()` below, matching test_billing.py's own
`_make_fake_stripe()` pattern (a non-None module-level `stripe` name is
what every function in the module under test reads at call time).

`scripts/stripe_bootstrap.py` lives outside the `app` package (it's a
top-level repo script, run with `backend/.venv/bin/python
scripts/stripe_bootstrap.py`), so it's imported here by adding the repo's
`scripts/` directory to `sys.path`, the same trick the script itself uses
to reach `app.core.*` from `backend/`.
"""
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import stripe_bootstrap  # noqa: E402
from app.core.config import _STRIPE_REQUIRED_PRICE_KEYS  # noqa: E402
from app.core.subscription import TIER_BILLING_PRICES_GBP  # noqa: E402


def _obj(**kw):
    return type("Obj", (), kw)()


# ── Fake stripe ──────────────────────────────────────────────────────────

# Intentionally tiny so a test can put more than one "page" of objects in
# the fake state cheaply (the real catalog here is already 6 products / 20
# prices, so with a real-sized page of 100 every existing test would
# accidentally already prove multi-page correctness without ever showing
# a naive `.data`-only read failing). A `.list(...)` call only ever
# returns one page's worth via `.data`; only `.auto_paging_iter()` walks
# every page, matching what the real `stripe` SDK does.
_FAKE_PAGE_SIZE = 2


def _paginate(items: list, kwargs: dict):
    starting_after = kwargs.get("starting_after")
    start_idx = 0
    if starting_after:
        for i, it in enumerate(items):
            if it.id == starting_after:
                start_idx = i + 1
                break
    page = items[start_idx:start_idx + _FAKE_PAGE_SIZE]
    has_more = start_idx + _FAKE_PAGE_SIZE < len(items)
    result = _obj(data=page, has_more=has_more)

    def auto_paging_iter():
        idx = start_idx
        while True:
            chunk = items[idx:idx + _FAKE_PAGE_SIZE]
            if not chunk:
                break
            for item in chunk:
                yield item
            idx += _FAKE_PAGE_SIZE

    result.auto_paging_iter = auto_paging_iter
    return result


class _FakePrice:
    def __init__(self, id, lookup_key, unit_amount, currency, recurring, product, metadata,
                 tax_behavior=None, active=True):
        self.id = id
        self.lookup_key = lookup_key
        self.unit_amount = unit_amount
        self.currency = currency
        self.recurring = recurring
        self.product = product
        self.metadata = metadata
        self.tax_behavior = tax_behavior
        self.active = active


class _FakeProduct:
    def __init__(self, id, name, metadata, active=True):
        self.id = id
        self.name = name
        self.metadata = metadata
        self.active = active


def _make_fake_stripe():
    """Minimal fake of the parts of the `stripe` SDK stripe_bootstrap.py
    actually calls: Product.create/.list, Price.create/.list/.modify. Each
    `*_calls` list records the kwargs it was called with so tests can
    assert on them, matching test_billing.py's `_make_fake_stripe()`
    convention."""
    products: list[_FakeProduct] = []
    prices: list[_FakePrice] = []
    product_create_calls: list[dict] = []
    price_create_calls: list[dict] = []
    price_modify_calls: list[dict] = []
    _counter = {"product": 0, "price": 0}

    class _Product:
        @staticmethod
        def create(**kwargs):
            product_create_calls.append(kwargs)
            _counter["product"] += 1
            prod = _FakeProduct(
                id=f"prod_{_counter['product']}", name=kwargs["name"],
                metadata=kwargs.get("metadata", {}),
            )
            products.append(prod)
            return prod

        @staticmethod
        def list(**kwargs):
            pool = [p for p in products if p.active] if kwargs.get("active") else list(products)
            return _paginate(pool, kwargs)

    class _Price:
        @staticmethod
        def create(**kwargs):
            price_create_calls.append(kwargs)
            _counter["price"] += 1
            price = _FakePrice(
                id=f"price_{_counter['price']}", lookup_key=kwargs.get("lookup_key"),
                unit_amount=kwargs["unit_amount"], currency=kwargs["currency"],
                recurring=kwargs.get("recurring"), product=kwargs["product"],
                metadata=kwargs.get("metadata", {}), tax_behavior=kwargs.get("tax_behavior"),
            )
            prices.append(price)
            return price

        @staticmethod
        def list(**kwargs):
            pool = list(prices)
            lookup_keys = kwargs.get("lookup_keys")
            if lookup_keys is not None:
                pool = [p for p in pool if p.lookup_key in lookup_keys]
            if kwargs.get("active"):
                pool = [p for p in pool if p.active]
            return _paginate(pool, kwargs)

        @staticmethod
        def modify(price_id, **kwargs):
            price_modify_calls.append({"id": price_id, **kwargs})
            for p in prices:
                if p.id == price_id:
                    for k, v in kwargs.items():
                        setattr(p, k, v)
            return _obj(id=price_id)

    fake = _obj(Product=_Product, Price=_Price, api_key=None)
    fake.products = products
    fake.prices = prices
    fake.product_create_calls = product_create_calls
    fake.price_create_calls = price_create_calls
    fake.price_modify_calls = price_modify_calls
    return fake


# ── 1. Plan completeness / amounts ─────────────────────────────────────────

def test_plan_produces_every_required_key():
    _, prices = stripe_bootstrap.build_plan()
    assert {p.lookup_key for p in prices} == set(_STRIPE_REQUIRED_PRICE_KEYS)
    assert len(_STRIPE_REQUIRED_PRICE_KEYS) == 20


def test_plan_amounts_match_pence_exactly():
    _, prices = stripe_bootstrap.build_plan()
    by_key = {p.lookup_key: p for p in prices}
    assert by_key["max_annual"].unit_amount == 16999
    assert by_key["lite_three_months"].unit_amount == 1699
    # cross-check every key against the source table directly, not a
    # second hand-copied expectation.
    for tier in ("lite", "standard", "connect", "max"):
        for period, key in (
            ("monthly", tier), ("three_months", f"{tier}_three_months"),
            ("six_months", f"{tier}_six_months"), ("annual", f"{tier}_annual"),
        ):
            expected = round(TIER_BILLING_PRICES_GBP[tier][period] * 100)
            assert by_key[key].unit_amount == expected, key


def test_statements_gets_no_product_or_price():
    products, prices = stripe_bootstrap.build_plan()
    assert not any("statements" in p.product_key for p in products)
    assert not any("statements" in p.metadata.get("tier", "") for p in prices)
    # 4 tier products + penny_topups + mcp_calls, never a 5th tier product.
    assert len(products) == 6
    # 4 tiers x 4 periods + 3 penny packs + 1 mcp pack, never the 24 you'd
    # get if statements' all-zero periods were wrongly included.
    assert len(prices) == 20


# ── 2. Safety gate ──────────────────────────────────────────────────────────

def test_live_key_refused_before_any_stripe_call(monkeypatch):
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_x")

    with pytest.raises(SystemExit) as exc_info:
        stripe_bootstrap.main([])
    assert exc_info.value.code != 0
    assert fake.product_create_calls == []
    assert fake.price_create_calls == []


def test_missing_key_refused(monkeypatch):
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)

    with pytest.raises(SystemExit) as exc_info:
        stripe_bootstrap.main([])
    assert exc_info.value.code != 0
    assert fake.product_create_calls == []


def test_dry_run_makes_no_stripe_calls(monkeypatch, capsys):
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")

    result = stripe_bootstrap.main(["--dry-run"])
    assert result == 0
    assert fake.product_create_calls == []
    assert fake.price_create_calls == []
    out = capsys.readouterr().out
    assert "STRIPE_PRICE_IDS=" in out
    assert "<would-create>" in out


# ── 3. Real run — idempotency ───────────────────────────────────────────────

def test_fresh_run_creates_all_20_keys(monkeypatch):
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")

    result_ids = stripe_bootstrap.run_real("sk_test_dummy", *stripe_bootstrap.build_plan())
    assert set(result_ids.keys()) == set(_STRIPE_REQUIRED_PRICE_KEYS)
    assert len(fake.product_create_calls) == 6
    assert len(fake.price_create_calls) == 20


def test_second_run_creates_nothing_new(monkeypatch):
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)

    products, prices = stripe_bootstrap.build_plan()
    ids_1 = stripe_bootstrap.run_real("sk_test_dummy", products, prices)
    creates_after_1 = (len(fake.product_create_calls), len(fake.price_create_calls))

    ids_2 = stripe_bootstrap.run_real("sk_test_dummy", products, prices)
    creates_after_2 = (len(fake.product_create_calls), len(fake.price_create_calls))

    assert creates_after_2 == creates_after_1
    assert ids_2 == ids_1


def test_changed_price_amount_transfers_lookup_key_and_archives_stale(monkeypatch):
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)

    # Pre-seed an existing product + a stale price for lite_annual at the
    # wrong amount (not 5999).
    stale_product = fake.Product.create(name="Sorted Lite", metadata={"app_product_key": "tier_lite"})
    stale_price = fake.Price.create(
        product=stale_product.id, lookup_key="lite_annual", unit_amount=5499,
        currency="gbp", recurring={"interval": "year", "interval_count": 1},
        metadata={"tier": "lite", "period": "annual"},
    )
    fake.product_create_calls.clear()
    fake.price_create_calls.clear()

    products, prices = stripe_bootstrap.build_plan()
    result_ids = stripe_bootstrap.run_real("sk_test_dummy", products, prices)

    # A new price was created with transfer_lookup_key=True and the
    # correct amount.
    transfer_calls = [c for c in fake.price_create_calls if c.get("lookup_key") == "lite_annual"]
    assert len(transfer_calls) == 1
    assert transfer_calls[0]["transfer_lookup_key"] is True
    assert transfer_calls[0]["unit_amount"] == 5999

    # The stale price was archived, not left active.
    modify_calls = [c for c in fake.price_modify_calls if c["id"] == stale_price.id]
    assert len(modify_calls) == 1
    assert modify_calls[0]["active"] is False

    # The resulting map points lite_annual at the NEW price, not the stale one.
    assert result_ids["lite_annual"] != stale_price.id


# ── 4. Copy rules — no em dashes in Stripe-rendered names ──────────────────

def test_product_names_have_no_em_dash():
    """Stripe product names are user-facing (Checkout, invoices, receipts,
    customer portal) so this repo's copy rules (no em dashes) apply to
    them same as any other user-facing string."""
    products, _ = stripe_bootstrap.build_plan()
    for product in products:
        assert "—" not in product.name, product.name


def test_product_names_match_expected_strings():
    products, _ = stripe_bootstrap.build_plan()
    names = {p.name for p in products}
    assert names == {
        "Sorted Lite", "Sorted Standard", "Sorted Connect", "Sorted Max",
        "Sorted Penny message top-ups", "Sorted MCP call pack",
    }


# ── 5. Pagination ────────────────────────────────────────────────────────

def test_second_run_across_multiple_pages_creates_nothing_new(monkeypatch):
    """A single `limit=100`-sized page silently stops at 100 objects; on a
    real Stripe account that accumulates other products/prices over time,
    a `.data`-only read would eventually go blind past the first page and
    this idempotent script would start creating duplicates at lookup_keys
    that already exist. The fake's page size (_FAKE_PAGE_SIZE=2) is tiny
    enough that this catalog's own 6 products / 20 prices already span
    several pages, so a correct second run over the same state proving
    zero new creates is only possible if _ensure_products/_ensure_prices
    actually walk every page (auto_paging_iter()), not just the first."""
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)

    products, prices = stripe_bootstrap.build_plan()
    assert len(products) > _FAKE_PAGE_SIZE
    assert len(prices) > _FAKE_PAGE_SIZE

    ids_1 = stripe_bootstrap.run_real("sk_test_dummy", products, prices)
    creates_after_1 = (len(fake.product_create_calls), len(fake.price_create_calls))
    assert creates_after_1 == (6, 20)

    ids_2 = stripe_bootstrap.run_real("sk_test_dummy", products, prices)
    creates_after_2 = (len(fake.product_create_calls), len(fake.price_create_calls))

    assert creates_after_2 == creates_after_1, "second run created something new — pagination is dropping matches"
    assert ids_2 == ids_1


def test_price_lookup_does_not_list_whole_price_book(monkeypatch):
    """_ensure_prices must look existing prices up directly by the
    lookup_keys it needs (stripe.Price.list(lookup_keys=[...])), not list
    the account's entire price book and filter client-side — the latter
    is exactly the pattern that goes blind past the first page. Assert
    every Price.list call this script makes passes lookup_keys, never a
    bare unscoped list."""
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)

    real_list = fake.Price.list
    recorded_calls = []

    def spying_list(**kwargs):
        recorded_calls.append(kwargs)
        return real_list(**kwargs)

    fake.Price.list = staticmethod(spying_list)

    products, prices = stripe_bootstrap.build_plan()
    stripe_bootstrap.run_real("sk_test_dummy", products, prices)

    assert recorded_calls, "expected at least one Price.list call"
    for call in recorded_calls:
        assert call.get("lookup_keys"), f"Price.list called without lookup_keys: {call}"
        assert len(call["lookup_keys"]) <= 10, "Stripe allows at most 10 lookup_keys per call"


# ── 6. VAT-inclusive pricing ─────────────────────────────────────────────

def test_every_created_price_is_tax_behavior_inclusive(monkeypatch):
    """docs/pricing/tiering-unit-economics-mcp-2026-09.md treats every
    advertised amount as VAT-inclusive; tax_behavior has to be set at
    creation since Stripe prices are immutable afterwards. Recurring and
    one-off prices alike must carry it."""
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)

    products, prices = stripe_bootstrap.build_plan()
    stripe_bootstrap.run_real("sk_test_dummy", products, prices)

    assert len(fake.price_create_calls) == 20
    for call in fake.price_create_calls:
        assert call.get("tax_behavior") == "inclusive", call

    # one-off (penny/mcp) and recurring (tier) prices are both covered, not
    # just one shape.
    recurring_calls = [c for c in fake.price_create_calls if c.get("recurring")]
    one_off_calls = [c for c in fake.price_create_calls if not c.get("recurring")]
    assert recurring_calls and all(c["tax_behavior"] == "inclusive" for c in recurring_calls)
    assert one_off_calls and all(c["tax_behavior"] == "inclusive" for c in one_off_calls)


def test_transfer_lookup_key_replacement_price_is_also_inclusive(monkeypatch):
    fake = _make_fake_stripe()
    monkeypatch.setattr(stripe_bootstrap, "stripe", fake)

    stale_product = fake.Product.create(name="Sorted Lite", metadata={"app_product_key": "tier_lite"})
    fake.Price.create(
        product=stale_product.id, lookup_key="lite_annual", unit_amount=5499,
        currency="gbp", recurring={"interval": "year", "interval_count": 1},
        metadata={"tier": "lite", "period": "annual"},
    )
    fake.product_create_calls.clear()
    fake.price_create_calls.clear()

    products, prices = stripe_bootstrap.build_plan()
    stripe_bootstrap.run_real("sk_test_dummy", products, prices)

    transfer_calls = [c for c in fake.price_create_calls if c.get("lookup_key") == "lite_annual"]
    assert len(transfer_calls) == 1
    assert transfer_calls[0]["tax_behavior"] == "inclusive"
