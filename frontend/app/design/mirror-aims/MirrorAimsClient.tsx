"use client";

// G242 design round, skills: impeccable (primary), web-design-guidelines
// (final audit). Three variants of one journey, every one rendering the
// PRODUCTION components with fixture data through optional props:
//   Spend rows        SpendVerdictView / MajorityRowView (aims, aimStyle, aimOffer)
//   Category sheet    CategorySheet (aimSlot) + CategoryAimSection
//   Aim editor        AimSheet (baseline, existingAmount, onSubmit, onRemove)
//   Mirror trait card TraitCard (nextStep, saveChoice, refined) + MirrorNextStep
//   Penny nudge       AimNudgeCard
//   Route to Mirror   MirrorRouteLink
// Not rendered here: the Spend hero and the "New normal" consent sheet (the
// first is out of scope for this round, the second fetches its own copy). The
// title row below is a stand-in for the hero and is not a proposal.
//
// Deep links: ?variant=a|b|c&mode=light|dark&state=spend|category|aim|mirror|step|nudge&chrome=0

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import SpendVerdictView from "@/components/SpendVerdictView";
import CategorySheet from "@/components/CategorySheet";
import CategoryAimSection from "@/components/CategoryAimSection";
import AimSheet from "@/components/AimSheet";
import AimNudgeCard from "@/components/AimNudgeCard";
import MirrorRouteLink from "@/components/MirrorRouteLink";
import MirrorNextStep from "@/components/MirrorNextStep";
import PennyMark from "@/components/PennyMark";
import { TraitCard } from "@/app/mirror/MirrorPage";
import { aimPace } from "@/lib/aimPace";
import type { AimRowStyle } from "@/components/AimProgress";
import type { ActiveAim, Checkpoint, MirrorTrait } from "@/lib/api";
import { EATING_OUT_TXNS, PERIOD_DAYS, SPENT, TRAITS, USUAL, aimFor, suggestedAim, verdictFor } from "./fixtures";

type Variant = "a" | "b" | "c";
type Screen = "spend" | "mirror";
type PreviewState = "spend" | "category" | "aim" | "mirror" | "step" | "nudge";
const STATES: PreviewState[] = ["spend", "category", "aim", "mirror", "step", "nudge"];
const STATE_LABEL: Record<PreviewState, string> = {
  spend: "Spend", category: "Category sheet", aim: "Aim editor", mirror: "Mirror", step: "Next step", nudge: "Penny nudge",
};

interface VariantConfig {
  name: string;
  summary: string;
  rowStyle: AimRowStyle;
  /** B only: one row offers "Set an aim of about £X" and rule rows open the editor directly. */
  rowOpensEditor: boolean;
  offerOnRow: boolean;
  route: "row" | "outlined" | "pill";
  nextStep: "inline" | "penny";
  /** C only: "change it" opens the aim editor at once, with the inline step as the fallback. */
  autoOpenEditor: boolean;
}

const CONFIG: Record<Variant, VariantConfig> = {
  a: {
    name: "A · Quiet line",
    summary: "Progress is one quiet line under the payment count. Setting, editing and removing live in the category sheet. The route back is a low row after the categories. Change it shows a plain next step in the trait card.",
    rowStyle: "line", rowOpensEditor: false, offerOnRow: false, route: "row", nextStep: "inline", autoOpenEditor: false,
  },
  b: {
    name: "B · Pace rule",
    summary: "A thin rule under the row with a tick for an even pace today. One row offers an aim in a tap, the rule opens the editor. The route back is an outlined row above the categories. Change it is a one-tap Penny step.",
    rowStyle: "rule", rowOpensEditor: true, offerOnRow: true, route: "outlined", nextStep: "penny", autoOpenEditor: false,
  },
  c: {
    name: "C · Pocket ring",
    summary: "A small ring beside the amount, the sentence in the subline. Setting and editing live in the category sheet. The route back is a pill under the title. Change it opens the aim editor at once.",
    rowStyle: "ring", rowOpensEditor: false, offerOnRow: false, route: "pill", nextStep: "inline", autoOpenEditor: true,
  },
};

type Sheet = { kind: "category" | "aim"; category: string } | null;

