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
    assert body["model"] == "jev-1.13"
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
    assert "Jev (jev-1.13)" in text
    assert "No results file yet" in text
    assert "Haiku baseline" in text
