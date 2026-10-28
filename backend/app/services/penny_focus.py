"""B59: entity focus carried server-side across Penny turns.

The model's history is client-built text, so "just this one", "change it back"
or "that pot" lost the entity the previous answer had found. A focus is a small
record the server keeps on the stored assistant turn (field `last_result`,
extended from G254's transaction-only shape):

  {"tool": name, "kind": "transaction"|"allocation"|"commitment"|"account"|
   "occurrence"|"recurring", "ids": [...<=200], "labels": {id: short label},
   "args": {...short}}

Producers are the read tools below. Consumers are the propose tools: before one
runs, `run_with_focus` narrows an unresolved or generic reference to the
focused entity, and after one fails to find its target it retries once with the
single focused id. Never an amount: a rounded figure is not an identity.
"""
import logging
import re

logger = logging.getLogger(__name__)

FOCUS_IDS_CAP = 200
FOCUS_LOOKBACK_TURNS = 12
LABEL_MAX = 80
_ID_MAX = 64

# read tool -> focus kind
KIND_BY_TOOL = {
    "search_transactions": "transaction",
    "get_set_asides": "allocation",
    "get_goals": "commitment",
    "get_accounts": "account",
    "get_upcoming_bills": "occurrence",
    "get_recurring_payments": "recurring",
}

# G355: a goal draft rides on the focus record as `draft` (see clean_draft), so it
# survives the 6-turn model history. A focus whose kind is `goal_draft` holds only
# the draft (a tool of this name produced it); a draft with no content is the
# tombstone left when the proposal is created, so an older draft is not revived.
DRAFT_TOOL = "preview_goal_schedule"
DRAFT_KIND = "goal_draft"
DRAFT_TOOLS = frozenset({"preview_goal_schedule", "propose_create_scheduled_goal", "propose_update_commitment"})

# propose tool -> (reference argument, kinds it can resolve from)
REF_ARG_BY_TOOL = {
    "propose_recategorise_transaction": ("transaction_id", ("transaction",)),
    "propose_update_allocation": ("allocation_ref", ("allocation",)),
    "propose_delete_allocation": ("allocation_ref", ("allocation",)),
    "propose_update_commitment": ("commitment_ref", ("commitment",)),
    "propose_delete_commitment": ("commitment_ref", ("commitment",)),
    "propose_skip_occurrence": ("key_or_name", ("occurrence", "recurring")),
    "propose_edit_occurrence": ("key_or_name", ("occurrence", "recurring")),
    "propose_clear_override": ("key_or_name", ("occurrence", "recurring")),
    "propose_dismiss_recurring": ("key", ("recurring", "occurrence")),
    "propose_update_offline_account": ("account_ref", ("account",)),
    "propose_delete_offline_account": ("account_ref", ("account",)),
    "propose_add_ledger_entry": ("account_ref", ("account",)),
}

# Error text meaning "I could not find what you pointed at" (a retry with the
# focused entity is safe), as opposed to a validation failure.
_NOT_FOUND_RE = re.compile(r"\bno (transaction|allocation|commitment|account|recurring|series)\b|series matching|required", re.I)

_CTRL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def _clean_label(text) -> str:
    return re.sub(r"\s+", " ", _CTRL_RE.sub(" ", str(text or ""))).strip()[:LABEL_MAX]


