"""Spend Verdict Service — backend for the redesigned Spend → Categories view.

ENGINE.md Build Stream 2. Pure Python, deterministic, no LLM — the model
never does arithmetic (the house rule already enforced in `can_i.py`); this
module IS the Python that counts, so a future narrator has numbers to read
rather than invent.

Doctrine this module encodes:
  - Show Your Working Rule (ENGINE.md "Traceability") — every notable is
    traceable to its top contributing merchants, computed here, not narrated.
  - The ontology (ENGINE.md "Learning & Scope") — "Other" is never a category:
    it never earns a baseline, a multiple, or a peer tile. It is carved out
    into `unresolved` before notables/majority are built, never promoted,
    never demoted alongside real categories.
  - The Destination Rule — moved money resolves to a destination (a pot's
    goal name, a credit-card payment, an investment), never a category, and
    is never shown with a minus sign.

Reuses rather than recomputes:
  - `pace.compute_category_signals` for `multiple` / `usual_rate_per_day` /
    the thin-history and early-period flags (`thin_history`,
    `suppress_multiple`) — this module never re-derives a baseline.
  - the commitments collection's stored pot links for the optional goal names
    behind "money you moved to your pots". This deliberately avoids the live
    balance allocation ledger: names are display metadata, not a balance fact.

Per-request I/O budget: ONE category-kind fetch, one small projected goal-name
query, and ONE transaction fetch for the current period
(compute_category_signals's own baseline fetch is separately cached and out of
this module's control).
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, timedelta

from app.db.collections import category_intent_col, commitments_col, preferences_col, transactions_col, yapily_transactions_col
from app.services.categories import (
    INCOME,
    MOVEMENT,
    get_category_kinds,
    kind_of,
)
from app.services.categorisation import canonical_merchant_key
from app.services.pace import compute_category_signals, get_total_pace_curve_fn
from app.services.region import get_user_region
from app.services.spend_impact import compute_spend_impact
from app.services import response_cache

logger = logging.getLogger(__name__)

# ── The qualifying formula (ENGINE.md Traceability / this brief) ────────────
# excess = spent - usual_rate_per_day * days_elapsed. A category qualifies as
# notable when either branch fires — the low-multiple branch needs a bigger
# pound gap to fire (guards against a tiny category swinging wildly), the
# high-multiple branch needs less (a genuine 1.25x on a big category is
# already material at £120).
_QUALIFY_LOW_MULTIPLE, _QUALIFY_LOW_EXCESS = 1.5, 40.0
_QUALIFY_HIGH_MULTIPLE, _QUALIFY_HIGH_EXCESS = 1.25, 120.0

NOTABLE_CAP = 3           # cards rendered; overflow becomes quiet_flags
EVERYTHING_THRESHOLD = 3  # qualifying_count > this ⇒ state "everything"

# Materiality (ENGINE.md Ask Budget Rule — "a recurring merchant, or a
# material amount"). Gated on the LARGEST unresolved transaction itself, not
# the bucket total: thirty small rows summing to £120 must never point an
# ask at a £4.50 payment. Whichever fires first — a flat floor for
# small-Out periods, a proportion for big ones.
UNRESOLVED_MATERIAL_FRACTION = 0.10   # of the period's Out
UNRESOLVED_MATERIAL_FLOOR = 250.0     # flat £ floor

_TXN_PROJ = {
    "amount": 1, "date": 1, "category": 1, "custom_category": 1,
    "transaction_type": 1, "description": 1, "merchant_name": 1, "merchant_key": 1,
    "currency": 1, "account_id": 1,
}

# Money-you-moved destination groups, fixed display order. "own_accounts"
# sits last — it is the least reassuring of the four (nothing was put
# anywhere, it just moved), so it reads as the sentence's trailing clause,
# never the headline.
_MOVED_ORDER = (
    ("pots", "To your pots"),
    ("credit_cards", "To your credit cards"),
    ("investments", "To your investments"),
    ("own_accounts", "Between your accounts"),
)

#: Kinds that are a genuine destination (a pot, a card payment, an
#: investment) as opposed to plain account-to-account shuffling — see
#: `_movement_bucket`'s docstring for why "Transfer" alone earns the
#: shuffling bucket. Order matches `_MOVED_ORDER`'s genuine-first display.
_GENUINE_DESTINATION_KINDS = ("pots", "credit_cards", "investments")


def _movement_bucket(category: str) -> str:
    """Which "money you moved" destination group a movement-kind category
    belongs to — the Destination Rule's grouping, not a new category system.

    "Transfer" gets its own "own_accounts" bucket rather than folding into
    "pots" (owner complaint, 2026-08: "You also moved £8,087 to savings and
    cards" named a destination for money that was mostly plain
    account-to-account shuffling). This is safe because "Transfer" is
    already a RELIABLE negative signal, not a guess: `categorisation.py`
    Pass 2.6 (`refine_transfer_target`) promotes the current-account leg of
    every matched own-transfer pair to "Savings" or "Debt" the moment the
    counterparty account is a savings/ISA or credit-card account. A row that
    survives sync-time categorisation still tagged plain "Transfer" has
    therefore already been checked and found NOT to resolve to a goal or a
    card — the negative result is the signal, computed once at write time,
    already sitting on `t["category"]` with no extra I/O here.

    A user-created custom MOVEMENT-kind category gets no such refinement —
    the engine never checks whether it points at a claimed goal/pot account,
    and there is no reliable way to check that here either: goal claims
    (`commitments.compute_pot_ledger`) are keyed by the CREDIT leg's
    (destination) account_id, but `bucket_transactions` only ever sees the
    DEBIT leg here (the source account money left FROM — see its docstring),
    so there is no account_id on this row to join against a goal's pots even
    with an extra query. Absent a reliable signal, this defaults a custom
    movement category to "pots" rather than "own_accounts": misfiling a
    genuine goal contribution (e.g. a custom "House Fund" category) as mere
    "shuffling" is the more insulting error of the two, and "pots" is also
    where every custom movement category has always landed — no behaviour
    change for the common case, only "Transfer" moves.
    """
    if category == "Investment":
        return "investments"
    if category == "Debt":
        return "credit_cards"
    if category == "Transfer":
        return "own_accounts"
    return "pots"  # Savings, and any custom movement category (see above)


# ── I/O: transaction load (kept separate from pace.py's load_spend_txns
# because notables/unresolved/moved all need merchant identity + txn ids that
# the Spend-tile signal loader deliberately does not carry) ─────────────────

async def _load_period_txns(uid: str, start: date, end: date) -> list[dict]:
    """Every debit/credit transaction in [start, end], normalised, filtered
    to the user's home currency (matching SpendPage's `categories`/`summary`
    memos — a foreign-currency row, e.g. a KES M-Pesa line on a UK account,
    must never inflate the verdict's pills/notables/majority/unresolved
    figures beyond what the tiles above them show; fix-round LOW finding).

    Returns [{"date", "category", "amount" (always positive), "debit" (bool),
    "description", "merchant_name", "merchant_key", "id", "account_id"}].
    """
    region = await get_user_region(uid)
    home_currency = "KES" if region == "Kenya" else "GBP"
    start_dt = datetime(start.year, start.month, start.day)
    end_dt = datetime(end.year, end.month, end.day, 23, 59, 59)
    raw_docs: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        try:
            async for doc in col.find(
                {
                    "user_id": uid,
                    "transaction_type": {"$in": ["debit", "credit"]},
                    "date": {"$gte": start_dt, "$lte": end_dt},
                },
                _TXN_PROJ,
            ):
                raw_docs.append(doc)
        except Exception:
            logger.exception("_load_period_txns: failed fetching from %s for %s", col.name, uid)

    out: list[dict] = []
    for doc in raw_docs:
        txn_currency = doc.get("currency")
        if txn_currency and txn_currency != home_currency:
            continue
        raw_date = doc.get("date")
        if hasattr(raw_date, "date"):
            d_obj = raw_date.date()
        elif isinstance(raw_date, date):
            d_obj = raw_date
        else:
            d_obj = date.today()
        out.append({
            "date":          d_obj,
            "category":      doc.get("custom_category") or doc.get("category") or "Other",
            "amount":        abs(float(doc.get("amount") or 0)),
            "debit":         doc.get("transaction_type") == "debit",
            "description":   doc.get("description") or "",
            "merchant_name": doc.get("merchant_name") or "",
            "merchant_key":  doc.get("merchant_key") or "",
            "id":            str(doc.get("_id") or ""),
            "account_id":    str(doc.get("account_id") or ""),
        })
    return out


def _merchant_identity(t: dict) -> str:
    """merchant_key||description-stem — prefer the stored sync-time identity
    (ENGINE.md "Identity" stage, `merchant_key`, backfilling onto rows as it
    lands) and fall back to computing the same shared identity function
    on-the-fly for rows that don't have it yet."""
    return t.get("merchant_key") or canonical_merchant_key(t["merchant_name"], t["description"])


