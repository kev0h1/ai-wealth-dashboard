"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import MoneyText from "@/components/MoneyText";
import {
  chartGeometry, linePath, money, samplePoints, shortDate,
  type GrowthPoint,
} from "@/lib/investmentGrowth";

export type ChartMode = "line" | "dots" | "pair";

const W = 320;

// Value over time. The line is always Adviser Indigo: a fall is a lower line,
// never a colour change (DESIGN.md, The Red Is Risk Rule). No y-axis figures,
// so the chart carries shape and the readout carries numbers. Touch or arrow
// keys pick a day; the readout row is fixed height so nothing jumps.
export default function GrowthChart({
  points, mode, height = 120, hidden, summary,
}: {
  points: GrowthPoint[];
  mode: ChartMode;
  height?: number;
  hidden?: boolean;
  summary: string;
}) {
  const id = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const geo = points.length ? chartGeometry(points, W, height, mode === "pair") : null;
  const idx = picked !== null && picked < points.length ? picked : null;
  const sel = idx !== null ? points[idx] : null;

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    if (!geo) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    geo.xs.forEach((gx, i) => { if (Math.abs(gx - x) < Math.abs(geo.xs[best] - x)) best = i; });
    setPicked(best);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const cur = idx ?? points.length - 1;
    setPicked(Math.max(0, Math.min(points.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
  };

  const dots = geo && mode === "dots" ? samplePoints(points.map((_, i) => i), 48) : [];
  const last = points.length - 1;
  const valueAbove = geo ? geo.ys[last] <= geo.paidYs[last] : true;

  return (
    <div>
      <div className="flex h-[34px] items-end justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400" aria-live="polite">
        {sel ? (
          <>
            <span className="shrink-0 font-semibold">{shortDate(sel.date, true)}</span>
            <span className="min-w-0 truncate text-right">
              <MoneyText text={money(sel.value, { hidden })} className="text-[13px] font-semibold text-slate-900 dark:text-slate-100" />
              {mode === "pair" ? (
                <>
                  <span className="mx-1">·</span>
                  <span>paid in </span>
                  <MoneyText text={money(sel.paid_in, { hidden })} className="text-[12px] text-slate-900 dark:text-slate-100" />
                  <span className="mx-1">·</span>
                  <MoneyText text={money(sel.value - sel.paid_in, { sign: true, hidden })} className="text-[12px] text-slate-900 dark:text-slate-100" />
                </>
              ) : null}
            </span>
          </>
        ) : (
          <span>Touch the chart to see a day</span>
        )}
      </div>
      <div
        role="img"
        aria-label={summary}
        tabIndex={0}
        onPointerDown={pick}
        onPointerMove={(e) => { if (e.pointerType === "mouse" || e.buttons) pick(e); }}
        onKeyDown={key}
        className="mt-1 touch-pan-y rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
      >
        {geo ? (
          <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full overflow-visible" aria-hidden="true">
            <line x1="0" x2={W} y1={height - 0.5} y2={height - 0.5} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
            {mode === "pair" ? (
              <path d={linePath(geo.xs, geo.paidYs)} fill="none" className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1.5" strokeDasharray="4 4" strokeLinejoin="round" />
            ) : null}
            {mode === "dots" ? (
              dots.map((i) => (
                <circle key={`${id}${i}`} cx={geo.xs[i]} cy={geo.ys[i]} r="2.6" className="fill-indigo-600 dark:fill-indigo-400" />
              ))
            ) : (
              <path d={linePath(geo.xs, geo.ys)} fill="none" className="stroke-indigo-600 dark:stroke-indigo-400" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            )}
            {mode === "pair" ? (
              <>
                <text x={W} y={geo.ys[last] + (valueAbove ? -8 : 15)} textAnchor="end" className="fill-indigo-700 stroke-white text-[10px] font-semibold dark:fill-indigo-300 dark:stroke-slate-800" strokeWidth="3" paintOrder="stroke">Value</text>
                <text x={W} y={geo.paidYs[last] + (valueAbove ? 15 : -8)} textAnchor="end" className="fill-slate-600 stroke-white text-[10px] font-semibold dark:fill-slate-400 dark:stroke-slate-800" strokeWidth="3" paintOrder="stroke">Paid in</text>
              </>
            ) : null}
            {sel && idx !== null ? (
              <>
                <line x1={geo.xs[idx]} x2={geo.xs[idx]} y1="0" y2={height} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1" />
                <circle cx={geo.xs[idx]} cy={geo.ys[idx]} r="4" className="fill-indigo-600 stroke-white dark:fill-indigo-400 dark:stroke-slate-800" strokeWidth="2" />
                {mode === "pair" ? (
                  <circle cx={geo.xs[idx]} cy={geo.paidYs[idx]} r="3.5" className="fill-slate-500 stroke-white dark:fill-slate-400 dark:stroke-slate-800" strokeWidth="2" />
                ) : null}
              </>
            ) : null}
          </svg>
        ) : (
          <div style={{ height }} className="flex items-center text-[13px] text-slate-600 dark:text-slate-400">
            The chart appears once there are two daily values.
          </div>
        )}
      </div>
      {points.length ? (
        <div className="mt-1 flex justify-between text-[11px] text-slate-600 dark:text-slate-400">
          <span>{shortDate(points[0].date)}</span>
          <span>{shortDate(points[last].date)}</span>
        </div>
      ) : null}
    </div>
  );
}
