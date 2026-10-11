"use client";

// The aim block on the transactions hub (G242, approved C 2026-10-11). A row,
// not a card, in the same grammar as the tips line beneath it. An aim is a
// PACE CHECK, not a budget: it never blocks, never moralises and no state is
// red or amber. Without an aim: one quiet 44px row. With one: the 32px ring,
// "£82 of a £100 aim · on pace", the even-pace line and a 44px
// "Edit or remove this aim". AimSheet stays the editor. Pace figures come
// from the server (lib/aimPace.ts reads them), never from a model.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Target } from "lucide-react";
import { api, type Checkpoint } from "@/lib/api";
import AimSheet from "@/components/AimSheet";
import { AimRing } from "@/components/AimProgress";
import MoneyText from "@/components/MoneyText";
import { aimPace } from "@/lib/aimPace";
import { fmtWhole } from "@/lib/aimFormat";
import { hubAimEligible, type HubAimScope } from "@/lib/hubAim";
import { invalidateSignalsCache } from "@/lib/signalsCache";

export interface HubAimProps {
  category: string;
  aim: Checkpoint | null;
  suggestedAim: number | null;
  periodDays: number;
  sym?: string;
  /** Opens the aim editor (set when there is no aim, edit or remove when there is). */
  onOpenEditor: () => void;
}

export function HubAim({ category, aim, suggestedAim, periodDays, sym = "£", onOpenEditor }: HubAimProps) {
  if (!aim) {
    return (
      <button
        type="button"
        onClick={onOpenEditor}
        className="flex min-h-[44px] w-full items-start gap-2.5 py-2.5 text-left transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Target size={14} className="mt-0.5 flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-slate-600 dark:text-slate-400">
          {suggestedAim != null
            ? <MoneyText text={`A pace to check ${category} against? Your usual would put it near ${fmtWhole(suggestedAim, sym)} a period.`} />
            : `A pace to check ${category} against?`}
          {" "}
          <span className="font-semibold text-indigo-700 dark:text-indigo-300">Set an aim</span>
        </span>
        <ChevronRight size={14} className="mt-0.5 flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
      </button>
    );
  }
  const p = aimPace(aim, periodDays);
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 flex-shrink-0 [&>svg]:h-8 [&>svg]:w-8"><AimRing aim={aim} periodDays={periodDays} sym={sym} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <MoneyText text={`${fmtWhole(aim.spent_so_far, sym)} of a ${fmtWhole(aim.aim_amount, sym)} aim`} />
          <span className="font-normal text-slate-600 dark:text-slate-400"> · {p.phrase}</span>
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-slate-600 dark:text-slate-400">
          <MoneyText text={`An even pace would be about ${fmtWhole(p.paceToday, sym)} by today.`} /> A pace check, not a limit.
        </p>
        <button
          type="button"
          onClick={onOpenEditor}
          className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-indigo-700 transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"
        >
          Edit or remove this aim
        </button>
      </div>
    </div>
  );
}

interface Loaded {
  period: { start: string; end: string; days: number };
  aim: Checkpoint | null;
  suggestedAim: number | null;
}

/** The hub's live aim block: reads this category's current-period signal, renders
 *  nothing unless the hub scope is a single category on the current period, and
 *  owns the editor (AimSheet) for set, edit and remove. */
export default function HubAimSection({ scope, sym = "£" }: { scope: HubAimScope; sym?: string }) {
  const category = scope.categoryFilter;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    if (!category) return Promise.resolve();
    return api.categorySignals(0)
      .then((d) => {
        const sig = d.signals?.[category];
        const days = d.period.period_days ?? d.period.days_elapsed + (d.period.days_left ?? 0);
        setLoaded({
          period: { start: d.period.start, end: d.period.end, days: days || 28 },
          aim: sig?.checkpoint ?? null,
          suggestedAim: sig?.suggested_aim ?? null,
        });
      })
      .catch(() => setLoaded(null));
  }, [category]);

  useEffect(() => { setLoaded(null); load(); }, [load]);

  if (!category || !loaded || !hubAimEligible(scope, loaded.period)) return null;

  const changed = () => { invalidateSignalsCache(); return load(); };
  const aim = loaded.aim;

  return (
    <>
      <HubAim
        category={category}
        aim={aim}
        suggestedAim={loaded.suggestedAim}
        periodDays={loaded.period.days}
        sym={sym}
        onOpenEditor={() => setEditing(true)}
      />
      {editing && (
        <AimSheet
          key={`${category}-${aim ? "edit" : "new"}`}
          category={category}
          existingAmount={aim?.aim_amount}
          onSaved={() => { void changed(); }}
          onSubmit={aim ? async (amount) => {
            if (amount != null) await api.updateCheckpoint(aim.id, amount);
            await changed();
          } : undefined}
          onRemove={aim ? async () => {
            await api.cancelCheckpoint(aim.id);
            setEditing(false);
            await changed();
          } : undefined}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
