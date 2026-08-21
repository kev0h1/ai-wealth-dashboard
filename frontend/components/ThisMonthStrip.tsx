"use client";

// Monthly-needle strip for the Home "YOUR MONEY" section.
// Shows a closed-period verdict (Variant A) when the last period ended within
// the past 7 days, otherwise a live in-period summary (Variant B).
// Taps through to /cards — the cards-story reading.

import { useEffect, useState, useCallback } from "react";
import { api, NeedleSummary } from "@/lib/api";
import { useRouter } from "next/navigation";
import { usePreferences } from "@/components/PreferencesContext";
import MoneyText from "@/components/MoneyText";

type Status = "loading" | "ready" | "failed";

function maskAmounts(line: string): string {
  return line.replace(/£[\d,]+(\.\d+)?/g, "£••••");
}

interface ThisMonthStripProps {
  // When provided, the parent already fetched /needle/summary — skip our
  // own duplicate request and render from these instead.
  summary?: NeedleSummary | null;
  summaryStatus?: Status;
}

export default function ThisMonthStrip({ summary, summaryStatus }: ThisMonthStripProps = {}) {
  const router = useRouter();
  const { hideNetWorth } = usePreferences();
  const externallyControlled = summaryStatus !== undefined;
  const [ownData, setOwnData] = useState<NeedleSummary | null>(null);
  const [ownStatus, setOwnStatus] = useState<Status>("loading");

  const load = useCallback(() => {
    setOwnStatus("loading");
    api
      .getNeedleSummary()
      .then((r) => {
        setOwnData(r);
        setOwnStatus("ready");
      })
      .catch(() => setOwnStatus("failed"));
  }, []);

  useEffect(() => {
    if (externallyControlled) return;
    load();
  }, [load, externallyControlled]);

  const data = externallyControlled ? (summary ?? null) : ownData;
  const status = externallyControlled ? summaryStatus! : ownStatus;

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

  // Determine variant: LAST MONTH for first 3 days of new period (days 0–2), then SINCE PAYDAY
  const useClosedVariant =
    last_closed !== null &&
    current.days_into_period <= 2;

  // live in-period card movement now lives on the Safe-to-Spend hero's chain
  // strip — this component only reports the closed month
  if (!useClosedVariant || !last_closed) {
    return null;
  }

  return (
    <div className="px-4 lg:px-0">
      <button
        onClick={() => router.push("/month?which=last")}
        className="w-full text-left rounded-2xl glass-card px-4 py-3 fade-in hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {/* Whisper label */}
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
          Last month
        </p>

        {/* Variant A — closed month verdict */}
        <p
          className={`text-sm font-medium ${
            last_closed.card_delta < 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-600 dark:text-slate-300"
          }`}
        >
          <MoneyText text={hideNetWorth
            ? maskAmounts(last_closed.lines.movement)
            : last_closed.lines.movement} />
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          <MoneyText text={hideNetWorth
            ? maskAmounts(last_closed.lines.cash)
            : last_closed.lines.cash} />
        </p>
      </button>
    </div>
  );
}
