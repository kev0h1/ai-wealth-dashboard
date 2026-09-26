"use client";

// G134 — Home surface inventory. A catalogue of every zone HomePage renders
// and every state its cards can reach, in one scrollable page, so Kevin can
// review the whole Home surface (and the brief cards' current render order)
// on his phone without needing a live account in every state. Fixtures
// only — see fixtures.ts and app/design/home-brief-cards/productionFixtures.ts
// for the data; nothing here fetches, dismisses, or writes a preference for
// real (every card is fed via props, previewMode where the real component
// takes one, dismissible=false everywhere else — see the per-zone comments
// below for exactly which write paths that closes off).
//
// /design/g134-home-inventory?mode=light|dark&state=stack-one|stack-two|stack-three|stack-all|balances-hidden
// (or the equivalent ?stack=one|two|three|all&balances=visible|hidden the page's own
// toolbar links use; see the `state` parsing below for how the two coexist)

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { usePreferences } from "@/components/PreferencesContext";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { PRODUCTION_CARD_FIXTURES, type ProductionCardKind } from "../home-brief-cards/productionFixtures";
import {
  TRAJECTORY_ITEM,
  RHYTHM_INFO_ITEM,
  OTHER_INFO_ITEM,
  NEEDLE_ITEM,
  GENERIC_ASK_ITEM,
  PAYDAY_PLAN_ACTIVE_ITEM,
  PAYDAY_PLAN_EXECUTED_ITEM,
  PAYDAY_WINDOW_SAFE_TO_SPEND,
  RECONNECT_PROVIDERS,
  RECONNECT_PROVIDERS_MULTI,
  SAFE_TO_SPEND_STATES,
  CLEARED_ADVICE,
  LEDGER_ACCOUNTS,
  LEDGER_INVESTMENT,
  LEDGER_PINNED_IDS,
  RECENT_TRANSACTIONS,
  PINNED_WIDGET_TRANSACTIONS,
  ACCOUNT_ELIGIBILITY,
} from "./fixtures";
import HomeBrief, {
  BriefBody,
  CelebrationCard,
  CliffCard,
  RhythmCard,
  IntentPaceCard,
  UnfundedMoveCard,
  AskPaydayCard,
  AskGenericCard,
  MoveCard,
  HomeBriefClearedRow,
  PaydayPlanSection,
} from "@/components/HomeBrief";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import ReconnectStrip from "@/components/ReconnectStrip";
import { PinnedWidgetCard, DEFAULT_HOME_PINNED_WIDGET } from "@/components/SpendTrends";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import TransactionRow from "@/components/TransactionRow";
import TeachingSheet from "@/components/TeachingSheet";
import { bankToRow, investmentToRow } from "@/lib/accountsEstate";
import { bestSpendAccount } from "@/lib/spendFromAccount";
import { getPayPeriodWithConfig, DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";
import { useColours } from "@/components/ColourProvider";
import type { CompanionItem, Transaction } from "@/lib/api";

type Mode = "light" | "dark";
type Balances = "visible" | "hidden";
type Stack = "one" | "two" | "three" | "all";

const STACKS: Stack[] = ["one", "two", "three", "all"];
const STACK_LABEL: Record<Stack, string> = { one: "1 card", two: "2 cards", three: "3 cards", all: "Everything" };

function noop() {}
const identity = (t: string) => t;
// Mirrors BriefBody's own masking regex (components/HomeBrief.tsx, "Mask £
// figures in a string when hideNetWorth is on") so the labelled catalogue
// entries below mask exactly as the real component does when it builds its
// own maskAmounts closure internally.
const hiddenMaskAmounts = (t: string) => t.replace(/£[\d,]+(?:\.\d+)?/g, "£••••");

// SSR renders this client component on the server too, where
// useLayoutEffect is a no-op and React warns about it; useEffect there
// instead is silent and irrelevant, since the fetch stand-in below only
// ever needs to exist in the browser. Same pattern as g88-home-real and
// g115-spend-from-accounts.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function hrefFor({ mode, balances, stack }: { mode: Mode; balances: Balances; stack: Stack }) {
  return `?mode=${mode}&balances=${balances}&stack=${stack}`;
}

