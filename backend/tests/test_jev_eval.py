"""G178: tests for the offline Jev-vs-Haiku eval harness
(`backend/scripts/jev_eval/`). None of these touch Mongo or the network --
`options.build_criteria` and `report.py`'s maths are pure functions by
design (see those modules' own docstrings for why), and the dry-run
request-body shape is validated against the documented Choice contract
without any HTTP call.
"""
import json

import pytest

from scripts.jev_eval import options, report
from scripts.jev_eval.common import build_state_text, row_id


# ── options.py: the firewall (never leak one user's text into another's,
#    or into a global prompt at all) ────────────────────────────────────────

def test_global_scope_never_carries_user_examples_even_if_passed_by_mistake():
    """A caller bug that accidentally hands `user_examples` through on a
    `scope="global"` call must still produce zero examples on every option
    -- the enforcement has to live in `build_criteria` itself, not just in
    caller discipline, because a global option is shared with every user."""
    kind_map = {"Groceries": "commitment", "Eating Out": "discretionary"}
    leaked = {"Groceries": ["Kevin's private Tesco description text"]}

    criteria = options.build_criteria(kind_map, scope="global", user_examples=leaked)

    for name, spec in criteria.items():
        assert spec["examples"] == [], f"{name} leaked examples on a global build: {spec['examples']}"


def test_two_users_examples_never_cross_contaminate():
    """Two separate `build_criteria` calls, one per user, must never see
    each other's example text -- guards against a shared/mutable-default
    argument bug leaking state across calls."""
    kind_map = {"Groceries": "commitment", "Padel": "discretionary"}

    user_a_examples = {"Groceries": ["Tesco Kentish Town, user A"], "Padel": ["Playtomic, user A"]}
    user_b_examples = {"Groceries": ["Sainsbury's Local, user B"]}

    criteria_a = options.build_criteria(kind_map, scope="user", user_examples=user_a_examples)
    criteria_b = options.build_criteria(kind_map, scope="user", user_examples=user_b_examples)

    assert criteria_a["Groceries"]["examples"] == ["Tesco Kentish Town, user A"]
    assert criteria_b["Groceries"]["examples"] == ["Sainsbury's Local, user B"]

    # Neither user's text shows up anywhere in the other user's whole criteria map.
    a_text = json.dumps(criteria_a)
    b_text = json.dumps(criteria_b)
    assert "user B" not in a_text
    assert "user A" not in b_text
    # Padel (a custom category) only existed for user A's input and must not
    # have leaked any example into user B's build even though user B's
    # kind_map also declares Padel exists (shared taxonomy, private examples).
    assert criteria_b["Padel"]["examples"] == []


def test_examples_are_capped_at_three_per_option():
    kind_map = {"Groceries": "commitment"}
    user_examples = {"Groceries": ["one", "two", "three", "four", "five"]}
    criteria = options.build_criteria(kind_map, scope="user", user_examples=user_examples)
    assert criteria["Groceries"]["examples"] == ["one", "two", "three"]


def test_excluded_categories_never_appear_as_options():
    """Transfer/Savings/Debt/Investment are assigned deterministically by
    earlier passes (ENGINE.md's ladder) and must never be offered as a
    Choice option to either judge under test."""
    kind_map = dict.fromkeys(options.VALID_CATEGORIES, "commitment")
    criteria = options.build_criteria(kind_map, scope="global")
    for excluded in ("Transfer", "Savings", "Debt", "Investment"):
        assert excluded not in criteria


def test_movement_kind_custom_category_excluded_from_user_options():
    """The Destination Rule: a user's own MOVEMENT-kind custom category
    (e.g. a custom "House Fund" pot) resolves to a pot-ledger destination,
    never a category, so it must never be offered as a Choice option."""
    kind_map = {"House Fund": "movement", "Padel": "discretionary"}
    names = options.custom_category_names(kind_map)
    assert "House Fund" not in names
    assert "Padel" in names


def test_income_option_carries_the_debit_never_income_rule():
    kind_map = dict.fromkeys(options.VALID_CATEGORIES, "commitment")
    criteria = options.build_criteria(kind_map, scope="global")
    assert "debit" in criteria["Income"]["not_for"].lower()