# ── Pure bucketing — no I/O, fully unit-testable ─────────────────────────────

def bucket_transactions(txns: list[dict], kind_map: dict) -> tuple[dict, dict, float]:
    """Split normalised txns into (cat_agg, moved_groups, income_total).

    cat_agg[category]    = {"spent": float, "payments_count": int,
                             "debit_txns": [txn, ...]}   # refund credits are
                             # netted into `spent` but never counted as a
                             # payment nor considered a spend "cause".
    moved_groups[bucket]  = {"amount": float, "payments_count": int,
                             "categories": {str, ...}}  # bucket is one of
                             # "pots" / "credit_cards" / "investments";
                             # only outgoing (debit) legs count as money moved —
                             # an incoming own-transfer is not spend either, but
                             # it did not leave the user, so it does not appear
                             # here or in pills.spent. `categories` is the set
                             # of source category names bucketed here (e.g.
                             # Savings, Transfer, a custom movement category all
                             # land in "pots") — the UI's deep-link needs to
                             # know which categories a bucket covers.
    income_total is the net of all income-kind rows (credit adds, debit —
    a correction/reversal — subtracts).
    """
    cat_agg: dict[str, dict] = {}
    moved_groups: dict[str, dict] = {
        key: {"amount": 0.0, "payments_count": 0, "categories": set()} for key, _ in _MOVED_ORDER
    }
    income_total = 0.0

    for t in txns:
        cat = t["category"]
        kind = kind_of(kind_map, cat)

        if kind == INCOME:
            income_total += t["amount"] if t["debit"] is False else -t["amount"]
            continue

        if kind == MOVEMENT:
            if t["debit"]:
                bucket = moved_groups[_movement_bucket(cat)]
                bucket["amount"] += t["amount"]
                bucket["payments_count"] += 1
                bucket.setdefault("categories", set()).add(cat)
            continue

        # Real spend (discretionary/commitment, incl. "Other" — carved out of
        # notables/majority downstream, but its arithmetic lives here too so
        # the reconciliation invariant holds without a special case).
        row = cat_agg.setdefault(cat, {"spent": 0.0, "payments_count": 0, "debit_txns": []})
        row["spent"] += t["amount"] if t["debit"] else -t["amount"]
        if t["debit"]:
            row["payments_count"] += 1
            row["debit_txns"].append(t)

    return cat_agg, moved_groups, income_total


def _top_causes(debit_txns: list[dict], cap: int = 3) -> list[dict]:
    """Top contributors within a category, grouped by merchant identity
    (merchant_key||description-stem, via `_merchant_identity`)."""
    groups: dict[str, dict] = {}
    for t in debit_txns:
        key = _merchant_identity(t)
        # Keep provider/reference plumbing for evidence views, never for the
        # category summary. The same display-only cleaner used by unresolved
        # asks turns AMZNMKTPLACE*NJ0X… into a recognisable merchant label.
        display = _unresolved_display_name(t["merchant_name"], t["description"]) or "Unknown merchant"
        g = groups.setdefault(key, {"name": display, "amount": 0.0})
        g["amount"] += t["amount"]
    ranked = sorted(groups.values(), key=lambda g: g["amount"], reverse=True)
    return [{"name": g["name"], "amount": round(g["amount"], 2)} for g in ranked[:cap]]


