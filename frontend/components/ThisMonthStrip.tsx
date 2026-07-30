"use client";

// Monthly-needle strip for the Home "YOUR MONEY" section.
// Shows a closed-period verdict (Variant A) when the last period ended within
// the past 7 days, otherwise a live in-period summary (Variant B).
// Taps through to /cards — the cards-story reading.

import { useEffect, useState, useCallback } from "react";
import { api, NeedleSummary } from "@/lib/api";
import { useRouter } from "next/navigation";
import { usePreferences } from "@/components/PreferencesContext";

type Status = "loading" | "ready" | "failed";

function maskAmounts(line: string): string {
  return line.replace(/£[\d,]+(\.\d+)?/g, "£••••");
}

export default function ThisMonthStrip() {
  const router = useRouter();
  const { hideNetWorth } = usePreferences();
  const [data, setData] = useState<NeedleSummary | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const load = useCallback(() => {
    setStatus("loading");
    api
      .getNeedleSummary()
      .then((r) => {
        setData(r);
        setStatus("ready");
      })
      .catch(() => setStatus("failed"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Loading skeleton
  if (status === "loading") {
    return (
      <div className="px-4 lg:px-0">
        <div className="h-16 rounded-2xl glass-card animate-pulse" />
      </div>
    );
  }

  // Error — render nothing
  if (status === "failed" || !data) {
    return null;
  }

  const { last_closed, current } = data;

  // Determine variant: closed period within last 7 days
  const useClosedVariant =
    last_closed !== null &&
    (Date.now() - new Date(last_closed.period_end).getTime()) / 86400000 <= 7;

  return (
    <div className="px-4 lg:px-0">
      <button
        onClick={() => router.push("/cards")}
        className="w-full text-left rounded-2xl glass-card px-4 py-3 fade-in hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {/* Whisper label */}
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
          {useClosedVariant && last_closed ? "Last month" : "Since payday"}
        </p>

        {useClosedVariant && last_closed ? (
          // Variant A — closed month verdict
          <>
            <p
              className={`text-sm font-medium ${
                last_closed.card_delta < 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-slate-600 dark:text-slate-300"
              }`}
            >
              {hideNetWorth
                ? maskAmounts(last_closed.lines.movement)
                : last_closed.lines.movement}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {hideNetWorth
                ? maskAmounts(last_closed.lines.cash)
                : last_closed.lines.cash}
            </p>
          </>
        ) : (
          // Variant B — live in-period summary
          (() => {
            const delta = current.card_delta_so_far;
            const N = current.days_into_period;
            if (Math.abs(delta) < 20) {
              return (
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  Cards held steady over {N} days
                </p>
              );
            }
            return (
              <p
                className={`text-sm font-medium ${
                  delta <= -20
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-slate-600 dark:text-slate-300"
                }`}
              >
                Cards {delta >= 0 ? "↑" : "↓"}
                <span className="num font-semibold text-slate-700 dark:text-slate-200">
                  {hideNetWorth
                    ? "£••••"
                    : `£${Math.round(Math.abs(delta)).toLocaleString("en-GB")}`}
                </span>
                {" over "}{N}{" days"}
              </p>
            );
          })()
        )}
      </button>
    </div>
  );
}
