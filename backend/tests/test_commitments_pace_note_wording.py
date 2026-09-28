"""G153: `_apply_pace_notes`'s note text (routers/commitments.py) still said
"Spending is about £X ahead of usual this period, ..." after G151 changed
the Spend page itself to explicit more-than/less-than-usual wording, the
same ambiguous phrase Kevin asked to have removed. This pins the fixed
wording directly against the pure function, no HTTP layer needed.

`_apply_pace_notes` only ever builds a note with `pace_ctx["excess"] > 0`
(`_pace_note_ctx` returns None otherwise, and the loop below also skips a
non-positive excess before reaching the note text), so there is no
under-usual branch to cover here - unlike `SpendVerdictView.tsx`'s reading
sentence, this note is one-sided by construction.
"""
from app.routers.commitments import _apply_pace_notes


def _item(per_period_slice=300.0):
    return {"per_period_slice": per_period_slice}


def _doc(status="active"):
    return {"status": status}


def test_pace_note_uses_more_than_usual_wording_not_ahead_of_usual():
    items = [_item()]
    docs = [_doc()]
    _apply_pace_notes(items, docs, {"excess": 150.0})

    note = items[0]["pace_note"]
    assert note is not None
    assert note["text"] == (
        "Spending is £150 more than usual this period, "
        "which may squeeze the £300 this plan needs."
    )
    assert "ahead of usual" not in note["text"]
    assert note["link"] == "spend"


def test_pace_note_none_when_excess_below_slice_ratio():
    items = [_item(per_period_slice=900.0)]  # ratio floor is excess/3 = 300
    docs = [_doc()]
    _apply_pace_notes(items, docs, {"excess": 150.0})
    assert items[0]["pace_note"] is None


def test_pace_note_none_when_plan_not_active():
    items = [_item()]
    docs = [_doc(status="done")]
    _apply_pace_notes(items, docs, {"excess": 150.0})
    assert items[0]["pace_note"] is None


def test_pace_note_none_when_no_pace_context():
    items = [_item()]
    docs = [_doc()]
    _apply_pace_notes(items, docs, None)
    assert items[0]["pace_note"] is None
