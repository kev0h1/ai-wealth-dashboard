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
two spots that sweep missed (`savings_insights.py`, found by G161's own
review; `routers/challenges.py`'s daily/weekly reset boundary and
`routers/subscription.py`'s `trial_charge_on`, found by G166's own review)
and adds this script as the guard that stops the pattern reappearing.

What this script does: greps backend/app for `date.today(`, `datetime.now(`
and `datetime.utcnow(` and fails, listing file:line, for every hit that
isn't explicitly allowed. A hit is allowed two ways:

  1. A `# naive-ok: <reason>` comment on the same source line (grep for it
     yourself before reaching for the central list below -- it's the
     lighter-weight option for a genuine one-off, and keeps the reason next
     to the code it's about).
  2. An entry in the ALLOWLIST dict below, keyed by (relative file path,
     exact STRIPPED SOURCE-LINE TEXT) -- not by line number.

DESIGN CHOICE, spelled out because it's the one a future maintainer is most
likely to want to change, and because this script's own first draft got it
wrong: the central allowlist is keyed by (file, source-line text), not by
line number. A line-number-keyed allowlist was tried first and reviewed out
-- it breaks under any UNRELATED edit that shifts line numbers in an
allowlisted file (adding an import, a comment, a new function above an
allowlisted one), which turns `scripts/session.sh finish` red for a future
session that touched nothing this script actually cares about. This file's
own history is the proof: the very diff that first added this script also
had to renumber two unrelated entries in `test_no_raw_exception_leak.py`
(itself a line-keyed allowlist) purely because a docstring comment shifted
them by seven lines -- the exact failure mode being designed against here.

Keying on the exact stripped line TEXT survives that kind of drift for
free: the code that was audited and allowlisted is still recognised
wherever it ends up in the file. The trade-off it introduces instead: two
DIFFERENT call sites that happen to share identical source text (`now =
datetime.utcnow()` is the classic case -- this codebase has dozens) become
indistinguishable by text alone, so a bare per-file "this text is allowed"
entry would let a SECOND, newly-added copy of that exact line slip past
unnoticed right next to the original, allowed one. Each allowlist entry
therefore carries a `count`: the number of occurrences of that exact text
this file is allowed to contain. If the actual number of matching lines in
the file exceeds the allowed count, the excess is reported as a failure --
so duplicating an allowlisted line (accidentally, or by pasting a new,
different call next to an old one) is still caught, even though the two
occurrences read identically. A handful of entries where the SAME text
legitimately serves two different purposes at different call sites (found
while building this list -- e.g. `now = datetime.now(timezone.utc)` in
`app/core/subscription.py`, used as both a monthly-usage-key seed and a
persisted audit-timestamp write) simply carry a `count` covering every
occurrence and a reason that names both purposes; text-keying cannot tell
those apart, so the reason has to.
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


ALLOWLIST: dict[str, dict[str, dict]] = {
    "app/core/bot_credentials.py": {
        "if expires_at is not None and expires_at <= datetime.now(timezone.utc):": {
            "reason": (
                "bot API credential TTL/expiry + a per-day telemetry bucket key for bot-call logging; "
                "internal bot-auth plumbing, not user-facing"
            ),
        },
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "bot API credential TTL/expiry + a per-day telemetry bucket key for bot-call logging; "
                "internal bot-auth plumbing, not user-facing"
            ),
            "count": 2,
        },
        "return datetime.now(timezone.utc) + timedelta(days=days)": {
            "reason": (
                "bot API credential TTL/expiry + a per-day telemetry bucket key for bot-call logging; "
                "internal bot-auth plumbing, not user-facing"
            ),
        },
    },
    "app/core/identity.py": {
        "\"linked_at\": datetime.now(timezone.utc),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
            "count": 2,
        },
    },
    "app/core/llm.py": {
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "ym = datetime.now(timezone.utc).strftime(\"%Y-%m\")": {
            "reason": (
                "month-grain billing/usage metering key (Y-M); the Dec 31 -> Jan 1 rollover this could "
                "ever disagree on always falls in GMT (BST always ends before it), so UTC and "
                "Europe/London never actually diverge here"
            ),
        },
        "ym = year_month or datetime.now(timezone.utc).strftime(\"%Y-%m\")": {
            "reason": (
                "month-grain billing/usage metering key (Y-M); the Dec 31 -> Jan 1 rollover this could "
                "ever disagree on always falls in GMT (BST always ends before it), so UTC and "
                "Europe/London never actually diverge here"
            ),
        },
    },
    "app/core/session_revocation.py": {
        "now = as_utc(now) if now is not None else datetime.now(timezone.utc)": {
            "reason": (
                "session-tombstone expiry arithmetic (seconds-scale), not day-scale copy"
            ),
        },
    },
    "app/core/subscription.py": {
        "if expires_at and expires_at < datetime.now(timezone.utc):": {
            "reason": (
                "subscription-expired check: raw instant vs a stored instant, correct as-is"
            ),
        },
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "either a monthly usage-key seed (`ym = now.strftime(...)`) or a persisted "
                "created_at/updated_at/started_at-style audit timestamp, depending on the call site; "
                "every occurrence in this file is one or the other, see routers/subscription.py's "
                "identical pattern for the equivalent split"
            ),
            "count": 5,
        },
    },
    "app/core/timeutil.py": {
        "Timestamps persisted to Mongo stay `datetime.now(timezone.utc)`.": {
            "reason": (
                "this IS the canonical Europe/London helper module -- its own implementation and "
                "docstrings are exempt by construction"
            ),
            "count": 2,
        },
        "application code compares them against `datetime.now(timezone.utc)`, which": {
            "reason": (
                "this IS the canonical Europe/London helper module -- its own implementation and "
                "docstrings are exempt by construction"
            ),
        },
        "return datetime.now(LONDON)": {
            "reason": (
                "this IS the canonical Europe/London helper module -- its own implementation and "
                "docstrings are exempt by construction"
            ),
        },
        "safely compared against datetime.now(timezone.utc). Returns None for": {
            "reason": (
                "this IS the canonical Europe/London helper module -- its own implementation and "
                "docstrings are exempt by construction"
            ),
        },
    },
    "app/main.py": {
        "\"started_at\": datetime.now(timezone.utc),": {
            "reason": (
                "distributed-lock acquisition, orphaned-connection cleanup and manual-account seed-data "
                "timestamps; startup/admin internals, not user-facing"
            ),
        },
        "cutoff = datetime.utcnow() - timedelta(hours=2)": {
            "reason": (
                "distributed-lock acquisition, orphaned-connection cleanup and manual-account seed-data "
                "timestamps; startup/admin internals, not user-facing"
            ),
        },
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "distributed-lock acquisition, orphaned-connection cleanup and manual-account seed-data "
                "timestamps; startup/admin internals, not user-facing"
            ),
        },
        "now = datetime.utcnow()": {
            "reason": (
                "distributed-lock acquisition, orphaned-connection cleanup and manual-account seed-data "
                "timestamps; startup/admin internals, not user-facing"
            ),
        },
        "purchased_at = oid.generation_time if isinstance(oid, ObjectId) else datetime.now(timezone.utc)": {
            "reason": (
                "distributed-lock acquisition, orphaned-connection cleanup and manual-account seed-data "
                "timestamps; startup/admin internals, not user-facing"
            ),
        },
    },
    "app/routers/accounts.py": {
        "from_dt = (datetime.now() - timedelta(days=90)).strftime(\"%Y-%m-%d\")": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
        "{\"$set\": {\"user_id\": uid, \"account_id\": account_id, \"excluded_at\": datetime.now()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "{\"_id\": u}, {\"$set\": {\"synced_at\": datetime.now()}}, upsert=True,": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
            "count": 2,
        },
    },
    "app/routers/admin_allowlist.py": {
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count); admin-only invite tooling, not primary user-facing"
            ),
        },
        "{\"$set\": {\"status\": \"revoked\", \"revoked_at\": datetime.now(timezone.utc)}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count); admin-only invite tooling, not primary user-facing"
            ),
        },
    },
    "app/routers/admin_usage.py": {
        "ym = _validate_month(month) if month else datetime.now(timezone.utc).strftime(\"%Y-%m\")": {
            "reason": (
                "month-grain billing/usage metering key (Y-M); the Dec 31 -> Jan 1 rollover this could "
                "ever disagree on always falls in GMT (BST always ends before it), so UTC and "
                "Europe/London never actually diverge here; admin-only usage view"
            ),
        },
    },
    "app/routers/allocations.py": {
        "\"created_at\":         datetime.now(timezone.utc),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "cutoff = datetime.now() - timedelta(days=_FILL_CANDIDATES_WINDOW_DAYS)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/routers/analytics.py": {
        "\"created_at\": datetime.now(),": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
            "count": 3,
        },
        "(never calls datetime.now() itself) so callers — and tests — can pin": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "_ai_recurring_cache[user_id] = (datetime.now(), result)": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "_cf = await _mcf(uid, datetime.now() - timedelta(days=90))": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "_pending_cutoff = datetime.utcnow() - timedelta(days=PENDING_TXN_MAX_AGE_DAYS)": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "both storage sites below use datetime.now()/judged_at) or, defensively,": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "cutoff    = datetime.now() - timedelta(days=90)": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "cutoff = datetime.now() - _td(days=90)": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "cutoff = datetime.now() - timedelta(days=_ENRICH_LOOKBACK_DAYS)": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "data[\"computed_at\"] = datetime.now()": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
            "count": 2,
        },
        "data[\"monthly_cf\"] = {\"data\": _cf, \"computed_at\": datetime.now()}": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "days = max((datetime.now() - earliest).days, 1)": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "entry = dict(meta.get(key) or {\"dismissed_at\": datetime.now()})": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "if cached and (datetime.now() - cached[0]).seconds < 86400:": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "if computed_at and (datetime.now() - computed_at).total_seconds() > _CACHE_TTL_HOURS * 3600:": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "meta, _ = _stamp_missing_meta(dismissed, dict(prefs.get(\"dismissed_recurring_meta\") or {}), datetime.now())": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "meta[key] = {\"dismissed_at\": datetime.now(), \"hidden\": False}": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
        "now = datetime.now()": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
            "count": 2,
        },
        "{\"$set\": {\"_override_rebuild\": datetime.now()}},": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
            "count": 4,
        },
        "{\"$setOnInsert\": {\"user_id\": uid, \"key_a\": ka, \"key_b\": kb, \"created_at\": datetime.utcnow()}},": {
            "reason": (
                "already swept by G161 (36 call sites in this file alone moved onto timeutil in that "
                "pass, per its own commit message); everything remaining here is a 90-day lookback "
                "cutoff, an in-memory cache TTL (seconds/hours-scale), a months-of-data statistical "
                "window, or a created_at/dismissed_at/_override_rebuild-style audit timestamp -- none of "
                "it is rendered to the user as a calendar day or day-count"
            ),
        },
    },
    "app/routers/auth.py": {
        "\"linked_at\": datetime.now(timezone.utc),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
    },
    "app/routers/baskets.py": {
        "\"created_at\": datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
    },
    "app/routers/behaviour.py": {
        "if datetime.now(timezone.utc) - ca < timedelta(days=7):": {
            "reason": (
                "7-day raw-instant cache-freshness gate (recompute-or-serve-cached), not rendered "
                "day-count copy"
            ),
        },
    },
    "app/routers/can_i.py": {
        "if expires_at and datetime.now() > expires_at:": {
            "reason": (
                "Penny propose/consent plumbing: a one-time consent timestamp, a 15-minute "
                "proposal-expiry check, and executed_at/cancelled_at audit timestamps -- all minute-scale "
                "or audit, not calendar-day copy"
            ),
        },
        "now = datetime.now()": {
            "reason": (
                "Penny propose/consent plumbing: a one-time consent timestamp, a 15-minute "
                "proposal-expiry check, and executed_at/cancelled_at audit timestamps -- all minute-scale "
                "or audit, not calendar-day copy"
            ),
        },
        "now = datetime.now().isoformat()": {
            "reason": (
                "Penny propose/consent plumbing: a one-time consent timestamp, a 15-minute "
                "proposal-expiry check, and executed_at/cancelled_at audit timestamps -- all minute-scale "
                "or audit, not calendar-day copy"
            ),
        },
        "{\"_id\": proposal_id}, {\"$set\": {\"cancelled_at\": datetime.now()}},": {
            "reason": (
                "Penny propose/consent plumbing: a one-time consent timestamp, a 15-minute "
                "proposal-expiry check, and executed_at/cancelled_at audit timestamps -- all minute-scale "
                "or audit, not calendar-day copy"
            ),
        },
    },
    "app/routers/card_terms.py": {
        "now = datetime.utcnow()": {
            "reason": (
                "14-day card-terms re-ask eligibility TTL (is_ask_eligible) + a confirmed_at audit "
                "timestamp; the genuinely user-facing BT-offer/promo end-date comparisons in this file "
                "already go through timeutil.user_today()"
            ),
            "count": 2,
        },
    },
    "app/routers/categories.py": {
        "\"created_at\": datetime.utcnow(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
    },
    "app/routers/challenges.py": {
        "compared against `datetime.utcnow()` elsewhere in this module) already": {
            "reason": (
                "prose inside _london_midnight_as_naive_utc's own docstring, describing this "
                "file's naive-UTC convention -- not an executable call"
            ),
        },
        "midnight (`datetime.utcnow().replace(hour=0, ...)`), which is up to an": {
            "reason": (
                "prose inside _london_midnight_as_naive_utc's own docstring, describing the OLD "
                "(now-fixed) behaviour it replaced -- not an executable call"
            ),
        },
        "now   = datetime.utcnow()": {
            "reason": (
                "_resolve_stale_challenges' raw-instant staleness check against period_end, which "
                "is itself now a correct London-midnight-derived naive-UTC instant (see "
                "_london_midnight_as_naive_utc/_day_bounds/_week_bounds above) -- comparing two "
                "naive-UTC instants here is correct as-is"
            ),
        },
        "now = datetime.utcnow()": {
            "reason": (
                "_compute_progress's hours_left/days_left countdown against period_end, which is "
                "itself now a correct London-midnight-derived naive-UTC instant -- comparing two "
                "naive-UTC instants here is correct as-is"
            ),
        },
        "\"status\": \"active\", \"actual\": None, \"created_at\": datetime.utcnow(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to "
                "the user as a day or day-count)"
            ),
            "count": 3,
        },
    },
    "app/routers/commitments.py": {
        "\"created_at\":   datetime.now(timezone.utc),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/routers/finexer.py": {
        "\"created_at\":  datetime.utcnow(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "{\"$set\": {\"status\": \"authorized\", \"authed_at\": datetime.utcnow()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "{\"$set\": {\"status\": \"canceled\", \"canceled_at\": datetime.utcnow(), \"error\": error}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
    },
    "app/routers/goals.py": {
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/routers/grow.py": {
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/routers/income.py": {
        "\"confirmed_at\": datetime.now().isoformat(),": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; confirmed_at audit timestamps. The genuinely displayed date arithmetic in this "
                "file already uses timeutil.user_today()"
            ),
            "count": 3,
        },
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; confirmed_at audit timestamps. The genuinely displayed date arithmetic in this "
                "file already uses timeutil.user_today()"
            ),
            "count": 2,
        },
    },
    "app/routers/investments.py": {
        "\"created_at\":     datetime.now(),": {
            "reason": (
                "updated_at/created_at/last_refreshed persisted timestamps, returned as a full ISO "
                "instant string for the frontend to format -- not a day-count computed here"
            ),
            "count": 2,
        },
        "\"provisional\": False, \"updated_at\": datetime.now(),": {
            "reason": (
                "updated_at/created_at/last_refreshed persisted timestamps, returned as a full ISO "
                "instant string for the frontend to format -- not a day-count computed here"
            ),
        },
        "\"updated_at\":        acc.get(\"updated_at\", datetime.now()).isoformat(),": {
            "reason": (
                "updated_at/created_at/last_refreshed persisted timestamps, returned as a full ISO "
                "instant string for the frontend to format -- not a day-count computed here"
            ),
        },
        "\"updated_at\":        datetime.now(),": {
            "reason": (
                "updated_at/created_at/last_refreshed persisted timestamps, returned as a full ISO "
                "instant string for the frontend to format -- not a day-count computed here"
            ),
        },
    },
    "app/routers/manual_accounts.py": {
        "\"$set\": {\"updated_at\": datetime.now()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual-account CRUD (including applies_from, a backfill-pin "
                "marker)"
            ),
            "count": 2,
        },
        "\"applies_from\": None if backfill else datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual-account CRUD (including applies_from, a backfill-pin "
                "marker)"
            ),
        },
        "\"created_at\": datetime.now(), \"updated_at\": datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual-account CRUD (including applies_from, a backfill-pin "
                "marker)"
            ),
        },
        "\"created_at\": datetime.now(), **fields,": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual-account CRUD (including applies_from, a backfill-pin "
                "marker)"
            ),
            "count": 2,
        },
        "updates[\"applies_from\"] = None if body[\"backfill\"] else (rule.get(\"applies_from\") or datetime.now())": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual-account CRUD (including applies_from, a backfill-pin "
                "marker)"
            ),
        },
        "updates[\"updated_at\"] = datetime.now()": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual-account CRUD (including applies_from, a backfill-pin "
                "marker)"
            ),
        },
        "{\"$inc\": {\"balance\": round(-delta, 2)}, \"$set\": {\"updated_at\": datetime.now()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual-account CRUD (including applies_from, a backfill-pin "
                "marker)"
            ),
        },
    },
    "app/routers/mcp.py": {
        "day_key = f\"mcp:day:{key}:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}\"": {
            "reason": (
                "MCP per-day rate-limit bucket keys + OAuth-token expiry checks; internal metering/token "
                "plumbing for the read-only agent connector, not rendered UI copy"
            ),
        },
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "MCP per-day rate-limit bucket keys + OAuth-token expiry checks; internal metering/token "
                "plumbing for the read-only agent connector, not rendered UI copy"
            ),
            "count": 3,
        },
        "ym: str | None = datetime.now(timezone.utc).strftime(\"%Y-%m\")": {
            "reason": (
                "MCP per-day rate-limit bucket keys + OAuth-token expiry checks; internal metering/token "
                "plumbing for the read-only agent connector, not rendered UI copy"
            ),
        },
    },
    "app/routers/oauth.py": {
        "\"created_at\": datetime.now(timezone.utc),": {
            "reason": (
                "OAuth authorization-code/token issuance, expiry and revocation timestamps"
            ),
        },
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "OAuth authorization-code/token issuance, expiry and revocation timestamps"
            ),
            "count": 7,
        },
    },
    "app/routers/planned.py": {
        "\"created_at\":     datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
    },
    "app/routers/push.py": {
        "\"$setOnInsert\": {\"created_at\": datetime.now()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for push-subscription records"
            ),
            "count": 2,
        },
        "\"updated_at\": datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for push-subscription records"
            ),
            "count": 3,
        },
    },
    "app/routers/savings.py": {
        "\"created_at\": datetime.now(),": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; persisted audit timestamp (created_at/updated_at-style write, not rendered to the "
                "user as a day or day-count)"
            ),
        },
        "\"created_at\": datetime.now(), \"updated_at\": datetime.now(),": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; persisted audit timestamp (created_at/updated_at-style write, not rendered to the "
                "user as a day or day-count)"
            ),
        },
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; persisted audit timestamp (created_at/updated_at-style write, not rendered to the "
                "user as a day or day-count)"
            ),
        },
        "updates[\"updated_at\"] = datetime.now()": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; persisted audit timestamp (created_at/updated_at-style write, not rendered to the "
                "user as a day or day-count)"
            ),
        },
    },
    "app/routers/savings_insights.py": {
        "\"spotlight_dismissed_at\": datetime.utcnow(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
            "count": 2,
        },
        "age_days = (datetime.utcnow() - existing[\"refreshed_at\"]).days": {
            "reason": (
                "raw-instant cache/regen/re-ask TTL gate (decides whether to recompute or re-offer "
                "something), not rendered day-count copy"
            ),
        },
        "cutoff    = datetime.utcnow() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
        "cutoff = datetime.utcnow() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
            "count": 3,
        },
        "if dismissed is None or dismissed < datetime.utcnow() - timedelta(days=30):": {
            "reason": (
                "deliberate raw-instant 30-day spotlight cooldown gate (see this file's own G161-review "
                "comment immediately above), not a rendered day-count"
            ),
        },
        "now            = datetime.utcnow()": {
            "reason": (
                "researched_at/refreshed_at/content_valid_until write site -- a persisted UTC anchor; "
                "every display read-site already converts it back through timeutil.to_user_date()"
            ),
            "count": 2,
        },
        "now          = datetime.utcnow()": {
            "reason": (
                "month-year label for an LLM research-query prompt, not rendered to the user; the Dec "
                "31/Jan 1 boundary always falls in GMT so it can't diverge from London"
            ),
        },
        "now    = datetime.utcnow()": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
        "now = datetime.utcnow()": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; also the verified_at/substituted_at audit-timestamp write site"
            ),
        },
        "reason = _regen_reason(existing, triggered_by, datetime.utcnow())": {
            "reason": (
                "raw-instant cache/regen/re-ask TTL gate (decides whether to recompute or re-offer "
                "something), not rendered day-count copy"
            ),
        },
        "retire_update[\"retired_at\"] = datetime.utcnow()": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "return bool(until and until > datetime.utcnow())": {
            "reason": (
                "spotlight snooze-until eligibility check (boolean), not rendered day-count text"
            ),
        },
        "update[\"expires_at\"] = None if new_pinned else datetime.utcnow() + timedelta(days=30)": {
            "reason": (
                "30-day pin-expiry persisted timestamp, never rendered to the user"
            ),
        },
        "{\"$set\": {\"card_opened_at\": datetime.utcnow()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "{\"$set\": {\"user_id\": uid, \"merchant_key\": merchant_key, \"category\": category, \"updated_at\": datetime.utcnow()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "{\"$set\": {\"viewed_at\": datetime.utcnow()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
    },
    "app/routers/scenario.py": {
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/routers/statements.py": {
        "\"region\": \"UK\", \"status\": \"connected\", \"updated_at\": datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) on a manual bank-statement connection record"
            ),
        },
    },
    "app/routers/subscription.py": {
        "\"$setOnInsert\": {\"started_at\": datetime.now(timezone.utc)},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "\"updated_at\": datetime.now(timezone.utc),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "either a monthly usage-key seed (`ym = now.strftime(...)`) or a persisted "
                "started_at/updated_at-style audit timestamp, depending on the call site"
            ),
            "count": 2,
        },
        "ym = datetime.now(timezone.utc).strftime(\"%Y-%m\")": {
            "reason": (
                "month-grain billing/usage metering key (Y-M); the Dec 31 -> Jan 1 rollover this could "
                "ever disagree on always falls in GMT (BST always ends before it), so UTC and "
                "Europe/London never actually diverge here"
            ),
        },
    },
    "app/routers/tax.py": {
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/routers/transactions.py": {
        "\"created_at\": datetime.now(), \"updated_at\": datetime.now(),": {
            "reason": (
                "user-supplied `days` query-window filters + created_at audit timestamps on manual "
                "pot/dismissal records, not calendar-day copy"
            ),
        },
        "\"created_at\": datetime.utcnow(),": {
            "reason": (
                "user-supplied `days` query-window filters + created_at audit timestamps on manual "
                "pot/dismissal records, not calendar-day copy"
            ),
        },
        "\"payload\": payload or {}, \"created_at\": datetime.utcnow(),": {
            "reason": (
                "user-supplied `days` query-window filters + created_at audit timestamps on manual "
                "pot/dismissal records, not calendar-day copy"
            ),
        },
        "base[\"date\"] = {\"$gte\": datetime.now() - timedelta(days=days)}": {
            "reason": (
                "user-supplied `days` query-window filters + created_at audit timestamps on manual "
                "pot/dismissal records, not calendar-day copy"
            ),
            "count": 2,
        },
        "cutoff = datetime.now() - timedelta(days=days)": {
            "reason": (
                "user-supplied `days` query-window filters + created_at audit timestamps on manual "
                "pot/dismissal records, not calendar-day copy"
            ),
        },
        "cutoff = datetime.now() - timedelta(days=min(days, 730))": {
            "reason": (
                "user-supplied `days` query-window filters + created_at audit timestamps on manual "
                "pot/dismissal records, not calendar-day copy"
            ),
        },
    },
    "app/routers/transport.py": {
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/routers/truelayer.py": {
        "return {\"message\": \"Callback routing works\", \"timestamp\": datetime.now()}": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count); line 129 is a debug echo timestamp on a test-only callback route"
            ),
        },
        "{\"$set\": {\"user_id\": user[\"email\"], \"pending\": True, \"created_at\": datetime.now()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count); line 129 is a debug echo timestamp on a test-only callback route"
            ),
        },
    },
    "app/routers/webhooks.py": {
        "if abs((datetime.now(timezone.utc) - event_time).total_seconds()) > 300:": {
            "reason": (
                "webhook signature/event-freshness checks (5-minute replay tolerance) + a revoked_at "
                "audit timestamp; security-critical raw-instant comparisons, deliberately not "
                "calendar-day arithmetic"
            ),
        },
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "webhook signature/event-freshness checks (5-minute replay tolerance) + a revoked_at "
                "audit timestamp; security-critical raw-instant comparisons, deliberately not "
                "calendar-day arithmetic"
            ),
            "count": 2,
        },
        "{\"$set\": {\"status\": \"revoked\", \"revoked_at\": datetime.utcnow()}},": {
            "reason": (
                "webhook signature/event-freshness checks (5-minute replay tolerance) + a revoked_at "
                "audit timestamp; security-critical raw-instant comparisons, deliberately not "
                "calendar-day arithmetic"
            ),
        },
    },
    "app/routers/yapily.py": {
        "\"created_at\": datetime.now(),": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; persisted audit timestamp (created_at/updated_at-style write, not rendered to the "
                "user as a day or day-count)"
            ),
        },
        "from_date = (datetime.now() - timedelta(days=90)).strftime(\"%Y-%m-%dT00:00:00Z\")": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; persisted audit timestamp (created_at/updated_at-style write, not rendered to the "
                "user as a day or day-count)"
            ),
        },
    },
    "app/services/affordability.py": {
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/services/behaviour.py": {
        "\"computed_at\": datetime.now(timezone.utc).isoformat(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "cutoff = datetime.now(timezone.utc) - timedelta(days=180)": {
            "reason": (
                "180-day behaviour-analysis lookback window"
            ),
        },
    },
    "app/services/billing.py": {
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "Stripe billing internals: token/trial/webhook-processed audit timestamps, all persisted, "
                "none rendered as calendar-day copy"
            ),
            "count": 4,
        },
        "{\"$set\": {\"processed_at\": datetime.now(timezone.utc), \"result\": result}},": {
            "reason": (
                "Stripe billing internals: token/trial/webhook-processed audit timestamps, all persisted, "
                "none rendered as calendar-day copy"
            ),
        },
        "{\"$set\": {\"status\": \"expired\", \"updated_at\": datetime.now(timezone.utc), \"source\": \"stripe\"}},": {
            "reason": (
                "Stripe billing internals: token/trial/webhook-processed audit timestamps, all persisted, "
                "none rendered as calendar-day copy"
            ),
        },
        "{\"$set\": {\"status\": \"past_due\", \"updated_at\": datetime.now(timezone.utc), \"source\": \"stripe\"}},": {
            "reason": (
                "Stripe billing internals: token/trial/webhook-processed audit timestamps, all persisted, "
                "none rendered as calendar-day copy"
            ),
        },
    },
    "app/services/broadcast.py": {
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for broadcast/notification records"
            ),
            "count": 2,
        },
        "{\"$set\": {\"read_at\": datetime.now(timezone.utc)}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for broadcast/notification records"
            ),
        },
    },
    "app/services/card_rates.py": {
        "now = datetime.utcnow()": {
            "reason": (
                "14-day card-rate re-ask TTL + computed-at timestamps, mirrors routers/card_terms.py's "
                "is_ask_eligible gate"
            ),
            "count": 2,
        },
        "return (now or datetime.utcnow()) - ts >= timedelta(days=RE_ASK_DAYS)": {
            "reason": (
                "14-day card-rate re-ask TTL + computed-at timestamps, mirrors routers/card_terms.py's "
                "is_ask_eligible gate"
            ),
        },
    },
    "app/services/cashflow.py": {
        "and (datetime.now() - at).total_seconds() < _MONTHLY_CF_TTL_SECONDS": {
            "reason": (
                "raw-instant cache/regen/re-ask TTL gate (decides whether to recompute or re-offer "
                "something), not rendered day-count copy; computed_at audit timestamp"
            ),
        },
        "now = datetime.now()": {
            "reason": (
                "raw-instant cache/regen/re-ask TTL gate (decides whether to recompute or re-offer "
                "something), not rendered day-count copy; computed_at audit timestamp"
            ),
        },
        "{\"$set\": {\"monthly_cf\": {\"data\": data, \"computed_at\": datetime.now()}}},": {
            "reason": (
                "raw-instant cache/regen/re-ask TTL gate (decides whether to recompute or re-offer "
                "something), not rendered day-count copy; computed_at audit timestamp"
            ),
        },
    },
    "app/services/categorisation.py": {
        "doc = {\"category\": category, \"source\": source, \"updated_at\": datetime.utcnow()}": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) on a category-learning doc"
            ),
        },
    },
    "app/services/checkpoints.py": {
        "\"created_at\":   datetime.now(timezone.utc),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for the debt/goal checkpoint cadence"
            ),
        },
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for the debt/goal checkpoint cadence"
            ),
        },
        "return datetime.now(timezone.utc).isoformat()": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for the debt/goal checkpoint cadence"
            ),
        },
    },
    "app/services/companion.py": {
        "\"_reactivated_at\": datetime.utcnow(),": {
            "reason": (
                "already swept by G161 for the Penny brief's rendered dates/day-counts (see e.g. `today = "
                "timeutil.user_today()` in this file); everything remaining here is a 90/100-day evidence "
                "lookback, a created_at/_reactivated_at audit timestamp, or a raw-instant lapse/re-ask "
                "TTL gate (24h celebration window, 7-day insight-win window, 14-day card-terms re-ask "
                "window) deciding card eligibility -- not rendered day-count text"
            ),
        },
        "\"created_at\": datetime.utcnow(),": {
            "reason": (
                "already swept by G161 for the Penny brief's rendered dates/day-counts (see e.g. `today = "
                "timeutil.user_today()` in this file); everything remaining here is a 90/100-day evidence "
                "lookback, a created_at/_reactivated_at audit timestamp, or a raw-instant lapse/re-ask "
                "TTL gate (24h celebration window, 7-day insight-win window, 14-day card-terms re-ask "
                "window) deciding card eligibility -- not rendered day-count text"
            ),
            "count": 4,
        },
        "_cel_now_utc = datetime.utcnow()": {
            "reason": (
                "already swept by G161 for the Penny brief's rendered dates/day-counts (see e.g. `today = "
                "timeutil.user_today()` in this file); everything remaining here is a 90/100-day evidence "
                "lookback, a created_at/_reactivated_at audit timestamp, or a raw-instant lapse/re-ask "
                "TTL gate (24h celebration window, 7-day insight-win window, 14-day card-terms re-ask "
                "window) deciding card eligibility -- not rendered day-count text"
            ),
        },
        "_ct_now = datetime.utcnow()": {
            "reason": (
                "already swept by G161 for the Penny brief's rendered dates/day-counts (see e.g. `today = "
                "timeutil.user_today()` in this file); everything remaining here is a 90/100-day evidence "
                "lookback, a created_at/_reactivated_at audit timestamp, or a raw-instant lapse/re-ask "
                "TTL gate (24h celebration window, 7-day insight-win window, 14-day card-terms re-ask "
                "window) deciding card eligibility -- not rendered day-count text"
            ),
        },
        "_win_now = datetime.utcnow()": {
            "reason": (
                "already swept by G161 for the Penny brief's rendered dates/day-counts (see e.g. `today = "
                "timeutil.user_today()` in this file); everything remaining here is a 90/100-day evidence "
                "lookback, a created_at/_reactivated_at audit timestamp, or a raw-instant lapse/re-ask "
                "TTL gate (24h celebration window, 7-day insight-win window, 14-day card-terms re-ask "
                "window) deciding card eligibility -- not rendered day-count text"
            ),
        },
        "cutoff = datetime.utcnow() - timedelta(days=100)": {
            "reason": (
                "already swept by G161 for the Penny brief's rendered dates/day-counts (see e.g. `today = "
                "timeutil.user_today()` in this file); everything remaining here is a 90/100-day evidence "
                "lookback, a created_at/_reactivated_at audit timestamp, or a raw-instant lapse/re-ask "
                "TTL gate (24h celebration window, 7-day insight-win window, 14-day card-terms re-ask "
                "window) deciding card eligibility -- not rendered day-count text"
            ),
        },
    },
    "app/services/cycle_story.py": {
        "\"computed_at\": datetime.now(timezone.utc).isoformat(),": {
            "reason": (
                "1h/24h cache-freshness TTLs + computed_at audit timestamps; this file's own rendered "
                "'today' narrative already uses timeutil.user_today()"
            ),
        },
        "age = datetime.now(timezone.utc) - computed_at": {
            "reason": (
                "1h/24h cache-freshness TTLs + computed_at audit timestamps; this file's own rendered "
                "'today' narrative already uses timeutil.user_today()"
            ),
            "count": 2,
        },
        "now_iso = datetime.now(timezone.utc).isoformat()": {
            "reason": (
                "1h/24h cache-freshness TTLs + computed_at audit timestamps; this file's own rendered "
                "'today' narrative already uses timeutil.user_today()"
            ),
            "count": 2,
        },
    },
    "app/services/cycle_story_personas.py": {
        "now_iso = datetime.now(timezone.utc).isoformat()": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
    },
    "app/services/data_version.py": {
        "{\"$inc\": {\"version\": 1}, \"$set\": {\"updated_at\": datetime.now(timezone.utc)}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) on a per-user cache-version bump"
            ),
        },
    },
    "app/services/debt_plan.py": {
        "computed_at = datetime.now(timezone.utc).isoformat()": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count); this file's own rendered 'today' already uses "
                "timeutil.user_today()"
            ),
        },
    },
    "app/services/finexer_sync.py": {
        "\"last_synced\": datetime.utcnow(),": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token/consent freshness TTLs, customer created_at, status_changed_at, "
                "last_synced)"
            ),
        },
        "\"status\": \"revoked\", \"status_changed_at\": datetime.utcnow(),": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token/consent freshness TTLs, customer created_at, status_changed_at, "
                "last_synced)"
            ),
        },
        "\"updated_at\":     datetime.utcnow(),": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token/consent freshness TTLs, customer created_at, status_changed_at, "
                "last_synced)"
            ),
        },
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token/consent freshness TTLs, customer created_at, status_changed_at, "
                "last_synced)"
            ),
        },
        "return datetime.now(timezone.utc) - fetched_at < timedelta(hours=ttl_hours)": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token/consent freshness TTLs, customer created_at, status_changed_at, "
                "last_synced)"
            ),
        },
        "return datetime.utcnow()": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token/consent freshness TTLs, customer created_at, status_changed_at, "
                "last_synced)"
            ),
            "count": 2,
        },
        "update_fields[\"status_changed_at\"] = datetime.utcnow()": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token/consent freshness TTLs, customer created_at, status_changed_at, "
                "last_synced)"
            ),
        },
        "{\"$set\": {\"customer_id\": customer_id, \"created_at\": datetime.utcnow()}},": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token/consent freshness TTLs, customer created_at, status_changed_at, "
                "last_synced)"
            ),
        },
    },
    "app/services/income.py": {
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/services/investment_prices.py": {
        "{\"$set\": {\"current_price\": current_price, \"current_value\": current_value, \"last_refreshed\": datetime.now()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) on a price refresh"
            ),
        },
        "{\"$set\": {\"total_value\": new_total, \"last_refreshed\": datetime.now()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) on a price refresh"
            ),
        },
    },
    "app/services/manual_account_rules.py": {
        "\"created_at\": datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual account-adjustment rules"
            ),
        },
        "{\"$inc\": {\"balance\": delta}, \"$set\": {\"updated_at\": datetime.now()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual account-adjustment rules"
            ),
        },
        "{\"$inc\": {\"balance\": round(-total, 2)}, \"$set\": {\"updated_at\": datetime.now()}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) for manual account-adjustment rules"
            ),
        },
    },
    "app/services/memory.py": {
        "{\"$set\": {\"facts\": combined, \"updated_at\": datetime.now(), \"user_id\": uid}},": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) on Penny's memory-facts doc"
            ),
        },
    },
    "app/services/money_shape.py": {
        "data[\"computed_at\"] = datetime.now()": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) + an hour-scale cache-freshness TTL"
            ),
        },
        "fresh = isinstance(computed_at, datetime) and (datetime.now() - computed_at).total_seconds() < ttl_hours * 3600": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) + an hour-scale cache-freshness TTL"
            ),
        },
    },
    "app/services/needle.py": {
        "\"computed_at\": datetime.now(timezone.utc).isoformat(),": {
            "reason": (
                "computed_at audit/debug metadata field; period_start/period_end are supplied by the "
                "caller, not computed in this file"
            ),
        },
    },
    "app/services/notifications.py": {
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; persisted audit timestamp (created_at/updated_at-style write, not rendered to the "
                "user as a day or day-count)"
            ),
        },
        "{\"$set\": {\"pushed\": True, \"pushed_at\": datetime.utcnow().isoformat()}},": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar "
                "copy; persisted audit timestamp (created_at/updated_at-style write, not rendered to the "
                "user as a day or day-count)"
            ),
        },
    },
    "app/services/pace.py": {
        "\"data\": baseline, \"months\": months, \"computed_at\": datetime.now(),": {
            "reason": (
                "cache-freshness TTL checks + computed_at audit timestamps for spend-baseline/shape "
                "caches"
            ),
        },
        "\"data\": bundle, \"computed_at\": datetime.now(),": {
            "reason": (
                "cache-freshness TTL checks + computed_at audit timestamps for spend-baseline/shape "
                "caches"
            ),
        },
        "if (datetime.now() - at).total_seconds() >= _BASELINE_TTL_SECONDS:": {
            "reason": (
                "cache-freshness TTL checks + computed_at audit timestamps for spend-baseline/shape "
                "caches"
            ),
        },
        "if (datetime.now() - at).total_seconds() >= _SHAPE_TTL_SECONDS:": {
            "reason": (
                "cache-freshness TTL checks + computed_at audit timestamps for spend-baseline/shape "
                "caches"
            ),
        },
    },
    "app/services/pending_transactions.py": {
        "now = datetime.utcnow()": {
            "reason": (
                "fallback `date` value used only when a bank doesn't supply one on a pending transaction "
                "row; not calendar-day copy"
            ),
        },
    },
    "app/services/penny_agent.py": {
        "return max((dt - datetime.now(timezone.utc)).total_seconds(), 0.0)": {
            "reason": (
                "seconds-until-expiry countdown for a Penny proposal, minute-scale, not day-count copy"
            ),
        },
    },
    "app/services/penny_tools.py": {
        "cached[\"computed_at\"] = datetime.now()": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy "
                "+ computed_at audit timestamps + a 7-day raw-instant cache-freshness gate (same TTL "
                "class as routers/behaviour.py)"
            ),
        },
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy "
                "+ computed_at audit timestamps + a 7-day raw-instant cache-freshness gate (same TTL "
                "class as routers/behaviour.py)"
            ),
        },
        "if datetime.now(timezone.utc) - ca < timedelta(days=7):": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy "
                "+ computed_at audit timestamps + a 7-day raw-instant cache-freshness gate (same TTL "
                "class as routers/behaviour.py)"
            ),
        },
        "now = datetime.now()": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy "
                "+ computed_at audit timestamps + a 7-day raw-instant cache-freshness gate (same TTL "
                "class as routers/behaviour.py)"
            ),
            "count": 2,
        },
    },
    "app/services/planned.py": {
        "\"expired_at\": datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
        "\"settled_at\":     datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count)"
            ),
        },
    },
    "app/services/recurring_judge.py": {
        "\"judged_at\": datetime.now(),": {
            "reason": (
                "judged_at audit timestamp on the recurring-series LLM veto decision"
            ),
        },
    },
    "app/services/response_cache.py": {
        "\"payload\": encoded, \"computed_at\": datetime.now(timezone.utc),": {
            "reason": (
                "generic response-cache TTL check + computed_at audit timestamp; shared cache infra, not "
                "day-count copy"
            ),
        },
        "if (datetime.now(timezone.utc) - computed_at).total_seconds() > ttl:": {
            "reason": (
                "generic response-cache TTL check + computed_at audit timestamp; shared cache infra, not "
                "day-count copy"
            ),
        },
    },
    "app/services/retention.py": {
        "now = now or datetime.utcnow()": {
            "reason": (
                "connection-grace/dormant-account sweep windows run by a background worker, not "
                "user-facing"
            ),
            "count": 4,
        },
    },
    "app/services/safe_to_spend_history.py": {
        "now = datetime.now(timezone.utc)": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count); this file's own rendered 'today' already uses "
                "timeutil.user_today()"
            ),
        },
    },
    "app/services/scenario.py": {
        "cutoff = datetime.now() - timedelta(days=90)": {
            "reason": (
                "internal N-day transaction lookback window (query cutoff), not user-facing calendar copy"
            ),
        },
    },
    "app/services/sync_freshness.py": {
        "* connections_col.last_synced  — written datetime.utcnow() (naive UTC) by TrueLayer sync": {
            "reason": (
                "prose inside this module's own docstring, describing OTHER files' storage convention -- "
                "not an executable date call"
            ),
        },
        "* finexer_consents_col.last_synced — written datetime.utcnow() (naive UTC) by Finexer sync": {
            "reason": (
                "prose inside this module's own docstring, describing OTHER files' storage convention -- "
                "not an executable date call"
            ),
        },
        "1. TrueLayer writes it as datetime.now() (naive local) but Finexer writes datetime.utcnow()": {
            "reason": (
                "prose inside this module's own docstring, describing OTHER files' storage convention -- "
                "not an executable date call"
            ),
        },
    },
    "app/services/truelayer_sync.py": {
        "\"date\":             _parse_iso_utc(txn.get(\"timestamp\")) or datetime.utcnow(),": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "\"expires_at\":    datetime.now() + timedelta(seconds=token_data.get(\"expires_in\", 3600)),": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "\"sort_code\":   None, \"updated_at\": datetime.now(),": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "\"updated_at\":    datetime.now(),": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "\"updated_at\":  datetime.now(),": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "cutoff = datetime.utcnow() - timedelta(hours=grace_hours)": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "d = (datetime.now() - timedelta(days=days)).strftime(\"%Y-%m-%d\")": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "from_date = (datetime.now() - timedelta(days=90)).strftime(\"%Y-%m-%d\")": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "if datetime.now() < conn[\"expires_at\"]:": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "to_date = datetime.now().strftime(\"%Y-%m-%d\")": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "update[\"needs_reauth_at\"] = datetime.utcnow()": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
        "{\"_id\": connection_id}, {\"$set\": {\"last_synced\": datetime.utcnow()}}, upsert=True": {
            "reason": (
                "background bank-sync worker internals (token/connection lifecycle, retry/query windows), "
                "not user-facing (token expiry/refresh, connection created_at/updated_at, sync-window "
                "query params sent to the bank API, last_synced write)"
            ),
        },
    },
    "app/services/yapily_sync.py": {
        "\"updated_at\": datetime.now(),": {
            "reason": (
                "persisted audit timestamp (created_at/updated_at-style write, not rendered to the user "
                "as a day or day-count) on a Yapily institution connection"
            ),
        },
    },
    "app/workers/sync_worker.py": {
        "now = datetime.utcnow()": {
            "reason": (
                "either a worker-run-summary audit timestamp, or task_consent_watch's deliberate "
                "raw-instant is_expiring/throttle GATE (per that function's own docstring) -- the "
                "rendered reconnect/expiry COPY those gates feed already converts through "
                "timeutil.to_user_date() a little further down this file, per "
                "_reconnect_body/_expiring_copy's own G161-follow-up comments"
            ),
            "count": 3,
        },
        "week = datetime.utcnow().strftime(\"%G-W%V\")": {
            "reason": (
                "weekly job-dedup key (ISO week number) for a scheduled reconcile job, not user-facing"
            ),
        },
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

        # Collect every naive-call hit in this file, keyed by its stripped
        # source text, so duplicate-text occurrences can be compared against
        # the allowlist's `count` as a group rather than line by line.
        hits_by_text: dict[str, list[int]] = {}
        for lineno, line in enumerate(text.splitlines(), start=1):
            if not NAIVE_CALL_RE.search(line):
                continue
            if INLINE_PRAGMA_RE.search(line):
                continue
            hits_by_text.setdefault(line.strip(), []).append(lineno)

        for line_text, linenos in hits_by_text.items():
            entry = allowed_here.get(line_text)
            allowed_count = entry.get("count", 1) if entry else 0
            if len(linenos) <= allowed_count:
                continue
            # Report every occurrence when there's no allowlist entry at all
            # (a genuinely new, never-seen line); report the count mismatch
            # plus every occurrence's line number when an allowlisted line
            # has MORE copies than it's allowed -- text alone can't say
            # which copy is the original and which is new, so all of them
            # are listed for a human to re-triage.
            if entry is None:
                for lineno in linenos:
                    failures.append(f"{rel}:{lineno}: {line_text}")
            else:
                where = ", ".join(str(n) for n in linenos)
                failures.append(
                    f"{rel}: {len(linenos)} occurrence(s) of {line_text!r} found "
                    f"(lines: {where}) but only {allowed_count} allowlisted -- "
                    f"a new, un-triaged copy of an allowed line?"
                )

    if failures:
        print(
            "check_naive_dates: found naive date.today()/datetime.now()/"
            "datetime.utcnow() call(s) not covered by the allowlist:\n",
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
            "add a `# naive-ok: <reason>` comment on the line, or a reasoned "
            "{\"reason\": ..., \"count\": N} entry to ALLOWLIST in "
            "scripts/check_naive_dates.py.",
            file=sys.stderr,
        )
        return 1

    print("check_naive_dates: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