export default function MirrorAimsClient() {
  const params = useSearchParams();
  const variant: Variant = (["a", "b", "c"] as const).includes(params.get("variant") as Variant) ? (params.get("variant") as Variant) : "a";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const state: PreviewState = STATES.includes(params.get("state") as PreviewState) ? (params.get("state") as PreviewState) : "spend";
  const chrome = params.get("chrome") !== "0";
  const cfg = CONFIG[variant];

  useEffect(() => {
    const el = document.documentElement;
    const wasDark = el.classList.contains("dark");
    const scheme = el.style.colorScheme;
    el.classList.toggle("dark", mode === "dark");
    el.style.colorScheme = mode;
    return () => { el.classList.toggle("dark", wasDark); el.style.colorScheme = scheme; };
  }, [mode]);

  const eatingOutSpent = state === "nudge" ? 96 : SPENT["Eating Out"];
  const verdict = useMemo(() => verdictFor(eatingOutSpent), [eatingOutSpent]);

  const [screen, setScreen] = useState<Screen>(state === "mirror" || state === "step" ? "mirror" : "spend");
  const [aims, setAims] = useState<Record<string, Checkpoint>>(() => {
    const base: Record<string, Checkpoint> = { Groceries: aimFor(240, SPENT.Groceries, "fixture-aim-groceries") };
    if (state === "nudge") base["Eating Out"] = aimFor(100, 96, "fixture-aim-eating-out");
    return base;
  });
  const [sheet, setSheet] = useState<Sheet>(
    state === "category" ? { kind: "category", category: "Eating Out" }
      : state === "aim" ? { kind: "aim", category: "Eating Out" }
      : null
  );
  const [traits, setTraits] = useState<MirrorTrait[]>(() =>
    TRAITS.map((t) => ((state === "step" || state === "nudge") && t.ref_category ? { ...t, choice: "change" } : t))
  );
  const [nudgeShown, setNudgeShown] = useState(true);

  function saveAim(category: string, amount: number | undefined) {
    const amt = amount ?? suggestedAim(category) ?? 100;
    setAims((prev) => ({ ...prev, [category]: aimFor(amt, SPENT[category] ?? 0, `fixture-aim-${category}`) }));
  }
  function removeAim(category: string) {
    setAims((prev) => { const next = { ...prev }; delete next[category]; return next; });
    setSheet(null);
  }
  function goSpend() {
    setScreen("spend");
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  const editorFor = (category: string) => setSheet({ kind: "aim", category });
  const openForRow = (category: string) =>
    cfg.rowOpensEditor ? editorFor(category) : setSheet({ kind: "category", category });

  // ── Spend ──────────────────────────────────────────────────────────────
  const eatingAim = aims["Eating Out"];
  const nudgeAim = eatingAim && aimPace(eatingAim, PERIOD_DAYS).state === "likely" ? eatingAim : null;
  const eatingTrait = traits.find((t) => t.ref_category === "Eating Out");
  const nudgeAllowed = nudgeAim != null && eatingTrait?.choice === "change" && nudgeShown;
  const showNudge = nudgeAllowed;
  const nudgePace = nudgeAim ? aimPace(nudgeAim, PERIOD_DAYS) : null;

  const route = <MirrorRouteLink variant={cfg.route === "row" ? "row" : cfg.route === "outlined" ? "outlined" : "pill"} href="/mirror" onNavigate={() => setScreen("mirror")} />;

  const spend = (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">Spend</h1>
          <p className="mt-0.5 text-[13px] text-slate-600 dark:text-slate-400">28 Sep to 25 Oct · day 22</p>
        </div>
      </div>
      {cfg.route === "pill" && <div className="-ml-3 mt-1">{route}</div>}

      {showNudge && nudgeAim && nudgePace && (
        <div className="mt-4">
          <AimNudgeCard
            category="Eating Out"
            traitTitle={eatingTrait?.title.replace(/^Your Signature:\s*/i, "") ?? "Eating Out"}
            aimAmount={nudgeAim.aim_amount}
            spentSoFar={nudgeAim.spent_so_far}
            projected={nudgeAim.spent_so_far / nudgePace.elapsedFraction}
            daysLeft={nudgeAim.days_left}
            onOpen={() => setSheet({ kind: "category", category: "Eating Out" })}
            onDismiss={() => setNudgeShown(false)}
          />
        </div>
      )}

      <div className="mt-3">
        <SpendVerdictView
          verdict={verdict}
          colours={{}}
          hideReading
          onOpenCategory={openForRow}
          onIntent={async () => {}}
          onNewNormalRequest={() => {}}
          aims={aims}
          aimStyle={cfg.rowStyle}
          aimPeriodDays={PERIOD_DAYS}
          aimOffer={cfg.offerOnRow && !aims["Eating Out"] ? { category: "Eating Out", amount: suggestedAim("Eating Out") ?? 100 } : null}
          onAimAction={cfg.rowOpensEditor ? editorFor : undefined}
          aboveMajority={cfg.route === "outlined" ? <div className="mb-3">{route}</div> : undefined}
        />
      </div>
      {cfg.route === "row" && <div className="mt-4 border-t border-slate-200 pt-1 dark:border-slate-700">{route}</div>}
    </div>
  );

  // ── Mirror ─────────────────────────────────────────────────────────────
  const mirror = (
    <div>
      <button
        type="button"
        onClick={goSpend}
        className="mb-3 flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-600 transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300"
      >
        <ChevronLeft size={15} aria-hidden="true" />
        Back to Spend
      </button>
      <div className="flex items-start justify-between">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-400">THE MIRROR</p>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">How your money behaves</h1>
        </div>
        <div className="mt-1 flex size-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/30">
          <PennyMark size={16} className="text-indigo-500" />
        </div>
      </div>
      <p className="mb-5 mt-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
        Computed from your last 6 months of transactions. No judgement, just what the data says.
      </p>
      <div className="space-y-4">
        {traits.map((trait) => {
          const cat = trait.ref_category ?? null;
          const aim = cat ? aims[cat] : undefined;
          const activeAim: ActiveAim | null = cat && aim ? { ...aim, ref: cat } : null;
          const amount = cat ? suggestedAim(cat) ?? 100 : 100;
          return (
            <TraitCard
              key={trait.id}
              trait={trait}
              activeAim={activeAim}
              refined
              saveChoice={async () => {}}
              openAimOnChange={cfg.autoOpenEditor}
              onChoice={(id, choice) => setTraits((prev) => prev.map((t) => (t.id === id ? { ...t, choice } : t)))}
              onSetAim={(c) => editorFor(c)}
              keepNote={<>That is part of how you do things, so I will leave it alone.</>}
              nextStep={cat ? (
                <MirrorNextStep
                  layout={cfg.nextStep}
                  category={cat}
                  amount={aim ? aim.aim_amount : amount}
                  status={aim ? "done" : "open"}
                  onAct={() => (cfg.nextStep === "penny" ? saveAim(cat, undefined) : editorFor(cat))}
                  onSeeSpend={goSpend}
                />
              ) : undefined}
            />
          );
        })}
      </div>
    </div>
  );

  const sheetCategory = sheet?.category ?? "";
  const sheetAim = sheet ? aims[sheetCategory] : undefined;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] pb-28 dark:bg-[#0f172a]">
        {chrome && (
          <nav aria-label="Preview controls" className="border-b border-slate-200 px-4 py-2 text-[12px] text-slate-600 dark:border-slate-700 dark:text-slate-400">
            <p className="font-semibold text-slate-800 dark:text-slate-100">{cfg.name}</p>
            <p className="mt-0.5 leading-snug">{cfg.summary}</p>
            <p className="mt-1 flex flex-wrap gap-x-3">
              {(["a", "b", "c"] as const).map((v) => (
                <a key={v} className="inline-flex min-h-[44px] items-center font-semibold text-indigo-700 dark:text-indigo-300" href={`?variant=${v}&mode=${mode}&state=${state}`}>Variant {v.toUpperCase()}</a>
              ))}
              <a className="inline-flex min-h-[44px] items-center font-semibold text-indigo-700 dark:text-indigo-300" href={`?variant=${variant}&mode=${mode === "dark" ? "light" : "dark"}&state=${state}`}>{mode === "dark" ? "Light" : "Dark"}</a>
              {STATES.map((s) => (
                <a key={s} className="inline-flex min-h-[44px] items-center font-semibold text-indigo-700 dark:text-indigo-300" href={`?variant=${variant}&mode=${mode}&state=${s}`}>{STATE_LABEL[s]}</a>
              ))}
            </p>
          </nav>
        )}
        <main className="mx-auto w-full max-w-[430px] px-4 pt-5">
          {screen === "spend" ? spend : mirror}
        </main>

        {sheet?.kind === "category" && (
          <CategorySheet
            name={sheetCategory}
            total={sheetCategory === "Eating Out" ? eatingOutSpent : SPENT[sheetCategory] ?? 0}
            count={sheetCategory === "Eating Out" ? EATING_OUT_TXNS.length : 0}
            transactions={sheetCategory === "Eating Out" ? EATING_OUT_TXNS : []}
            onClose={() => setSheet(null)}
            onTransactionClick={() => {}}
            aimSlot={
              <CategoryAimSection
                category={sheetCategory}
                aim={sheetAim ?? null}
                suggestedAim={suggestedAim(sheetCategory)}
                periodDays={PERIOD_DAYS}
                onOpenEditor={() => editorFor(sheetCategory)}
              />
            }
          />
        )}
        {sheet?.kind === "aim" && (
          <AimSheet
            key={`${sheetCategory}-${sheetAim ? "edit" : "new"}`}
            category={sheetCategory}
            baseline={{ usual: USUAL[sheetCategory] ?? null, suggestedAim: sheetAim ? sheetAim.aim_amount : suggestedAim(sheetCategory) }}
            existingAmount={sheetAim?.aim_amount}
            onSubmit={(amount) => saveAim(sheetCategory, amount)}
            onRemove={() => removeAim(sheetCategory)}
            onClose={() => setSheet(null)}
          />
        )}
      </div>
    </div>
  );
}
