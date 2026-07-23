"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, ValueDelivered } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";

const SYM: Record<string, string> = { UK: "£", Kenya: "KSh " };
import { useRouter } from "next/navigation";

export default function ValueDeliveredBanner() {
  const { region } = usePreferences();
  const sym = SYM[region] ?? "£";
  const router = useRouter();
  const [data, setData] = useState<ValueDelivered | null>(null);

  useEffect(() => {
    api.valueDelivered().then(setData).catch(() => {});
  }, []);

  if (!data || data.total_monthly_saving === 0) return null;

  const monthly = data.total_monthly_saving;
  const annual  = Math.round(monthly * 12);

  return (
    <button
      onClick={() => router.push("/insights")}
      className="mx-4 mb-4 w-[calc(100%-2rem)] lg:mx-0 lg:w-full text-left"
    >
      <div className="flex items-center gap-3 bg-indigo-600 rounded-2xl px-4 py-3 shadow-sm active:scale-[0.98] transition-transform">
        <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <Sparkles size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white/70 uppercase tracking-wide">Value delivered</p>
          <p className="text-sm font-bold text-white leading-tight">
            {sym}{monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo saved
            {" "}<span className="font-normal text-white/80">· {sym}{annual.toLocaleString("en-GB")}/yr</span>
          </p>
        </div>
        <p className="text-[10px] text-white/60 flex-shrink-0">{data.insights_acted_on} insight{data.insights_acted_on !== 1 ? "s" : ""}</p>
      </div>
    </button>
  );
}
