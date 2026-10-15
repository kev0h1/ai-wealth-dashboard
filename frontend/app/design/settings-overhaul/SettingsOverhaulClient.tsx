"use client";

// TEMPORARY PREVIEW, G201 settings overhaul design round.
// Static fixtures only. No API requests, nothing saves, no production edits.
// /design/settings-overhaul?variant=d|e|f&page=hub|<page>&state=ready|attention|relay|empty&mode=light|dark[&sheet=pay-period|financial][&chrome=0]
//
// Production components rendered here through props: Toggle, ConfirmDialog,
// SheetFrame, PayPeriodSettingsSheet, YourPlanCard, CoverPlanSourcesCard and
// the real TUTORIAL_FLOWS list. Hand-authored stand-ins: the hub rows, groups
// and page frames (ui.tsx), and the forms and notification, sign-in, profile,
// biometric, data and delete blocks (sections.tsx), because those are inline
// JSX inside app/settings/SettingsPage.tsx and cannot be imported.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import PayPeriodSettingsSheet from "@/components/PayPeriodSettingsSheet";
import { SheetFrame } from "@/components/SheetFrame";
import type { PayPeriodConfig } from "@/lib/payPeriod";
import { buildModel, INK, PreviewCtx, SOFT, type Mode, type PState, type VariantId } from "./ui";
import { FinancialBlock } from "./sections";
import { HUBS, PAGES, PageView, VARIANT_NOTES } from "./variants";

const VARIANTS: VariantId[] = ["d", "e", "f", "a", "b", "c"];
const STATES: { id: PState; label: string }[] = [
  { id: "ready", label: "Ready" },
  { id: "attention", label: "Alert" },
  { id: "blocked", label: "Blocked" },
  { id: "relay", label: "Apple relay" },
  { id: "empty", label: "New, web" },
];

function ordinal(d: number) {
  return `${d}${d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"}`;
}

function payLabelOf(c: PayPeriodConfig): string {
  switch (c.type) {
    case "calendar_month": return "Calendar month";
    case "monthly_pay_date": return `Monthly · ${ordinal(c.day)}`;
    case "biweekly": return "Every two weeks";
    case "last_weekday_of_month": return "Last weekday";
    case "last_friday": return "Last Friday";
    default: return "Custom";
  }
}