# ── custom_category_names cross-checked against the real app helper ────────

def test_custom_category_names_matches_real_app_filter_shape():
    """`options.custom_category_names` is a literal copy of the filter
    `app.services.categorisation.user_allowed_categories` applies (kept
    Mongo/app-import-free on purpose -- see options.py's module docstring).
    This cross-checks the copy hasn't silently drifted from the real
    VALID_CATEGORIES list and MOVEMENT kind constant."""
    from app.services.categorisation import VALID_CATEGORIES as real_valid_categories
    from app.services.categories import MOVEMENT as real_movement

    assert options.VALID_CATEGORIES == real_valid_categories
    assert real_movement == "movement"


# ── common.py: state text always carries direction ──────────────────────────

def test_state_text_carries_direction_on_every_example_line():
    examples = [
        {"description": "Tesco Express", "amount": 12.34, "direction": "debit", "subtype": "current"},
        {"description": "Salary", "amount": 2000.0, "direction": "credit", "subtype": "current"},
    ]
    text = build_state_text("tesco", examples)
    lines = [l for l in text.splitlines() if l.strip() and l[0].isdigit()]
    assert len(lines) == 2
    assert "debit" in lines[0]
    assert "credit" in lines[1]


def test_state_text_handles_zero_examples_without_crashing():
    text = build_state_text("ghost merchant", [])
    assert "ghost merchant" in text
    assert "no example transaction lines" in text


def test_row_id_disambiguates_global_and_user_rows_sharing_a_merchant_key():
    global_id = row_id("global", "", "tesco")
    user_id = row_id("user", "abc123", "tesco")
    assert global_id != user_id


# ── run_jev.py's dry-run request body validates against the documented
#    Choice contract (state/model/questions; questions.<id>.{type,
#    instructions, criteria}), with no network call ─────────────────────────

def test_dry_run_request_body_matches_documented_choice_contract():
    from scripts.jev_eval.run_jev import build_request_body

    row = {
        "merchant_key": "playtomic",
        "scope": "global",
        "uid_hash": "",
        "label": "Entertainment",
        "label_source": "llm",
        "examples": [
            {"description": "PLAYTOMIC.IO 0987A SPAIN", "amount": 24.0, "direction": "debit", "subtype": "current"},
        ],
    }
    kind_map = dict.fromkeys(options.VALID_CATEGORIES, "commitment")
    body = build_request_body(row, kind_map, None)

    assert isinstance(body["state"], str) and body["state"]
    assert body["model"] == "jev-latest"
    assert build_request_body(row, kind_map, None, model="jev-1.13.0")["model"] == "jev-1.13.0"
    assert set(body["questions"].keys()) == {"category"}

    q = body["questions"]["category"]
    assert q["type"] == "choice"
    assert isinstance(q["instructions"], str) and q["instructions"]
    assert isinstance(q["criteria"], dict) and q["criteria"]

    # Up to 255 options per the documented Choice contract.
    assert len(q["criteria"]) <= 255

    for option_name, spec in q["criteria"].items():
        assert isinstance(option_name, str)
        # Criteria values may be strings or {what, not_for, examples}-shaped
        # objects per docs.typesafe.ai/primitives/choice.md -- this harness
        # always emits the latter.
        assert isinstance(spec, dict)
        assert "what" in spec and "not_for" in spec and "examples" in spec
        assert isinstance(spec["examples"], list)

    # JSON-serialisable, exactly as it will be POSTed.
    json.dumps(body)


# ── report.py maths on a tiny hand-built fixture ─────────────────────────────

@pytest.fixture
def tiny_records():
    # 4 gold rows, 1 silver row. Confidences chosen to land in distinct
    # deciles so calibration/ECE/abstain are all exercised.
    return [
        {"label": "Groceries", "label_source": "user", "choice": "Groceries", "confidence": 0.95, "latency_ms": 100},
        {"label": "Eating Out", "label_source": "user", "choice": "Eating Out", "confidence": 0.85, "latency_ms": 200},
        {"label": "Travel", "label_source": "user", "choice": "Shopping", "confidence": 0.55, "latency_ms": 300},
        {"label": "Bills", "label_source": "user", "choice": "Subscriptions", "confidence": 0.60, "latency_ms": 400},
        {"label": "Health", "label_source": "llm", "choice": "Health", "confidence": 0.90, "latency_ms": 150},
    ]


