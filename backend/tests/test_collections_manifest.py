"""Guard test for backlog A101.

app.services.retention.erase_user used to decide what to sweep on account
deletion by walking every `*_col` attribute on app.db.collections at
runtime (`dir(_cols)`). That is how A98's Kenya removal silently dropped
mpesa_accounts_col/mpesa_transactions_col (and three mono_* bindings) out
of account erasure: removing the binding removed it from the sweep too,
and nothing noticed. app.db.collections.ERASURE_MANIFEST replaces that
runtime enumeration with an explicit, reviewable list.

This test is the guard that keeps the manifest honest: it fails loudly,
naming the collection, the moment ERASURE_MANIFEST and the live `*_col`
bindings in app.db.collections disagree in either direction.
  - A live binding with no manifest entry means a new collection was added
    without anyone deciding whether erase_user should sweep it.
  - A manifest entry with no live binding means a collection was removed
    without anyone deciding what happens to the user data already in it
    (exactly what happened to the five Kenya collections under A98 — see
    app.db.collections.ERASE_ONLY_COLLECTIONS, which is the fix for
    those five specifically and is deliberately NOT compared here, since
    there is no *_col binding for it to be compared against).
"""
import app.db.collections as collections


def _live_col_bindings() -> set[str]:
    return {name for name in dir(collections) if name.endswith("_col")}


def test_erasure_manifest_matches_live_col_bindings():
    live = _live_col_bindings()
    manifest = set(collections.ERASURE_MANIFEST)

    added_without_manifest_entry = live - manifest
    assert not added_without_manifest_entry, (
        "app/db/collections.py has *_col binding(s) not listed in "
        "ERASURE_MANIFEST, so erase_user will silently skip them on "
        "account deletion: "
        f"{sorted(added_without_manifest_entry)}. Add each to "
        "ERASURE_MANIFEST (having decided erase_user should sweep it), or "
        "remove the binding if it holds no user data."
    )

    removed_without_binding = manifest - live
    assert not removed_without_binding, (
        "ERASURE_MANIFEST names collection(s) with no live *_col binding in "
        "app/db/collections.py, so erase_user's getattr would crash (or, "
        "before this guard existed, silently stop sweeping them once the "
        "binding was removed — the exact A101 bug): "
        f"{sorted(removed_without_binding)}. Decide what happens to that "
        "collection's user data (drop it, or fold it into "
        "app.db.collections.ERASE_ONLY_COLLECTIONS as an erase-only entry "
        "the way A101 did for the five Kenya collections), then remove it "
        "from ERASURE_MANIFEST."
    )


def test_erasure_manifest_and_erase_only_collections_do_not_overlap():
    """A collection should be swept exactly one way: either it has a live
    *_col binding (ERASURE_MANIFEST) or it doesn't (ERASE_ONLY_COLLECTIONS,
    keyed by bare Mongo collection name, not attribute name) — never both,
    and the two sets use different name shapes (`foo_col` vs `foo`) so an
    accidental overlap would be a sign something is mis-keyed."""
    manifest_bare_names = {name.removesuffix("_col") for name in collections.ERASURE_MANIFEST}
    overlap = manifest_bare_names & set(collections.ERASE_ONLY_COLLECTIONS)
    assert not overlap, (
        f"collection(s) listed in both ERASURE_MANIFEST and "
        f"ERASE_ONLY_COLLECTIONS: {sorted(overlap)}"
    )


# ── A128: retired collections ───────────────────────────────────────────────

def _bound_mongo_names() -> set[str]:
    """Real Mongo collection names behind every live *_col binding (the
    attribute name often differs, e.g. behaviour_portrait_col)."""
    return {getattr(collections, n).name for n in _live_col_bindings()}


def test_retired_collections_have_no_live_binding():
    """A name in RETIRED_COLLECTIONS must not also be bound: a bound
    collection is live code's, and belongs in ERASURE_MANIFEST."""
    bound = _bound_mongo_names()
    clash = bound & set(collections.RETIRED_COLLECTIONS)
    assert not clash, (
        f"collection(s) {sorted(clash)} are in RETIRED_COLLECTIONS but also "
        "have a live *_col binding; remove them from RETIRED_COLLECTIONS and "
        "add the binding to ERASURE_MANIFEST."
    )
    assert not (set(collections.RETIRED_COLLECTIONS) & set(collections.ERASE_ONLY_COLLECTIONS))


def test_known_retired_names_are_covered():
    """expo_push_tokens and savings_plans (A128) predate any manifest and
    were missed by it: they must stay covered by name until the migration
    has run everywhere and a reviewer removes them on purpose."""
    assert {"expo_push_tokens", "savings_plans"} <= set(collections.RETIRED_COLLECTIONS)
    assert {"expo_push_tokens", "savings_plans"} <= collections.managed_collection_names()


def test_managed_collection_names_flags_unknown_collection():
    managed = collections.managed_collection_names()
    live_names = ["transactions", "expo_push_tokens", "mpesa_accounts", "some_new_thing"]
    assert sorted(n for n in live_names if n not in managed) == ["some_new_thing"]


def test_every_bound_collection_name_is_managed():
    assert _bound_mongo_names() <= collections.managed_collection_names()
