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
4. Every string VALUE kept anywhere in the tree, for every tool, is run
   through `_sanitise_text` (A91, pentest finding MCP-06): control and
   zero-width/bidi-override characters are stripped, whitespace is
   collapsed, the string is capped at 1000 characters, and the whole
   string is replaced with a fixed marker if it matches an
   instruction-shaped pattern. Rules 1-3 above are structural (key name,
   row shape); this rule is the one that inspects CONTENT, because a
   merchant name, recurring-series description, or insight trigger
   string is provider-supplied text a user does not fully control (a
   bank/Finexer/TrueLayer merchant field, or a payment reference someone
   else wrote), and an instruction-shaped string sitting in one of those
   fields would otherwise reach the connecting external assistant over
   `/mcp` unmodified. See `_INSTRUCTION_RE` for the exact patterns
   covered.
"""
import logging
import re

logger = logging.getLogger(__name__)

# ── A91 / MCP-06: content sanitisation ──────────────────────────────────
#
# Each alternative below matches one class of prompt-injection / instruction
# override attempt that could ride in on provider-supplied text (a merchant
# name, payment reference, category label, or insight trigger string). This
# is intentionally broad: a false positive here only swaps a suspicious
# fragment for a fixed marker, it never leaks anything, and the ordinary UK
# payment references this was tested against ("TESCO STORES 2941",
# "Amazon.co.uk*AB1CD2EF3", "DD SANTANDER MORTGAGE", "Mrs A Smith ref RENT
# MAY", "SumUp *The Coffee User", "PAYPAL *ASSISTANT SUPPLIES", "CONTRACT
# ASSOCIATES LTD", "EXACT ASSEMBLY", "IMPACT ASIA", "REACT ASSOCIATES",
# "SYSTEM PROMPTS LTD") don't trip any of these. Every word-initial
# alternative below is wrapped in `\b...\b` (leading boundary AND, where
# the alternative ends in a word rather than a delimiter, a trailing one
# too) precisely so it can only match a whole word run, never a substring
# straddling a word boundary: without it, `act\s+as` matched inside
# "REACT ASSOCIATES" and "IMPACT ASIA" (review finding, A91), and
# `system\s+prompt` without a trailing boundary would also match inside
# "SYSTEM PROMPTS LTD". The delimiter alternatives (`<|`, `|>`, `[INST]`,
# `<<SYS>>`, backticks) are punctuation, not words, so they keep no `\b`.
_INSTRUCTION_PATTERNS = [
    r"\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules)\b",  # "ignore all previous instructions"
    r"\bdisregard\s+(?:the\s+|your\s+)?(?:previous|prior|above|earlier|system)\b",  # "disregard the system..."
    r"\byou\s+are\s+now\b",  # role-reassignment opener
    r"\bnew\s+instructions\b",  # explicit override framing
    r"\bsystem\s+prompt\b",  # asks the model to reveal/replace its system prompt
    r"\b(?:system|assistant|user)\s*:",  # chat-role token injection, e.g. "system:"; requires the colon and a word
                                          # boundary so "PAYPAL *ASSISTANT SUPPLIES" (no colon) never matches
    r"<\|",  # special-token style delimiter, e.g. <|im_start|>
    r"\|>",  # closing half of the same delimiter style
    r"\[INST\]",  # Llama-style instruction delimiter
    r"<<SYS>>",  # Llama-style system delimiter
    r"```",  # fenced block, often used to smuggle a fake system/tool message
    r"\btell\s+the\s+user\s+(?:to|that|their)\b",  # instructs the connecting model to relay a message
    r"\bshare\s+(?:your|their|the)\s+password\b",  # credential-harvest instruction
    r"\bdo\s+not\s+tell\b",  # suppression instruction
    r"\bact\s+as\b",  # role-play jailbreak opener; \b...\b so it can't match inside "REACT ASSOCIATES"/"IMPACT ASIA"
    r"\bpretend\s+(?:to\s+be|you\s+are)\b",  # role-play jailbreak opener
    r"\breveal\s+(?:your|the)\s+(?:instructions|prompt)\b",  # prompt-extraction attempt
]
_INSTRUCTION_RE = re.compile("|".join(_INSTRUCTION_PATTERNS), re.IGNORECASE)

_INSTRUCTION_MARKER = "[text removed: instruction-like content]"
_MAX_TEXT_LEN = 1000
_TRUNCATION_SUFFIX = " [truncated]"

# Zero-width and bidi-override code points removed outright (never turned
# into a space): zero-width space/non-joiner/joiner/LRM/RLM (U+200B-200F),
# line/paragraph separators (U+2028/U+2029), word joiner (U+2060), BOM/
# zero-width no-break space (U+FEFF), and the bidi override/isolate control
# characters (U+202A-202E, U+2066-2069) that can be used to visually
# reorder or hide text.
_ZERO_WIDTH_AND_BIDI = frozenset(
    [0x2028, 0x2029, 0x2060, 0xFEFF]
    + list(range(0x200B, 0x2010))  # U+200B..U+200F
    + list(range(0x202A, 0x202F))  # U+202A..U+202E
    + list(range(0x2066, 0x206A))  # U+2066..U+2069
)


def _strip_control_and_bidi(text: str) -> str:
    """Tab and newline become a single space (later collapsed); every other
    C0 (U+0000-001F), DEL (U+007F) and C1 (U+0080-009F) control character,
    plus the zero-width/bidi-override code points in
    `_ZERO_WIDTH_AND_BIDI`, is removed outright."""
    out = []
    for ch in text:
        cp = ord(ch)
        if ch in ("\t", "\n"):
            out.append(" ")
        elif cp <= 0x1F or cp == 0x7F or 0x80 <= cp <= 0x9F:
            continue
        elif cp in _ZERO_WIDTH_AND_BIDI:
            continue
        else:
            out.append(ch)
    return "".join(out)


def _sanitise_text(value: str) -> tuple[str, str | None]:
    """Clean one string VALUE kept anywhere in a tool's masked output tree.

    Returns `(cleaned_value, reason)`. `reason` is `None` when nothing
    changed, `"instruction_like"` when the whole string was replaced by
    `_INSTRUCTION_MARKER`, or `"sanitised"` for a lesser change (control
    characters stripped, whitespace collapsed, or the 1000-character cap
    applied). The reason is used only for counting and logging, never
    anything user-visible, and the removed/original text itself is never
    logged."""
    cleaned = _strip_control_and_bidi(value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if _INSTRUCTION_RE.search(cleaned):
        return _INSTRUCTION_MARKER, "instruction_like"

    changed = cleaned != value
    if len(cleaned) > _MAX_TEXT_LEN:
        cleaned = cleaned[:_MAX_TEXT_LEN] + _TRUNCATION_SUFFIX
        changed = True

    return cleaned, ("sanitised" if changed else None)

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


def _walk(node, tool_name: str, dropped: list, sanitised: list, parent_key: str | None):
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
            out[key] = _walk(value, tool_name, dropped, sanitised, key)
        return out
    if isinstance(node, list):
        return [_walk(item, tool_name, dropped, sanitised, parent_key) for item in node]
    if isinstance(node, str):
        cleaned, reason = _sanitise_text(node)
        if reason is not None:
            sanitised.append(reason)
            if reason == "instruction_like":
                # A removal, not just a cosmetic clean-up: worth a WARNING
                # of its own so it's visible without grepping for the INFO
                # summary line below. Never logs the text itself.
                logger.warning(
                    "mcp_mask: tool=%s removed instruction-like text from a kept string",
                    tool_name,
                )
        return cleaned
    return node


def mask_output_and_count(tool_name: str, result):
    """Recursively apply every masking rule to `result` (a tool's raw
    `execute_tool` return value). Returns `(masked_result, dropped_count,
    sanitised_count)`; `dropped_count` (never the dropped values) feeds the
    per-call audit doc's `dropped_keys` field, `sanitised_count` feeds its
    `sanitised` field (A91), and both are logged here at INFO alongside the
    key NAMES / change reasons (still never any actual string content)."""
    dropped: list = []
    sanitised: list = []
    masked = _walk(result, tool_name, dropped, sanitised, None)
    if dropped:
        logger.info(
            "mcp_mask: tool=%s dropped=%d keys=%s",
            tool_name, len(dropped), sorted(set(dropped)),
        )
    if sanitised:
        logger.info(
            "mcp_mask: tool=%s sanitised=%d reasons=%s",
            tool_name, len(sanitised), sorted(set(sanitised)),
        )
    return masked, len(dropped), len(sanitised)


def mask_output(tool_name: str, result) -> dict:
    """Public entry point per the F3 spec's exact signature. Callers that
    also need the dropped-key/sanitised counts for the audit doc
    (`app/routers/mcp.py`) should call `mask_output_and_count` directly
    instead."""
    masked, _dropped, _sanitised = mask_output_and_count(tool_name, result)
    return masked