def test_agreement_counts_correct_over_gold_and_silver_separately(tiny_records):
    gold = report.agreement(tiny_records, "user")
    silver = report.agreement(tiny_records, "llm")
    assert gold == {"n": 4, "correct": 2, "accuracy": 0.5}
    assert silver == {"n": 1, "correct": 1, "accuracy": 1.0}


def test_confusion_pairs_lists_only_mismatches(tiny_records):
    pairs = report.confusion_pairs(tiny_records)
    pair_set = {(p["true"], p["pred"]) for p in pairs}
    assert ("Travel", "Shopping") in pair_set
    assert ("Bills", "Subscriptions") in pair_set
    assert ("Groceries", "Groceries") not in pair_set  # never a confusion, it's a match


def test_calibration_table_buckets_and_ece_is_between_0_and_1(tiny_records):
    table, ece = report.calibration_and_ece(tiny_records, n_buckets=10)
    assert len(table) == 10
    non_empty = [b for b in table if b["n"] > 0]
    assert sum(b["n"] for b in non_empty) == len(tiny_records)
    assert ece is not None
    assert 0.0 <= ece <= 1.0


def test_calibration_and_ece_on_a_perfectly_calibrated_fixture():
    """A fixture built so mean confidence exactly equals bucket accuracy in
    every populated bucket must score ECE == 0."""
    records = [
        {"label": "A", "choice": "A", "confidence": 0.91},
        {"label": "A", "choice": "A", "confidence": 0.91},
        {"label": "A", "choice": "B", "confidence": 0.91},  # bucket 0.9-1.0: 2/3 correct != 0.91... adjust
    ]
    # Build an exactly-calibrated 2-row fixture instead: both correct, both
    # at confidence 1.0 -> bucket accuracy 1.0 == mean confidence 1.0.
    records = [
        {"label": "A", "choice": "A", "confidence": 1.0},
        {"label": "B", "choice": "B", "confidence": 1.0},
    ]
    _, ece = report.calibration_and_ece(records, n_buckets=10)
    assert ece == pytest.approx(0.0)


def test_abstain_curve_is_monotonic_non_increasing_coverage(tiny_records):
    curve = report.abstain_curve(tiny_records, thresholds=[0.5, 0.6, 0.7, 0.8, 0.9, 0.95])
    coverages = [row["coverage"] for row in curve]
    assert coverages == sorted(coverages, reverse=True)
    # At threshold 0.95, only the 0.95-confidence gold row (correct) clears.
    assert curve[-1]["n"] == 1
    assert curve[-1]["accuracy"] == 1.0


def test_latency_stats_median_and_p95(tiny_records):
    stats = report.latency_stats(tiny_records)
    assert stats["n"] == 5
    assert stats["median_ms"] == 200
    assert stats["p95_ms"] in (300, 400)  # depends on rounding convention, both are defensible p95s of n=5


def test_jev_cost_per_1000_uses_input_plus_output_tokens_placeholder_rate():
    records = [
        {"usage": {"input_tokens": 500, "output_tokens": 20}},
        {"usage": {"input_tokens": 700, "output_tokens": 20}},
    ]
    cost = report.jev_cost_per_1000(records, price_per_billion_input_tokens=42.0)
    mean_tokens = ((500 + 20) + (700 + 20)) / 2
    expected = mean_tokens * (42.0 / 1e9) * 1000
    assert cost == pytest.approx(expected)


def test_haiku_cost_per_1000_from_recorded_cost_usd():
    records = [{"cost_usd": 0.0008}, {"cost_usd": 0.0006}]
    cost = report.haiku_cost_per_1000(records)
    assert cost == pytest.approx(((0.0008 + 0.0006) / 2) * 1000)


def test_report_works_when_only_one_result_file_exists():
    text = report.build_report(dataset_rows=[], jev_records=[{"label": "A", "choice": "A", "label_source": "user"}], haiku_records=None)
    assert "Jev (jev-latest)" in text
    assert "No results file yet" in text
    assert "Haiku baseline" in text


