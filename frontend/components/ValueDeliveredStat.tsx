"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api, ValueDelivered } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";

const SYM: Record<string, string> = { UK: "£", Kenya: "KSh " };

export default function ValueDeliveredStat() {
  const { region } = usePreferences();
  const sym = SYM[region] ?? "£";
  const [data, setData] = useState<ValueDelivered | null>(null);

  useEffect(() => {
    api.valueDelivered().then(setData).catch(() => {});
  }, []);

  const verified = data?.verified_monthly_saving ?? 0;
  // Owner decision (2026-09-05): this row is now a verified-only ledger
  // entry, never a projection. No "£X/mo potential savings" branch — a
  // number nobody has actually banked yet doesn't belong on Home.
  if (!data || verified === 0) return null;

  // Non-tappable (2026-09-05): this used to open Spend's Patterns view as an
  // interim landing spot for a tips index. That index retired along with
  // the Insights page (tips now live in category sublines and on the
  // transactions page, see DESIGN.md's 2026-09-05 note), so there is no
  // page left for this row to open — a plain stat, not a dead link.
  //
  // Icon fixed 2026-09-05 (review round): this is verified, bank-confirmed
  // money (Verified Emerald, DESIGN.md), not advice, so it wears the same
  // emerald CheckCircle2 InsightCard.tsx's own verified_savings banner
  // uses, not PennyMark — the indigo/violet Penny mark is reserved for
  // surfaces that are actually Penny (DESIGN.md's Penny Gradient Rule).
  return (
    <div className="mt-3 rounded-2xl glass-card px-4">
      <div className="min-h-[44px] flex items-center gap-2">
        <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
          <span className="font-mono tabular-nums">{sym}{verified.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span>/mo saved
        </span>
      </div>
    </div>
  );
}