# ── Unresolved-bucket display name ───────────────────────────────────────
# `canonical_merchant_key` is an IDENTITY function, not a label function: it
# lowercases and peels channel codes/dates so five differently-formatted
# statement lines collapse to one merchant, but it deliberately leaves
# legal-entity tokens (LTD) and payment-rail nouns (OPENBANKINGPAYMENT) in
# place — identity doesn't care about those, display does. This reuses that
# same normalisation and then strips the tokens that are correct for
# identity but wrong for a human-facing label.
_LEGAL_ENTITY_TOKENS = {"ltd", "limited", "plc", "llp", "uk", "group", "holdings", "international"}
_PAYMENT_RAIL_TOKENS = {
    "openbankingpayment", "fasterpayment", "faster", "payment", "payments",
    "bacs", "chaps", "dd", "so", "ft", "fp", "transfer",
}
_DISPLAY_ACRONYMS = {"edf", "hmrc", "nhs", "tfl", "bt", "ee"}
_DISPLAY_ALIASES = {
    "amznmktplace": "Amazon",
    "amazon marketplace": "Amazon",
}
_DISPLAY_NAME_MAX_LEN = 22
_TRAILING_PUNCT_RE = re.compile(r'[.,;:!?]+$')


def _unresolved_display_name(merchant_name: str, description: str) -> str | None:
    """A human-recognisable label for an unresolved (Other-bucket) merchant,
    or None if nothing clean survives — the card then names no merchant
    rather than quote bank plumbing (e.g. 'FINEXER LTD OPENBANKINGPAYMENT
    FT.' -> 'Finexer'; 'PLAYTOMIC* PI-F0D6 ON 11 JUL BCC' -> 'Playtomic';
    'WISE *8827 TRANSFER' -> 'Wise').

    Trailing punctuation is stripped BEFORE handing off to
    `canonical_merchant_key`, because that function's channel-code peel is
    anchored at end-of-string — a trailing '.' silently blocks it (the bug
    this exists to fix).
    """
    base = (merchant_name or "").strip() or (description or "").strip()
    if not base:
        return None
    base = _TRAILING_PUNCT_RE.sub("", base).strip()
    key = canonical_merchant_key(base)
    if not key:
        return None
    if key in _DISPLAY_ALIASES:
        return _DISPLAY_ALIASES[key]
    tokens = [
        tok for tok in key.split()
        if tok not in _LEGAL_ENTITY_TOKENS and tok not in _PAYMENT_RAIL_TOKENS
    ]
    if not tokens:
        return None
    words = [tok.upper() if tok in _DISPLAY_ACRONYMS else tok.capitalize() for tok in tokens]
    name = " ".join(words)
    if len(name) > _DISPLAY_NAME_MAX_LEN:
        name = name[:_DISPLAY_NAME_MAX_LEN].rstrip()
    return name or None


def build_unresolved(other_row: dict | None, total_out: float = 0.0) -> dict:
    """The Other-bucket total + whether it earns an ask.

    Always returned (even at zero, even when not ask-worthy) so the UI's
    "Show Your Working" whisper row has something to render — the Ask Budget
    Rule only governs whether Penny asks, never whether the total is shown.

    `total_out` is the period's whole spend total (pills.spent) — the
    materiality fraction is measured against it, not the Other bucket alone.
    """
    if not other_row or not other_row["debit_txns"]:
        return {
            "total": round((other_row or {}).get("spent", 0.0), 2),
            "payments_count": (other_row or {}).get("payments_count", 0),
            "ask_worthy": False,
            "weight": "routine",
            "largest": None,
        }
    debit_txns = other_row["debit_txns"]
    total = round(other_row["spent"], 2)
    largest_txn = max(debit_txns, key=lambda x: x["amount"])
    largest_amount = round(largest_txn["amount"], 2)
    largest_key = _merchant_identity(largest_txn)
    # Recurring: the largest transaction's merchant identity appears more
    # than once in this period's unresolved bucket.
    occurrences = sum(1 for t in debit_txns if _merchant_identity(t) == largest_key)
    recurring = occurrences >= 2

    material = (
        largest_amount >= UNRESOLVED_MATERIAL_FLOOR
        or (total_out > 0 and largest_amount >= UNRESOLVED_MATERIAL_FRACTION * total_out)
    )
    weight = "material" if material else "routine"
    # Gate the ask on the LARGEST transaction being itself material or
    # recurring — a bucket total crossing an old flat threshold used to be
    # enough on its own, which let thirty small rows summing to £120 fire an
    # ask that named a £4.50 payment. That violates the Ask Budget Rule.
    ask_worthy = material or recurring

    raw_description = largest_txn["merchant_name"] or largest_txn["description"] or "Unknown"
    display_name = _unresolved_display_name(largest_txn["merchant_name"], largest_txn["description"])

    return {
        "total": total,
        "payments_count": other_row["payments_count"],
        "ask_worthy": ask_worthy,
        "weight": weight,
        "largest": {
            # ENGINE.md's teaching sheet opens directly on this transaction
            # (the ask card's "Tell me what this was") — it needs the real
            # id to PATCH/resolve-movement, not just display fields.
            "id":              largest_txn["id"],
            "display_name":    display_name,
            "raw_description": raw_description,
            "amount":          largest_amount,
            "date":            largest_txn["date"].isoformat(),
            "account_id":      largest_txn.get("account_id") or "",
        },
    }