const pill = "flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export default function SettingsOverhaulClient() {
  const params = useSearchParams();
  const rawV = params.get("variant");
  const variant: VariantId = VARIANTS.includes(rawV as VariantId) ? (rawV as VariantId) : "d";
  const rawS = params.get("state");
  const state: PState = STATES.some((s) => s.id === rawS) ? (rawS as PState) : "ready";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const rawPage = params.get("page") ?? "hub";
  const page = rawPage !== "hub" && PAGES[variant][rawPage] ? rawPage : "hub";
  const showChrome = params.get("chrome") !== "0";

  const [sheet, setSheet] = useState<string | null>(params.get("sheet"));
  const [pay, setPay] = useState<PayPeriodConfig>({ type: "monthly_pay_date", day: 25 });
  const [search, setSearch] = useState("");
  const [prefs, setPrefs] = useState({ dark: mode === "dark", hideBalances: true, showTips: true });
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [returnY, setReturnY] = useState(0);
  const effectiveMode: Mode = prefs.dark ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", effectiveMode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", effectiveMode);
  }, [effectiveMode]);

  useEffect(() => {
    if (page === "hub" && returnY) window.requestAnimationFrame(() => window.scrollTo({ top: returnY, behavior: "auto" }));
  }, [page, returnY]);

  const model = useMemo(() => buildModel(state), [state]);
  const href = (p: string, extra?: Record<string, string>) => {
    const q = new URLSearchParams({ variant, page: p, state, mode, ...(showChrome ? {} : { chrome: "0" }), ...extra });
    return `?${q.toString()}`;
  };
  const ctx = { variant, page, state, mode: effectiveMode, model, href, openSheet: setSheet, payLabel: payLabelOf(pay), search, setSearch, prefs, setPrefs, openChapter, setOpenChapter, returnY, setReturnY };
  const Hub = HUBS[variant];
  const note = VARIANT_NOTES[variant];
  const hubVisible = page === "hub";

  return (
    <PreviewCtx.Provider value={ctx}>
      <div className={effectiveMode === "dark" ? "dark" : ""}>
        <div className="min-h-dvh overflow-x-hidden bg-[#f0f2f7] pb-16 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
          {showChrome && (
            <nav aria-label="Preview controls" className="mx-auto w-full max-w-5xl px-4 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/design" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl pr-2 text-sm font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300">
                  <ArrowLeft size={16} aria-hidden="true" />
                  Design
                </Link>
                <div className="flex items-center gap-1 rounded-xl bg-slate-900 p-1 dark:border dark:border-slate-700">
                  {VARIANTS.map((v) => (
                    <Link key={v} href={`?${new URLSearchParams({ variant: v, state, mode }).toString()}`} aria-current={v === variant ? "page" : undefined} className={`${pill} ${v === variant ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"}`}>
                      {v.toUpperCase()}
                    </Link>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
                  {STATES.map((s) => (
                    <Link key={s.id} href={`?${new URLSearchParams({ variant, page, state: s.id, mode }).toString()}`} aria-current={s.id === state ? "true" : undefined} className={`${pill} ${s.id === state ? "bg-slate-100 text-slate-950 dark:bg-slate-700 dark:text-white" : "text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"}`}>
                      {s.label}
                    </Link>
                  ))}
                  <Link href={`?${new URLSearchParams({ variant, page, state, mode: mode === "dark" ? "light" : "dark" }).toString()}`} className={`${pill} text-slate-700 dark:text-slate-300`}>
                    {mode === "dark" ? "Light" : "Dark"}
                  </Link>
                </div>
              </div>
            </nav>
          )}

          <main className="mx-auto w-full max-w-md px-4 pt-6 lg:grid lg:max-w-5xl lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-14">
            <div className={hubVisible ? "" : "hidden lg:block"}>
              <Hub />
            </div>
            <div className={hubVisible ? "hidden lg:block" : ""}>
              {hubVisible ? (
                <p className={`mt-24 text-sm ${SOFT}`}>Choose a setting to see its page here.</p>
              ) : (
                <PageView variant={variant} page={page} />
              )}
            </div>
          </main>

          {showChrome && (
            <div className="mx-auto mt-12 w-full max-w-md px-4 lg:max-w-5xl" role="region" aria-label="About this direction">
              <div className="border-t border-slate-300/80 pt-5 dark:border-slate-700">
                <h2 className={`text-base font-bold ${INK}`}>{note.name}</h2>
                <p className={`mt-2 text-sm leading-6 ${INK}`}>{note.thesis}</p>
                <p className={`mt-2 text-sm leading-6 ${SOFT}`}>Trade-off: {note.tradeoff}</p>
                <p className={`mt-2 text-sm leading-6 ${SOFT}`}>{note.inline}</p>
                <p className={`mt-2 text-sm leading-6 ${SOFT}`}>{note.exits}</p>
                <p className={`mt-4 text-xs leading-5 ${SOFT}`}>
                  Fixture preview only. It makes no API calls and never saves a preference, sends a notification, changes a sign-in method, signs out or deletes an account. Production components rendered through local props: switches, confirm dialogs, sheet frame, the Pay period sheet, plan card, cover-plan card and tour list. Inline Settings blocks are honestly represented as local stand-ins. Connected assistants remains flag-gated and is off in production.
                </p>
              </div>
            </div>
          )}
          {!showChrome && <p role="note" className={`mx-auto mt-6 w-full max-w-md px-4 text-xs leading-5 ${SOFT}`}>Fixture preview only. Nothing here saves, sends a notification, changes sign-in, signs out or deletes an account.</p>}

          {sheet === "pay-period" && (
            <PayPeriodSettingsSheet current={pay} onClose={() => setSheet(null)} onSave={(c) => { setPay(c); setSheet(null); }} />
          )}
          {sheet === "financial" && (
            <SheetFrame
              title="Financial profile"
              onClose={() => setSheet(null)}
              themeClass={effectiveMode === "dark" ? "dark" : undefined}
              bodyClassName="px-0 py-2"
              footer={
                <button type="button" onClick={() => setSheet(null)} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors active:scale-[0.98]">
                  Save financial profile
                </button>
              }
            >
              <FinancialBlock bare />
            </SheetFrame>
          )}
        </div>
      </div>
    </PreviewCtx.Provider>
  );
}
