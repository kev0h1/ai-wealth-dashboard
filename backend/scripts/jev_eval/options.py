"""Builds the Choice primitive's `criteria` map for one dataset row.

Pure and Mongo-free by design: everything this module needs -- the category
kind map, a scope, and (for scope="user" only) that ONE user's own real
correction examples -- is passed in already assembled. The live scripts
(`run_jev.py`) do the Mongo reads and hand this module plain dicts, which is
what makes `build_criteria` unit-testable with nothing running (see
`tests/test_jev_eval.py`).

Firewall Rule (ENGINE.md): user-provided text must never reach another
user's prompt, and a GLOBAL option (used for merchant keys the catalog
already shares across everyone) must never carry any single user's text at
all, however routine it looks. Two things enforce that here, not just
caller discipline:

  1. `build_criteria(..., scope="global", ...)` ignores `user_examples`
     entirely -- even if a caller passes it by mistake, every option's
     `examples` comes back `[]`. See the `scope == "user"` guard below.
  2. `build_criteria` takes no module-level or default-argument mutable
     state, so nothing written for one call can leak into the next one.
"""
from __future__ import annotations

# Deliberately NOT importing app.services.categories here (this module must
# stay import-clean of `app.*` for the same reason common.py does), but the
# category list and kind seed table are duplicated from
# `app.services.categories.BUILTIN_CATEGORY_KINDS` /
# `app.services.categorisation.VALID_CATEGORIES` (which are themselves the
# same 21 names in the same order) -- see `tests/test_jev_eval.py` for a
# cross-check against the real app module so this copy cannot silently
# drift. Kept as a copy rather than an import so `options.py`/`common.py`
# can be exercised (and imported by `run_jev.py --dry-run`) with zero `app`
# package side effects.
VALID_CATEGORIES: list[str] = [
    "Groceries", "Eating Out", "Transport", "Entertainment",
    "Shopping", "Bills", "Mortgage", "Car finance", "Subscriptions",
    "Health", "Beauty", "Travel",
    "Software", "Savings", "Investment", "Debt", "Transfer", "Income",
    "Cash", "Charity", "Other",
]

#: Categories the deterministic ladder tiers already own (Pass 2/2.6's
#: own-transfer + pot-ledger refinement) -- never offered as a Choice option
#: to either judge under test, matching `categorise_others_bg`'s own
#: `cat_list` exclusion. Re-exported from common so there is exactly one
#: definition.
from scripts.jev_eval.common import EXCLUDED_FROM_CHOICE  # noqa: E402

#: Static, generic (never user-specific) `{what, not_for}` descriptions for
#: each built-in category -- safe to share in a GLOBAL prompt, since this
#: text describes the world, not one user's transactions (the same
#: world-fact/user-fact split ENGINE.md draws for the merchant catalog
#: itself). Written from the rule text already in
#: `categorise_others_bg`'s prompt_prefix and the category-kind commentary
#: in `app/services/categories.py`, so it should read as a restatement of
#: existing doctrine rather than a new taxonomy.
CATEGORY_DESCRIPTIONS: dict[str, dict[str, str]] = {
    "Groceries": {
        "what": "Supermarkets and food shops bought for later consumption at home.",
        "not_for": "A single meal eaten or collected ready-to-eat (that is Eating Out), or a pharmacy/health-only purchase (Health).",
    },
    "Eating Out": {
        "what": "Restaurants, cafes, takeaways, coffee shops, and food-delivery apps.",
        "not_for": "A supermarket trip (Groceries) or an in-app subscription to a delivery service itself (Subscriptions).",
    },
    "Transport": {
        "what": "Trains, buses, taxis, ride-hailing, parking, fuel, and other car-running costs.",
        "not_for": "Flights or holiday travel booked as a trip (Travel), or a car finance/lease repayment (Car finance).",
    },
    "Entertainment": {
        "what": "Cinema, events, days out, hobbies, games, and other leisure spending.",
        "not_for": "A recurring streaming or app subscription (Subscriptions), or a gym/sport membership treated as health (Health).",
    },
    "Shopping": {
        "what": "Retail and online stores selling physical, non-food goods -- clothes, electronics, homeware.",
        "not_for": "Food bought to eat at home (Groceries) or a beauty/personal-care purchase (Beauty).",
    },
    "Bills": {
        "what": "Household utilities, broadband, mobile, insurance, rent, and council tax -- routine, non-discretionary household costs.",
        "not_for": "A mortgage payment (Mortgage) or car finance payment (Car finance), which are their own categories, or a subscription service (Subscriptions).",
    },
    "Mortgage": {
        "what": "A recognised mortgage lender's repayment on the user's home.",
        "not_for": "Rent (Bills) or any other loan repayment (Debt is a movement kind and is never assigned by this judge -- see excluded categories).",
    },
    "Car finance": {
        "what": "A recognised car finance or lease provider's repayment.",
        "not_for": "Fuel, parking, or other running costs of a car (Transport), or a mortgage payment (Mortgage).",
    },
    "Subscriptions": {
        "what": "Recurring digital memberships -- streaming, software-as-a-service, apps billed on a cycle.",
        "not_for": "A one-off purchase inside an app store (Shopping/Entertainment), or a household utility bill (Bills).",
    },
    "Health": {
        "what": "Hospitals, pharmacies, gyms, dentists, opticians, and other medical or fitness services.",
        "not_for": "A cosmetic/personal-care purchase (Beauty) or a grocery-store pharmacy aisle purchase bought alongside food (Groceries).",
    },
    "Beauty": {
        "what": "Hairdressers, cosmetics, skincare, and other personal-care spending.",
        "not_for": "A medical or fitness service (Health), or general retail shopping (Shopping).",
    },
    "Travel": {
        "what": "Flights, hotels, and holidays booked as a trip.",
        "not_for": "Everyday local transport (Transport).",
    },
    "Software": {
        "what": "One-off or professional software purchases and licences.",
        "not_for": "A recurring consumer subscription (Subscriptions).",
    },
    "Income": {
        "what": "Salary, refunds, cashback, or money received from someone else.",
        "not_for": "A debit (money leaving the account) can NEVER be Income, whatever the text says -- only ever assign this to a credit line. Money moving between the account owner's own accounts is Transfer, not Income (excluded from this judge's choices).",
    },
    "Cash": {
        "what": "ATM withdrawals and other cash-out transactions.",
        "not_for": "A specific purchase whose merchant is actually known (categorise by what it was, not that cash happened to be used).",
    },
    "Charity": {
        "what": "Donations to a recognised charity or fundraiser.",
        "not_for": "A payment to an individual person (that is more likely Transfer, excluded from this judge's choices, or Income if incoming).",
    },
    "Other": {
        "what": "Genuinely unclassifiable -- use only when nothing above fits at all.",
        "not_for": "A routine transaction that merely wasn't recognised by name; prefer the closest real category over Other whenever the transaction's nature (restaurant, shop, bill) is evident from the text.",
    },
}


