"use client";

// G124 ask #3, three genuinely different answers to "it reads cluttered"
// (Kevin: "Set aside actually has them together but again it's more the
// content makes it cluttered"). All three start from the SAME data
// (fixtures.ts's ALLOCATIONS, including the two exact clutter examples
// Kevin named: a bare-number title and a long shouty raw bank string) and
// the same hygiene fixes (setAsideHelpers.ts: word-safe truncation, title
// casing, a card string collapsed to "Brand •• 1234"), but disagree on
// WHERE the secondary detail (cadence, fill progress, the raw feed string)
// should live:
//   A — Tightened ledger: today's shape, kept, with the typography/
//       truncation fixes applied in place. Every line still always shows.
//   B — Compact chip: the raw feed identity moves off its own caption line
//       into a small pill, shrinking the row to two lines in the common
//       case.
//   C — Progressive disclosure: the row collapses to title + amount + a
//       slim progress bar by default (the DESIGN.md "Progress Bars"
//       signature component, not currently used on this card at all);
//       cadence and the fed-by line only appear once the row is opened,
//       using the same grid-template-rows convention DESIGN.md's folded-
//       ladder and card-resolve-lifecycle sections already establish.
import { useState } from "react";
import { Wallet, ChevronDown } from "lucide-react";
import type { PreviewAllocation } from "./fixtures";
import { titleFor, humanizeRaw, fmtC, cadenceLabel, statusFor } from "./setAsideHelpers";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
      {children}
    </div>
  );
}

function WalletChip() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">
      <Wallet size={15} aria-hidden="true" />
    </span>
  );
}

// ── Variant A — Tightened ledger ────────────────────────────────────────
export function SetAsideA({ allocations }: { allocations: PreviewAllocation[] }) {
  return (
    <Shell>
      {allocations.map((a) => {
        const { primary, tag } = titleFor(a);
        const { detail, amount } = statusFor(a);
        const feed = humanizeRaw(a.feedRaw, 30);
        return (
          <div key={a.id} className="flex min-h-[64px] items-center gap-3 px-3.5 py-2.5">
            <WalletChip />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{primary}</span>
                {tag && <span className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">{tag}</span>}
                {a.createdViaPenny && <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">with Penny</span>}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{detail}</p>
              {a.feedRaw !== "Manual set aside" && (
                <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500" title={a.feedRaw}>
                  Fed by {feed}
                </p>
              )}
            </div>
            {amount && (
              <span className="shrink-0 text-right">
                <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{amount}</span>
                <span className="block text-[10px] text-slate-400 dark:text-slate-500">to reserve</span>
              </span>
            )}
          </div>
        );
      })}
    </Shell>
  );
}

// ── Variant B — Compact chip ────────────────────────────────────────────
export function SetAsideB({ allocations }: { allocations: PreviewAllocation[] }) {
  return (
    <Shell>
      {allocations.map((a) => {
        const { primary, tag } = titleFor(a);
        const remaining = Math.max(0, a.remaining);
        const complete = a.completed || remaining < 0.5;
        const amount = a.pending ? null : complete ? "£0" : `−${fmtC(remaining)}`;
        const feed = humanizeRaw(a.feedRaw, 20);
        const showFeedChip = a.feedRaw !== "Manual set aside";
        return (
          <div key={a.id} className="flex min-h-[64px] items-center gap-3 px-3.5 py-2.5">
            <WalletChip />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{primary}</span>
                {tag && <span className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">{tag}</span>}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {a.pending ? "Not started yet" : complete ? "Fully set aside" : `${fmtC(a.filledThisPeriod)} of ${fmtC(a.amountPerPeriod)}`} · {cadenceLabel(a)}
              </p>
              {showFeedChip && (
                <span
                  title={a.feedRaw}
                  className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                >
                  Fed by {feed}
                </span>
              )}
              {a.createdViaPenny && <span className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">with Penny</span>}
            </div>
            {amount && (
              <span className="shrink-0 text-right">
                <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{amount}</span>
                <span className="block text-[10px] text-slate-400 dark:text-slate-500">to reserve</span>
              </span>
            )}
          </div>
        );
      })}
    </Shell>
  );
}

// ── Variant C — Progressive disclosure ──────────────────────────────────
export function SetAsideC({ allocations }: { allocations: PreviewAllocation[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Shell>
      {allocations.map((a) => {
        const { primary, tag } = titleFor(a);
        const { detail, amount } = statusFor(a);
        const feed = humanizeRaw(a.feedRaw, 34);
        const pct = a.pending ? 0 : Math.max(0, Math.min(100, Math.round((a.filledThisPeriod / Math.max(1, a.amountPerPeriod)) * 100)));
        const isOpen = open.has(a.id);
        return (
          <div key={a.id}>
            <button
              type="button"
              onClick={() => toggle(a.id)}
              aria-expanded={isOpen}
              className="flex min-h-[64px] w-full items-center gap-3 px-3.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
            >
              <WalletChip />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{primary}</span>
                  {tag && <span className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">{tag}</span>}
                </div>
                {/* DESIGN.md "Progress Bars" signature component, not
                    currently used on this card, every budget/goal/plan is
                    meant to render one; this variant is the answer that
                    actually does. Fill is indigo, not amber: the doc's own
                    spec ties amber to a PACE judgement ("amber when above
                    pace"), and there is no pace here, an envelope simply
                    accumulates toward its target over the pay period, never
                    "behind" or "ahead". Colouring it amber regardless of
                    fill level would borrow the caution signifier for a
                    neutral fact on every single row, which is the opposite
                    of "colour is information, never decoration". Indigo
                    matches the Wallet icon chip's own colour on this same
                    row, so the fill reads as this row's identity, not a
                    warning. */}
                <div className="mt-1.5 h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <span className="shrink-0 text-right">
                {amount && <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{amount}</span>}
                <ChevronDown size={14} className={`ml-auto mt-0.5 text-slate-400 transition-transform dark:text-slate-500 ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </span>
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-200 ease-out"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              inert={!isOpen}
            >
              <div className="overflow-hidden">
                <div className="px-3.5 pb-3 pl-[52px] pr-3.5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">{detail}</p>
                  {a.feedRaw !== "Manual set aside" && (
                    <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500" title={a.feedRaw}>
                      Fed by {feed}
                    </p>
                  )}
                  {a.createdViaPenny && <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">with Penny</p>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </Shell>
  );
}
