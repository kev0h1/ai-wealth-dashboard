"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, ValueDelivered } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useRouter } from "next/navigation";

const SYM: Record<string, string> = { UK: "£", Kenya: "KSh " };

export default function ValueDeliveredStat() {
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
      className="flex items-center gap-1.5 mt-2 px-1 active:opacity-70 transition-opacity"
    >
      <Sparkles size={11} className="text-indigo-400" />
      <span className="text-xs text-indigo-500 dark:text-indigo-400 font-medium">
        {verified > 0
          ? `${sym}${verified.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo saved${monthly > 0 ? ` · ${sym}${monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo more possible` : ""}`
          : `${sym}${monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo potential savings across ${data.insights_acted_on} insight${data.insights_acted_on !== 1 ? "s" : ""}`}
      </span>
    </button>
  );
}
