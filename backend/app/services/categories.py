"""Category kinds — the single source of truth for what a category *means*.

Historically every consumer hardcoded its own set of "which categories are real
spend". Those sets drifted apart (some omit Income, some add Bills, one excludes
only Transfer) and several of them named categories that do not exist at all
("Health & Beauty", "Hobbies", "Internal Transfer"), so the same transaction
could be spend in one screen and not-spend in another.

This module replaces the guessing with a declared *kind* per category.

Kinds
-----
``discretionary``  Real spend, freely chosen. Cuttable. (Eating Out, Golf)
``commitment``     Real spend, not freely chosen. (Bills, Groceries, Childcare)
``movement``       NOT spend — money moved, not consumed. (Transfer, Savings)
``income``         NOT spend — money arriving. Internal only; never offered as a
                   choice when creating a custom category.

``income`` is deliberately its own kind rather than being folded into
``movement``. Both are non-spend, but they are opposite *directions*, and the
income/analytics paths need to identify inflow specifically. Collapsing them
would make it impossible to ask "is this money coming in?" from the kind map,
and would show "Income" as a movement option in the category picker, which is
wrong. ``is_non_spend()`` covers both, so nothing that only cares about
"exclude from spend" has to know the difference.

Efficiency contract
-------------------
The predicates here are called inside per-transaction loops. They take an
already-fetched kind map as their first argument so that a request does exactly
ONE database read:

    kinds = await get_category_kinds(uid)          # once per request
    spend = [t for t in txns if not is_non_spend(kinds, cat_of(t))]

There is intentionally no convenience helper that takes a ``uid`` and a single
category — that shape invites a database read per transaction.
"""

from __future__ import annotations

import re

from app.db.collections import user_categories_col

# ── Kinds ────────────────────────────────────────────────────────────────────
DISCRETIONARY = "discretionary"
COMMITMENT    = "commitment"
MOVEMENT      = "movement"
INCOME        = "income"

#: Kinds a user may pick when creating a custom category.
USER_SELECTABLE_KINDS = (DISCRETIONARY, COMMITMENT, MOVEMENT)

#: Every valid kind, including the internal-only one.
VALID_KINDS = USER_SELECTABLE_KINDS + (INCOME,)

#: Kinds that are NOT real spend.
NON_SPEND_KINDS = frozenset({MOVEMENT, INCOME})

#: Fallback for anything unrecognised, and for legacy bare-string categories.
#:
#: ``discretionary`` is the *safe* default, in the specific sense that it is the
#: one that cannot make money disappear. An unknown category defaulted to
#: ``movement`` would be silently dropped from every spend total — under-stating
#: what the user spent and over-stating what they can safely spend, which is the
#: dangerous direction to be wrong in. Defaulted to ``discretionary`` it is
#: counted as real, cuttable spend: visible, and at worst slightly pessimistic.
#: It also matches today's behaviour exactly — a custom category currently
#: appears in no exclusion set anywhere, so it already counts as ordinary spend.
DEFAULT_KIND = DISCRETIONARY

# ── Built-in seed table ──────────────────────────────────────────────────────
#: Kind for each of the 19 built-in categories. Insertion order is the display
#: order and is the source of ``BUILTIN_CATEGORIES``.
#:
#: Seeded to reproduce today's behaviour exactly, with ONE deliberate exception:
#: Health and Beauty are discretionary, recovering the intent of the dead
#: "Health & Beauty" entry in ``behaviour.py:_DISCRETIONARY``.
BUILTIN_CATEGORY_KINDS: dict[str, str] = {
    "Groceries":     COMMITMENT,
    "Eating Out":    DISCRETIONARY,
    "Transport":     COMMITMENT,
    "Entertainment": DISCRETIONARY,
    "Shopping":      DISCRETIONARY,
    "Bills":         COMMITMENT,
    "Subscriptions": DISCRETIONARY,
    "Health":        DISCRETIONARY,   # behaviour change — see module docs/report
    "Beauty":        DISCRETIONARY,   # behaviour change — see module docs/report
    "Travel":        DISCRETIONARY,
    "Software":      COMMITMENT,
    "Savings":       MOVEMENT,
    "Investment":    MOVEMENT,
    "Debt":          MOVEMENT,
    "Transfer":      MOVEMENT,
    "Income":        INCOME,
    "Cash":          COMMITMENT,
    "Charity":       COMMITMENT,
    "Other":         COMMITMENT,
}

