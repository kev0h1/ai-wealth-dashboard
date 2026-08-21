"use client";

import { useEffect, useState } from "react";
import { api, ValueDelivered } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useRouter } from "next/navigation";
import PennyMark from "@/components/PennyMark";

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
    <div className="mt-3 rounded-2xl glass-card px-4">
      <button
        onClick={() => router.push("/insights?tab=save")}
        className="w-full active:scale-[0.98] transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
      >
        <div className="min-h-[44px] flex items-center justify-between">
          {/* Left */}
          <div className="flex items-center gap-2">
            <PennyMark size={15} className="text-slate-400 flex-shrink-0" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {verified > 0
                ? <><span className="font-mono tabular-nums">{sym}{verified.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span>/mo saved</>
                : <><span className="font-mono tabular-nums">{sym}{monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span>/mo potential savings</>}
            </span>
          </div>
          {/* Right */}
          <span className="text-sm text-slate-400 dark:text-slate-500">›</span>
        </div>
      </button>
    </div>
  );
}