# Deliberate: a focus is refreshed on every turn (carried forward when nothing new
# is found), so it does not age out of the 12-turn window mid-conversation. The
# kind check and whole-token matching bound the harm of a stale one, and a new
# producer tool returning an empty result set clears it (see penny_agent).
def clean_focus(raw) -> dict | None:
    """Validate a focus read from storage or built by a producer. None when it
    holds no usable ids. Legacy G254 values (no kind) are transaction focus."""
    if not isinstance(raw, dict):
        return None
    tool = raw.get("tool")
    if tool == DRAFT_TOOL and raw.get("kind") == DRAFT_KIND:
        draft = clean_draft(raw.get("draft"))
        out = {"tool": tool, "kind": DRAFT_KIND, "args": {}, "ids": ["draft"],
               "labels": {"draft": _clean_label((draft or {}).get("name") or "goal draft")}}
        if draft:
            out["draft"] = draft
        return out
    kind = raw.get("kind") or KIND_BY_TOOL.get(tool)
    if tool not in KIND_BY_TOOL or kind != KIND_BY_TOOL[tool]:
        return None
    ids = []
    for i in raw.get("ids") or []:
        if isinstance(i, (str, int)) and not isinstance(i, bool) and str(i).strip():
            ids.append(str(i)[:_ID_MAX])
    if not ids:
        return None
    ids = ids[:FOCUS_IDS_CAP]
    args = {}
    raw_args = raw.get("args")
    for k, v in (raw_args.items() if isinstance(raw_args, dict) else []):
        if isinstance(k, str) and len(k) <= 20 and isinstance(v, (str, int, float)) and not isinstance(v, bool):
            args[k] = str(v)[:40]
    labels = {}
    raw_labels = raw.get("labels")
    for k, v in (raw_labels.items() if isinstance(raw_labels, dict) else []):
        if isinstance(k, str) and k[:_ID_MAX] in ids and isinstance(v, str) and v.strip():
            labels[k[:_ID_MAX]] = _clean_label(v)
    out = {"tool": tool, "kind": kind, "args": args, "ids": ids, "labels": labels}
    draft = clean_draft(raw.get("draft"))
    if draft:
        out["draft"] = draft
    return out


# ── G355: the goal draft ─────────────────────────────────────────────────────

_DRAFT_STR = {"name": 80, "source_account_id": 64, "source_account_name": 80, "into_id": 64, "into_name": 80,
              "convert_from_set_aside": 64}
_DRAFT_INT = ("start_pence", "step_pence", "count", "expected_pay_pence", "day_number", "last_day")
_DRAFT_BASES = ("stated", "stored", "recent-transfers", "assumed", "model")
_DRAFT_INT_MAX = 100_000_000


def _iso_or_none(value) -> str | None:
    from datetime import date as _date
    try:
        return _date.fromisoformat(str(value)[:10]).isoformat()
    except (TypeError, ValueError):
        return None


def clean_draft(raw) -> dict | None:
    """Validate a goal draft read from storage or built by the schedule tools.
    Only known keys, typed and capped; None when nothing usable is left."""
    if not isinstance(raw, dict):
        return None
    out: dict = {}
    for key, cap in _DRAFT_STR.items():
        v = raw.get(key)
        if isinstance(v, str) and v.strip():
            out[key] = _clean_label(v)[:cap]
    for key in ("start_date", "end_date"):
        v = _iso_or_none(raw.get(key)) if raw.get(key) else None
        if v:
            out[key] = v
    for key in _DRAFT_INT:
        v = raw.get(key)
        if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= _DRAFT_INT_MAX:
            out[key] = v
    pct = raw.get("percent")
    if isinstance(pct, (int, float)) and not isinstance(pct, bool) and 0 < pct <= 100:
        out["percent"] = round(float(pct), 2)
    if raw.get("step_unit") in ("day", "week", "period"):
        out["step_unit"] = raw["step_unit"]
    if raw.get("source_basis") in _DRAFT_BASES:
        out["source_basis"] = raw["source_basis"]
    amounts = raw.get("amounts_pence")
    if isinstance(amounts, list) and 0 < len(amounts) <= 120 and all(
            isinstance(a, int) and not isinstance(a, bool) and 0 < a <= _DRAFT_INT_MAX for a in amounts):
        out["amounts_pence"] = list(amounts)
    cands = raw.get("source_candidates")
    if isinstance(cands, list):
        ids = [str(c)[:64] for c in cands if isinstance(c, (str, int)) and not isinstance(c, bool) and str(c).strip()][:8]
        if ids:
            out["source_candidates"] = ids
    if raw.get("create_alongside") is True:
        out["create_alongside"] = True
    cand = raw.get("convert_candidate")
    if isinstance(cand, dict) and cand.get("kind") in ("set_aside", "goal") and isinstance(cand.get("id"), str):
        out["convert_candidate"] = {"kind": cand["kind"], "id": cand["id"][:64], "name": _clean_label(cand.get("name"))}
    return out or None