def custom_category_names(kind_map: dict[str, str]) -> list[str]:
    """Names in `kind_map` beyond the 21 built-ins, excluding MOVEMENT-kind
    customs (Destination Rule: a movement-kind custom is never something a
    categorisation judge should guess into -- it resolves to a pot-ledger
    destination, never a category). Mirrors
    `app.services.categorisation.user_allowed_categories`'s own filter
    exactly; kept here as a literal copy (not an import) for the same
    Mongo/app-import-free reason as the rest of this module -- see
    `tests/test_jev_eval.py` for the cross-check against the real function.
    """
    out = []
    for name, kind in kind_map.items():
        if name in VALID_CATEGORIES or kind == "movement":
            continue
        if name not in out:
            out.append(name)
    return out


def build_criteria(
    kind_map: dict[str, str],
    *,
    scope: str,
    user_examples: dict[str, list[str]] | None = None,
) -> dict[str, dict]:
    """The Choice `criteria` map for one row.

    `kind_map`: category name -> kind ("discretionary"/"commitment"/
    "movement"/"income"). For scope="global" pass the plain built-in seed
    table; for scope="user" pass that user's own `get_category_kinds(uid)`
    result (built-ins merged with their customs).

    `user_examples`: category name -> list of that SAME user's own real
    correction description strings. Only ever consulted when
    `scope == "user"` -- for `scope == "global"` it is ignored outright,
    even if the caller passes something, which is the firewall
    enforcement point (see module docstring).

    Every option is capped at 3 examples. Built-in categories get their
    static `what`/`not_for` text plus (scope="user" only) that user's own
    examples if they have any for that category, else `[]` -- examples are
    never fabricated. Custom categories (scope="user" only, MOVEMENT
    excluded) get a generic `what`/`not_for` (the app has no world-fact
    description for a user-coined word) plus that user's own examples.
    """
    effective_examples: dict[str, list[str]] = {}
    if scope == "user" and user_examples:
        effective_examples = user_examples

    criteria: dict[str, dict] = {}
    for name in VALID_CATEGORIES:
        if name in EXCLUDED_FROM_CHOICE:
            continue
        base = CATEGORY_DESCRIPTIONS.get(name, {"what": name, "not_for": ""})
        criteria[name] = {
            "what": base["what"],
            "not_for": base["not_for"],
            "examples": list(effective_examples.get(name, []))[:3],
        }

    if scope == "user":
        for name in custom_category_names(kind_map):
            kind = kind_map.get(name, "discretionary")
            criteria[name] = {
                "what": f'"{name}" -- a {kind} spend category this user named themselves; the app has no built-in definition for it.',
                "not_for": f'Anything that does not match this specific user\'s own use of the word "{name}".',
                "examples": list(effective_examples.get(name, []))[:3],
            }

    return criteria
