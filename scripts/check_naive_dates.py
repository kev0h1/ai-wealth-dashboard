#!/usr/bin/env python3
"""G166 regression guard: no new naive local-clock date/time call in
backend/app.

Background (see CLAUDE.md's "London-today sweep" / G161 / G166): the app
used to compute "today" from the server's own clock. From about 23:00
Europe/London the naive UTC date is already tomorrow's UTC date's eve while
still being TODAY in London (and the reverse, just after London midnight
during BST, when the UTC clock is still on yesterday) -- so a naive
`date.today()` / `datetime.now()` / `datetime.utcnow()` used for anything the
user sees as a day (a "days ago" badge, a "valid until" date, a due/overdue
flag, a day/week reset boundary) can silently disagree with the user's own
calendar day for up to an hour a day, and disagree with ITSELF between hosts
on different timezones (the UAT VPS was on Europe/Berlin; Railway prod is
UTC). `app.core.timeutil`'s `user_today()` / `user_now()` / `to_user_date()`
are the fix: a single Europe/London-aware source of "today" for every
calendar-facing call site. G161 swept the app for this; G166 finished the
one file G161's own review found missed (`savings_insights.py`) and adds
this script as the guard that stops it reappearing.

What this script does: greps backend/app for `date.today(`, `datetime.now(`
and `datetime.utcnow(` and fails, listing file:line, for every hit that
isn't explicitly allowed. A hit is allowed two ways:

  1. A `# naive-ok: <reason>` comment on the same source line (grep for it
     yourself before reaching for the central list below -- it's the
     lighter-weight option for a genuine one-off, and keeps the reason next
     to the code it's about).
  2. An entry in the ALLOWLIST dict below, keyed by (relative file path,
     line number).

DESIGN CHOICE, spelled out because it's the one a future maintainer is most
likely to want to change: the central allowlist is keyed by exact LINE
NUMBER, not by file or by a source-text pattern. The alternative -- allow
everything in a given file, or allow every line matching some regex like
`r'_at"?\\s*:\\s*datetime\\.'` -- would be far less code to maintain, but it
defeats the point of the guard: the overwhelming majority of naive calls in
this codebase are entirely legitimate (persisted audit timestamps such as
created_at/updated_at, multi-week transaction-lookback cutoffs, hour-scale
cache TTLs, background sync-worker internals) and look, at the source-line
level, IDENTICAL to the genuinely buggy ones this sweep fixed -- `now =
datetime.utcnow()` was the exact shape of both a correct persisted-timestamp
write AND, before this pass, of the three real bugs in savings_insights.py
and the one in routers/subscription.py. A blanket file- or pattern-level
allow would have silently let all four of those past. Keying to the exact
audited line means ANY newly introduced call -- including one added at a
fresh line number in an already-mostly-allowlisted file -- fails the check
and must be triaged explicitly, either by moving it onto timeutil or by
adding a new, reasoned entry (or an inline pragma) right next to it.

The trade-off, accepted deliberately: an unrelated edit that shifts line
numbers in an allowlisted file makes previously-fine lines fail this check
again, purely because their line number moved. That's noise, not a bug in
the guard -- re-run the classification for the file (see the loop this
script itself runs, or just `grep -n` it) and update the line numbers. A
false "please re-triage this" is the trade this script is designed to make,
in preference to a false "nothing to see here" silently swallowing a real
regression.
"""
from __future__ import annotations

import pathlib
import re
import sys

# This script lives at repo-root scripts/, matching scripts/check_pentest_evidence.py's
# location and invocation style (run with backend/.venv's python, cwd = repo root) --
# see scripts/session.sh's finish step. ALLOWLIST paths below are relative to backend/,
# since that's where the naive-date call sites actually are.
REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]  # repo root
BACKEND_ROOT = REPO_ROOT / "backend"
APP_ROOT = BACKEND_ROOT / "app"

NAIVE_CALL_RE = re.compile(r"date\.today\(|datetime\.now\(|datetime\.utcnow\(")
INLINE_PRAGMA_RE = re.compile(r"#\s*naive-ok\s*:")


def _lines(reason: str, *nums: int) -> dict[int, str]:
    return {n: reason for n in nums}