def draft_of(last_result) -> dict | None:
    """The goal draft a stored focus carries, or None."""
    focus = clean_focus(last_result)
    return (focus or {}).get("draft")


def with_draft(focus: dict | None, draft: dict | None, *, tombstone: bool = False) -> dict | None:
    """`focus` carrying `draft`. With no other focus a draft-only focus is made;
    a cleared draft with no other focus leaves a tombstone only when asked (the
    proposal was created), so an older stored draft is not found again."""
    focus = clean_focus(focus)
    draft = clean_draft(draft)
    if focus and focus["kind"] == DRAFT_KIND:
        focus = None  # the draft record is rebuilt below
    if focus is None:
        if draft or tombstone:
            return clean_focus({"tool": DRAFT_TOOL, "kind": DRAFT_KIND, "draft": draft})
        return None
    focus = {k: v for k, v in focus.items() if k != "draft"}
    if draft:
        focus["draft"] = draft
    return focus


def transaction_labels(result: dict) -> dict:
    """Short labels for a search result's rows: `BRITISH GAS 2026-10-01 £159.70`."""
    labels = {}
    for r in (result or {}).get("transactions") or []:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        amount = (r.get("amount") or {}).get("formatted") if isinstance(r.get("amount"), dict) else ""
        label = _clean_label(f"{r.get('description') or ''} {r.get('date') or ''} {amount or ''}")
        if label:
            labels[str(r["id"])] = label
    return labels


def focus_from_result(name: str, result) -> dict | None:
    """The focus a non-search read tool's result establishes, or None."""
    if name not in KIND_BY_TOOL or name == "search_transactions" or not isinstance(result, dict):
        return None
    ids: list[str] = []
    labels: dict[str, str] = {}

    def add(i, label):
        if i is None or not str(i).strip():
            return
        i = str(i)[:_ID_MAX]
        if i not in labels:
            ids.append(i)
            labels[i] = _clean_label(label or i)

    if name == "get_set_asides":
        for a in result.get("set_asides") or []:
            add(a.get("id"), a.get("name"))
    elif name == "get_goals":
        for g in result.get("goals") or []:
            # The goals tool carries no id, and the commitment resolver
            # matches a name exactly, so the name is the reference.
            add(g.get("name"), g.get("name"))
    elif name == "get_accounts":
        for a in result.get("accounts") or []:
            add(a.get("id"), a.get("name"))
    elif name == "get_upcoming_bills":
        for b in result.get("upcoming_bills") or []:
            add(b.get("name"), b.get("name"))
    elif name == "get_recurring_payments":
        for s in result.get("series") or []:
            add(s.get("name"), s.get("name"))
    return clean_focus({"tool": name, "kind": KIND_BY_TOOL[name], "ids": ids, "labels": labels, "args": {}})


def focus_block(focus: dict | None) -> str:
    """Model-facing note naming the focused entities, so a follow-up passes the
    right id. Labels came from the user's own records, so they are stripped of
    control characters and capped."""
    focus = clean_focus(focus)
    if not focus:
        return ""
    draft_note = draft_block((focus or {}).get("draft"))
    if focus["kind"] == DRAFT_KIND:
        return draft_note
    shown = focus["ids"][:10]
    items = "; ".join(f"{focus['labels'].get(i, i)} [id {i}]" for i in shown)
    more = f" (and {len(focus['ids']) - len(shown)} more)" if len(focus["ids"]) > len(shown) else ""
    return (
        f"\n\nFOCUS: your last answer was about these {focus['kind']} records: {items}{more}. "
        "A follow-up such as 'just this one', 'change it back', 'put it under X', 'this one' or "
        "'that pot' means one of them: pass its id to the tool, never search again by a rounded "
        "figure, and never say you cannot find something you reported in the last few turns."
    ) + draft_note


def draft_block(draft: dict | None) -> str:
    """Model-facing note holding the goal draft. Built by penny_goal_schedule
    (which owns the schedule wording); empty when there is no draft."""
    if not draft:
        return ""
    try:
        from app.services.penny_goal_schedule import draft_sentence
        return "\n\n" + draft_sentence(draft)
    except Exception:
        logger.exception("penny_focus: draft sentence failed")
        return ""


