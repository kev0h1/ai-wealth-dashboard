"""Unit tests for the pure Codex board watcher event reconciler."""
from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import codex_board_events as events  # noqa: E402


def item(item_id="H118", **changes):
    base = {"id": item_id, "owner": "codex", "state": "todo", "branch": None, "notes": [], "priority": "p3"}
    base.update(changes)
    return base


def state():
    return {"version": 1, "observed": {}, "queue": [], "runs": []}


def test_bootstrap_idle_then_unchanged_poll_has_no_duplicate_and_keeps_inputs_immutable():
    initial = state()
    board = [item("H2"), item("H10", owner="kevin"), item("H11", state="blocked")]
    first = events.reconcile(initial, board, 10.0)
    assert [event["item_id"] for event in first["queue"]] == ["H2"]
    assert first["queue"][0]["kind"] == "assigned"
    assert initial == state()
    snapshot = copy.deepcopy(first)
    second = events.reconcile(first, board, 11.0)
    assert second == snapshot
    assert first == snapshot


def test_reassignment_and_approval_after_uat_round_queue_once_each():
    first = events.reconcile(state(), [item(owner="kevin")], 1)
    assigned = events.reconcile(first, [item()], 2)
    assert assigned["queue"][-1]["kind"] == "assigned"
    uat = events.reconcile(assigned, [item(state="uat", branch="feature-H118")], 3)
    # Approval returns the UAT item to implementation with no branch.
    approved = events.reconcile(uat, [item(state="in-progress", notes=[{"text": "approved: A"}])], 4)
    assert approved["queue"][-1]["kind"] == "approved"


def test_same_letter_second_approval_round_gets_a_new_generation_and_key():
    one = events.reconcile(state(), [item(state="in-progress", notes=[{"text": "approved: A"}])], 1)
    # The watcher can miss the intervening UAT state.  The new, same-letter
    # approval must still be a distinct event while the item is unbranched.
    two = events.reconcile(one, [item(state="in-progress", notes=[{"text": "approved: A"}, {"text": "approved: A"}])], 2)
    assert two["queue"][-1]["kind"] == "approved"
    assert two["queue"][-1]["key"] != one["queue"][-1]["key"]


def test_ordinary_approved_note_on_todo_does_not_change_the_watcher_signature():
    initial = events.reconcile(state(), [item()], 1)
    with_note = events.reconcile(initial, [item(notes=[{"text": "approved: housekeeping"}])], 2)
    assert with_note == initial
    assert events.signature(item(notes=[{"text": "approved: housekeeping"}]))["approval_count"] == 0
    assert events.signature(item(notes=[{"text": "approved: housekeeping"}]))["latest_approved_note"] is None


def test_state_cycles_and_rejected_reason_changes_are_actionable_events():
    first = events.reconcile(state(), [item()], 1)
    blocked = events.reconcile(first, [item(state="blocked")], 2)
    returned = events.reconcile(blocked, [item()], 3)
    assert returned["queue"][-1]["kind"] == "ready"
    rejected = events.reconcile(returned, [item(state="rejected", branch="feature-H118", reason="tests failed")], 4)
    assert rejected["queue"][-1]["kind"] == "rejected"
    revised = events.reconcile(rejected, [item(state="rejected", branch="feature-H118", reason="type check failed")], 5)
    assert revised["queue"][-1]["kind"] == "rejected"
    assert revised["queue"][-1]["key"] != rejected["queue"][-1]["key"]


@pytest.mark.parametrize("candidate", [
    item(owner="claude"), item(state="blocked"), item(state="uat"), item(state="review"),
    item(state="done"), item(state="cancelled"), item(state="in-progress", branch="feature-H118"),
])
def test_non_actionable_cases_are_excluded(candidate):
    assert events.reconcile(state(), [candidate], 1)["queue"] == []
    assert events.actionable(candidate) is False


def test_stale_queued_events_are_cancelled_when_item_changes_or_disappears():
    queued = events.reconcile(state(), [item()], 1)
    changed = events.reconcile(queued, [item(owner="kevin")], 2)
    assert changed["queue"] == []
    gone = events.reconcile(queued, [item("H119")], 2)
    assert all(event["item_id"] != "H118" for event in gone["queue"])


def test_priority_only_change_reorders_existing_queued_event_without_new_event():
    first = events.reconcile(state(), [item("H2", priority="p3"), item("H10", priority="p2")], 1)
    updated = events.reconcile(first, [item("H2", priority="p1"), item("H10", priority="p2")], 2)
    assert len(updated["queue"]) == 2
    assert [event["item_id"] for event in updated["queue"]] == ["H2", "H10"]
    old_h2 = next(event for event in first["queue"] if event["item_id"] == "H2")
    assert updated["queue"][0]["key"] == old_h2["key"]
    assert updated["queue"][0]["priority"] == "p1"


def test_all_codex_bootstrap_and_priority_ordering():
    result = events.reconcile(state(), [
        item("H10", priority="p3"),
        item("H2", state="rejected", branch="feature-H2", reason="repair", priority="p3"),
        item("A1", state="in-progress", notes=[{"text": "approved: B"}], priority="p3"),
        item("H1", priority="p1"),
    ], 1)
    assert [(event["kind"], event["item_id"]) for event in result["queue"]] == [
        ("approved", "A1"), ("rejected", "H2"), ("assigned", "H1"), ("assigned", "H10"),
    ]


@pytest.mark.parametrize("bad_state,bad_items", [
    ({}, [item()]),
    ({"version": 2, "observed": {}, "queue": [], "runs": []}, [item()]),
    (state(), []),
    (state(), [item("bad-id")]),
    (state(), [item(), item()]),
    (state(), [item(notes="approved: A")]),
    (state(), [item(priority="p9")]),
])
def test_corrupt_inputs_fail_loudly(bad_state, bad_items):
    with pytest.raises(ValueError):
        events.reconcile(bad_state, bad_items, 1)


@pytest.mark.parametrize("now", [True, float("inf"), float("nan")])
def test_non_finite_or_boolean_timestamps_fail_loudly(now):
    with pytest.raises(ValueError):
        events.reconcile(state(), [item()], now)


def test_corrupt_persisted_queue_event_and_signature_fail_loudly():
    persisted = events.reconcile(state(), [item()], 1)
    persisted["queue"][0]["key"] = "0" * 64
    with pytest.raises(ValueError, match="key"):
        events.reconcile(persisted, [item()], 2)

    persisted = events.reconcile(state(), [item()], 1)
    persisted["queue"][0]["signature"]["approval_count"] = True
    with pytest.raises(ValueError, match="approval count"):
        events.reconcile(persisted, [item()], 2)

    persisted = events.reconcile(state(), [item()], 1)
    persisted["queue"][0]["created_at"] = float("inf")
    with pytest.raises(ValueError, match="created_at"):
        events.reconcile(persisted, [item()], 2)
