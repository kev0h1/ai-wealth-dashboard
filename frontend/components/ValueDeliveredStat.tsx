"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, ValueDelivered } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useRouter } from "next/navigation";

const SYM: Record<string, string> = { UK: "£", Kenya: "KSh " };

export default function ValueDeliveredStat({ plain }: { plain?: boolean } = {}) {
  const { region } = usePreferences();
  const sym = SYM[region] ?? "£";
  const router = useRouter();
  const [data, setData] = useState<ValueDelivered | null>(null);

  useEffect(() => {
    api.valueDelivered().then(setData).catch(() => {});
  }, []);

  const verified = data?.verified_monthly_saving ?? 0;
  if (!data || (data.total_monthly_saving === 0 && verified === 0)) return null;

  const monthly = data.total_monthly_saving;

  return (
    <button
      onClick={() => router.push("/insights?tab=save")}
      className={plain
        ? "mt-1 flex items-center gap-1.5 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        : "mt-2 flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl px-3 py-2 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"}
    >
      <Sparkles size={13} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
      <span className={plain ? "text-sm text-indigo-500 dark:text-indigo-400" : "text-sm font-medium text-indigo-600 dark:text-indigo-400"}>
        {verified > 0
          ? `${sym}${verified.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo saved${monthly > 0 ? ` · ${sym}${monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo more possible` : ""}`
          : `${sym}${monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo potential savings across ${data.insights_acted_on} insight${data.insights_acted_on !== 1 ? "s" : ""}`}
      </span>
    </button>
  );
}
