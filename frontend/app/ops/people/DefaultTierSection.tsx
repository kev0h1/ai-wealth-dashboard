"use client";

// A195: read-only report of people whose plan comes only from the default.
// Owner-only: the endpoint answers 403 to anyone else, and this page is
// already behind the same check. Nothing here writes.

import { useEffect, useState } from "react";
import { api, type OpsDefaultTierReport } from "@/lib/api";
import { DEFAULT_TIER_WORDING, defaultTierSummary, formatDate, tierLabel } from "./people";

export default function DefaultTierSection() {
  const [report, setReport] = useState<OpsDefaultTierReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .getOpsDefaultTierReport()
      .then((r) => live && setReport(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (!report && !failed) return null;

  return (
    <section aria-label={DEFAULT_TIER_WORDING.title} className="glass-card rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {DEFAULT_TIER_WORDING.title}
      </p>
      {failed || !report ? (
        <p role="status" className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          {DEFAULT_TIER_WORDING.loadFailed}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-800 dark:text-slate-100">{defaultTierSummary(report)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{DEFAULT_TIER_WORDING.intro}</p>
          {report.people.length > 0 && (
            <>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="mt-3 min-h-11 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {open ? DEFAULT_TIER_WORDING.hide : DEFAULT_TIER_WORDING.show}
              </button>
              {open && (
                <>
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{DEFAULT_TIER_WORDING.grantHint}</p>
                  <ul className="mt-2 space-y-2">
                    {report.people.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-xl border border-slate-200 p-3 text-sm dark:border-white/10"
                      >
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{p.display_name || p.email}</p>
                        {p.display_name && <p className="text-xs text-slate-500 dark:text-slate-400">{p.email}</p>}
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                          {tierLabel(p.tier_today)} today, {tierLabel(p.tier_after)} after.{" "}
                          {p.has_subscription_doc ? "Has a lapsed or free record." : "No subscription record."}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Invited {formatDate(p.invited_at)}. Last active {formatDate(p.last_active_at)}.
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