# ── G178 tuning round: split, variants, calibration, report ─────────────────

from scripts.jev_eval import calibrate, curated_examples, split as split_mod, variants  # noqa: E402


def _gold_row(key, label, n_examples=1, scope="global"):
    return {
        "merchant_key": key, "scope": scope, "uid_hash": "", "label": label, "label_source": "user",
        "examples": [{"description": f"{key} desc", "amount": 5.0, "direction": "debit", "subtype": "current"}] * n_examples,
    }


def _split_rows():
    rows = []
    for label in ("Groceries", "Bills", "Travel"):
        rows += [_gold_row(f"{label}-{i}", label) for i in range(10)]
    rows.append(_gold_row("lonely", "Health"))
    rows.append(_gold_row("empty one", "Shopping", n_examples=0))
    rows.append(_gold_row("moved money", "Transfer"))
    silver = _gold_row("silver one", "Groceries")
    silver["label_source"] = "llm"
    rows.append(silver)
    return rows


def test_split_is_deterministic_stratified_and_tags_unanswerable():
    rows = _split_rows()
    a = split_mod.make_split(rows)
    assert a == split_mod.make_split(list(reversed(rows)))
    assert a[row_id("global", "", "empty one")] == "unanswerable"
    assert a[row_id("global", "", "moved money")] == "unanswerable"
    assert a[row_id("global", "", "silver one")] == "silver"
    for label in ("Groceries", "Bills", "Travel"):
        buckets = [a[row_id("global", "", f"{label}-{i}")] for i in range(10)]
        assert buckets.count("tune") == 6 and buckets.count("holdout") == 4
    assert a[row_id("global", "", "lonely")] == "tune"  # single-row label stays in tune
    assert split_mod.make_split(rows, seed=1) != a


def test_filter_rows_by_bucket_requires_split_unless_all():
    rows = _split_rows()
    sp = split_mod.make_split(rows)
    assert split_mod.filter_rows_by_bucket(rows, "all", None) == rows
    with pytest.raises(SystemExit):
        split_mod.filter_rows_by_bucket(rows, "tune", None)
    tune = split_mod.filter_rows_by_bucket(rows, "tune", sp)
    assert tune and all(sp[row_id(r["scope"], r["uid_hash"], r["merchant_key"])] == "tune" for r in tune)


_FIXTURE_ROW = {
    "merchant_key": "playtomic", "scope": "global", "uid_hash": "", "label": "Entertainment", "label_source": "user",
    "examples": [{"description": "PLAYTOMIC.IO 0987A SPAIN", "amount": 24.0, "direction": "debit", "subtype": "current"}],
}


def test_v0_reproduces_todays_request_body_byte_for_byte():
    from scripts.jev_eval.run_jev import build_request_body

    kind_map = dict.fromkeys(options.VALID_CATEGORIES, "commitment")
    body = build_request_body(_FIXTURE_ROW, kind_map, None)
    legacy_criteria = {
        name: {"what": options.CATEGORY_DESCRIPTIONS[name]["what"], "not_for": options.CATEGORY_DESCRIPTIONS[name]["not_for"], "examples": []}
        for name in options.VALID_CATEGORIES if name not in options.EXCLUDED_FROM_CHOICE
    }
    legacy = {
        "state": build_state_text("playtomic", _FIXTURE_ROW["examples"]),
        "model": "jev-latest",
        "questions": {"category": {
            "type": "choice",
            "instructions": (
                "Assign this UK bank merchant to exactly one spending category, based "
                "only on the example transaction lines given in the state above. "
                "A debit (money leaving the account) can never be Income, whatever "
                "the text says -- only ever choose Income for a credit line. If "
                "genuinely nothing fits, choose Other."
            ),
            "criteria": legacy_criteria,
        }},
    }
    assert json.dumps(body) == json.dumps(legacy)
    assert json.dumps(build_request_body(_FIXTURE_ROW, kind_map, None, variant=variants.VARIANTS["v0_baseline"])) == json.dumps(legacy)