// ── Zone chrome — labels the catalogue by real Home render position ──────

function ZoneHeading({ order, title, source }: { order: string; title: string; source: string }) {
  return (
    <div className="mb-3 border-b border-slate-200 pb-2 dark:border-slate-700">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo-500 dark:text-indigo-400">{order}</p>
      <h2 className="text-[17px] font-bold text-slate-950 dark:text-white">{title}</h2>
      <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{source}</p>
    </div>
  );
}

function CatalogueEntry({ component, condition, children }: { component: string; condition: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5">
        <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">{component}</span>
        <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{condition}</span>
      </div>
      {children}
    </div>
  );
}

function StsEntry({ fixture }: { fixture: (typeof SAFE_TO_SPEND_STATES)[number] }) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5">
        <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">{fixture.label}</span>
        <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{fixture.note}</span>
      </div>
      <SafeToSpendCard
        data={fixture.data}
        loading={fixture.loading}
        error={fixture.error}
        onRetry={noop}
        spendFrom={fixture.key === "comfortable" ? bestSpendAccount(ACCOUNT_ELIGIBILITY, LEDGER_ACCOUNTS) : undefined}
      />
      {fixture.key === "hidden" && (
        <p className="mt-1.5 px-0.5 text-[11px] italic text-slate-400 dark:text-slate-500">
          hideNetWorth is one global preference (PreferencesContext), not a per-card prop — toggle
          the Balances control below to mask every figure on this page, this card included, exactly
          like Home.
        </p>
      )}
    </div>
  );
}

