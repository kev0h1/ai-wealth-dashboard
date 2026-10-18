"""Pure reconciliation for the Codex board watcher.

This module deliberately knows nothing about files, subprocesses, or launching
agents.  Its input is the already-parsed board and its output is JSON-safe state
that a caller can persist atomically with dispatching an event.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
import math
import re
from typing import Any


_VERSION = 1
_ID_RE = re.compile(r"^[A-Z]+[1-9][0-9]*$")
_PRIORITY_RE = re.compile(r"^p([1-9][0-9]*)$")
_KEY_RE = re.compile(r"^[0-9a-f]{64}$")
_ACTIONABLE_STATES = {"todo", "in-progress", "rejected"}
_KNOWN_STATES = _ACTIONABLE_STATES | {"blocked", "uat", "review", "done", "cancelled"}


def _error(message: str) -> ValueError:
    return ValueError(f"invalid Codex board event data: {message}")


def _item_id(item: dict[str, Any]) -> str:
    item_id = item.get("id")
    if not isinstance(item_id, str) or not _ID_RE.fullmatch(item_id):
        raise _error("item id must be an uppercase section prefix followed by a non-zero number")
    return item_id


def _approval_details(item: dict[str, Any]) -> tuple[int, str | None]:
    notes = item.get("notes", [])
    if not isinstance(notes, list):
        raise _error("notes must be a list")
    approved: list[str] = []
    for note in notes:
        if not isinstance(note, dict) or not isinstance(note.get("text"), str):
            raise _error("each note must be an object with text")
        text = note["text"]
        if text.startswith("approved:"):
            approved.append(text)
    return len(approved), approved[-1] if approved else None


def _signature(item: dict[str, Any]) -> dict[str, Any]:
    item_id = _item_id(item)
    owner = item.get("owner")
    state = item.get("state")
    branch = item.get("branch")
    reason = item.get("reason")
    if not isinstance(owner, str) or not isinstance(state, str):
        raise _error(f"{item_id} needs string owner and state")
    if state not in _KNOWN_STATES:
        raise _error(f"{item_id} has unsupported state {state!r}")
    if branch is not None and not isinstance(branch, str):
        raise _error(f"{item_id} branch must be a string or null")
    if reason is not None and not isinstance(reason, str):
        raise _error(f"{item_id} reason must be a string or null")
    if "priority" in item and item["priority"] not in {"p1", "p2", "p3"}:
        raise _error(f"{item_id} has unsupported priority")
    # Approval notes are meaningful only after an approved design round has
    # returned a Codex item to implementation.  A user can write an ordinary
    # note beginning with ``approved:`` on any other item, so keeping those
    # notes in this signature would let them create a watcher wake-up.
    approval_count, latest_approved_note = _approval_details(item)
    if not (owner == "codex" and state == "in-progress" and branch is None):
        approval_count, latest_approved_note = 0, None
    return {
        "owner": owner,
        "state": state,
        "branch": branch,
        "reason": reason if state == "rejected" else None,
        "approval_count": approval_count,
        "latest_approved_note": latest_approved_note,
    }


def _validate_signature(signature: Any, *, label: str) -> dict[str, Any]:
    expected = {"owner", "state", "branch", "reason", "approval_count", "latest_approved_note"}
    if not isinstance(signature, dict) or set(signature) != expected:
        raise _error(f"{label} has the wrong shape")
    if not isinstance(signature["owner"], str) or signature["state"] not in _KNOWN_STATES:
        raise _error(f"{label} has invalid owner or state")
    if signature["branch"] is not None and not isinstance(signature["branch"], str):
        raise _error(f"{label} has invalid branch")
    if signature["reason"] is not None and not isinstance(signature["reason"], str):
        raise _error(f"{label} has invalid reason")
    if type(signature["approval_count"]) is not int or signature["approval_count"] < 0:
        raise _error(f"{label} has invalid approval count")
    if signature["latest_approved_note"] is not None and not isinstance(signature["latest_approved_note"], str):
        raise _error(f"{label} has invalid approved note")
    return signature


def actionable(item: dict[str, Any]) -> bool:
    """Whether an item is eligible for one Codex watcher dispatch."""
    signature = _signature(item)
    if signature["owner"] != "codex":
        return False
    if signature["state"] == "rejected":
        return True
    return signature["state"] in {"todo", "in-progress"} and signature["branch"] is None


def signature(item: dict[str, Any]) -> dict[str, Any]:
    """Return the canonical compact signature used for queue invalidation."""
    return _signature(item)


def _event_key(item_id: str, signature: dict[str, Any], generation: int) -> str:
    source = json.dumps(
        {"item_id": item_id, "signature": signature, "generation": generation},
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(source.encode("utf-8")).hexdigest()


def _priority_level(value: Any) -> int:
    if not isinstance(value, str):
        return 3
    match = _PRIORITY_RE.fullmatch(value)
    return int(match.group(1)) if match else 3


def _id_sort_key(item_id: str) -> tuple[str, int]:
    match = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", item_id)
    if not match:  # Event IDs are produced only after _item_id validation.
        raise _error("event has malformed item id")
    return match.group(1), int(match.group(2))


def priority(event: dict[str, Any]) -> tuple[int, int, str, int, str]:
    """Return the deterministic queue ordering for an event."""
    if not isinstance(event, dict):
        raise _error("event must be an object")
    kind = event.get("kind")
    if kind not in {"approved", "rejected", "assigned", "ready"}:
        raise _error("event has unsupported kind")
    item_id = event.get("item_id")
    if not isinstance(item_id, str):
        raise _error("event needs an item id")
    prefix, number = _id_sort_key(item_id)
    kind_rank = {"approved": 0, "rejected": 1, "assigned": 2, "ready": 2}[kind]
    key = event.get("key")
    if not isinstance(key, str):
        raise _error("event needs a key")
    return kind_rank, _priority_level(event.get("priority")), prefix, number, key


def _validate_state(state: dict[str, Any]) -> None:
    if not isinstance(state, dict) or state.get("version") != _VERSION:
        raise _error("unsupported or missing state version")
    for name, expected in (("observed", dict), ("queue", list), ("runs", list)):
        if not isinstance(state.get(name), expected):
            raise _error(f"state.{name} has the wrong shape")
    for item_id, entry in state["observed"].items():
        if not isinstance(item_id, str) or not _ID_RE.fullmatch(item_id):
            raise _error("observed state has malformed item id")
        if not isinstance(entry, dict) or "signature" not in entry:
            raise _error("observed state entry has the wrong shape")
        if type(entry.get("generation")) is not int or entry["generation"] < 0:
            raise _error("observed state generation has the wrong shape")
        _validate_signature(entry["signature"], label="observed signature")
    for event in state["queue"]:
        expected = {"key", "item_id", "signature", "kind", "created_at", "priority"}
        if not isinstance(event, dict) or set(event) != expected:
            raise _error("queued event has the wrong shape")
        item_id = event["item_id"]
        if not isinstance(item_id, str) or not _ID_RE.fullmatch(item_id):
            raise _error("queued event has malformed item id")
        if not isinstance(event["key"], str) or not _KEY_RE.fullmatch(event["key"]):
            raise _error("queued event has malformed key")
        if event["kind"] not in {"approved", "rejected", "assigned", "ready"}:
            raise _error("queued event has unsupported kind")
        if type(event["created_at"]) not in {int, float} or not math.isfinite(event["created_at"]):
            raise _error("queued event has invalid created_at")
        if event["priority"] not in {"p1", "p2", "p3"}:
            raise _error("queued event has invalid priority")
        signature = _validate_signature(event["signature"], label="queued event signature")
        observed = state["observed"].get(item_id)
        if observed is None or signature != observed["signature"]:
            raise _error("queued event does not match observed state")
        if event["key"] != _event_key(item_id, signature, observed["generation"]):
            raise _error("queued event key does not match its content")
    for run in state["runs"]:
        if not isinstance(run, dict) or not isinstance(run.get("event_key"), str):
            raise _error("runs must contain event_key objects")


def _kind(item: dict[str, Any], signature: dict[str, Any], previous: dict[str, Any] | None) -> str:
    if signature["state"] == "rejected":
        return "rejected"
    previous_signature = previous.get("signature") if previous else None
    old_count = previous_signature.get("approval_count", 0) if previous_signature else 0
    if signature["approval_count"] > old_count:
        return "approved"
    if previous is None or previous["signature"]["owner"] != "codex":
        return "assigned"
    return "ready"


def reconcile(state: dict[str, Any], items: list[dict[str, Any]], now: float) -> dict[str, Any]:
    """Return a copied, reconciled state for one parsed-board observation.

    The caller owns removal from ``queue`` and addition to ``runs`` when it
    dispatches.  This function only observes and queues.
    """
    _validate_state(state)
    if not isinstance(items, list) or not items:
        raise _error("items must be a non-empty list")
    if type(now) not in {int, float} or not math.isfinite(now):
        raise _error("now must be a number")

    result = deepcopy(state)
    board: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for item in items:
        if not isinstance(item, dict):
            raise _error("each item must be an object")
        item_id = _item_id(item)
        if item_id in board:
            raise _error(f"duplicate item id {item_id}")
        board[item_id] = (item, _signature(item))

    dispatched = {run["event_key"] for run in result["runs"]}
    valid_queue: list[dict[str, Any]] = []
    queued_keys: set[str] = set()
    for event in result["queue"]:
        item_id = event.get("item_id")
        observed = board.get(item_id) if isinstance(item_id, str) else None
        if (
            observed is None
            or event.get("key") in dispatched
            or not actionable(observed[0])
            or event.get("signature") != observed[1]
            or event.get("key") in queued_keys
        ):
            continue
        # Priority is deliberately outside the wake-up signature.  A reprioritised
        # queued job must move in the queue, but must not become a second job.
        event["priority"] = observed[0].get("priority", "p3")
        valid_queue.append(event)
        queued_keys.add(event["key"])
    result["queue"] = valid_queue

    for item_id, (item, signature) in board.items():
        previous = result["observed"].get(item_id)
        changed = previous is None or previous["signature"] != signature
        generation = (previous["generation"] + 1) if changed and previous else (1 if previous is None else previous["generation"])
        result["observed"][item_id] = {"signature": signature, "generation": generation}
        if not changed or not actionable(item):
            continue
        event = {
            "key": _event_key(item_id, signature, generation),
            "item_id": item_id,
            "signature": signature,
            "kind": _kind(item, signature, previous),
            "created_at": now,
            "priority": item.get("priority", "p3"),
        }
        if event["key"] not in queued_keys and event["key"] not in dispatched:
            result["queue"].append(event)
            queued_keys.add(event["key"])

    result["queue"].sort(key=priority)
    return result
