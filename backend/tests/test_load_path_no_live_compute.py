"""H145: gate skeleton for the "no live calculation on screen load" rule
(ENGINE.md, "No live calculation on screen load").

A screen's load-path endpoint may read stored results and format them. It may
not compute money figures, forecasts, matches or candidates on request. Today
many still do on a cache miss (see docs/engine/LOAD-PATH-AUDIT.md), so this is
a RATCHET: an explicit allowlist records, per load-path route, the compute
functions its handler is currently permitted to reach. The test fails when

  * a handler reaches a compute function that is NOT in its allowance (a new
    live computation on a load path), or
  * an allowance lists a compute function the handler no longer reaches (a
    stale allowance: the precompute landed, so the entry must be removed).

The second rule is what makes the gate tighten by itself.

How the check works (static, no app import, no database): every router module
under app/routers is parsed with `ast`. For each route listed in LOAD_PATH the
handler function is found by its decorator (`@router.get("/path")`). The set
of called names (`foo(...)` or `x.foo(...)`) is collected from the handler
body, then, for every called name that is a function defined in the same
module and is not itself a compute function, the walk descends into that
helper (up to HELPER_DEPTH levels) and collects its calls too. Compute
functions (COMPUTE_FUNCTIONS) are sinks: the walk records them and does not
descend into them, so a route is judged by the first compute function it
reaches, not by everything behind it.

HOW TO TIGHTEN (each precompute step of H145's plan does this):
  1. Move the computation to sync time (or another recompute trigger) and have
     the handler read the stored result.
  2. In the same commit, delete the compute function from that route's set in
     LOAD_PATH below. If the route no longer reaches any compute function,
     leave its entry as an empty set so it stays under the gate.
  3. If the step introduces a new compute function name, add it to
     COMPUTE_FUNCTIONS so it is recognised, and (only if the handler really
     still has to call it) add it to the route's allowance with a comment
     naming the board item that will remove it.
  4. Never add a compute function to an allowance to make a new live call
     pass. That is the thing this test exists to stop.
A cache-miss fallback that calls a compute function counts as reaching it; the
end state is a handler that returns "not ready" or the last stored result and
lets the recompute triggers fill the store, with warm_user as a safety net.

LIMITS (read before trusting an empty allowance):
  * Matching is by bare called name. A compute function reached through an
    alias (`f = compute_x; f()`, `from m import compute_x as g`, `getattr`,
    a callable passed in as an argument, `functools.partial`) is NOT seen.
  * A helper in another module that is not listed in COMPUTE_FUNCTIONS is not
    descended into; only same-module helpers are.
  * Inline aggregation inside a handler (a Mongo pipeline or loop that sums raw
    transactions) is not a named function and is invisible. Routes known to do
    this are listed in KNOWN_INLINE so that an empty or short allowance on them
    is never read as "clean". Add a route there when you find inline compute;
    remove it only when the inline work has moved to a recompute trigger.
  * Computation in the browser is outside this test (see the audit, section 3).
  * Every GET route under app/routers must be classified: in LOAD_PATH (gated)
    or in NOT_LOAD_PATH (not called on the load of an audited screen). A new
    GET therefore cannot slip in unclassified; decide which list it belongs to.
"""
import ast
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
ROUTERS = BACKEND_ROOT / "app" / "routers"
HELPER_DEPTH = 3

# Functions that compute money figures, forecasts, matches, candidates,
# readings or aggregates from raw transactions and balances. Includes the
# read-through wrappers whose miss path computes. Matched by bare name.
COMPUTE_FUNCTIONS: frozenset[str] = frozenset({
    # Left to spend and its read-throughs
    "compute_safe_to_spend", "build_safe_to_spend_response",
    "cached_safe_to_spend_response", "get_cached_safe_to_spend",
    # pace, category signals, spend verdict
    "compute_pace", "compute_pace_detail", "compute_category_signals",
    "compute_spend_verdict",
    # Home plan items, cover plan, payday plan
    "build_today_payload", "compute_today_items",
    # Upcoming forecast and bill matching
    "compute_and_cache_cashflow", "_compute_cashflow_patterns",
    "_build_cashflow_response", "recompute_if_dirty_for_read",
    "_get_txn_dates_for_income_key", "current_period_facts",
    "build_window_inputs", "total_reserved_slices", "list_active_allocations",
    "_list_enriched", "_serialise_all", "_serialise", "_live_pool_balances",
    "_safe_to_spend_accounts", "_overlay_live_account_balances",
    "pooled_walk", "compute_account_positions",
    # transfer review candidates (G390 store, rebuilt inline on a miss)
    "get_review_state", "_build_review_state", "_resolve_period_bounds",
    "_series_touching_period", "_group_miscategorised",
    # money shape, debt plan, grow, commitments, mirror, nudges
    "get_money_shape_cached", "compute_and_cache_money_shape",
    "get_debt_plan_cached", "compute_debt_plan", "monthly_cashflow_cached",
    "compute_portrait", "get_aim_nudge", "goals_summary",
    "compute_insights", "_find_triggered_transactions",
    # per-request aggregation over transactions or accounts
    "try_build_spending_context", "from_docs", "txn_flow", "_avg_monthly_burn",
    "account_value", "_investment_display", "_cashflow", "_current_savings",
    "_period_gate", "_feasibility_ctx", "_debt_ctx",
    "_pace_note_ctx", "_apply_pace_notes",
})