# ── Reason buckets shared across many files ────────────────────────────────
_LOOKBACK = "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
_AUDIT = "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user as a day or day-count)"
_TTL = "raw-instant cache/regen/re-ask TTL gate (decides whether to recompute or re-offer something), not rendered day-count copy"
_MONTH_KEY = "month-grain billing/usage metering key (Y-M); the Dec 31 -> Jan 1 rollover this could ever disagree on always falls in GMT (BST always ends before it), so UTC and Europe/London never actually diverge here"
_SYNC_INTERNAL = "background bank-sync worker internals (token/connection lifecycle, retry/query windows), not user-facing"

# ── Per-file entries, in the order `grep -rn` finds them ───────────────────
ALLOWLIST: dict[str, dict[int, str]] = {
    "app/core/bot_credentials.py": _lines(
        "bot API credential TTL/expiry + a per-day telemetry bucket key for bot-call logging; "
        "internal bot-auth plumbing, not user-facing",
        113, 170, 190, 249,
    ),
    "app/core/identity.py": _lines(_AUDIT, 114, 133),
    "app/core/llm.py": {
        105: _MONTH_KEY,
        193: _AUDIT,
        303: _MONTH_KEY,
    },
    "app/core/session_revocation.py": _lines(
        "session-tombstone expiry arithmetic (seconds-scale), not day-scale copy", 90,
    ),
    "app/core/subscription.py": {
        271: "subscription-expired check: raw instant vs a stored instant, correct as-is",
        505: _MONTH_KEY, 569: _MONTH_KEY, 630: _MONTH_KEY, 759: _MONTH_KEY,
        789: _AUDIT,
    },
    "app/core/timeutil.py": _lines(
        "this IS the canonical Europe/London helper module -- its own implementation "
        "and docstrings are exempt by construction",
        5, 16, 33, 35, 42,
    ),
    "app/main.py": _lines(
        "distributed-lock acquisition, orphaned-connection cleanup and manual-account "
        "seed-data timestamps; startup/admin internals, not user-facing",
        534, 682, 730, 756, 837,
    ),
    "app/routers/accounts.py": {
        210: _AUDIT, 253: _AUDIT, 322: _AUDIT,
        237: _LOOKBACK,
    },
    "app/routers/admin_allowlist.py": _lines(
        _AUDIT + "; admin-only invite tooling, not primary user-facing", 94, 127,
    ),
    "app/routers/admin_usage.py": _lines(_MONTH_KEY + "; admin-only usage view", 81),
    "app/routers/allocations.py": {456: _LOOKBACK, 519: _AUDIT},
    "app/routers/analytics.py": _lines(
        "already swept by G161 (36 call sites in this file alone moved onto timeutil in "
        "that pass, per its own commit message); everything remaining here is a 90-day "
        "lookback cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data "
        "statistical window, or a created_at/dismissed_at/_override_rebuild-style audit "
        "timestamp -- none of it is rendered to the user as a calendar day or day-count",
        192, 200, 276, 319, 386, 2132, 2527, 2533, 2534, 2720, 2777, 2780, 2848, 2901,
        2974, 2975, 3117, 3130, 3175, 3188, 3307, 3319, 3335, 3425, 3996, 4031, 4038, 5369,
    ),
    "app/routers/auth.py": _lines(_AUDIT, 311),
    "app/routers/baskets.py": _lines(_AUDIT, 182),
    "app/routers/behaviour.py": _lines(
        "7-day raw-instant cache-freshness gate (recompute-or-serve-cached), not "
        "rendered day-count copy", 35,
    ),
    "app/routers/can_i.py": _lines(
        "Penny propose/consent plumbing: a one-time consent timestamp, a 15-minute "
        "proposal-expiry check, and executed_at/cancelled_at audit timestamps -- all "
        "minute-scale or audit, not calendar-day copy",
        1313, 1368, 1399, 1447,
    ),
    "app/routers/card_terms.py": _lines(
        "14-day card-terms re-ask eligibility TTL (is_ask_eligible) + a confirmed_at "
        "audit timestamp; the genuinely user-facing BT-offer/promo end-date comparisons "
        "in this file already go through timeutil.user_today()",
        112, 307,
    ),
    "app/routers/categories.py": _lines(_AUDIT, 301),
    "app/routers/challenges.py": _lines(
        "the weekly/daily spending Challenges feature has no live frontend consumer -- "
        "ChallengesPanel.tsx is defined but not imported by any page or component "
        "anywhere (see this file's own 2026-08-30 comment) -- so period_start/"
        "period_end/hours_left/days_left computed here are not currently rendered to "
        "any user. _day_bounds()/_week_bounds() ARE a genuine instance of the same "
        "day-boundary bug class this sweep fixes (see G166's report); left allowlisted "
        "rather than fixed because there is nothing live to fix it FOR right now -- "
        "revisit if this feature is ever wired back up to a page",
        33, 40, 53, 140, 155, 170, 195,
    ),
    "app/routers/commitments.py": {463: _LOOKBACK, 1106: _AUDIT},
    "app/routers/finexer.py": _lines(_AUDIT, 89, 130, 153),
    "app/routers/goals.py": _lines(_LOOKBACK, 52),
    "app/routers/grow.py": _lines(_LOOKBACK, 255),
    "app/routers/income.py": _lines(
        _LOOKBACK + "; confirmed_at audit timestamps. The genuinely displayed date "
        "arithmetic in this file already uses timeutil.user_today()",
        29, 45, 204, 266, 326,
    ),
    "app/routers/investments.py": _lines(
        "updated_at/created_at/last_refreshed persisted timestamps, returned as a full "
        "ISO instant string for the frontend to format -- not a day-count computed here",
        61, 187, 291, 397, 420,
    ),
    "app/routers/manual_accounts.py": _lines(
        _AUDIT + " for manual-account CRUD (including applies_from, a backfill-pin marker)",
        77, 100, 220, 226, 246, 262, 383, 384, 413,
    ),
    "app/routers/mcp.py": _lines(
        "MCP per-day rate-limit bucket keys + OAuth-token expiry checks; internal "
        "metering/token plumbing for the read-only agent connector, not rendered UI copy",
        204, 232, 337, 447, 790,
    ),
    "app/routers/oauth.py": _lines(
        "OAuth authorization-code/token issuance, expiry and revocation timestamps",
        189, 290, 312, 360, 432, 546, 564, 603,
    ),
    "app/routers/planned.py": _lines(_AUDIT, 82),
    "app/routers/push.py": _lines(_AUDIT + " for push-subscription records", 59, 83, 85, 105, 107),
    "app/routers/savings.py": _lines(_LOOKBACK + "; " + _AUDIT, 77, 132, 180, 200),
    "app/routers/savings_insights.py": {
        # 90-day transaction lookback windows for category/evidence detection.
        1296: _LOOKBACK, 1327: _LOOKBACK, 3213: _LOOKBACK,
        # Month/year label embedded in an LLM research-query prompt ("Today is
        # September 2026") -- never returned to the frontend. Month/year grain, and
        # the one boundary that matters (Dec 31 -> Jan 1) always falls in GMT, so it
        # can't diverge from London here.
        1457: "month-year label for an LLM research-query prompt, not rendered to the "
              "user; the Dec 31/Jan 1 boundary always falls in GMT so it can't diverge "
              "from London",
        # researched_at/refreshed_at/content_valid_until WRITE sites: persisted UTC
        # anchors. Every display read-site (_derive_insight_state, _serialize_insight,
        # _expiry_line, all above) already converts these back through
        # timeutil.to_user_date() -- the write must stay a plain UTC instant to match.
        1860: "researched_at/refreshed_at/content_valid_until write site -- a persisted "
              "UTC anchor; every display read-site already converts it back through "
              "timeutil.to_user_date()",
        2108: "researched_at/refreshed_at/content_valid_until write site -- a persisted "
              "UTC anchor; every display read-site already converts it back through "
              "timeutil.to_user_date()",
        2001: _AUDIT,  # retired_at
        # Background regen-cadence gate (_regen_reason) and its spend_changed 7-day
        # minimum-age floor: decide whether a research pass fires, never rendered.
        2041: _TTL, 2060: _TTL,
        # Deliberate raw-instant 30-day cooldown gate, reviewed and commented in place
        # during G161 (see the comment directly above this line in the source).
        2666: "deliberate raw-instant 30-day spotlight cooldown gate (see this file's "
              "own G161-review comment immediately above), not a rendered day-count",
        2698: _LOOKBACK, 2781: _LOOKBACK,
        2846: _LOOKBACK + "; also the verified_at/substituted_at audit-timestamp write site",
        2936: "spotlight snooze-until eligibility check (boolean), not rendered day-count text",
        3058: _AUDIT, 3094: _AUDIT, 3135: _AUDIT, 3160: _AUDIT, 3266: _AUDIT,
        3198: "30-day pin-expiry persisted timestamp, never rendered to the user",
    },
    "app/routers/scenario.py": _lines(_LOOKBACK, 192),
    "app/routers/statements.py": _lines(
        _AUDIT + " on a manual bank-statement connection record", 178,
    ),
    "app/routers/subscription.py": {
        34: _MONTH_KEY,
        149: _AUDIT, 195: _AUDIT, 197: _AUDIT, 233: _MONTH_KEY,
        # NOTE: `trial_charge_on` (the one genuinely user-facing date this router
        # returned) was moved onto timeutil.user_today() in this pass -- see the fix
        # a few lines above GET /subscription's return dict.
    },
    "app/routers/tax.py": _lines(_LOOKBACK, 25),
    "app/routers/transactions.py": _lines(
        "user-supplied `days` query-window filters + created_at audit timestamps on "
        "manual pot/dismissal records, not calendar-day copy",
        138, 179, 207, 286, 560, 592, 711,
    ),
    "app/routers/transport.py": _lines(_LOOKBACK, 20),
    "app/routers/truelayer.py": _lines(
        _AUDIT + "; line 129 is a debug echo timestamp on a test-only callback route",
        46, 129,
    ),
    "app/routers/webhooks.py": _lines(
        "webhook signature/event-freshness checks (5-minute replay tolerance) + a "
        "revoked_at audit timestamp; security-critical raw-instant comparisons, "
        "deliberately not calendar-day arithmetic",
        74, 224, 283, 314,
    ),
    "app/routers/yapily.py": _lines(_LOOKBACK + "; " + _AUDIT, 51, 82),
    "app/services/affordability.py": _lines(_LOOKBACK, 270),
    "app/services/behaviour.py": {133: "180-day behaviour-analysis lookback window", 499: _AUDIT},
    "app/services/billing.py": _lines(
        "Stripe billing internals: token/trial/webhook-processed audit timestamps, all "
        "persisted, none rendered as calendar-day copy",
        152, 268, 542, 584, 598, 626, 644,
    ),
    "app/services/broadcast.py": _lines(_AUDIT + " for broadcast/notification records", 278, 345, 415),
    "app/services/card_rates.py": _lines(
        "14-day card-rate re-ask TTL + computed-at timestamps, mirrors "
        "routers/card_terms.py's is_ask_eligible gate", 61, 284, 339,
    ),
    "app/services/cashflow.py": _lines(_TTL + "; computed_at audit timestamp", 56, 121, 129),
    "app/services/categorisation.py": _lines(_AUDIT + " on a category-learning doc", 793),
    "app/services/checkpoints.py": _lines(
        _AUDIT + " for the debt/goal checkpoint cadence", 54, 201, 283,
    ),
    "app/services/companion.py": _lines(
        "already swept by G161 for the Penny brief's rendered dates/day-counts (see "
        "e.g. `today = timeutil.user_today()` in this file); everything remaining here "
        "is a 90/100-day evidence lookback, a created_at/_reactivated_at audit "
        "timestamp, or a raw-instant lapse/re-ask TTL gate (24h celebration window, "
        "7-day insight-win window, 14-day card-terms re-ask window) deciding card "
        "eligibility -- not rendered day-count text",
        455, 2278, 3443, 3901, 3997, 4188, 4340, 4517, 4846,
    ),
    "app/services/cycle_story.py": _lines(
        "1h/24h cache-freshness TTLs + computed_at audit timestamps; this file's own "
        "rendered 'today' narrative already uses timeutil.user_today()",
        707, 722, 776, 809, 823,
    ),
    "app/services/cycle_story_personas.py": _lines(_AUDIT, 164),
    "app/services/data_version.py": _lines(_AUDIT + " on a per-user cache-version bump", 80),
    "app/services/debt_plan.py": _lines(
        _AUDIT + "; this file's own rendered 'today' already uses timeutil.user_today()", 1471,
    ),
    "app/services/finexer_sync.py": _lines(
        _SYNC_INTERNAL + " (token/consent freshness TTLs, customer created_at, "
        "status_changed_at, last_synced)",
        115, 196, 247, 314, 320, 482, 511, 632, 707,
    ),
    "app/services/income.py": _lines(_LOOKBACK, 314),
    "app/services/investment_prices.py": _lines(_AUDIT + " on a price refresh", 75, 87),
    "app/services/manual_account_rules.py": _lines(
        _AUDIT + " for manual account-adjustment rules", 131, 138, 153,
    ),
    "app/services/memory.py": _lines(_AUDIT + " on Penny's memory-facts doc", 51),
    "app/services/money_shape.py": _lines(
        _AUDIT + " + an hour-scale cache-freshness TTL", 703, 720,
    ),
    "app/services/needle.py": _lines(
        "computed_at audit/debug metadata field; period_start/period_end are supplied "
        "by the caller, not computed in this file", 412,
    ),
    "app/services/notifications.py": _lines(_LOOKBACK + "; " + _AUDIT, 138, 701),
    "app/services/pace.py": _lines(
        "cache-freshness TTL checks + computed_at audit timestamps for spend-baseline/"
        "shape caches", 308, 330, 1223, 1242,
    ),
    "app/services/pending_transactions.py": _lines(
        "fallback `date` value used only when a bank doesn't supply one on a pending "
        "transaction row; not calendar-day copy", 83,
    ),
    "app/services/penny_agent.py": _lines(
        "seconds-until-expiry countdown for a Penny proposal, minute-scale, not "
        "day-count copy", 224,
    ),
    "app/services/penny_tools.py": _lines(
        _LOOKBACK + " + computed_at audit timestamps + a 7-day raw-instant "
        "cache-freshness gate (same TTL class as routers/behaviour.py)",
        2003, 2604, 3229, 3970, 4025,
    ),
    "app/services/planned.py": _lines(_AUDIT, 132, 144),
    "app/services/recurring_judge.py": _lines(
        "judged_at audit timestamp on the recurring-series LLM veto decision", 245,
    ),
    "app/services/response_cache.py": _lines(
        "generic response-cache TTL check + computed_at audit timestamp; shared cache "
        "infra, not day-count copy", 177, 224,
    ),
    "app/services/retention.py": _lines(
        "connection-grace/dormant-account sweep windows run by a background worker, "
        "not user-facing", 315, 369, 405, 422,
    ),
    "app/services/safe_to_spend_history.py": _lines(
        _AUDIT + "; this file's own rendered 'today' already uses timeutil.user_today()", 93,
    ),
    "app/services/scenario.py": _lines(_LOOKBACK, 767),
    "app/services/sync_freshness.py": _lines(
        "prose inside this module's own docstring, describing OTHER files' storage "
        "convention -- not an executable date call", 5, 6, 9,
    ),
    "app/services/truelayer_sync.py": _lines(
        _SYNC_INTERNAL + " (token expiry/refresh, connection created_at/updated_at, "
        "sync-window query params sent to the bank API, last_synced write)",
        40, 41, 52, 80, 155, 171, 240, 241, 286, 352, 405, 424,
    ),
    "app/services/yapily_sync.py": _lines(
        _AUDIT + " on a Yapily institution connection", 119,
    ),
    "app/workers/sync_worker.py": {
        67: "weekly job-dedup key (ISO week number) for a scheduled reconcile job, not "
            "user-facing",
        229: _AUDIT + " on a worker-run summary",
        465: "task_consent_watch's raw-instant is_expiring/throttle GATE -- deliberately "
             "left as a raw instant per this function's own docstring; the rendered "
             "reconnect/expiry COPY those gates feed (_reconnect_body/_expiring_copy, "
             "a little further down this file) already converts through "
             "timeutil.to_user_date(), per their own G161-follow-up comments",
        663: "same deliberate raw-instant gate as line 465, for the Finexer branch of "
             "task_consent_watch",
    },
}