def test_v1_makes_other_a_last_resort_and_keeps_debit_rule_verbatim():
    v0, v1 = variants.VARIANTS["v0_baseline"], variants.VARIANTS["v1_instructions"]
    rule = "A debit (money leaving the account) can never be Income, whatever the text says -- only ever choose Income for a credit line."
    assert rule in v0.instructions_text and rule in v1.instructions_text
    assert "Use Other only when the text carries no business type at all." in v1.instructions_text
    assert "even when the exact brand is unfamiliar" in v1.instructions_text
    for v in variants.VARIANTS.values():
        assert "—" not in v.instructions_text and "—" not in v.haiku_addendum


def test_v2_state_header_is_a_pure_function_of_the_row():
    row = {"merchant_key": "x", "examples": [
        {"description": "a", "amount": 10.0, "direction": "debit", "subtype": "CREDIT_CARD"},
        {"description": "b", "amount": 10.0, "direction": "debit", "subtype": "TRANSACTION"},
        {"description": "c", "amount": 40.0, "direction": "credit", "subtype": "TRANSACTION"},
    ]}
    header = variants.state_header(row)
    assert "Lines seen: 3" in header
    assert "Typical amount: £10.00" in header
    assert "repeats on 2 or more lines: yes" in header
    assert "credit_card, transaction" in header
    assert "2 debit, 1 credit" in header
    state = variants.VARIANTS["v2_richer_state"].state_builder(row)
    assert state.startswith(header) and "Merchant identity key: x" in state
    empty = variants.state_header({"merchant_key": "x", "examples": []})
    assert "Lines seen: 0" in empty and "Typical amount: n/a" in empty and "unknown" in empty


def test_haiku_prompt_v0_unchanged_and_v2_mirrors_jev_wording_and_header():
    from scripts.jev_eval.run_haiku import build_prompt

    cats = ["Groceries", "Other"]
    v0 = build_prompt(_FIXTURE_ROW, cats, None)
    assert v0 == build_prompt(_FIXTURE_ROW, cats, None, variants.VARIANTS["v0_baseline"])
    assert v0.endswith('Reply ONLY with JSON: {"category": "Category"}\n\nExample transaction lines:\n1. [OUT] £24.00 PLAYTOMIC.IO 0987A SPAIN')
    assert "Summary of the transaction lines" not in v0

    v2 = variants.VARIANTS["v2_richer_state"]
    p2 = build_prompt(_FIXTURE_ROW, cats, None, v2)
    assert v2.haiku_addendum in p2
    assert "Use Other only when the text carries no business type at all." in p2
    assert variants.state_header(_FIXTURE_ROW) in p2
    assert p2.index("Summary of the transaction lines") < p2.index("Example transaction lines:")


def test_v3_global_criteria_carry_only_curated_names_never_user_text():
    kind_map = dict.fromkeys(options.VALID_CATEGORIES, "commitment")
    fake_user = {"Groceries": ["Zed's Corner Shop 42"], "Eating Out": ["Kevin's Cafe"]}
    crit = options.build_criteria(kind_map, scope="global", user_examples=fake_user, option_examples_mode="curated")
    curated = curated_examples.CURATED_EXAMPLES
    user_strings = {s for v in fake_user.values() for s in v}
    for name, spec in crit.items():
        assert spec["examples"] == curated.get(name, [])[:8]
        assert not (set(spec["examples"]) & user_strings)
    assert crit["Other"]["examples"] == []
    assert not (user_strings & {n for names in curated.values() for n in names})


def test_v3_user_scope_appends_user_examples_after_curated():
    kind_map = dict.fromkeys(options.VALID_CATEGORIES, "commitment")
    crit = options.build_criteria(kind_map, scope="user", user_examples={"Groceries": ["My Local"]}, option_examples_mode="curated")
    ex = crit["Groceries"]["examples"]
    assert ex[-1] == "My Local" and ex[:-1] == curated_examples.CURATED_EXAMPLES["Groceries"][:8]


def test_curated_examples_cover_every_offered_category_with_5_to_8_names():
    offered = [c for c in options.VALID_CATEGORIES if c not in options.EXCLUDED_FROM_CHOICE and c != "Other"]
    assert set(curated_examples.CURATED_EXAMPLES) == set(offered)
    for name, names in curated_examples.CURATED_EXAMPLES.items():
        assert 5 <= len(names) <= 8, name
        assert all("—" not in n for n in names)
    assert "Other" not in curated_examples.CURATED_EXAMPLES