export default function HomeInventoryClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { colours } = useColours();
  const { preferencesReady, setHideNetWorth } = usePreferences();

  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  // The /design index's PreviewCard emits every state chip as `?state=<value>`
  // (see app/design/page.tsx's ROUTES entry for this preview: stack-all,
  // stack-one, stack-two, stack-three, balances-hidden). This preview's own
  // bottom toolbar instead links with the two separate `?stack=` and
  // `?balances=` params it always used. `state` is read first and, when
  // present, wins; `stack`/`balances` remain the fallback so the toolbar's
  // own links (and any old direct link using them) keep working. Without
  // this, every index chip fell back to the same bare default and rendered
  // byte-identical previews, which was the rejected defect (1).
  const rawState = params.get("state");
  const stateStack: Stack | null =
    rawState === "stack-all" ? "all"
    : rawState === "stack-one" ? "one"
    : rawState === "stack-two" ? "two"
    : rawState === "stack-three" ? "three"
    : null;
  const stateBalancesHidden = rawState === "balances-hidden";

  const rawBalances = params.get("balances");
  const balances: Balances = stateBalancesHidden || rawBalances === "hidden" ? "hidden" : "visible";
  const rawStack = params.get("stack");
  const stack: Stack = stateStack ?? ((STACKS as string[]).includes(rawStack ?? "") ? (rawStack as Stack) : "all");

  const hidden = balances === "hidden";
  const maskAmounts = hidden ? hiddenMaskAmounts : identity;

  // Defect (2): balances=hidden used to only relabel this preview's own
  // toolbar button. Every card was fed the hardcoded literals
  // maskAmounts={identity} and hideNetWorth={false} regardless of the URL,
  // and SafeToSpendCard read hideNetWorth from
  // PreferencesContext directly, which this preview never touched, so
  // nothing actually masked. /design is signed out, and PreferencesProvider
  // (app/Providers.tsx, wraps the whole app including this route) owns its
  // own state from an always-401ing GET/PATCH /preferences, which is the
  // same trap G88 and G115 hit and fixed the same way: intercept only this
  // preview's own /preferences round trip so the real setHideNetWorth()
  // write always succeeds instead of reverting, then drive it for real.
  // Every card below now reads the resulting `hidden`/`maskAmounts` through
  // its own real props, and SafeToSpendCard picks the same value up for
  // real through context.
  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const nativeFetch = window.fetch.bind(window);
    const isPreferencesRequest = (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return /\/preferences(?:[/?]|$)/.test(url);
    };
    let version = 0;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (!isPreferencesRequest(input)) return nativeFetch(input, init);
      version += 1;
      return new Response(JSON.stringify({ hide_net_worth: hidden, version }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof window.fetch;
    return () => {
      window.fetch = nativeFetch;
    };
  }, [hidden]);

  useEffect(() => {
    if (preferencesReady) setHideNetWorth(hidden);
  }, [hidden, preferencesReady, setHideNetWorth]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const productionByKind = useMemo(() => {
    const map = new Map<ProductionCardKind, CompanionItem>();
    for (const f of PRODUCTION_CARD_FIXTURES) map.set(f.kind, f.item);
    return map;
  }, []);
  const celebrationItem = productionByKind.get("celebration")!;
  const cliffItem = productionByKind.get("cliff")!;
  const rhythmItem = productionByKind.get("rhythm")!;
  const intentPaceItem = productionByKind.get("intent_pace")!;
  const unfundedMoveItem = productionByKind.get("unfunded_move")!;
  const askPaydayItem = productionByKind.get("ask_payday")!;
  const askCardTermsItem = productionByKind.get("ask_generic")!;
  const coverPlanItem = productionByKind.get("cover_plan")!;

  // ── Realistic stacks — real HomeBrief/BriefBody composition, real fixed
  // order, no per-item labels (this is what the phone actually sees). Pool
  // is deliberately restricted to card kinds with no LIVE write path when
  // BriefBody drives them directly (BriefBody does not forward a
  // `previewMode` to its children — see the labelled catalogue below for
  // the full explanation): ask:payday's confirm/decline, unfunded_move's
  // hardcoded-`can_skip` row action, and the interactive rhythm card's
  // one_off/new_normal buttons all call a live, unauthenticated endpoint
  // if BriefBody renders them un-guarded, so they are demonstrated
  // individually (with previewMode) in the labelled section instead, never
  // here.
  const stackPool: CompanionItem[] = [
    celebrationItem,
    cliffItem,
    TRAJECTORY_ITEM,
    RHYTHM_INFO_ITEM,
    intentPaceItem,
    askCardTermsItem,
    NEEDLE_ITEM,
    OTHER_INFO_ITEM,
    coverPlanItem,
  ];
  const stackItems: CompanionItem[] =
    stack === "one" ? [coverPlanItem]
    : stack === "two" ? [askCardTermsItem, coverPlanItem]
    : stack === "three" ? [celebrationItem, RHYTHM_INFO_ITEM, coverPlanItem]
    : stackPool;

  const periodStart_End = getPayPeriodWithConfig(new Date(), DEFAULT_PAY_PERIOD_CONFIG);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className="min-h-dvh bg-[#f0f2f7] pb-40 pt-6 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
        <div className="mx-auto w-full max-w-[600px] px-4">
          <header className="mb-8">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">G134 · design catalogue</p>
            <h1 className="mt-1 text-[22px] font-bold tracking-tight text-slate-950 dark:text-white">Home surface inventory</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
              Every zone HomePage.tsx renders, in real render order, and every state its cards can
              reach. Fixtures only, real production components fed fixture props, nothing fetches
              or writes for real. Preview only, not a live account.
            </p>
          </header>

          {/* ── Zone 1: ReconnectStrip ─────────────────────────────────── */}
          <section className="mb-10 space-y-4">
            <ZoneHeading order="Zone 1 · ~640" title="ReconnectStrip" source="components/ReconnectStrip.tsx — HomePage's expired-provider banner, passed into HomeBrief's `banner` slot" />
            <CatalogueEntry component="ReconnectStrip" condition="N = 1 expired provider — stays a one-line row, reconnect action inline">
              <ReconnectStrip providers={RECONNECT_PROVIDERS} onReconnect={noop} />
            </CatalogueEntry>
            <CatalogueEntry component="ReconnectStrip" condition="N > 1 expired providers — collapses behind a native disclosure, one action per bank consent">
              <ReconnectStrip providers={RECONNECT_PROVIDERS_MULTI} onReconnect={noop} />
            </CatalogueEntry>
          </section>

          {/* ── Zone 2: HomeBrief (greeting, banner slot, cards, payday) ── */}
          <section className="mb-10 space-y-6">
            <ZoneHeading order="Zone 2 · ~675" title="HomeBrief" source="components/HomeBrief.tsx (default export) — greeting row, the `banner` slot, the brief cards (BriefBody), then PaydayPlanSection" />

            <CatalogueEntry component="HomeBrief" condition="Normal — no banner, a realistic card stack, payday plan not in its window">
              <div className="glass-card rounded-2xl p-4">
                <HomeBrief
                  items={stackItems}
                  firstName="Kevin"
                  safeToSpend={SAFE_TO_SPEND_STATES[0].data}
                  loading={false}
                  syncing={false}
                  syncError={false}
                  onSync={noop}
                  hasAccounts={true}
                  hideNetWorth={hidden}
                  dismissible={false}
                />
              </div>
            </CatalogueEntry>

            <CatalogueEntry component="HomeBrief" condition="banner slot filled — HomeBrief.tsx ~87-98 documents this as the one slot outranking everything below, including the payday plan card">
              <div className="glass-card rounded-2xl p-4">
                <HomeBrief
                  items={[celebrationItem]}
                  firstName="Kevin"
                  safeToSpend={SAFE_TO_SPEND_STATES[0].data}
                  loading={false}
                  syncing={false}
                  syncError={false}
                  onSync={noop}
                  hasAccounts={true}
                  hideNetWorth={hidden}
                  dismissible={false}
                  banner={<ReconnectStrip providers={RECONNECT_PROVIDERS} onReconnect={noop} />}
                />
              </div>
            </CatalogueEntry>

            <CatalogueEntry component="HomeBrief → BriefSkeleton" condition="loading = true — the two-line pulse shown while /today is still in flight">
              <div className="glass-card rounded-2xl p-4">
                <HomeBrief items={[]} firstName="Kevin" safeToSpend={null} loading={true} syncing={false} syncError={false} onSync={noop} hideNetWorth={hidden} />
              </div>
            </CatalogueEntry>

            <CatalogueEntry component="HomeBrief → SyncErrorBanner" condition="syncError = true — the last background sync attempt failed">
              <div className="glass-card rounded-2xl p-4">
                <HomeBrief
                  items={[celebrationItem]}
                  firstName="Kevin"
                  safeToSpend={SAFE_TO_SPEND_STATES[0].data}
                  loading={false}
                  syncing={false}
                  syncError={true}
                  onSync={noop}
                  hasAccounts={true}
                  hideNetWorth={hidden}
                  dismissible={false}
                />
              </div>
            </CatalogueEntry>

            <CatalogueEntry component="PaydayPlanSection" condition="No live plan yet, within the T-5-days-to-payday window (lib/paydayWindow.ts) — the quiet entry/preview row">
              <div className="glass-card rounded-2xl p-4">
                <PaydayPlanSection items={[]} safeToSpend={PAYDAY_WINDOW_SAFE_TO_SPEND} gate hasAccounts={true} />
              </div>
            </CatalogueEntry>

            <CatalogueEntry component="PaydayPlanSection → PaydayPlanCard" condition="A live, not-yet-executed plan (`preview: true`) — the full confirm/adjust card">
              <div className="glass-card rounded-2xl p-4">
                <PaydayPlanSection items={[PAYDAY_PLAN_ACTIVE_ITEM]} safeToSpend={SAFE_TO_SPEND_STATES[0].data} gate hasAccounts={true} />
              </div>
            </CatalogueEntry>

            <CatalogueEntry component="PaydayPlanSection → ExecutedPaydayRow" condition="`executed: true` — the plan already auto-verified for this window; a quiet summary row, expandable in place">
              <div className="glass-card rounded-2xl p-4">
                <PaydayPlanSection items={[PAYDAY_PLAN_EXECUTED_ITEM]} safeToSpend={SAFE_TO_SPEND_STATES[0].data} gate hasAccounts={true} />
              </div>
            </CatalogueEntry>
          </section>

          {/* ── Zone 3: Brief card order — the full labelled set ────────── */}
          <section className="mb-10 space-y-5">
            <ZoneHeading
              order="Inside Zone 2's BriefBody"
              title="Brief card order — every kind, real fixed sequence"
              source="components/HomeBrief.tsx's BriefBody renders a FIXED JSX type sequence with no sort: celebration, cliff, trajectory, rhythm, rhythm-info, intent_pace, unfunded_move, ask, needle, other, move"
            />
            <p className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] leading-snug text-slate-700 dark:border-amber-500/30 dark:bg-amber-400/[0.06] dark:text-slate-200">
              This is the question this round exists to ask: <strong>move</strong>, the single most
              actionable card (an actual sum of money to send), renders <strong>last</strong>, after
              seven information-only kinds that never require the user to do anything.
            </p>
            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              Each card below is the real named export from components/HomeBrief.tsx, fed a fixture
              item, in BriefBody&rsquo;s own order. dismissible is false throughout (no × renders, so
              no dismiss call can fire); AskPaydayCard, UnfundedMoveCard, RhythmCard and MoveCard are
              given <code>previewMode</code> so their confirm/skip/intent buttons short-circuit locally
              instead of calling a live endpoint.
            </p>

            <CatalogueEntry component="CelebrationCard" condition='type: "celebration" — a bill or pot has been verified covered ("Sorted" reward)'>
              <CelebrationCard item={celebrationItem} router={router} maskAmounts={maskAmounts} dismissible={false} />
            </CatalogueEntry>

            <CatalogueEntry component="CliffCard" condition='type: "cliff" — a 0%/promo rate is ending soon'>
              <CliffCard item={cliffItem} maskAmounts={maskAmounts} dismissible={false} />
            </CatalogueEntry>

            <CatalogueEntry component="CliffCard" condition='type: "trajectory" — companion.py only ever emits this for a "drifting" or "bad" debt verdict, never good news dressed up neutral'>
              <CliffCard item={TRAJECTORY_ITEM} maskAmounts={maskAmounts} dismissible={false} />
            </CatalogueEntry>

            <CatalogueEntry component="RhythmCard" condition="type: rhythm AND payload.multiple >= 1.5 — the interactive card, one_off/new_normal intent buttons">
              <RhythmCard item={rhythmItem} router={router} maskAmounts={maskAmounts} previewMode dismissible={false} />
            </CatalogueEntry>

            <CatalogueEntry component="CliffCard" condition="type: rhythm WITHOUT a qualifying payload — falls through to the plain info-card treatment, no accent, no CTA">
              <CliffCard item={RHYTHM_INFO_ITEM} maskAmounts={maskAmounts} dismissible={false} />
            </CatalogueEntry>

            <CatalogueEntry component="IntentPaceCard" condition='type: "intent_pace" — a quiet pace note against a Mirror-chosen aim'>
              <IntentPaceCard item={intentPaceItem} maskAmounts={maskAmounts} dismissible={false} />
            </CatalogueEntry>

            <CatalogueEntry component="UnfundedMoveCard" condition='type: "unfunded_move" — a due-but-unfunded own transfer; this fixture is the compact-handoff branch (every account fully covered)'>
              <UnfundedMoveCard item={unfundedMoveItem} hideNetWorth={hidden} maskAmounts={maskAmounts} previewMode dismissible={false} />
            </CatalogueEntry>

            <CatalogueEntry component="AskPaydayCard" condition='id === "ask:payday" — the one bespoke ask; its two buttons ARE the confirm_payday (primary) and set_payday (secondary) subtypes'>
              <AskPaydayCard item={askPaydayItem} router={router} maskAmounts={maskAmounts} previewMode />
            </CatalogueEntry>

            <CatalogueEntry component="AskGenericCard" condition='type: "ask", id !== "ask:payday" — the card_terms subtype (action.kind === "card_terms")'>
              <AskGenericCard item={askCardTermsItem} router={router} maskAmounts={maskAmounts} dismissible={false} />
            </CatalogueEntry>

            <CatalogueEntry component="AskGenericCard" condition='type: "ask", id !== "ask:payday" — the plain "generic" subtype, unrelated to card terms (same component, different copy)'>
              <AskGenericCard item={GENERIC_ASK_ITEM} router={router} maskAmounts={maskAmounts} dismissible={false} />
            </CatalogueEntry>

            <CatalogueEntry component="(inline in BriefBody, no separate component)" condition='type: "needle" — invitation to review a closed month; reproduced verbatim from components/HomeBrief.tsx ~2067-2081, there is nothing importable for it'>
              <div className="glass-card rounded-2xl p-4">
                <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300 leading-snug mb-2">{NEEDLE_ITEM.headline}</p>
                {NEEDLE_ITEM.action && (
                  <span className="text-[14px] text-indigo-600 dark:text-indigo-400 font-medium">{NEEDLE_ITEM.action.label}</span>
                )}
              </div>
            </CatalogueEntry>

            <CatalogueEntry component="(inline in BriefBody, no separate component)" condition='every item type BriefBody does not recognise by name falls here — only "info" reaches it in practice; reproduced verbatim, a bare headline + body paragraph, no card chrome at all'>
              <div>
                <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose text-pretty">
                  <strong className="text-slate-900 dark:text-slate-100 font-semibold">{OTHER_INFO_ITEM.headline}</strong>
                </p>
                <p className="text-pretty text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed max-w-prose">{OTHER_INFO_ITEM.body}</p>
              </div>
            </CatalogueEntry>

            <CatalogueEntry component="MoveCard" condition='type: "move" — a cover-plan money-move recommendation; renders LAST regardless of urgency (see the callout above)'>
              <MoveCard item={coverPlanItem} hideNetWorth={hidden} maskAmounts={maskAmounts} previewMode dismissible={false} />
            </CatalogueEntry>
          </section>

          {/* ── Zone 3b: realistic stacks (real BriefBody, no labels) ───── */}
          <section className="mb-10 space-y-4">
            <ZoneHeading order="Also inside Zone 2" title="Realistic stacks" source="Real BriefBody, fed different-sized item lists via the Stack control below — one card, two, three, or everything the safe pool covers" />
            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              Currently showing <strong>{STACK_LABEL[stack]}</strong>. ask:payday, unfunded_move and
              the interactive rhythm card are omitted from this live BriefBody composition (shown
              individually with previewMode above instead) since BriefBody does not forward a
              previewMode flag to them and their buttons call a real, unauthenticated endpoint.
            </p>
            <div className="glass-card rounded-2xl p-4">
              <BriefBody items={stackItems} safeToSpend={SAFE_TO_SPEND_STATES[0].data} router={router} hideNetWorth={hidden} dismissible={false} />
            </div>
          </section>

          {/* ── Zone 4: fresh-user hero ──────────────────────────────────── */}
          <section className="mb-10 space-y-4">
            <ZoneHeading order="Zone 3 · ~694" title="Fresh-user hero" source="Inline in app/components/HomePage.tsx (isFreshUser), no separate component — suppresses the estate section entirely" />
            <CatalogueEntry component="(inline in HomePage.tsx)" condition="isFreshUser = !loading && !loadError && accounts.length === 0 && investmentAccounts.length === 0 — reproduced verbatim; the button is inert in this preview">
              <div data-tutorial-id="tutorial-home-fresh" className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1">Connect your first bank</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-snug">Read-only access through open banking, we can never move your money.</p>
                <button type="button" onClick={noop} className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold rounded-xl py-2.5 px-4">
                  Connect a bank
                </button>
              </div>
            </CatalogueEntry>
          </section>

          {/* ── Zone 5: SafeToSpendCard ──────────────────────────────────── */}
          <section className="mb-10 space-y-5">
            <ZoneHeading order="Zone 5 · ~743" title="SafeToSpendCard" source="components/SafeToSpendCard.tsx — the Home hero instrument" />
            {SAFE_TO_SPEND_STATES.map((fixture) => (
              <StsEntry key={fixture.key} fixture={fixture} />
            ))}
          </section>

          {/* ── Zone 6: HomeBriefClearedRow ──────────────────────────────── */}
          <section className="mb-10 space-y-4">
            <ZoneHeading order="Zone 6 · ~759" title="HomeBriefClearedRow" source="components/HomeBrief.tsx — the archive pointer shown when every Home card has been Hide-on-Home'd but at least one is still actionable on Penny" />
            <CatalogueEntry component="HomeBriefClearedRow" condition="cleared = { count: 2, type: 'cliff' } — two actionable items survive on Penny's archive">
              <HomeBriefClearedRow cleared={CLEARED_ADVICE} router={router} />
            </CatalogueEntry>
          </section>

          {/* ── Zone 7: "Your money" strips ──────────────────────────────── */}
          <section className="mb-10 space-y-4">
            <ZoneHeading order="Zone 7 · ~780-786" title="Your money — bills, insight, offer" source="UpcomingBillsStrip, HomeInsightSpotlight, OfferCard" />
            {/* G169 removed ThisMonthStrip ("Last month" strip, the closed-
                month verdict variant) as a duplicate of the month-closed
                card at the top of Home; no replacement entry needed here. */}
            <div className="rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-[12px] leading-snug text-slate-500 dark:border-slate-600 dark:text-slate-400">
              <strong className="text-slate-700 dark:text-slate-300">Not covered:</strong> UpcomingBillsStrip
              (self-fetches <code>api.cashflow()</code>, no prop path in), HomeInsightSpotlight (self-fetches,
              only takes <code>onReady</code>) and OfferCard (self-fetches, takes zero props at all). None
              can take fixture data through props without forking their markup, which the brief for this
              round rules out — see the report for the full reasoning.
            </div>
          </section>

          {/* ── Zone 8: PinnedWidgetCard ─────────────────────────────────── */}
          <section className="mb-10 space-y-4">
            <ZoneHeading order="Zone 8 · ~801" title="PinnedWidgetCard" source="components/SpendTrends.tsx — a user-pinned chart widget, demoted below the fold" />
            <CatalogueEntry component="PinnedWidgetCard" condition={`id: "${DEFAULT_HOME_PINNED_WIDGET}" (the shipped default) — pace_curve is the only widget id that self-fetches, so it is deliberately not used here`}>
              <PinnedWidgetCard
                id={DEFAULT_HOME_PINNED_WIDGET}
                transactions={PINNED_WIDGET_TRANSACTIONS}
                periodStart={periodStart_End[0]}
                periodEnd={periodStart_End[1]}
                payPeriodConfig={DEFAULT_PAY_PERIOD_CONFIG}
                colours={colours}
                onOpen={noop}
              />
            </CatalogueEntry>
            <div className="rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-[12px] leading-snug text-slate-500 dark:border-slate-600 dark:text-slate-400">
              <strong className="text-slate-700 dark:text-slate-300">Not covered:</strong> FuelSavingsCard and
              GroceryBasketCard, PinnedWidgetCard&rsquo;s siblings in HomePage.tsx&rsquo;s demoted
              &ldquo;below zones&rdquo; area, both self-fetch internally (<code>api.fuelNearby</code>,{" "}
              <code>api.listBaskets</code>/<code>api.basketInsights</code>) and take zero props, same
              reason as the strips above.
            </div>
          </section>

          {/* ── Zone 9: Your estate — AccountLedgerRow ──────────────────── */}
          <section className="mb-10 space-y-4">
            <ZoneHeading order="Zone 9 · ~867, ~875" title="Your estate — AccountLedgerRow" source="components/AccountLedgerRow.tsx via lib/accountsEstate.ts's bankToRow/investmentToRow" />
            <div className="glass-card rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">
              {LEDGER_ACCOUNTS.map((acc, i) => (
                <div key={acc.id}>
                  {i > 0 && <div className="border-t border-slate-100 dark:border-white/5" />}
                  <AccountLedgerRow row={bankToRow(acc, LEDGER_PINNED_IDS)} onClick={noop} />
                </div>
              ))}
              <div className="border-t border-slate-100 dark:border-white/5">
                <AccountLedgerRow row={investmentToRow(LEDGER_INVESTMENT, LEDGER_PINNED_IDS)} onClick={noop} />
              </div>
            </div>
            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              Rows above, top to bottom: current, pinned savings, credit (negative balance), expired
              connection, investment (sparkline).
            </p>
          </section>

          {/* ── Zone 10: Recent transactions ─────────────────────────────── */}
          <section className="mb-10 space-y-4">
            <ZoneHeading order="Zone 10 · ~931, ~945" title="Recent transactions — TransactionRow + TeachingSheet" source="components/TransactionRow.tsx, components/TeachingSheet.tsx (opens on tap)" />
            <div className="glass-card rounded-2xl overflow-hidden divide-y divide-slate-50 dark:divide-slate-700">
              {RECENT_TRANSACTIONS.map((tx) => (
                <TransactionRow key={tx.id} transaction={tx} onClick={() => setSelectedTx(tx)} />
              ))}
            </div>
            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              Tap any row to open TeachingSheet. It calls <code>api.listCommitments()</code> internally,
              which fails harmlessly with no session on this unauthenticated preview; the sheet itself
              still renders and behaves normally.
            </p>
          </section>

          <p className="mb-10 text-center text-[11px] text-slate-400 dark:text-slate-500">
            Preview only. No bank data or preferences are changed for real.
          </p>
        </div>
      </main>

      {selectedTx && (
        <TeachingSheet
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
          onUpdated={noop}
          account={LEDGER_ACCOUNTS.find((a) => a.id === selectedTx.account_id)}
        />
      )}

      <FixtureBottomNav active="Home" />

      <div
        className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 92px)" }}
      >
        <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/92 p-1.5 shadow-xl">
          <div className="flex flex-wrap items-center justify-center gap-1">
            {STACKS.map((s) => (
              <a
                key={s}
                href={hrefFor({ mode, balances, stack: s }) as Route}
                aria-current={s === stack ? "page" : undefined}
                className={`flex min-h-9 items-center rounded-xl px-2.5 text-[11px] font-semibold transition-[transform,background-color,color] duration-150 active:scale-95 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                  s === stack ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
                }`}
              >
                {STACK_LABEL[s]}
              </a>
            ))}
            <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
            <a
              href={hrefFor({ mode, balances: balances === "hidden" ? "visible" : "hidden", stack }) as Route}
              className="flex min-h-9 items-center rounded-xl px-2.5 text-[11px] font-semibold text-slate-300 hover:text-white transition-[transform,background-color,color] duration-150 active:scale-95 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {balances === "hidden" ? "Show £" : "Hide £"}
            </a>
            <a
              href={hrefFor({ mode: mode === "dark" ? "light" : "dark", balances, stack }) as Route}
              className="flex min-h-9 items-center rounded-xl px-2.5 text-[11px] font-semibold text-slate-300 hover:text-white transition-[transform,background-color,color] duration-150 active:scale-95 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {mode === "dark" ? "Light" : "Dark"}
            </a>
          </div>
        </nav>
      </div>
    </div>
  );
}