def build_notables_and_majority(
    cat_agg: dict[str, dict], signals: dict[str, dict], days_elapsed: int,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Returns (notables, quiet_flags, majority).

    "Other" never participates here — it is carved out by the caller before
    this runs (via `build_unresolved`), per the ontology: Other is never a
    baseline, never a multiple, never a peer tile.
    """
    qualifying: list[dict] = []
    for cat, row in cat_agg.items():
        if cat == "Other":
            continue
        sig = signals.get(cat) or {}
        multiple = sig.get("multiple")
        usual_by_now = sig.get("usual_by_now")
        # Rolling-cache compatibility: older category-signal payloads stored
        # only the daily baseline. Do not blank every notable during a deploy;
        # reconstruct the same period-to-date baseline until that cache turns.
        if usual_by_now is None and sig.get("usual_rate_per_day") is not None:
            usual_by_now = float(sig["usual_rate_per_day"]) * max(1, days_elapsed)
        if multiple is None or usual_by_now is None:
            continue
        excess = row["spent"] - usual_by_now
        if excess <= 0:
            continue  # under-usual NEVER qualifies
        qualifies = (
            (multiple >= _QUALIFY_LOW_MULTIPLE and excess >= _QUALIFY_LOW_EXCESS) or
            (multiple >= _QUALIFY_HIGH_MULTIPLE and excess >= _QUALIFY_HIGH_EXCESS)
        )
        if not qualifies:
            continue
        qualifying.append({
            "category":        cat,
            "spent":           round(row["spent"], 2),
            "multiple":        multiple,
            "excess":          round(excess, 2),
            "payments_count":  row["payments_count"],
            "cause":           _top_causes(row["debit_txns"]),
            "pace":            {"spent": round(row["spent"], 2), "usual_by_now": round(usual_by_now, 2)},
        })

    qualifying.sort(key=lambda q: q["excess"], reverse=True)
    notables = qualifying[:NOTABLE_CAP]
    quiet_flags = [
        {k: v for k, v in q.items() if k not in ("cause", "pace")}
        for q in qualifying[NOTABLE_CAP:]
    ]

    promoted = {n["category"] for n in notables}
    majority = []
    for cat, row in cat_agg.items():
        if cat == "Other" or cat in promoted:
            continue
        sig = signals.get(cat) or {}
        m = sig.get("multiple")
        has_baseline = m is not None and sig.get("usual_rate_per_day") is not None
        # A majority category can still have a materially high multiple if it
        # only missed the pound-threshold gate (small category, big swing) —
        # "close to usual" would be false for it, so it's flagged here rather
        # than silently swept into a blanket reassurance downstream.
        elevated = has_baseline and m >= _QUALIFY_LOW_MULTIPLE
        majority.append({
            "category":       cat,
            "spent":          round(row["spent"], 2),
            "payments_count": row["payments_count"],
            "has_baseline":   has_baseline,
            "elevated":       elevated,
        })
    majority.sort(key=lambda r: r["spent"], reverse=True)

    return notables, quiet_flags, majority


def build_moved(moved_groups: dict[str, dict], goal_names: list[str]) -> list[dict]:
    """Money-you-moved destination groups — never a minus sign, never a
    category (Destination Rule). Zero-payment groups are omitted.

    Each entry carries `categories`: the sorted list of source category
    names bucketed into this destination group (e.g. "pots" covers Savings,
    Transfer, and any custom movement category) — lets the UI deep-link
    "To your pots" straight to the exact transactions behind it."""
    out: list[dict] = []
    for key, label in _MOVED_ORDER:
        g = moved_groups.get(key) or {}
        if not g.get("payments_count"):
            continue
        entry = {
            "kind":            key,
            "label":           label,
            "amount":          round(g["amount"], 2),
            "payments_count":  g["payments_count"],
            "categories":      sorted(g.get("categories") or []),
        }
        if key == "pots":
            entry["goal_names"] = goal_names
        out.append(entry)
    return out


def determine_state(days_elapsed: int, thin_history: bool, qualifying_count: int) -> str:
    if days_elapsed < 5:
        return "early"
    if thin_history:
        return "nobaseline"
    if qualifying_count == 0:
        return "nothing"
    if qualifying_count > EVERYTHING_THRESHOLD:
        return "everything"
    return "normal"


_ORDINAL_COUNT_WORD = {1: "One category is", 2: "Two categories are", 3: "Three categories are"}


def _join_names(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{', '.join(names[:-1])} and {names[-1]}"


def build_reading(
    state: str, *, days_elapsed: int, qualifying: list[dict],
    majority: list[dict], total_excess: float, unresolved_total: float = 0.0,
) -> str:
    """Deterministic template string per state — real counts/amounts from
    real data, causal clauses hedged ("mostly"), never "because" (no
    causation is asserted, only correlation of biggest contributor).

    "Nothing unusual" / "Everything else looks normal" are only ever said
    about categories that actually earn them: a real baseline AND a multiple
    that isn't itself materially elevated. A majority category that has no
    baseline yet, or one that only avoided "notable" status by missing the
    pound-threshold gate, is named and hedged instead of swept silently into
    the blanket claim (ENGINE.md Traceability — no manufactured reassurance).
    """
    majority_count = len(majority)
    elevated = [m["category"] for m in majority if m.get("elevated")]
    no_baseline = [m["category"] for m in majority if not m.get("has_baseline", True)]

    if state == "early":
        return f"{days_elapsed} day{'s' if days_elapsed != 1 else ''} in, too soon to compare against usual."
    if state == "nobaseline":
        return (
            "Still learning your usual, I need about two full pay periods "
            "before I can compare. Here's where this period's money went so far."
        )
    if state == "nothing":
        if majority_count == 0:
            if unresolved_total > 0:
                return "No spend categories to compare yet this period, everything so far is still unreviewed."
            return "No spending logged for this period yet."
        base = (
            f"Nothing unusual to report, all {majority_count} "
            f"categor{'y' if majority_count == 1 else 'ies'} "
            f"{'is' if majority_count == 1 else 'are'} running close to usual."
        )
        if not elevated and not no_baseline:
            return base
        notes = []
        if elevated:
            notes.append(f"{_join_names(elevated)} ran hotter than usual, just not by much yet")
        if no_baseline:
            notes.append(f"I don't have a usual yet for {_join_names(no_baseline)}")
        return "Nothing crossed the line this period. " + " ".join(f"{n[0].upper()}{n[1:]}." for n in notes)
    if state == "everything":
        return (
            f"Spending is running high across the board, about "
            f"£{round(total_excess):,} more than a typical {days_elapsed} days in. "
            f"The three biggest are below."
        )
    # normal
    n = len(qualifying)
    word = _ORDINAL_COUNT_WORD.get(n, f"{n} categories are")
    top_name = qualifying[0]["category"] if qualifying else ""
    tail = "Everything else looks normal."
    if elevated or no_baseline:
        notes = []
        if elevated:
            notes.append(f"{_join_names(elevated)} also ran hot, just in smaller amounts")
        if no_baseline:
            notes.append(f"still building a usual for {_join_names(no_baseline)}")
        joined = "; ".join(notes)
        tail = f"{joined[0].upper()}{joined[1:]}."
    return f"{word} running above your usual pace, mostly {top_name}. {tail}"


def assemble_verdict(
    *,
    cat_agg: dict[str, dict],
    moved_groups: dict[str, dict],
    income_total: float,
    signals: dict[str, dict],
    days_elapsed: int,
    thin_history: bool,
    goal_names: list[str],
    period: dict,
    dismissed_unresolved_ids: frozenset[str] | set[str] = frozenset(),
) -> dict:
    """Pure assembly — no I/O. The seam every unit test drives.

    `dismissed_unresolved_ids` — transaction ids the user has already tapped
    "Not now" on (persisted, fetched by the orchestrator below). A dismissal
    only suppresses the ASK CARD for that exact transaction; the quiet
    unresolved whisper (total, still counted in Out) keeps showing — the Ask
    Budget Rule governs asking, never whether the total is shown.
    """
    other_row = cat_agg.get("Other")
    spend_total = sum(row["spent"] for row in cat_agg.values())
    unresolved = build_unresolved(other_row, total_out=spend_total)
    largest = unresolved.get("largest")
    if largest and largest["id"] in dismissed_unresolved_ids:
        unresolved["ask_worthy"] = False

    notables, quiet_flags, majority = build_notables_and_majority(cat_agg, signals, days_elapsed)

    qualifying_count = len(notables) + len(quiet_flags)
    state = determine_state(days_elapsed, thin_history, qualifying_count)

    total_excess = sum(n["excess"] for n in notables) + sum(q["excess"] for q in quiet_flags)
    reading = build_reading(
        state,
        days_elapsed=days_elapsed,
        qualifying=notables + quiet_flags,
        majority=majority,
        total_excess=total_excess,
        unresolved_total=unresolved["total"],
    )

    moved = build_moved(moved_groups, goal_names)

    pills = {
        "spent":  round(spend_total, 2),
        "income": round(income_total, 2),
        "net":    round(income_total - spend_total, 2),
    }

    # In "early"/"nobaseline" states no category can qualify (multiple is
    # always None there — see pace.py's suppress_multiple/thin_history gate),
    # so notables/quiet_flags are structurally empty; the majority list still
    # carries every real spend category so the UI has rows to render.
    return {
        "state":       state,
        "reading":     reading,
        "notables":    notables,
        "quiet_flags": quiet_flags,
        "majority":    majority,
        "unresolved":  unresolved,
        "moved":       moved,
        "pills":       pills,
        "period":      period,
    }


# ── Spend -> Plan bridge — pure helpers ──────────────────────────────────────
# Reading-composer materiality: below this, "you also moved £X" isn't worth a
# sentence.
MOVED_MATERIAL_FLOOR = 50.0


def compute_pace_totals(
    cat_agg: dict[str, dict],
    signals: dict[str, dict],
    days_elapsed: int,
    *,
    period_days: int | None = None,
    thin_history: bool = False,
    usual_rate_total: float | None = None,
    total_curve_fn: object | None = None,
) -> dict:
    """Signed pace fact across every BASELINED spend category (Other
    excluded, same ontology carve-out as build_notables_and_majority):
    actual spend so far vs what "usual" would put you at by today.
    `excess` is signed — positive means running ahead of usual, negative
    means under it. This is the input the impact engine floor-projects from
    (`spend_impact.compute_spend_impact`'s `total_excess`), independent of
    which categories individually qualify as "notable".

    The headline `usual_by_now` is now derived from the TOTAL-level shape
    curve (`pace.get_total_pace_curve_fn`, floor `_SHAPE_MIN_PERIODS` = 2 —
    NOT the per-category floor) as `usual_total_for_period * S_total(f_now)`,
    passed in as `total_curve_fn`/`usual_rate_total`/`period_days` — rather
    than summing each category's OWN `usual_by_now`. Rationale (the audit
    finding this revises): the headline reading and spend_impact's
    `total_excess` floor-projection must be immune to any single category
    falling back to linear (a thin-history category's fallback shouldn't
    contaminate the one number every other surface anchors to), and
    aggregating across every category is exactly what washes out a single
    category's noise — so the total deserves its own (looser, n=2) floor
    rather than inheriting whichever categories individually cleared
    `_SHAPE_MIN_PERIODS_CATEGORY`. Falls back to the ORIGINAL per-category
    sum (unchanged maths) whenever the total curve is unavailable or the
    baseline is still thin — same "never crash, always degrade to the
    existing linear-safe path" discipline as the rest of pace.py.

    Per-category `usual_by_now`/`multiple` (notables, badges) are untouched
    by this — those still read straight from `signals[cat]["usual_by_now"]`,
    each category's own shaped-or-linear figure.
    """
    actual = 0.0
    fallback_usual_by_now = 0.0
    for cat, row in cat_agg.items():
        if cat == "Other":
            continue
        sig = signals.get(cat) or {}
        ubn = sig.get("usual_by_now")
        if ubn is None:
            continue
        actual += row["spent"]
        fallback_usual_by_now += ubn

    usual_by_now = fallback_usual_by_now
    if (
        not thin_history
        and total_curve_fn is not None
        and period_days
        and usual_rate_total is not None
    ):
        f_now = (days_elapsed / period_days) if period_days > 0 else 1.0
        usual_total_for_period = usual_rate_total * period_days
        usual_by_now = usual_total_for_period * total_curve_fn(f_now)

    return {
        "actual":       round(actual, 2),
        "usual_by_now": round(usual_by_now, 2),
        "excess":       round(actual - usual_by_now, 2),
    }


def build_pace_series(
    txns: list[dict], kind_map: dict, start: date, days_elapsed: int,
    usual_rate_per_day_total: float, thin_history: bool,
    total_curve_fn: object | None = None, period_days: int | None = None,
) -> list[dict]:
    """Cumulative total spend by day (day 1..days_elapsed, TOTAL basis — same
    income/movement carve-out as `bucket_transactions`) vs cumulative usual.

    `usual` on day d is `usual_total_for_period * S(d/period_days)` when
    `total_curve_fn` (pace.py's shaped TOTAL-level S(f), see
    `pace.get_total_pace_curve_fn`) and `period_days` are both given —
    replacing the old linear `usual_rate_per_day_total * day` with the
    learned shape, so a day early in the period whose historical spend
    front-loads (e.g. bills) shows a correspondingly higher "usual" line
    instead of a uniform ramp. Falls back to the linear maths whenever the
    shape is unavailable (thin history) or the caller omits it — `usual` is
    None on every day only while the baseline itself is still learning,
    never a fabricated number.
    """
    daily: dict[int, float] = {}
    for t in txns:
        if t["category"] == "Other":
            # "Other" never earns a baseline (ontology carve-out) — the usual
            # line and the shape training both exclude it, so the actual line
            # must too, or an unplaced/unresolved transfer landing in "Other"
            # spikes the actual line against a usual line that never counted
            # it in the first place.
            continue
        kind = kind_of(kind_map, t["category"])
        if kind in (INCOME, MOVEMENT):
            continue
        day = (t["date"] - start).days + 1
        if day < 1 or day > days_elapsed:
            continue
        signed = t["amount"] if t["debit"] else -t["amount"]
        daily[day] = daily.get(day, 0.0) + signed

    usual_total_for_period = None
    if not thin_history and total_curve_fn is not None and period_days:
        usual_total_for_period = usual_rate_per_day_total * period_days

    series: list[dict] = []
    running = 0.0
    for day in range(1, days_elapsed + 1):
        running += daily.get(day, 0.0)
        if thin_history:
            usual_val = None
        elif usual_total_for_period is not None:
            usual_val = round(usual_total_for_period * total_curve_fn(day / period_days), 2)
        else:
            usual_val = round(usual_rate_per_day_total * day, 2)
        series.append({"day": day, "actual": round(running, 2), "usual": usual_val})
    return series


def _first_sentence(text: str) -> str:
    """Truncate a (possibly 2-sentence) template string to its first
    sentence, so appending a consequence sentence never produces more than
    the caption grammar's 2-sentence budget."""
    idx = text.find(". ")
    return text[: idx + 1] if idx != -1 else text


#: Sentence-2 noun for each genuine destination kind, in `_MOVED_ORDER`
#: order — feeds `_join_names` so the fallback sentence only ever names
#: destinations this period's data actually supports (never a hardcoded
#: "savings, cards and investments" when, say, nothing went to investments).
_GENUINE_LABEL = {"pots": "savings", "credit_cards": "cards", "investments": "investments"}


def _movement_fallback_sentence(moved: list[dict]) -> str | None:
    """Sentence-2's movement-reassurance fallback, split honestly per the
    Destination Rule (owner complaint, 2026-08: "You also moved £8,087 to
    savings and cards" named a destination for money that was mostly plain
    account-to-account shuffling). Money moved to a genuine destination
    (`_GENUINE_DESTINATION_KINDS` — pots/credit_cards/investments) is named;
    money moved to "own_accounts" (see `_movement_bucket`) is described as
    what it is and never folded into "savings".

    Each half only speaks once it clears `MOVED_MATERIAL_FLOOR` ON ITS OWN —
    a few pounds of shuffling alongside a big genuine move (or the reverse)
    isn't worth its own clause, the same discipline the old single-total
    gate applied. Returns None when neither half is material, exactly like
    the old fallback returning no sentence 2 below the floor.
    """
    genuine_amount = round(
        sum(m["amount"] for m in moved if m["kind"] in _GENUINE_DESTINATION_KINDS), 2
    )
    own_amount = round(
        sum(m["amount"] for m in moved if m["kind"] == "own_accounts"), 2
    )
    # Only name a destination the money actually went to this period — a
    # £0 genuine group (e.g. no investment payment happened) must never
    # appear in the joined list even when genuine_amount overall clears
    # the floor off the other groups.
    genuine_labels = [
        _GENUINE_LABEL[m["kind"]]
        for m in moved
        if m["kind"] in _GENUINE_DESTINATION_KINDS and m["amount"] > 0
    ]

    show_genuine = genuine_amount >= MOVED_MATERIAL_FLOOR
    show_own = own_amount >= MOVED_MATERIAL_FLOOR

    if show_genuine and show_own:
        return (
            f"You also moved £{genuine_amount:,.0f} to {_join_names(genuine_labels)}, "
            f"and £{own_amount:,.0f} between your own accounts."
        )
    if show_genuine:
        return f"You also moved £{genuine_amount:,.0f} to {_join_names(genuine_labels)}."
    if show_own:
        return f"You also moved £{own_amount:,.0f} between your own accounts."
    return None


def compose_reading(
    *, state: str, base_reading: str, notables: list[dict], pace_totals: dict,
    impact: dict, moved: list[dict], unresolved_total: float = 0.0,
) -> str:
    """Recompose the verdict's `reading` as caption grammar: max 2 sentences,
    no em-dashes, always hedged, never "will".

    Sentence 1 — the pace fact. For "normal"/"everything" states with a
    genuine aggregate overspend, this leads with the pound figure ("Running
    about £1,411 ahead of usual, mostly Bills."). For a materially
    under-pace period paired with a live consequence, it's the plain "You're
    under usual pace." Otherwise the existing per-state template
    (`build_reading`'s output) already says the honest pace fact.

    Unresolved-money hedge (owner-approved fix, 2026-08) — pills.spent (OUT)
    counts every unresolved/"Other" transaction (bucket_transactions above),
    but the pace comparison that produces `excess`, and everything the
    impact engine prices off it, both exclude "Other" (the ontology
    carve-out — it never earns a baseline). So a confidently-worded claim
    built on `excess` can be sitting on top of a materially incomplete slice
    of the real Out figure. `impact["unresolved_hedge"]` is computed ONCE,
    in `spend_impact.compute_spend_impact` (single source of truth — the
    same call also decides whether to drop a MOVE/HORIZON consequence
    entirely when the unresolved bucket is as large as the excess itself,
    see that function's docstring); this function only consumes the flag to
    soften sentence 1's verb and name the unplaced amount — it never
    re-derives either threshold. When suppression already fired upstream,
    `consequence` here is already None, so sentence 2 falls through to the
    movement-reassurance fallback (or nothing), exactly like any other
    no-consequence period.

    Sentence 2 — the ONE consequence, by priority bills_risk > horizon >
    move_delta > permission, else the movement-reassurance fallback
    (`_movement_fallback_sentence`) when a genuine-destination or
    own-accounts total is material, else nothing (sentence 1 stands alone).
    bills_risk only ever fires alongside a genuine excess (`excess > 0` —
    see spend_impact.py's causation test), so it never interacts with the
    excess < 0 branch below.
    """
    excess = pace_totals.get("excess", 0.0)
    sentence1 = base_reading

    consequence = impact.get("consequence")
    if state in ("normal", "everything") and notables and excess > 0:
        top = notables[0]["category"]
        sentence1 = f"Running about £{abs(excess):,.0f} ahead of usual, mostly {top}."
    elif excess < 0 and consequence in ("permission", "horizon"):
        sentence1 = "You're under usual pace."

    if impact.get("unresolved_hedge"):
        # Truncate to sentence 1's own first sentence BEFORE hedging — some
        # per-state templates (`build_reading`'s "normal"/"nothing" cases)
        # are already 2 sentences on their own account, and the hedge clause
        # must survive the `_first_sentence` truncation below (which keeps
        # only the material before the first ". ") once sentence 2 (the
        # consequence or the movement fallback) is appended. Discarding the
        # template's own second sentence here is deliberate — the hedge
        # takes that slot instead, same 2-sentence budget either way.
        base = _first_sentence(sentence1)
        # (a) soften the verdict verb where sentence 1 is the plain "You're
        # under usual pace." claim; every other sentence-1 form already
        # reads as hedged/qualified ("Running about...", "Nothing unusual
        # to report...") so it's left as-is bar the trailing full stop.
        if base == "You're under usual pace.":
            base = "You look under usual pace"
        else:
            base = base.rstrip(".")
        # (b) name the unplaced amount, in the same clause — no em-dash.
        sentence1 = f"{base}, though £{unresolved_total:,.0f} isn't placed yet, which could change this."

    sentence2: str | None = None
    if consequence == "bills_risk" and impact.get("bills_risk"):
        br = impact["bills_risk"]
        sentence2 = f"At this pace, your {br['bill']} bill on {br['date']} gets tight. Worth a look."
    elif consequence == "horizon" and impact.get("horizon"):
        h = impact["horizon"]
        if h["kind"] == "debt":
            sentence2 = f"If this holds, your card clear-by moves from {h['from_month']} to {h['to_month']}."
        else:
            sentence2 = f"If this holds, your {h['name']} moves from {h['from_month']} to {h['to_month']}."
    elif consequence == "move_delta" and impact.get("move"):
        _projected = impact["move"]["projected"]
        if _projected < 10:
            # Softened per the house rule against bleak fake-precise £0s
            # (spend_impact.MOVE_SOFTEN_FLOOR mirrors this threshold).
            sentence2 = "If this holds, there may be nothing spare to move this payday."
        else:
            sentence2 = f"If this holds, your payday move shrinks to about £{_projected:,.0f}."
    elif consequence == "permission" and impact.get("move"):
        bigger = impact["move"]["projected"] - impact["move"]["usual"]
        sentence2 = f"Your move could be about £{bigger:,.0f} bigger this payday."
    else:
        sentence2 = _movement_fallback_sentence(moved)

    if sentence2:
        return f"{_first_sentence(sentence1)} {sentence2}"
    return sentence1


# ── I/O orchestrator ──────────────────────────────────────────────────────

async def _prior_one_off_categories(uid: str, categories: set[str], current_period_end: date) -> set[str]:
    """Categories in `categories` the user has already answered "one_off"
    for in a PRIOR (not this) period — the repeat-nag guard behind each
    notable card's `prior_intent`."""
    if not categories:
        return set()
    try:
        cursor = category_intent_col.find(
            {
                "user_id":    uid,
                "category":   {"$in": list(categories)},
                "period_end": {"$lt": current_period_end.isoformat()},
                "answer":     "one_off",
            },
            {"category": 1},
        )
        docs = await cursor.to_list(None)
        return {d["category"] for d in docs}
    except Exception:
        logger.exception("spend_verdict: prior-intent lookup failed for %s", uid)
        return set()


async def _active_goal_names(uid: str) -> list[str]:
    """Distinct active goal names with a linked pot, oldest-goal-first.

    The Spend row only uses these as optional display metadata. Calling
    ``compute_pot_ledger`` here used to fetch live balances for every pot and
    allocate every claim before the page could render; that is necessary for
    financial calculations, but not for reading names already stored on the
    commitments. Keep this projected query intentionally balance-free.
    """
    try:
        docs = await commitments_col.find(
            {"user_id": uid, "status": "active"},
            {"name": 1, "funding_pots": 1, "funding_account_id": 1, "created_at": 1},
        ).sort([("created_at", 1), ("_id", 1)]).to_list(None)
        names: list[str] = []
        seen: set[str] = set()
        for doc in docs:
            pots = doc.get("funding_pots")
            has_linked_pot = (
                any(isinstance(p, dict) and p.get("account_id") for p in pots)
                if isinstance(pots, list)
                else False
            ) or bool(doc.get("funding_account_id"))
            name = str(doc.get("name") or "").strip()
            if has_linked_pot and name and name not in seen:
                seen.add(name)
                names.append(name)
        return names
    except Exception:
        logger.exception("spend_verdict: goal-name lookup failed for %s", uid)
        return []


async def _dismissed_unresolved_ids(uid: str) -> set[str]:
    """Transaction ids whose unresolved-merchant ask the user has already
    dismissed ("Not now") — persisted the same way the miscategorised
    guardrail persists its dismissal (`dismiss_miscategorised`,
    `analytics.py`): an `$addToSet` array on the user's preferences doc.
    Failure-tolerant, same rationale as `_active_goal_names`."""
    try:
        prefs = await preferences_col.find_one({"user_id": uid}, {"dismissed_unresolved_asks": 1}) or {}
        return set(prefs.get("dismissed_unresolved_asks") or [])
    except Exception:
        logger.exception("spend_verdict: dismissed-unresolved lookup failed for %s", uid)
        return set()


async def compute_spend_verdict(uid: str, offset: int = 0) -> dict:
    """The GET /spend/verdict payload with independent metadata reads grouped."""
    kind_map, goal_names, dismissed_unresolved_ids = await asyncio.gather(
        get_category_kinds(uid),
        _active_goal_names(uid),
        _dismissed_unresolved_ids(uid),
    )

    # Reuse the same 90 s per-offset cache GET /spend/category-signals reads
    # and writes (analytics.py's get_category_signals) — offset here is
    # already clamped to [-60, 0] the same way that endpoint clamps it, so
    # the key matches whether this offset arrived here first or there first.
    # kind_map is only an internal cache-avoidance detail of
    # compute_category_signals (see its own docstring): passing it in or
    # letting the callee fetch it itself never changes the returned result,
    # so a cache entry written by either caller is interchangeable here.
    _signals_cache_name = f"category_signals:{offset}"
    signals_result = response_cache.get(_signals_cache_name, uid)
    if signals_result is None:
        signals_result = await compute_category_signals(uid, offset=offset, kind_map=kind_map)
        response_cache.put(_signals_cache_name, uid, signals_result)
    period = signals_result["period"]
    signals = signals_result["signals"]

    start = date.fromisoformat(period["start"])
    end = date.fromisoformat(period["end"])

    txns = await _load_period_txns(uid, start, end)
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)

    result = assemble_verdict(
        cat_agg=cat_agg,
        moved_groups=moved_groups,
        income_total=income_total,
        signals=signals,
        days_elapsed=period["days_elapsed"],
        thin_history=period["thin_history"],
        goal_names=goal_names,
        period=period,
        dismissed_unresolved_ids=dismissed_unresolved_ids,
    )

    # ── Spend -> Plan bridge additions ────────────────────────────────────
    # pace_series, moved_total, impact (the consequence engine),
    # consequence_line, per-notable prior_intent, and the recomposed
    # 2-sentence reading. All derived from data this function already
    # loaded/computed above — no second transaction fetch.
    days_elapsed = period["days_elapsed"]
    usual_rate_total = sum(
        (signals.get(cat) or {}).get("usual_rate_per_day") or 0.0
        for cat in cat_agg
        if cat != "Other" and (signals.get(cat) or {}).get("usual_rate_per_day") is not None
    )
    # TOTAL-level shape function — used for BOTH the chart's cumulative
    # "usual" line (pace.get_total_pace_curve_fn) AND, below, compute_pace_totals'
    # headline usual_by_now. A Python callable, so it's fetched separately
    # rather than via compute_category_signals's return value (that dict is
    # returned verbatim by /spend/category-signals and must stay
    # JSON-serialisable). Reads the same memoised bundle
    # compute_category_signals already populated above, so this is a cache
    # hit in the common case. Fetched ONCE, shared by both consumers below —
    # never two separate lookups for the same curve in one request.
    try:
        total_curve_fn = await get_total_pace_curve_fn(uid, start, kind_map=kind_map)
    except Exception:
        logger.exception("spend_verdict: total shape-curve lookup failed for %s", uid)
        total_curve_fn = None
    pace_totals = compute_pace_totals(
        cat_agg, signals, days_elapsed,
        period_days=period.get("period_days"),
        thin_history=period["thin_history"],
        usual_rate_total=usual_rate_total,
        total_curve_fn=total_curve_fn,
    )
    pace_series = build_pace_series(
        txns, kind_map, start, days_elapsed, usual_rate_total, period["thin_history"],
        total_curve_fn=total_curve_fn, period_days=period.get("period_days"),
    )
    moved_total = round(sum(m["amount"] for m in result["moved"]), 2)
    unresolved_total = result["unresolved"]["total"]

    verdict_ctx = {
        "period": period,
        "total_excess": pace_totals["excess"],
        # Fed to the impact engine's own unresolved-money hedge/suppress
        # gate (spend_impact.compute_spend_impact) — see that function's
        # docstring for why the decision lives there rather than here.
        "unresolved_total": unresolved_total,
    }
    # Per-notable prior_intent + consequence_line — attached to the matching
    # notable object (NOT a top-level field): frontend contract is
    # notable.prior_intent = {"question": str, ...} | None and
    # notable.consequence_line = {"text": str} | None, the latter non-null
    # on only the single loudest notable (notables[0] — already excess-desc
    # sorted by build_notables_and_majority).
    notables = result["notables"]
    prior_one_off: set[str] = set()
    try:
        if notables:
            categories = {n["category"] for n in notables}
            impact, prior_one_off = await asyncio.gather(
                compute_spend_impact(uid, verdict_ctx),
                _prior_one_off_categories(uid, categories, end),
            )
        else:
            impact = await compute_spend_impact(uid, verdict_ctx)
    except Exception:
        logger.exception("spend_verdict: impact metadata failed for %s", uid)
        impact = {"consequence": None, "move": None, "horizon": None, "bills_risk": None, "unresolved_hedge": False}

    if notables:
        for n in notables:
            cat = n["category"]
            if cat in prior_one_off:
                n["prior_intent"] = {
                    "repeat":   True,
                    "question": f"{cat} is over usual again this period. One-off, or is this the new normal now?",
                }
            else:
                n["prior_intent"] = None
            n["consequence_line"] = None

        if impact.get("consequence") in ("move_delta", "horizon"):
            loudest = notables[0]
            excess_total = pace_totals["excess"]
            # "...of that" only has an antecedent when the AGGREGATE excess
            # is itself positive (sentence 1 is the "running ahead" pace
            # fact). When the aggregate is flat/negative — a notable over-
            # pace category offset by bigger under-pace elsewhere, sentence
            # 1 becomes "You're under usual pace." — "that" would dangle, so
            # this falls back to a self-contained line naming the category's
            # own excess instead of its share of a total that isn't shown.
            if excess_total > 0:
                share = loudest["excess"] / excess_total
                if share >= 0.6:
                    text = f"{loudest['category']} alone accounts for most of that."
                else:
                    text = f"{loudest['category']} is about £{loudest['excess']:,.0f} of that."
            else:
                text = f"{loudest['category']} is about £{loudest['excess']:,.0f} over its usual."
            loudest["consequence_line"] = {"text": text}

    result["reading"] = compose_reading(
        state=result["state"],
        base_reading=result["reading"],
        notables=notables,
        pace_totals=pace_totals,
        impact=impact,
        moved=result["moved"],
        unresolved_total=unresolved_total,
    )
    result["pace_series"] = pace_series
    result["moved_total"] = moved_total
    result["impact"] = impact
    # Spend-page honesty fix (owner-approved, 2026-08) — the OUT pill's own
    # footnote. `unresolved_material` is the SAME boolean the reading hedge
    # above is keyed off (`impact["unresolved_hedge"]`, computed once in
    # spend_impact.is_unresolved_material) so the footnote and the reading
    # can never disagree about whether the unplaced money is material this
    # period.
    result["unresolved_total"] = unresolved_total
    result["unresolved_material"] = bool(impact.get("unresolved_hedge"))

    return result
