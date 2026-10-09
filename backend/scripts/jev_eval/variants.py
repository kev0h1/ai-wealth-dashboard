"""G178 tuning round: the variants ladder.

A Variant bundles everything that can differ between tuning rounds so a
runner or the report only needs a name:

  - `instructions_text`: the Jev Choice `instructions` string.
  - `haiku_addendum`: the equivalent wording folded into the Haiku prompt
    (empty for v0, so Haiku's prompt is unchanged byte-for-byte).
  - `state_builder(row)`: the Jev state text.
  - `header_builder(row)`: the state header alone ("" when the variant has
    none), shared with the Haiku prompt so both judges see the same facts.
  - `option_examples_mode`: "none" or "curated" (see options.build_criteria).

Everything is a pure function of the dataset row: no Mongo, no network.
Headers carry only aggregates and account subtypes, never merchant text, so
the firewall rule is unaffected.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass
from typing import Callable

from scripts.jev_eval.common import build_state_text

DEFAULT_VARIANT = "v0_baseline"

_DEBIT_RULE = (
    "A debit (money leaving the account) can never be Income, whatever "
    "the text says -- only ever choose Income for a credit line."
)

V0_INSTRUCTIONS = (
    "Assign this UK bank merchant to exactly one spending category, based "
    "only on the example transaction lines given in the state above. "
    f"{_DEBIT_RULE} If "
    "genuinely nothing fits, choose Other."
)

V1_INSTRUCTIONS = (
    "Assign this UK bank merchant to exactly one spending category, based "
    "only on the example transaction lines given in the state above. "
    "The merchant key and description usually name a UK shop, restaurant, "
    "utility, transport operator or service. Choose the category that kind "
    "of business belongs to, even when the exact brand is unfamiliar. "
    f"{_DEBIT_RULE} "
    "Use Other only when the text carries no business type at all."
)

V1_HAIKU_ADDENDUM = (
    "- The transaction descriptions usually name a UK shop, restaurant, "
    "utility, transport operator or service. Choose the category that kind "
    "of business belongs to, even when the exact brand is unfamiliar. "
    "Use Other only when the text carries no business type at all.\n"
)


def state_header(row: dict) -> str:
    """Aggregate facts about the example lines: count, typical amount,
    repeating amounts, account subtypes, credit/debit mix."""
    examples = row.get("examples") or []
    amounts = [e["amount"] for e in examples if isinstance(e.get("amount"), (int, float))]
    typical = f"£{statistics.median(amounts):.2f}" if amounts else "n/a"
    rounded = [round(a, 2) for a in amounts]
    repeats = len(rounded) != len(set(rounded))
    subtypes = sorted({str(e.get("subtype")).lower() for e in examples if e.get("subtype")})
    debits = sum(1 for e in examples if e.get("direction") == "debit")
    credits = len(examples) - debits
    return "\n".join([
        "Summary of the transaction lines:",
        f"- Lines seen: {len(examples)}",
        f"- Typical amount: {typical}",
        f"- Same amount repeats on 2 or more lines: {'yes' if repeats else 'no'}",
        f"- Account type(s): {', '.join(subtypes) if subtypes else 'unknown'}",
        f"- Direction mix: {debits} debit, {credits} credit",
    ])


def _plain_state(row: dict) -> str:
    return build_state_text(row["merchant_key"], row["examples"])


def _header_state(row: dict) -> str:
    return state_header(row) + "\n\n" + _plain_state(row)


def _no_header(row: dict) -> str:
    return ""


@dataclass(frozen=True)
class Variant:
    name: str
    instructions_text: str
    haiku_addendum: str
    state_builder: Callable[[dict], str]
    header_builder: Callable[[dict], str]
    option_examples_mode: str  # "none" | "curated"


VARIANTS: dict[str, Variant] = {
    "v0_baseline": Variant("v0_baseline", V0_INSTRUCTIONS, "", _plain_state, _no_header, "none"),
    "v1_instructions": Variant("v1_instructions", V1_INSTRUCTIONS, V1_HAIKU_ADDENDUM, _plain_state, _no_header, "none"),
    "v2_richer_state": Variant("v2_richer_state", V1_INSTRUCTIONS, V1_HAIKU_ADDENDUM, _header_state, state_header, "none"),
    "v3_curated_examples": Variant("v3_curated_examples", V1_INSTRUCTIONS, V1_HAIKU_ADDENDUM, _header_state, state_header, "curated"),
}


def get_variant(name: str | None) -> Variant:
    name = name or DEFAULT_VARIANT
    if name not in VARIANTS:
        raise SystemExit(f"unknown variant {name!r}; choose one of: {', '.join(VARIANTS)}")
    return VARIANTS[name]
