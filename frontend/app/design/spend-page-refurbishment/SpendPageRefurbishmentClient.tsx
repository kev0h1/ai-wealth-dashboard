"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import VariantA from "./VariantA";
import VariantAChartPage from "./VariantAChartPage";
import { INITIAL_CHART_COLLECTION, type ChartPlacement } from "./VariantACharts";
import type { PreviewMode } from "./shared";

type PreviewSurface = "journey" | "charts";

function previewHref(placement: ChartPlacement, mode: PreviewMode, surface: PreviewSurface = "journey") {
  return `?variant=a&charts=${placement}&surface=${surface}&mode=${mode}`;
}

function PreviewControls({ placement, mode, surface }: { placement: ChartPlacement; mode: PreviewMode; surface: PreviewSurface }) {
  const placements: readonly { key: ChartPlacement; label: string }[] = [
    { key: "here", label: "1 · Charts here" },
    { key: "page", label: "2 · Own page" },
  ];

  return (
    <nav
      aria-label="G57 chart placement treatments"
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-white/10 bg-slate-950/95 px-3 py-2 text-white shadow-xl"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="mx-auto flex w-full max-w-5xl items-center gap-1 overflow-x-auto">
        <span className="hidden shrink-0 rounded-full bg-indigo-400/15 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.06em] text-indigo-200 sm:inline">A winner</span>
        {placements.map((item) => (
          <a
            key={item.key}
            href={previewHref(item.key, mode, item.key === "page" ? surface : "journey")}
            aria-current={placement === item.key ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center rounded-xl px-3 text-[12px] font-semibold transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${placement === item.key ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}
          >
            {item.label}
          </a>
        ))}
        <a
          href={previewHref(placement, mode === "dark" ? "light" : "dark", surface)}
          className="ml-auto flex min-h-11 shrink-0 items-center rounded-xl px-3 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function SpendPageRefurbishmentClient() {
  const params = useSearchParams();
  const [chartCollection, setChartCollection] = useState(INITIAL_CHART_COLLECTION);
  const placement: ChartPlacement = params.get("charts") === "page" ? "page" : "here";
  const mode: PreviewMode = params.get("mode") === "dark" ? "dark" : "light";
  const surface: PreviewSurface = placement === "page" && params.get("surface") === "charts" ? "charts" : "journey";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] text-slate-950 dark:bg-[#0f172a] dark:text-slate-100">
        <p className="sr-only">Illustrative figures, not real balances. G57 Spend revamp, A with charts {placement === "here" ? "on the journey" : "on their own page"}.</p>
        {surface === "charts" ? (
          <VariantAChartPage backHref={previewHref("page", mode)} collection={chartCollection} setCollection={setChartCollection} />
        ) : (
          <VariantA chartPlacement={placement} chartsHref={previewHref("page", mode, "charts")} chartCollection={chartCollection} setChartCollection={setChartCollection} />
        )}
      </div>
      <PreviewControls placement={placement} mode={mode} surface={surface} />
    </div>
  );
}
