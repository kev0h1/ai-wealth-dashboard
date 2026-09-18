"use client";

// G124 ask #2 — same-day payments grouped into ONE bounded day card,
// adopting the G122 transactions-hub grammar verbatim:
// `<section className="rounded-2xl border ... bg-white shadow-sm ...
// overflow-hidden">` with a heading and `divide-y` hairline rows
// (app/transactions/TransactionsPage.tsx lines ~572-580), replacing
// PlanningPage.tsx's current per-payment floating `glass-card` under a bare
// "TODAY" / "3 DAYS" label.
//
// What this preserves from PlanningPage.tsx's renderGroups (lines
// ~1551-1619), because losing any of it is a regression per the brief:
//   - the payday-boundary divider ("Next pay period · from <date>"),
//     rendered as a plain-canvas hairline divider BETWEEN bounded day
//     sections, never inside one — it is a boundary between periods, not a
//     day's own content.
//   - the settling sub-cluster: bank-side pending debits are pulled out of
//     the ordinary row list into their own quiet "Settling" group at the
//     end of the day's section, never interleaved with live rows.
//   - `data-day-key` on each day's own container.
//   - each row stays individually identifiable (name/amount/status), ready
//     for SwipeDismissRow to wrap it in production — see this file's own
//     note above the row renderer for why that wrap isn't reproduced here.
//
// What this does NOT reproduce, disclosed explicitly (see also the G124
// report): PlanningPage.tsx's actual risk-flag computation (the
// account-by-account running-balance walk that decides `flagged` /
// `timingRisk` / `at_risk`) is a large, page-only simulation, not an
// importable function. Each fixture row below carries a fixed flag
// (`flagged`/`timingRisk`/`isSettling`) chosen by hand to demonstrate every
// visual state that walk can produce, rather than being computed by any
// walk of this preview's own.
import { AlertTriangle, AlertCircle, Clock } from "lucide-react";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";
import { useCategoryIcons } from "@/components/IconProvider";
import { getCategoryIcon } from "@/lib/categoryIcons";
import type { PreviewItem } from "./fixtures";

const sym = "£";

interface DayGroup {
  label: string;
  dayKeyIso: string;
  nextPeriod: boolean;
  active: PreviewItem[];
  settling: PreviewItem[];
}

function groupItems(items: PreviewItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    let g = groups.find((g) => g.label === item.dayLabel);
    if (!g) {
      g = { label: item.dayLabel, dayKeyIso: item.dayKeyIso, nextPeriod: !!item.nextPeriod, active: [], settling: [] };
      groups.push(g);
    }
    if (item.isSettling) g.settling.push(item);
    else g.active.push(item);
  }
  return groups;
}

function Row({ item }: { item: PreviewItem }) {
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const colour = getCategoryColour(item.category, colours);
  const Icon = getCategoryIcon(item.category, iconOverrides);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {item.flagged ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-500 dark:bg-rose-900/40" aria-hidden="true">
          <AlertTriangle size={14} />
        </span>
      ) : item.timingRisk ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-500 dark:bg-amber-900/40 dark:text-amber-400" aria-hidden="true">
          <AlertCircle size={14} />
        </span>
      ) : item.isSettling ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500" aria-hidden="true">
          <Clock size={14} />
        </span>
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${colour}26` }} aria-hidden="true">
          <Icon size={15} style={{ color: colour }} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.name}</p>
          {item.planned && <span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">planned</span>}
          {!item.planned && item.edited && <span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">edited</span>}
        </div>
        {item.accountLabel && (
          <p className="truncate text-xs text-slate-400 dark:text-slate-500">{item.accountLabel}</p>
        )}
        {item.isSettling && (
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">Left earlier today, still settling</p>
        )}
      </div>

      <div className="shrink-0 text-right">
        {/* The Money Is Mono Rule collision fix: the live row glues the
            estimate tilde straight onto the sign ("−~£99.80"), which is
            also two leading sigils MoneyText's own currency-token regex
            only expects one of (`[~−+-]?£`) — the fix separates the
            estimate flag from the figure instead of gluing a second sign
            onto it, so the amount itself always tokenises as one clean
            mono figure. */}
        <p className={`font-mono text-base tabular-nums ${
          item.type === "income" ? "font-bold text-emerald-500" :
          item.flagged ? "font-bold text-rose-600 dark:text-rose-400" :
          item.isSettling ? "font-semibold text-slate-500 dark:text-slate-400" :
          "font-bold text-slate-800 dark:text-slate-100"
        }`}>
          {item.type === "income" ? "+" : "−"}{sym}{item.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        {item.amountBasis === "balance_estimate" && (
          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">estimated</p>
        )}
        {item.isSettling ? null : item.poolNote ? (
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.poolNote}</p>
        ) : item.balanceAfter != null ? (
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            After: <span className="font-mono tabular-nums">{item.balanceAfter >= 0 ? "" : "−"}{sym}{Math.abs(item.balanceAfter).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span> {item.balanceAfter < 0 ? "short" : "left"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function DayGroups({ items, paydayLabel }: { items: PreviewItem[]; paydayLabel: string }) {
  const groups = groupItems(items);
  let dividerInserted = false;
  const nodes: React.ReactNode[] = [];

  for (const g of groups) {
    if (g.nextPeriod && !dividerInserted) {
      nodes.push(
        <div key="payday-boundary" role="separator" aria-label={`Next pay period, from ${paydayLabel}`} className="flex items-center gap-3 py-1.5">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Next pay period · from {paydayLabel}</span>
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>
      );
      dividerInserted = true;
    }

    nodes.push(
      // G122's bounded day-section grammar, adopted verbatim
      // (app/transactions/TransactionsPage.tsx): rounded-2xl bordered
      // section, a plain heading, hairline `divide-y` rows inside — the
      // structural change this ask is actually about. `data-day-key`
      // preserved for parity with PlanningPage.tsx's own scroll-to-day
      // deep link (?day=YYYY-MM-DD).
      <section
        key={g.label}
        data-day-key={g.dayKeyIso}
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
      >
        <h2 className="px-4 pb-1 pt-4 text-sm font-bold text-slate-950 dark:text-slate-50">{g.label}</h2>
        {g.active.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {g.active.map((item) => <Row key={item.id} item={item} />)}
          </div>
        )}
        {g.settling.length > 0 && (
          // Kevin, G124 revision (2026-09-18): "I don't think it needs a
          // title just the icon and the settling under the payment is
          // enough" — the SETTLING section title is gone, but the settling
          // rows still sit in their own trailing block (a plain border
          // stands in for the boundary the title used to carry) so they
          // keep sorting to the end of the day's group, not interleaved
          // with live rows. See groupItems() above and PlanningPage.tsx's
          // own comment on why that ordering exists.
          <div className={g.active.length > 0 ? "border-t border-slate-100 dark:border-slate-700" : ""}>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {g.settling.map((item) => <Row key={item.id} item={item} />)}
            </div>
          </div>
        )}
      </section>
    );
  }

  return <div className="space-y-3">{nodes}</div>;
}