# route -> compute functions the handler may reach today. Remove entries as
# each precompute lands; see the module docstring. Keys are "METHOD /path".
# An empty set means the handler reaches no compute function today (Stored).
# Measured results per route are in docs/engine/LOAD-PATH-AUDIT.md.
LOAD_PATH: dict[str, set[str]] = {
    "GET /today": {"build_today_payload"},
    "GET /safe-to-spend": {"cached_safe_to_spend_response"},
    "GET /spend/verdict": {"compute_spend_verdict"},
    "GET /spend/category-signals": {"compute_category_signals"},
    "GET /pace/detail": {"compute_pace_detail"},
    "GET /cashflow": {
        "_build_cashflow_response",
        "_compute_cashflow_patterns",
        "_get_txn_dates_for_income_key",
        "_live_pool_balances",
        "_overlay_live_account_balances",
        "_safe_to_spend_accounts",
        "cached_safe_to_spend_response",
        "compute_and_cache_cashflow",
        "current_period_facts",
        "list_active_allocations",
        "recompute_if_dirty_for_read",
        "total_reserved_slices",
    },
    "GET /cashflow/at-risk-count": {
        "_build_cashflow_response",
        "build_window_inputs",
        "compute_and_cache_cashflow",
        "recompute_if_dirty_for_read",
    },
    "GET /dismissed-series": set(),
    "GET /kpis": {
        "_avg_monthly_burn",
        "account_value",
        "try_build_spending_context",
    },
    "GET /transactions": {"from_docs", "txn_flow"},
    "GET /transactions/oldest": set(),
    "GET /transactions/miscategorised": {"_group_miscategorised", "get_review_state"},
    "GET /transactions/miscategorised-count": {
        "_group_miscategorised",
        "_resolve_period_bounds",
        "_series_touching_period",
        "get_review_state",
    },
    "GET /money-shape": {"get_money_shape_cached"},
    "GET /grow": {
        "_current_savings",
        "_investment_display",
        "_period_gate",
        "get_cached_safe_to_spend",
        "get_debt_plan_cached",
        "monthly_cashflow_cached",
    },
    "GET /commitments": {
        "_apply_pace_notes",
        "_debt_ctx",
        "_feasibility_ctx",
        "_pace_note_ctx",
        "_serialise_all",
    },
    "GET /allocations": {"_list_enriched"},
    "GET /account-plans": {"_serialise"},
    "GET /accounts": set(),
    "GET /sync/status": set(),
    "GET /connections": set(),
    "GET /profile": set(),
    "GET /preferences": set(),
    "GET /categories": set(),
    "GET /subscription": set(),
    "GET /savings-insights": {"_find_triggered_transactions"},
    "GET /savings/insights": {"_cashflow", "_current_savings"},
    "GET /debt-plan/summary": {"get_debt_plan_cached"},
    "GET /mirror": {"compute_portrait"},
    "GET /investment/accounts": {"_investment_display"},
    "GET /checkpoints/nudge": {"get_aim_nudge"},
    "GET /can-i/suggestions": {"get_cached_safe_to_spend"},
    "GET /goals/summary": {"goals_summary"},
    "GET /card-terms": set(),
    "GET /manual-accounts": set(),
    "GET /baskets/insights": set(),
    "GET /penny/conversations": set(),
    "GET /accounts/{account_id}/transactions": set(),
    "GET /accounts/{account_id}/categories": set(),
    "GET /savings-insights/spotlight": set(),
    "GET /transactions/search": set(),
}