#: Display-ordered built-in names. Single source of truth for the router.
BUILTIN_CATEGORIES = list(BUILTIN_CATEGORY_KINDS)

#: Names that some backend code paths recognise and others do not. Creating one
#: of these as a custom category produces partial recognition — the same
#: category counted as spend in one screen and excluded in another, i.e. two
#: different totals for the same name. Rejected at creation time.
RESERVED_NAMES = (
    "Internal Transfer",     # behaviour.py / cycle_story.py transfer checks
    "Loan Payment",          # behaviour.py:_NON_SPEND_CATEGORIES
    "Credit Card Payment",   # behaviour.py:_NON_SPEND_CATEGORIES
    "Hobbies",               # behaviour.py:_DISCRETIONARY
    "Health & Beauty",       # behaviour.py:_DISCRETIONARY
    "Sports & Fitness",      # behaviour.py:_DISCRETIONARY
    "Utilities",             # challenges.py:CHALLENGE_EXCL
    "Gambling",              # behaviour.py:_GAMBLING_CATEGORIES
)


# ── Name normalisation ───────────────────────────────────────────────────────
_WS = re.compile(r"\s+")


def normalise_name(name: str) -> str:
    """Fold a category name for comparison: casefold + collapse whitespace.

    ``"  gRoCeries "`` and ``"Groceries"`` compare equal, so a user cannot
    create a shadow category that looks identical to a built-in but is treated
    as a separate, unrecognised one. Used for comparison ONLY — the user's
    original casing is what gets stored.
    """
    return _WS.sub(" ", (name or "").strip()).casefold()


def clean_name(name: str) -> str:
    """Tidy a name for storage: trim ends, collapse internal runs of whitespace.

    Casing is preserved exactly as the user typed it.
    """
    return _WS.sub(" ", (name or "").strip())


_BUILTIN_NORMS  = {normalise_name(n): n for n in BUILTIN_CATEGORIES}
_RESERVED_NORMS = {normalise_name(n): n for n in RESERVED_NAMES}


def builtin_conflict(name: str) -> str | None:
    """Return the built-in this name collides with, ignoring case/whitespace."""
    return _BUILTIN_NORMS.get(normalise_name(name))


def reserved_conflict(name: str) -> str | None:
    """Return the reserved ghost name this collides with, if any."""
    return _RESERVED_NORMS.get(normalise_name(name))


def coerce_kind(kind: str | None, *, allow_internal: bool = False) -> str | None:
    """Normalise a kind string, or return None if it is not valid."""
    k = (kind or "").strip().casefold()
    allowed = VALID_KINDS if allow_internal else USER_SELECTABLE_KINDS
    return k if k in allowed else None


# ── Stored-document parsing (backwards compatible) ───────────────────────────
def parse_stored_categories(doc: dict | None) -> list[dict]:
    """Read a ``user_categories`` document under EITHER schema.

    Modern:  ``categories: [{"name": "Golf", "kind": "discretionary"}]``
    Legacy:  ``categories: ["Golf"]``

    A legacy bare string is read as ``DEFAULT_KIND`` (discretionary), which is
    what those categories effectively are today. Malformed entries are skipped
    rather than raising, so one bad row cannot take out the endpoint.

    Returns a list of ``{"name": str, "kind": str}`` with duplicates (by
    normalised name) collapsed, first occurrence winning.
    """
    raw = (doc or {}).get("categories") or []
    if not isinstance(raw, list):
        # A malformed document (e.g. `categories` stored as a bare string or a
        # dict) would otherwise be iterated character-by-character or
        # key-by-key, silently producing garbage per-character "categories".
        # Treat the whole container as empty rather than propagate that —
        # one bad row (or, here, a bad container) cannot take out the endpoint.
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for entry in raw:
        if isinstance(entry, str):
            name, kind = entry, DEFAULT_KIND
        elif isinstance(entry, dict):
            name = entry.get("name")
            kind = coerce_kind(entry.get("kind"), allow_internal=True) or DEFAULT_KIND
        else:
            continue
        if not isinstance(name, str):
            continue
        name = clean_name(name)
        if not name:
            continue
        norm = normalise_name(name)
        if norm in seen:
            continue
        seen.add(norm)
        out.append({"name": name, "kind": kind})
    return out


