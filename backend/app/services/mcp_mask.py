"""Output minimisation for the `/mcp` read connector (F3).

Owner decision 2026-09-08 (supersedes the F3 backlog item text where they
differ): v1 of the connector never returns raw transaction rows at all, not
even under a scope. Everything a tool hands back to an external assistant
must be an aggregate, a verdict, or a figure the app itself already shows in
that shape.

`mask_output` is the one place that rule is enforced, applied to EVERY
tool's result on its way out of `app/routers/mcp.py`'s `tools/call` handler,
regardless of which tool ran:

1. Banking identifiers are stripped by key name, anywhere in the tree.
   `app.core.models.Account` does carry `account_number`/`sort_code`
   fields even though today's `_exec_get_accounts` never serialises them,
   so this is defence in depth, not a no-op.
2. Any LIST of transaction-shaped dicts is dropped, anywhere in the tree,
   for every tool. "Transaction-shaped" means a dict carrying a
   description/merchant name AND an amount AND a date, the row shape of an
   actual bank transaction. This is what turns `get_account_activity`'s
   `top_transactions` list into nothing without a tool-specific rule; it is
   deliberately generic so a future tool that grows a transaction list
   doesn't leak one just because nobody remembered to add a case here.
3. A short list of tool-specific rules catches shapes rule 2 can't:
   `get_account_activity`'s `first_transaction`/`last_transaction` are
   single dicts, not lists, so they need an explicit key drop;
   `get_spend_verdict`'s `unresolved.largest` uses `display_name` rather
   than `description`/`merchant`, so it also needs an explicit drop.

Every other tool (get_category_spend's `top_merchants`, get_insights'
`triggered_by`, get_recurring_payments' `series`, get_fill_candidates'
`candidates`, ...) already reports merchant/category-level aggregates with
no `date` key sitting next to the amount, so rule 2 leaves them untouched.
This was audited by hand against each executor in
`app/services/penny_tools.py` when this module was written (2026-09-08),
not merely assumed.
"""
import logging

logger = logging.getLogger(__name__)

# Removed by key name, anywhere in the tree, for every tool.
_SENSITIVE_KEYS = {
    "account_number", "sort_code", "iban",
    "consent_id", "consent_ids", "credentials_id", "provider_account_id",
    "token", "access_token", "refresh_token",
}

# Tool-specific keys dropped anywhere in that tool's own result tree.
_TOOL_DROP_KEYS: dict[str, set[str]] = {
    "get_account_activity": {"top_transactions", "first_transaction", "last_transaction"},
}

# Tool-specific (parent_key, child_key) pairs dropped anywhere in that
# tool's own result tree, for single-dict transaction-shaped values rule 2
# can't reach because they aren't inside a list.
_TOOL_NESTED_DROPS: dict[str, set[tuple[str, str]]] = {
    "get_spend_verdict": {("unresolved", "largest")},
}


def _is_transaction_shaped(item) -> bool:
    """A dict counts as one bank-transaction row if it carries a
    description/merchant name AND an amount AND a date. Category/merchant
    aggregates in this codebase never carry all three under exactly these
    key names (they use `expected_date`, `last_date`, `monthly_amount`,
    `spent`, etc instead), which is what keeps this rule from also
    sweeping up the legitimate aggregates every read tool otherwise
    returns."""
    if not isinstance(item, dict):
        return False
    has_name = "description" in item or "merchant" in item
    return has_name and "amount" in item and "date" in item


def _walk(node, tool_name: str, dropped: list, parent_key: str | None):
    if isinstance(node, dict):
        extra_drop = _TOOL_DROP_KEYS.get(tool_name, ())
        nested_drop = _TOOL_NESTED_DROPS.get(tool_name, ())
        out = {}
        for key, value in node.items():
            key_l = key.lower() if isinstance(key, str) else key
            if key_l in _SENSITIVE_KEYS:
                dropped.append(key)
                continue
            if key in extra_drop:
                dropped.append(key)
                continue
            if parent_key is not None and (parent_key, key) in nested_drop:
                dropped.append(key)
                continue
            if isinstance(value, list) and value and all(_is_transaction_shaped(v) for v in value):
                dropped.append(key)
                continue
            out[key] = _walk(value, tool_name, dropped, key)
        return out
    if isinstance(node, list):
        return [_walk(item, tool_name, dropped, parent_key) for item in node]
    return node


def mask_output_and_count(tool_name: str, result):
    """Recursively apply every masking rule to `result` (a tool's raw
    `execute_tool` return value). Returns `(masked_result, dropped_count)`;
    the count (never the dropped values) feeds the per-call audit doc's
    `dropped_keys` field and is logged here at INFO alongside the key
    NAMES dropped (still never their values)."""
    dropped: list = []
    masked = _walk(result, tool_name, dropped, None)
    if dropped:
        logger.info(
            "mcp_mask: tool=%s dropped=%d keys=%s",
            tool_name, len(dropped), sorted(set(dropped)),
        )
    return masked, len(dropped)


def mask_output(tool_name: str, result) -> dict:
    """Public entry point per the F3 spec's exact signature. Callers that
    also need the dropped-key count for the audit doc (`app/routers/mcp.py`)
    should call `mask_output_and_count` directly instead."""
    masked, _dropped = mask_output_and_count(tool_name, result)
    return masked
