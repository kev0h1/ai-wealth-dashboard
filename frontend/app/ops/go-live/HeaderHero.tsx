"use client";

// The page hero: overall done/total progress plus five small at-a-glance
// figures (P1 open, blocked, in review, rejected, UAT) computed from the
// unfiltered board so they always read as the whole picture, not the
// current filter. Rejected reads amber like Blocked, never red: a
// rejection is a reviewer asking for a decision, not a failure (see
// DESIGN.md "The Red Is Risk Rule"). UAT reads the same amber, "waiting
// on you", never a failure either (see H31).

import { Moon, Sun } from "lucide-react";
import Toggle from "@/components/Toggle";
import { usePreferences } from "@/components/PreferencesContext";
import { headerFigures, type GoLiveItem } from "@/lib/goLive";

export function HeaderHero({ items, done, total }: { items: GoLiveItem[]; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const { p1Open, blocked, inReview, rejected, uat } = headerFigures(items);
  // H69: the board deliberately has no nav, and the Board Android app
  // (H66) wraps nothing but this page, so this toggle is the only path to
  // dark mode when reached that way. It is wired straight to
  // PreferencesContext's setDarkMode, the same server-backed `dark_mode`
  // preference and `wd_dark` localStorage key SettingsPage.tsx's own "Dark
  // Mode" toggle already owns (components/Toggle.tsx, reused here rather
  // than a second control), never a new preference or a second source of
  // truth: toggling here updates Settings and the reverse, and both read
  // the same context. `darkMode` initialises synchronously from
  // localStorage (see PreferencesContext's own useState initialiser
  // comment, matching the no-flash inline script in app/layout.tsx), so
  // unlike balances, which mask until `preferencesReady` resolves
  // (PreferencesContext's own docstring on that field), there is no wrong
  // state to gate here — the value is already correct at first paint, and
  // SettingsPage's own toggle does not gate on `preferencesReady` either.
  const { darkMode, setDarkMode } = usePreferences();

  return (
    <div className="glass-hero rounded-3xl p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Backlog progress</p>
        <div className="flex items-center gap-1.5">
          {darkMode ? (
            <Moon size={14} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
          ) : (
            <Sun size={14} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
          )}
          <Toggle checked={darkMode} onChange={() => setDarkMode(!darkMode)} label="Dark mode" />
        </div>
      </div>
      <p className="money mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
        {done} of {total} done
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-5 gap-3">
        <div>
          <p className="money text-lg font-bold text-amber-700 dark:text-amber-300">{p1Open}</p>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">P1 open</p>
        </div>
        <div>
          <p className="money text-lg font-bold text-amber-700 dark:text-amber-300">{blocked}</p>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Blocked</p>
        </div>
        <div>
          <p className="money text-lg font-bold text-indigo-700 dark:text-indigo-300">{inReview}</p>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">In review</p>
        </div>
        <div>
          <p className="money text-lg font-bold text-amber-700 dark:text-amber-300">{rejected}</p>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Rejected</p>
        </div>
        <div>
          <p className="money text-lg font-bold text-amber-700 dark:text-amber-300">{uat}</p>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">UAT</p>
        </div>
      </div>
    </div>
  );
}
