"""POST /savings-insights/{insight_id}/research retirement (owner decision
2026-09-01, verbatim: "the app should be responsible for the refreshes").

The live, user-initiated research pull this endpoint ran is superseded by
the weekly cron researching every category for every user on its own
predictable schedule (see test_cron_researches_all_categories.py) with a
displayed TTL per entry (test_content_ttl.py). Deleted, not 410'd — see the
comment left in its place in savings_insights.py for why removal (not a
stub) is this codebase's convention for a fully superseded surface.
"""
import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import router


def test_research_savings_insight_function_no_longer_exists():
    assert not hasattr(savings_insights, "research_savings_insight")


def test_no_route_is_registered_for_the_research_path():
    research_paths = [
        (r.path, sorted(r.methods))
        for r in router.routes
        if getattr(r, "path", "").endswith("/research")
    ]
    assert research_paths == [], f"a route still handles a /research path: {research_paths}"


def test_no_route_is_registered_for_post_on_the_insight_id_research_path():
    for r in router.routes:
        if r.path == "/savings-insights/{insight_id}/research":
            raise AssertionError("POST /savings-insights/{insight_id}/research must not exist")


def test_research_throttle_and_requested_at_helpers_are_gone():
    # RESEARCH_THROTTLE (the endpoint's own double-tap guard) is retired
    # alongside it — nothing left to import it.
    assert not hasattr(savings_insights, "RESEARCH_THROTTLE")


def test_old_research_ttl_constant_is_gone_replaced_by_default_research_ttl():
    # The old 48h pull-freshness window is fully replaced by the 7-day,
    # weekly-aligned DEFAULT_RESEARCH_TTL (see test_content_ttl.py).
    assert not hasattr(savings_insights, "RESEARCH_TTL")
    assert hasattr(savings_insights, "DEFAULT_RESEARCH_TTL")
    assert hasattr(savings_insights, "DEFAULT_RESEARCH_TTL_DAYS")
