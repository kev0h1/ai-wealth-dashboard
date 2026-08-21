"use client";

import { useEffect, useState } from "react";
import {
  Fuel, SquareParking, CarTaxiFront, Train, Bus,
  PlugZap, Wrench, Car, ChevronDown,
} from "lucide-react";
import { api, TransportSummary, TransportMode } from "@/lib/api";
import Spinner from "@/components/Spinner";
import FuelSavingsCard from "@/components/FuelSavingsCard";
import MoneyText from "@/components/MoneyText";

const MODE_ICON: Record<string, React.ReactNode> = {
  "Fuel":             <Fuel size={14} />,
  "Parking":          <SquareParking size={14} />,
  "Taxi & Rideshare": <CarTaxiFront size={14} />,
  "Rail":             <Train size={14} />,
  "TfL / Oyster":     <Train size={14} />,
  "Bus & Coach":      <Bus size={14} />,
  "EV Charging":      <PlugZap size={14} />,
  "Car Rental":       <Car size={14} />,
  "Car Care":         <Wrench size={14} />,
};

function fmt(n: number) {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function adaptiveInsight(data: TransportSummary): string {
  const total        = data.total_spend;
  const carPct       = total > 0 ? (data.car_total       / total) * 100 : 0;
  const ridesharePct = total > 0 ? (data.rideshare_total / total) * 100 : 0;
  const ptPct        = total > 0 ? (data.pt_total        / total) * 100 : 0;

  const parking   = data.modes.find(m => m.name === "Parking");
  const rideshare = data.modes.find(m => m.name === "Taxi & Rideshare");

  if (ridesharePct > 25 && data.car_total > 0 && rideshare && parking) {
    return `Rideshare (£${fmt(rideshare.monthly)}/mo) is nearly as much as parking (£${fmt(parking.monthly)}/mo)`;
  }
  if (ridesharePct > 50 && data.car_total === 0 && rideshare) {
    return `£${fmt(rideshare.monthly)}/mo on rideshare. Could a monthly travelcard work out cheaper?`;
  }
  if (carPct > 60) {
    return `Your car costs roughly £${Math.round(data.car_monthly * 12).toLocaleString("en-GB")} a year to run`;
  }
  if (ptPct > 60) {
    return `Public transport is your main mode at £${fmt(data.pt_monthly)}/mo`;
  }
  const top = data.modes[0];
  if (!top) return "";
  return `${top.name} is your biggest cost at £${fmt(top.monthly)}/mo (${Math.round(top.pct)}%)`;
}

function ModeRow({ mode, maxTotal }: { mode: TransportMode; maxTotal: number }) {
  const w = Math.max(Math.round((mode.total / maxTotal) * 100), 3);
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white"
        style={{ backgroundColor: mode.colour }}
      >
        {MODE_ICON[mode.name] ?? <Car size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate">
            {mode.name}
          </span>
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 ml-2 flex-shrink-0">
            <span className="font-mono tabular-nums">£{fmt(mode.monthly)}</span><span className="text-xs font-normal text-slate-400">/mo</span>
          </span>
        </div>
        <div className="h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-200 ease-out"
            style={{ width: `${w}%`, backgroundColor: mode.colour }}
          />
        </div>
      </div>
      <span className="text-xs font-medium text-slate-400 dark:text-slate-500 w-7 text-right flex-shrink-0">
        {Math.round(mode.pct)}%
      </span>
    </div>
  );
}

export default function TransportInsights() {
  const [data, setData] = useState<TransportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    api.transportSummary()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>;
  }
  if (!data || data.total_spend === 0) {
    return (
      <div className="pt-8 text-center">
        <p className="text-slate-400 dark:text-slate-500 text-sm">No transport data in the last 90 days</p>
      </div>
    );
  }

  const total        = data.total_spend;
  const carPct       = total > 0 ? (data.car_total       / total) * 100 : 0;
  const ridesharePct = total > 0 ? (data.rideshare_total / total) * 100 : 0;
  const ptPct        = total > 0 ? (data.pt_total        / total) * 100 : 0;

  const activeSplitGroups = [carPct, ridesharePct, ptPct].filter(p => p > 0).length;
  const maxModeTotal      = Math.max(...data.modes.map(m => m.total), 1);
  const insight           = adaptiveInsight(data);
  const hasCar            = data.car_total > 0;
  const annualCar         = hasCar ? Math.round(data.car_monthly * 12) : 0;

  return (
    <div className="pb-8 space-y-3">

      {/* ── 1. FuelSavingsCard — action first ───────────────────────── */}
      {hasCar && <FuelSavingsCard />}

      {/* ── 2. Always-visible summary whisper ───────────────────────── */}
      <div className="px-1">
        <p className="text-[12px] text-slate-400 dark:text-slate-500">
          Transport · <span className="font-semibold text-slate-600 dark:text-slate-300 font-mono tabular-nums">~£{fmt(data.monthly_avg)}/mo</span>
        </p>
      </div>

      {/* ── 3. Collapsible breakdown ─────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <button
          onClick={() => setBreakdownOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
          aria-expanded={breakdownOpen}
        >
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
            See your travel breakdown
          </span>
          <ChevronDown
            size={16}
            className={[
              "text-slate-500 dark:text-slate-400 flex-shrink-0",
              reducedMotion ? "" : "transition-transform duration-200",
              breakdownOpen ? "rotate-180" : "rotate-0",
            ].join(" ")}
          />
        </button>

        <div
          className={[
            "overflow-hidden",
            reducedMotion ? "" : "transition-[max-height] duration-300 ease-in-out",
          ].join(" ")}
          style={{ maxHeight: breakdownOpen ? "2000px" : "0px" }}
        >
          <div className="px-4 pb-4 space-y-4 border-t border-slate-100 dark:border-slate-700 pt-3">
            {/* Hero total */}
            <div>
              <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">
                Transport · 90 days
              </p>
              <div className="flex items-end gap-2">
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  <span className="font-mono tabular-nums">£{fmt(data.monthly_avg)}</span><span className="text-base font-normal text-slate-400">/mo</span>
                </p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mb-0.5 font-mono tabular-nums">
                  £{fmt(data.weekly_avg)}/wk
                </p>
              </div>
            </div>

            {/* Split bar + legend */}
            {activeSplitGroups >= 2 && (
              <>
                <div className="h-2.5 rounded-full overflow-hidden flex gap-px">
                  {carPct > 1 && <div className="h-full bg-amber-400" style={{ width: `${carPct}%` }} />}
                  {ridesharePct > 1 && <div className="h-full bg-blue-500" style={{ width: `${ridesharePct}%` }} />}
                  {ptPct > 1 && <div className="h-full bg-violet-500" style={{ width: `${ptPct}%` }} />}
                </div>
                <div className="flex flex-wrap gap-3">
                  {carPct > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />Car · {Math.round(carPct)}%
                    </span>
                  )}
                  {ridesharePct > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                      <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />Rideshare · {Math.round(ridesharePct)}%
                    </span>
                  )}
                  {ptPct > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                      <span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />Public · {Math.round(ptPct)}%
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Where it goes */}
            <div>
              <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 mb-3">Where it goes</p>
              <div className="space-y-4">
                {data.modes.map(m => (
                  <ModeRow key={m.name} mode={m} maxTotal={maxModeTotal} />
                ))}
              </div>
            </div>

            {/* Adaptive insight chip */}
            {insight && (
              <div className="flex items-start gap-2 bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2">
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center text-white flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: data.modes[0]?.colour ?? "#64748b" }}
                >
                  {MODE_ICON[data.modes[0]?.name] ?? <Car size={11} />}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300"><MoneyText text={insight} /></p>
              </div>
            )}

            {/* Annual car footnote */}
            {hasCar && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-700">
                Car running costs total roughly{" "}
                <span className="font-semibold text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                  £{annualCar.toLocaleString("en-GB")}/yr
                </span>{" "}
                before depreciation and insurance
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── 4. Recent transport ──────────────────────────────────────── */}
      {data.top_transactions.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 mb-3">Recent transport</p>
          <div className="space-y-3">
            {data.top_transactions.map((tx, i) => {
              const modeColour = data.modes.find(m => m.name === tx.mode)?.colour ?? "#64748b";
              return (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white"
                    style={{ backgroundColor: modeColour }}
                  >
                    {MODE_ICON[tx.mode] ?? <Car size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-slate-800 dark:text-slate-100 truncate">{tx.name}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">{tx.mode} · {tx.date}</p>
                  </div>
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 flex-shrink-0 font-mono tabular-nums">
                    £{tx.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