_STOPWORDS = frozenset({
    "it", "this", "that", "one", "pot", "set", "aside", "asides", "setaside", "allocation", "plan", "goal",
    "account", "bill", "payment", "transaction", "the", "my", "just", "change", "back", "same",
})


def _norm(text) -> str:
    return re.sub(r"[^a-z0-9£.]+", " ", str(text or "").lower()).strip()


def _ref_tokens(text) -> list[str]:
    """The reference's own words: lower-cased, punctuation stripped, stopwords
    removed. Empty means the reference is generic ("it", "that pot")."""
    return [t for t in _norm(text).split() if t not in _STOPWORDS]


def _label_matches(needle: str, label: str) -> bool:
    """Whole-token containment: every non-stopword token of the reference is a
    token of the label. No substring tests, and a generic reference matches
    nothing."""
    tokens = _ref_tokens(needle)
    return bool(tokens) and set(tokens) <= set(_norm(label).split())


def _narrow_transactions(focus: dict, merchant, date_str, amount) -> list[str]:
    ids = [i for i in focus["ids"] if _label_matches(merchant, focus["labels"].get(i, ""))]
    if len(ids) > 1 and date_str:
        by_date = [i for i in ids if str(date_str)[:10] in focus["labels"].get(i, "")]
        ids = by_date or ids
    if len(ids) > 1 and amount is not None:
        try:
            token = f"£{abs(float(amount)):,.2f}"
            by_amount = [i for i in ids if token in focus["labels"].get(i, "")]
            ids = by_amount or ids
        except (TypeError, ValueError):
            pass
    return ids


def _single(focus: dict) -> str | None:
    return focus["ids"][0] if len(focus["ids"]) == 1 else None


def _pick(tool: str, args: dict, focus: dict) -> str | None:
    """The focused id this call should address before it runs, or None. A
    generic reference ("it", "that pot") takes the single focused id and never
    picks among several; a named one must match exactly one focused label."""
    ref_arg = REF_ARG_BY_TOOL[tool][0]
    ref = args.get(ref_arg)
    ref = str(ref).strip() if ref is not None else ""
    if ref and ref in focus["ids"]:
        return None  # an explicit id is never overridden
    if tool == "propose_recategorise_transaction":
        if ref:
            return None
        merchant = str(args.get("merchant") or "").strip()
        if not _ref_tokens(merchant):
            return _single(focus)
        ids = _narrow_transactions(focus, merchant, args.get("date"), args.get("amount"))
        return ids[0] if len(ids) == 1 else None
    if not _ref_tokens(ref):
        return _single(focus)
    ids = [i for i in focus["ids"] if _label_matches(ref, focus["labels"].get(i, ""))]
    return ids[0] if len(ids) == 1 else None


def _failed_to_find(result) -> bool:
    if not isinstance(result, dict) or result.get("proposal") is True:
        return False
    err = result.get("error")
    return isinstance(err, str) and bool(_NOT_FOUND_RE.search(err))


async def run_with_focus(uid: str, name: str, args: dict, execute) -> dict:
    """Run a propose tool with the conversation's focus applied. `execute` is
    penny_tools.execute_tool. `args["_focus"]` is stripped before dispatch."""
    args = dict(args)
    focus = clean_focus(args.pop("_focus", None))
    spec = REF_ARG_BY_TOOL.get(name)
    if not focus or not spec or focus["kind"] not in spec[1]:
        return await execute(uid, name, args)
    ref_arg = spec[0]
    picked = _pick(name, args, focus)
    if picked:
        logger.info("penny_focus: %s addressed to focused %s id for %s", name, focus["kind"], uid)
        return await execute(uid, name, {**args, ref_arg: picked})
    result = await execute(uid, name, args)
    if _failed_to_find(result) and len(focus["ids"]) == 1:
        logger.info("penny_focus: %s found nothing, retrying with the focused %s for %s", name, focus["kind"], uid)
        retry = await execute(uid, name, {**args, ref_arg: focus["ids"][0]})
        if isinstance(retry, dict) and not _failed_to_find(retry):
            return retry
    return result