def _relpath(p: pathlib.Path) -> str:
    return str(p.relative_to(BACKEND_ROOT)).replace("\\", "/")


def main() -> int:
    failures: list[str] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        rel = _relpath(path)
        allowed_here = ALLOWLIST.get(rel, {})
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            if not NAIVE_CALL_RE.search(line):
                continue
            if INLINE_PRAGMA_RE.search(line):
                continue
            if lineno in allowed_here:
                continue
            failures.append(f"{rel}:{lineno}: {line.strip()}")

    if failures:
        print(
            "check_naive_dates: found naive date.today()/datetime.now()/"
            "datetime.utcnow() call(s) not in the allowlist:\n",
            file=sys.stderr,
        )
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        print(
            "\nIf this is genuinely user-facing day-scale copy (anything the user "
            "sees as a date, a day-count, or a due/overdue/New-badge flag), fix it to "
            "use app.core.timeutil's user_today()/user_now()/to_user_date() instead. "
            "If it's a legitimate non-calendar use (a persisted audit timestamp, a "
            "lookback window, an hour-scale cache TTL, background-worker internals), "
            "add a `# naive-ok: <reason>` comment on the line, or a reasoned entry to "
            "ALLOWLIST in scripts/check_naive_dates.py.",
            file=sys.stderr,
        )
        return 1

    print("check_naive_dates: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