def _overconfident_records(n=200):
    recs = []
    for i in range(n):
        correct = (i % 10) < 6  # 60% accurate
        label = "A" if correct else "B"
        recs.append({
            "label": label, "choice": "A", "label_source": "user",
            "confidence": 0.95, "probabilities": {"A": 0.95, "B": 0.03, "C": 0.02},
        })
    return recs


def test_temperature_scaling_softens_an_overconfident_judge():
    recs = _overconfident_records()
    t = calibrate.fit_temperature(recs)
    assert t > 1.0
    _, raw_ece = report.calibration_and_ece(recs)
    cal = calibrate.apply_temperature(recs, t)
    _, cal_ece = report.calibration_and_ece(cal)
    assert cal_ece < raw_ece
    assert all(c["confidence"] < 0.95 for c in cal)
    assert recs[0]["confidence"] == 0.95  # input untouched


def test_scaled_probs_sum_to_one_and_t1_is_near_identity():
    p = {"A": 0.7, "B": 0.2, "C": 0.1}
    s = calibrate.scaled_probs(p, 1.0)
    assert sum(s.values()) == pytest.approx(1.0)
    assert s["A"] == pytest.approx(0.7)
    assert calibrate.fit_temperature([]) == 1.0


def test_coverage_at_accuracy_and_answerable_partition():
    recs = (
        [{"row_id": f"r{i}", "label": "A", "choice": "A", "confidence": 0.9} for i in range(10)]
        + [{"row_id": f"w{i}", "label": "A", "choice": "B", "confidence": 0.5} for i in range(10)]
        + [{"row_id": "u1", "label": "Transfer", "choice": "Other", "confidence": 0.9}]
    )
    sp = {r["row_id"]: "tune" for r in recs}
    sp["u1"] = "unanswerable"
    ans, unans = report.partition_answerable(report.in_bucket(recs, sp, "tune"), sp)
    assert len(ans) == 20 and len(unans) == 1
    assert report.accuracy(ans) == 0.5
    rows = report.coverage_at_accuracy(ans)
    assert rows[2]["coverage"] == 0.5 and rows[2]["threshold"] == 0.9
    assert report.agreement_between(ans, [{"row_id": "r0", "choice": "A"}, {"row_id": "w0", "choice": "A"}])["rate"] == 0.5


def test_report_tables_are_aggregates_only_and_errors_dump_has_names():
    ds = [_gold_row("secret merchant", "Groceries")]
    rid = row_id("global", "", "secret merchant")
    jev = [{"row_id": rid, "merchant_key": "secret merchant", "label": "Groceries", "label_source": "user",
            "choice": "Other", "confidence": 0.7, "probabilities": {"Groceries": 0.2, "Other": 0.7, "Bills": 0.1}}]
    sp = {rid: "tune"}
    text = report.build_variant_report("v0_baseline", "tune", sp, jev, None, "tune")
    assert "secret merchant" not in text
    assert "accuracy on answerable rows" in text and "Unanswerable" in text and "Coverage at accuracy, calibrated" in text
    dump = report.build_errors_dump("v0_baseline", "tune", sp, ds, jev, [])
    assert "secret merchant" in dump


def test_results_path_v0_copies_legacy_file_once(tmp_path, monkeypatch):
    from scripts.jev_eval import common

    monkeypatch.setattr(common, "OUT_DIR", tmp_path)
    monkeypatch.setattr(common, "JEV_RESULTS_PATH", tmp_path / "jev_results.jsonl")
    (tmp_path / "jev_results.jsonl").write_text('{"row_id": "a"}\n')
    p = common.results_path("jev", "v0_baseline")
    assert p.name == "jev_results.v0_baseline.jsonl" and p.read_text() == '{"row_id": "a"}\n'
    p.write_text("changed\n")
    assert common.results_path("jev", "v0_baseline").read_text() == "changed\n"  # not overwritten
    assert not common.results_path("jev", "v1_instructions").exists()
