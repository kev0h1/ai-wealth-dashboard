"use client";

// "Penny messages" usage row (backlog B4) — shared markup for the live
// Sign-in methods card (app/settings/SettingsPage.tsx, added as the last
// row after Apple) and its design preview
// (app/design/settings-usage-row/page.tsx), so the two can't drift.
//
// Reads a SubscriptionInfo snapshot passed in by the caller rather than
// fetching its own — SettingsPage.tsx sources it from
// PennySheetProvider's usePennyUsage() singleton (already the shared store
// for Penny's own usage ring/composer, GET /subscription), and calls
// refreshPennyUsage() once on mount so the row is fresh when Settings
// opens. This component makes no network call itself.
//
// `used` reads straight off `usage.penny_messages` (always present on a
// successful /subscription response) rather than deriving it from
// `limit - remaining`, since `penny_remaining` is documented optional
// (SubscriptionUsage, shared/src/types.ts) — this way the row still shows
// a used count even against a payload missing that field.
//
// Copy: no em dashes (repo-wide rule). Colour: the trailing pill turns
// amber only once used reaches 80% of the (topped-up) limit, never red —
// DESIGN.md's Red Is Risk rule reserves red for genuine financial risk,
// and running low on chat messages isn't one.

import type { SubscriptionInfo } from "@/lib/api";
import { formatPennyResetDate } from "@/components/PennySheetProvider";

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export default function PennyUsageRow({
  info,
  error = false,
}: {
  info: SubscriptionInfo | null;
  /** True once a fetch has been attempted and still left `info` null (a
   * failed GET /subscription) — distinct from the ordinary pre-fetch null,
   * which reads as "Checking…" instead. */
  error?: boolean;
}) {
  let subline: string;
  let pill: { text: string; amber: boolean } | null = null;

  if (!info) {
    subline = error ? "Could not load usage" : "Checking…";
  } else {
    const u = info.usage;
    const used = u.penny_messages;
    const limitBase = u.penny_limit ?? null;
    if (limitBase == null) {
      subline = `Unlimited on the ${capitalize(info.tier)} plan`;
    } else {
      const topups = u.penny_topup_messages ?? 0;
      const limit = limitBase + topups;
      const remaining = u.penny_remaining ?? Math.max(0, limit - used);
      const resetLabel = formatPennyResetDate(u.penny_resets_on ?? null);
      subline = topups > 0
        ? `${used} of ${limit} used this month, including ${topups} extra, resets ${resetLabel}`
        : `${used} of ${limit} used this month, resets ${resetLabel}`;
      pill = { text: `${remaining} left`, amber: limit > 0 && used / limit >= 0.8 };
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div className="min-w-0 pr-3">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Penny messages</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 num">{subline}</p>
      </div>
      {pill && (
        <span
          className={`flex-shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-1 num ${
            pill.amber
              ? "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30"
              : "text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-700"
          }`}
        >
          {pill.text}
        </span>
      )}
    </div>
  );
}