def custom_categories(doc: dict | None) -> list[dict]:
    """User's custom categories: stored entries minus any built-in collisions.

    Mirrors the historic ``_clean_custom`` filter (a legacy document may contain
    a name that later became a built-in, e.g. "Charity"), but now collision
    detection is case/whitespace insensitive too.
    """
    return [c for c in parse_stored_categories(doc) if not builtin_conflict(c["name"])]


# ── The kind map ─────────────────────────────────────────────────────────────
class CategoryKinds(dict):
    """``dict[str, str]`` of category name -> kind, with tolerant lookup.

    Behaves as a plain dict (JSON-serialisable, iterable, ``.get()`` works), but
    also carries a pre-built normalised index so ``kind_of`` can resolve a
    transaction whose stored category drifted in case or spacing without paying
    for a scan per lookup.

    Treat as read-only: the normalised index is built once at construction.
    """

    def __init__(self, mapping: dict[str, str] | None = None):
        super().__init__(mapping or {})
        self._norm = {normalise_name(k): v for k, v in self.items()}

    def kind_of(self, category: str | None) -> str:
        if not category:
            return DEFAULT_KIND
        kind = self.get(category)
        if kind is not None:
            return kind
        return self._norm.get(normalise_name(category), DEFAULT_KIND)


async def get_category_kinds(uid: str) -> CategoryKinds:
    """Built-in kinds merged with this user's custom category kinds.

    ONE database read. Call once per request and pass the result into the
    predicates below; never call this inside a per-transaction loop.

    Built-ins win over a same-named custom entry, so a legacy collision cannot
    reassign the meaning of a built-in category.
    """
    doc = await user_categories_col.find_one({"user_id": uid})
    kinds = dict(BUILTIN_CATEGORY_KINDS)
    for entry in custom_categories(doc):
        kinds[entry["name"]] = entry["kind"]
    return CategoryKinds(kinds)


# ── Predicates (kind map first — the efficient shape) ────────────────────────
def kind_of(kind_map: dict[str, str], category: str | None) -> str:
    """Kind for ``category``, falling back to ``DEFAULT_KIND`` if unknown."""
    if isinstance(kind_map, CategoryKinds):
        return kind_map.kind_of(category)
    if not category:
        return DEFAULT_KIND
    return kind_map.get(category, DEFAULT_KIND)


def is_non_spend(kind_map: dict[str, str], category: str | None) -> bool:
    """True if this category is not real spend (movement or income)."""
    return kind_of(kind_map, category) in NON_SPEND_KINDS


def is_spend(kind_map: dict[str, str], category: str | None) -> bool:
    """True if this category is real spend (discretionary or commitment)."""
    return not is_non_spend(kind_map, category)


def is_discretionary(kind_map: dict[str, str], category: str | None) -> bool:
    """True if this category is real spend the user freely chose."""
    return kind_of(kind_map, category) == DISCRETIONARY


def is_commitment(kind_map: dict[str, str], category: str | None) -> bool:
    """True if this category is real spend the user did not freely choose."""
    return kind_of(kind_map, category) == COMMITMENT


def is_income(kind_map: dict[str, str], category: str | None) -> bool:
    """True if this category represents money arriving."""
    return kind_of(kind_map, category) == INCOME


# ── Migration ────────────────────────────────────────────────────────────────
async def migrate_category_kinds() -> dict:
    """Upgrade legacy ``categories: [str]`` documents to ``[{name, kind}]``.

    Idempotent and cheap to re-run: the query only matches documents that still
    contain a bare string, so once migrated this is a no-op index scan.

    A legacy bare string becomes ``DEFAULT_KIND`` (discretionary) — exactly how
    it behaves today — except where the name matches a built-in, in which case
    it takes the built-in's kind so a legacy collision cannot silently disagree
    with the seed table.
    """
    scanned = upgraded = entries = 0
    cursor = user_categories_col.find({"categories": {"$elemMatch": {"$type": "string"}}})
    async for doc in cursor:
        scanned += 1
        parsed = parse_stored_categories(doc)
        new_list = []
        for entry in parsed:
            builtin = builtin_conflict(entry["name"])
            kind = BUILTIN_CATEGORY_KINDS[builtin] if builtin else entry["kind"]
            new_list.append({"name": entry["name"], "kind": kind})
        result = await user_categories_col.update_one(
            {"_id": doc["_id"]}, {"$set": {"categories": new_list}}
        )
        if result.modified_count:
            upgraded += 1
            entries += len(new_list)
    return {"scanned": scanned, "upgraded": upgraded, "entries_converted": entries}