def _decorated_routes() -> dict[str, tuple[Path, ast.AST, dict[str, ast.AST]]]:
    found: dict[str, tuple[Path, ast.AST, dict[str, ast.AST]]] = {}
    for path in sorted(ROUTERS.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        module_funcs = {
            n.name: n for n in tree.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        for node in module_funcs.values():
            for dec in node.decorator_list:
                if (
                    isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute)
                    and dec.func.attr in {"get", "post", "put", "patch", "delete"}
                    and dec.args
                    and isinstance(dec.args[0], ast.Constant)
                    and isinstance(dec.args[0].value, str)
                ):
                    key = f"{dec.func.attr.upper()} {dec.args[0].value}"
                    found[key] = (path, node, module_funcs)
    return found


def _called_names(node: ast.AST) -> set[str]:
    names: set[str] = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            f = sub.func
            if isinstance(f, ast.Name):
                names.add(f.id)
            elif isinstance(f, ast.Attribute):
                names.add(f.attr)
    return names


def reached_compute(handler: ast.AST, module_funcs: dict[str, ast.AST]) -> set[str]:
    reached: set[str] = set()
    seen: set[str] = set()

    def walk(fn: ast.AST, depth: int) -> None:
        for name in _called_names(fn):
            if name in COMPUTE_FUNCTIONS:
                reached.add(name)
            elif name in module_funcs and name not in seen and depth < HELPER_DEPTH:
                seen.add(name)
                walk(module_funcs[name], depth + 1)

    walk(handler, 0)
    return reached


def discover() -> dict[str, set[str]]:
    """Developer aid: what each LOAD_PATH route reaches right now."""
    routes = _decorated_routes()
    return {
        r: reached_compute(routes[r][1], routes[r][2]) for r in LOAD_PATH if r in routes
    }


def test_every_allowlisted_route_exists():
    routes = _decorated_routes()
    missing = sorted(r for r in LOAD_PATH if r not in routes)
    assert not missing, f"load-path routes not found in app/routers (renamed or removed?): {missing}"


def test_load_path_handlers_call_nothing_beyond_their_allowance():
    routes = _decorated_routes()
    problems = []
    for route, allowed in sorted(LOAD_PATH.items()):
        if route not in routes:
            continue
        _, handler, module_funcs = routes[route]
        actual = reached_compute(handler, module_funcs)
        extra = sorted(actual - allowed)
        if extra:
            problems.append(
                f"{route} now reaches {extra}: a load-path endpoint must read stored results, "
                "not compute (ENGINE.md, No live calculation on screen load)"
            )
    assert not problems, "\n".join(problems)


def test_allowances_are_tight():
    routes = _decorated_routes()
    stale = []
    for route, allowed in sorted(LOAD_PATH.items()):
        if route not in routes:
            continue
        _, handler, module_funcs = routes[route]
        actual = reached_compute(handler, module_funcs)
        unused = sorted(allowed - actual)
        if unused:
            stale.append(f"{route} no longer reaches {unused}: remove them from LOAD_PATH")
    assert not stale, "\n".join(stale)


def test_allowances_only_name_known_compute_functions():
    unknown = sorted(
        (r, f) for r, fs in LOAD_PATH.items() for f in fs if f not in COMPUTE_FUNCTIONS
    )
    assert not unknown, f"allowance names a function missing from COMPUTE_FUNCTIONS: {unknown}"


# Routes whose handlers aggregate inline, so the static check cannot see the
# computation. An empty allowance on one of these means "no named compute
# function", not "clean". Value: what the inline work is.
KNOWN_INLINE: dict[str, str] = {
    "GET /accounts/{account_id}/categories": "per-request aggregation over 90 days of the account's debits",
    "GET /kpis": "runway divides cash by a burn averaged inline from 90 days of debits, besides the named helpers",
}

# Every other GET under app/routers. Not called on the load of Home, Spend,
# Upcoming, Planning, Accounts, the account page, Penny or the transfers
# review; they belong to Settings, ops, auth and OAuth, billing, drill-downs
# and screens not yet audited (cards, tax, receipts, fuel, challenges, cycle).
# Moving a route here is a decision that it is not on a load path; if a screen
# starts calling it on load, move it to LOAD_PATH.
NOT_LOAD_PATH: frozenset[str] = frozenset({
    "GET ",
    "GET /.well-known/oauth-authorization-server",
    "GET /.well-known/oauth-protected-resource",
    "GET /.well-known/oauth-protected-resource/{resource_path:path}",
    "GET /.well-known/openid-configuration",
    "GET /accounts/{account_id}/rate",
    "GET /admin/broadcast",
    "GET /admin/broadcast/{broadcast_id}",
    "GET /admin/llm-usage",
    "GET /admin/sync-stats",
    "GET /allocations/fill-candidates",
    "GET /allocations/{allocation_id}/contribution-preview",
    "GET /auth/finexer/callback",
    "GET /auth/finexer/link",
    "GET /auth/finexer/providers",
    "GET /auth/google",
    "GET /auth/google/callback",
    "GET /auth/google/mobile",
    "GET /auth/google/mobile-callback",
    "GET /auth/identities",
    "GET /auth/mobile/poll",
    "GET /auth/oauth/authorize",
    "GET /auth/truelayer/callback",
    "GET /auth/truelayer/link",
    "GET /auth/truelayer/providers",
    "GET /backfill",
    "GET /baskets",
    "GET /baskets/{basket_id}",
    "GET /billing/apple/account-token",
    "GET /billing/play/config",
    "GET /billing/status",
    "GET /cards/story",
    "GET /categories/groups",
    "GET /challenges",
    "GET /checkpoints",
    "GET /checkpoints/history",
    "GET /checkpoints/{checkpoint_id}/evidence",
    "GET /commitments/fill-candidates",
    "GET /commitments/{commitment_id}",
    "GET /commitments/{commitment_id}/contribution-preview",
    "GET /commitments/{commitment_id}/ease-preview",
    "GET /cycle/story",
    "GET /fuel/nearby",
    "GET /fuel/status",
    "GET /go-live",
    "GET /health",
    "GET /health/alerts",
    "GET /health/collectors",
    "GET /health/collectors/{name}",
    "GET /health/trends",
    "GET /income/streams",
    "GET /insights",
    "GET /investment/accounts/{account_id}/holdings",
    "GET /investment/accounts/{account_id}/notes",
    "GET /logo/provider/{provider_id}",
    "GET /logo/{domain}",
    "GET /manual-account-rules",
    "GET /manual-accounts/{acc_id}/transactions",
    "GET /mcp",
    "GET /mcp/audit",
    "GET /mirror/payment-records",
    "GET /money-basics",
    "GET /money-basics/daily",
    "GET /needle/summary",
    "GET /oauth/connections",
    "GET /oauth/request/{req_id}",
    "GET /offers",
    "GET /penny/conversations/export",
    "GET /penny/conversations/{conversation_id}",
    "GET /planned",
    "GET /proxy",
    "GET /push/native/status",
    "GET /push/vapid-public-key",
    "GET /rules",
    "GET /savings-insights/labels",
    "GET /savings-insights/new-count",
    "GET /savings-insights/unknown-bills",
    "GET /savings-insights/workflows",
    "GET /settings",
    "GET /tax/annualised-income",
    "GET /today/cover-plan",
    "GET /transactions/transfer-pair-suggestions",
    "GET /transactions/{transaction_id}/similar",
    "GET /transport/summary",
    "GET /webhooks/recent",
    "GET /{pid}/subscription",
})


def test_known_inline_routes_are_gated():
    for route, reason in KNOWN_INLINE.items():
        assert route in LOAD_PATH, f"{route} is KNOWN_INLINE but not in LOAD_PATH"
        assert reason.strip(), f"{route} needs a reason in KNOWN_INLINE"


def test_every_get_route_is_classified():
    gets = {k for k in _decorated_routes() if k.startswith("GET ")}
    both = sorted(set(LOAD_PATH) & NOT_LOAD_PATH)
    assert not both, f"in both LOAD_PATH and NOT_LOAD_PATH: {both}"
    unclassified = sorted(gets - set(LOAD_PATH) - NOT_LOAD_PATH)
    assert not unclassified, (
        f"GET routes not in LOAD_PATH or NOT_LOAD_PATH: {unclassified}. "
        "Decide whether a screen calls it on load (LOAD_PATH, with its allowance) or not (NOT_LOAD_PATH)."
    )
    stale = sorted(NOT_LOAD_PATH - gets)
    assert not stale, f"NOT_LOAD_PATH names routes that no longer exist: {stale}"
