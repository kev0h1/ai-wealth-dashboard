"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ScanFace } from "lucide-react";
import { api, CompanionItem, SafeToSpend } from "@/lib/api";
import { BRAND_GRADIENT } from "@/lib/brand";
import PennyMark from "@/components/PennyMark";
import { PennyPromptBar } from "@/components/PennyConversation";
import { usePennySheet } from "@/components/PennySheetProvider";
import { usePreferences } from "@/components/PreferencesContext";
import BottomNav from "@/components/BottomNav";
import { BriefBody, BriefSkeleton, PaydayPlanSection } from "@/components/HomeBrief";
import { isActionableCompanionItem } from "@/lib/companionItems";
import { isPaydayWindowActive, writePaydayDotCache } from "@/lib/paydayWindow";
import { readHomeDismissedAdvice } from "@/lib/homeDismissedAdvice";
import MoneyText from "@/components/MoneyText";

export default function PennyPage() {
  const router = useRouter();
  const { hideNetWorth } = usePreferences();
  // Opens the app-wide Penny sheet (components/PennySheetProvider.tsx) from
  // this hub's own entry point (section e below) — the conversation itself
  // no longer renders on this page, see that section's comment for why.
  const { open } = usePennySheet();
  const [contextLine, setContextLine] = useState<string | null>(null);
  const [items, setItems] = useState<CompanionItem[]>([]);
  const [safeToSpend, setSafeToSpend] = useState<SafeToSpend | null>(null);
  const [loading, setLoading] = useState(true);
  // Mirror rich entry — a LIVE one-line headline when the Mirror already has
  // a computed portrait, otherwise a calm static framing line. Reuses the
  // Mirror page's own endpoint (GET /mirror, no refresh) — cheap the
  // overwhelming majority of the time (7-day server-side cache read), so
  // this is not a new/expensive call, just the same one the Mirror page
  // already makes on every visit.
  const [mirrorHeadline, setMirrorHeadline] = useState<string | null>(null);

  // Home-only dismissed ids (localStorage, lib/homeDismissedAdvice.ts) —
  // read once, fresh, since this page only ever mounts client-side (App
  // Router remounts the page component on navigation, so there's no SSR
  // markup to mismatch and no stale value to worry about). Used to keep an
  // informational item off this hub once it's been dismissed on Home — see
  // `informationalPennyItems` below; there is no restore/undo control for
  // this any more (that lived in the now-retired "Cleared from Home"
  // archive), so this never needs to change after mount and has no setter.
  const [dismissedKeys] = useState<Set<string>>(() =>
    typeof window !== "undefined" ? readHomeDismissedAdvice() : new Set()
  );

  const loadData = useCallback(async () => {
    try {
      const [today, sts] = await Promise.all([
        api.getToday().catch(() => ({ status: "ok" as const, items: [] as CompanionItem[] })),
        api.safeToSpend().catch(() => null),
      ]);
      setItems(today.items ?? []);
      setSafeToSpend(sts);
      // Write-through for BottomNav's Penny dot (see lib/paydayWindow.ts) —
      // this page already fetches both of these for its own content, so
      // hand the same boolean to the nav's cache instead of letting its
      // hook fire a redundant copy of the same two requests on its own page.
      const hasLivePlan = (today.items ?? []).some((i) => i.type === "payday_plan");
      writePaydayDotCache(isPaydayWindowActive({
        hasLivePlan,
        daysUntilPayday: sts?.status === "ok" ? sts.days_until_payday : null,
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Header context line ("£251 free · 10 days left") — used to arrive via
  // PennyConversation's onContextLine callback (it made this exact fetch
  // for its own suggestion chips and just handed the page a copy). Now
  // that the conversation has moved into the app-wide sheet
  // (components/PennySheetProvider.tsx) and no longer renders on this
  // page, fetching it directly here was chosen over dropping it: it's the
  // one piece of the old inline conversation's decorative context this hub
  // can still show cheaply (one fire-and-forget GET, same endpoint,
  // degrades to no line at all on failure/old backend, never blocks this
  // page's own render).
  useEffect(() => {
    api.canISuggestions()
      .then((s) => setContextLine(s?.context_line ?? null))
      .catch(() => setContextLine(null));
  }, []);

  useEffect(() => {
    api.getMirror()
      .then((portrait) => {
        if (portrait.status === "ok" && portrait.traits.length > 0) {
          setMirrorHeadline(portrait.traits[0].title.replace(/^Your Signature:\s*/i, ""));
        }
      })
      .catch(() => {});
  }, []);

  // Penny hub policy (owner rule, 2026-09-01): actionable items — a real
  // decision/CTA beyond dismissal, see lib/companionItems.ts — show
  // regardless of Home-dismissal, because deferred work follows you here.
  // Informational items (celebrations, cliff/trajectory/rhythm narrations,
  // pace notes) show ONLY while not dismissed anywhere: `dismissedKeys` is
  // the Home-only localStorage dismissal (lib/homeDismissedAdvice.ts) read
  // fresh on this page's mount above; a SERVER-side dismissal (the plain
  // `api.dismissTodayItem` path each card falls back to when rendered here
  // without `dismissible`, since this page never passes that prop) already
  // removes the item from `items` entirely, upstream, before either filter
  // below ever sees it. Either mechanism therefore makes an informational
  // item disappear from this hub entirely — there is no archive for a
  // dismissed informational item any more (that archive was exactly what
  // let "X is covered" / "£X/mo staying in your pocket" cards linger here
  // after a Home dismissal, the incoherence the owner flagged).
  const actionablePennyItems = items.filter(isActionableCompanionItem);
  const informationalPennyItems = items.filter(
    i => !isActionableCompanionItem(i) && !dismissedKeys.has(i.id)
  );
  // Whether BriefBody will actually paint a card for `actionablePennyItems`
  // — excludes payday_plan, which is actionable but rendered exclusively by
  // PaydayPlanSection (section c below), never by BriefBody. Gates the
  // "Waiting on you" header alone (section b) so it never appears floating
  // over an empty BriefBody output on a payday-plan-only window.
  const hasActionableBriefCard = actionablePennyItems.some(i => i.type !== "payday_plan");

  return (
    <div
      // pb was 15rem/lg:pb-40 (vs. every other page's standard 9rem/lg:pb-8
      // below) to clear PennyConversation's own `position: fixed` composer,
      // which floated above BottomNav even on desktop (no lg:hidden on that
      // wrapper in components/PennyConversation.tsx's full-page mode). That
      // composer no longer renders on this page at all, so the extra
      // clearance is vestigial — back to the standard value every other
      // BottomNav-bearing page uses.
      className="relative isolate min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" } as React.CSSProperties}
    >
      {/* rise-in lives on this inner content wrapper, not the outer
          min-h-dvh/isolate one above — BottomNav (rendered as this outer
          div's sibling-at-the-end, below) is `fixed`, and CSS animations
          with a non-"none" transform in their keyframes (riseIn ends at
          translateY(0), kept alive forever by fill-mode "both") establish a
          containing block for fixed descendants. Putting rise-in on the
          outer div trapped BottomNav inside it instead of the viewport, so
          on a long /penny page the nav scrolled away with the content
          instead of staying pinned. Every other rise-in page (Home, Month,
          Cards, Debt plan, Mirror) already keeps rise-in off the
          BottomNav-bearing ancestor for the same reason — this just brings
          Penny in line.

          History (kept for whoever next touches this div): this page used
          to also render PennyConversation inline, section e, and that
          component docks a `position: fixed` composer to the viewport
          bottom. A fixed descendant is contained by the NEAREST
          transformed/filtered ancestor, so a rise-in wrapper around it
          trapped that composer too (caught on iPhone Safari) — the fix at
          the time was keeping the conversation as a SIBLING of this div,
          never nested inside it. That conversation has since moved into
          the app-wide bottom sheet (components/PennySheetProvider.tsx) and
          no longer renders on this page at all (see section e below, now
          just an entry point with no fixed descendant of its own) — so the
          specific hazard that shaped this div's boundary is gone. Collapsing
          this wrapper back into the outer div was deliberately NOT done
          here even so: the outer div still carries BottomNav as a sibling
          below, and that reasoning (the first paragraph above) is
          independent of the conversation and still holds on its own. */}
      <div className="px-4 pt-6 lg:px-0 lg:pt-6 lg:max-w-2xl lg:mx-auto rise-in" style={{ "--rise-index": 0 } as React.CSSProperties}>
        {/* a. Header — Penny's own gradient mark, the only gradient surface
            on this screen besides the nav button that led here. The context
            line ("£251 free · 10 days left") is fetched directly by this
            page (see the canISuggestions effect above) and is decorative
            only — its absence (old/unreachable backend) just leaves the
            header without it. */}
        <div className="flex items-center gap-2.5 mb-6">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: BRAND_GRADIENT }}
          >
            <PennyMark size={16} className="text-white" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
              Penny
            </h1>
            {contextLine && (
              <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 truncate"><MoneyText text={contextLine} /></p>
            )}
          </div>
        </div>

        {/* b. Penny's brief — the exact same verdict/greeting content Home
            shows (same BriefBody component, same /today + /safe-to-spend
            data), split into two groups per the owner's Penny hub policy
            (2026-09-01): actionable items (a real decision/CTA beyond
            dismissal — lib/companionItems.ts) always show here, carried
            over under their own "Waiting on you" header so deferred work
            reads as one clear block rather than blending into narration;
            informational items (celebrations, cliff/trajectory/rhythm
            notices, pace notes) render beneath, unlabelled — same bare
            presentation Home gives them — and only while not dismissed
            anywhere (see `informationalPennyItems` above).
            `actionablePennyItems` still includes payday_plan (it IS
            actionable), but BriefBody itself never renders that type —
            PaydayPlanSection (section c, below) owns that card exclusively
            so a live plan never double-renders. `hasActionableBriefCard`
            only gates the header: on a window where the only actionable
            item is payday_plan, BriefBody would otherwise paint nothing
            under a "Waiting on you" label with the real card appearing
            further down in section c — an empty-looking header for no
            reason. */}
        <div className="space-y-3">
          {loading ? <BriefSkeleton /> : (
            <>
              {hasActionableBriefCard && (
                <div>
                  <div className="flex items-baseline gap-1.5 px-1 mb-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Waiting on you
                    </span>
                  </div>
                  <BriefBody items={actionablePennyItems} safeToSpend={safeToSpend} router={router} hideNetWorth={hideNetWorth} onRefresh={loadData} hideAttribution />
                </div>
              )}
              {informationalPennyItems.length > 0 && (
                <div className={hasActionableBriefCard ? "mt-6" : undefined}>
                  <BriefBody items={informationalPennyItems} safeToSpend={safeToSpend} router={router} hideNetWorth={hideNetWorth} onRefresh={loadData} hideAttribution />
                </div>
              )}
              {actionablePennyItems.length === 0 && informationalPennyItems.length === 0 && (
                <BriefBody items={[]} safeToSpend={safeToSpend} router={router} hideNetWorth={hideNetWorth} onRefresh={loadData} hideAttribution />
              )}
            </>
          )}
        </div>

        {/* c. Payday Plan — its permanent home. Same component Home uses,
            just without the `gate` prop — always available here, year-round,
            live full card when there's one or the entry/preview affordance
            otherwise. Gated on `loading` so it never renders on the first
            paint (before items/safeToSpend resolve, `showEntryRow` would be
            true by default) only to swap to the live card a moment later —
            worst right at payday, when that flash is most visible. */}
        {!loading && (
          <PaydayPlanSection items={actionablePennyItems} safeToSpend={safeToSpend} hideNetWorth={hideNetWorth} onRefresh={loadData} />
        )}

        {/* d. Mirror rich entry */}
        <button
          onClick={() => router.push("/mirror")}
          className="w-full mt-6 glass-card rounded-2xl min-h-[44px] p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center flex-shrink-0">
            <ScanFace size={18} aria-hidden="true" className="text-slate-500 dark:text-slate-400" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
              How your money behaves
            </span>
            <span className="block text-[13px] text-slate-500 dark:text-slate-400 leading-snug truncate">
              {mirrorHeadline ?? "Your money's rhythm, patterns and habits, reflected back."}
            </span>
          </span>
          <ChevronRight size={16} aria-hidden="true" className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
        </button>

        {/* e. Start a conversation — the hub's door into Penny's sheet, now
            that the conversation itself no longer lives inline on this page
            (moved app-wide, components/PennySheetProvider.tsx, so a thread
            survives navigating to another screen mid-question — see this
            file's other comments for the full history). Reuses
            PennyPromptBar's exact visual grammar (glass-card row + gradient
            chip + placeholder, components/PennyConversation.tsx) rather
            than inventing a new control — the same component Planning uses
            to open the sheet from its own dense list. showChips is off:
            the full suggestion set already appears once the sheet is open,
            and this page already makes its own canISuggestions() call
            above for the header's context line, so a second chip fetch
            here would just duplicate that GET for content the sheet is
            about to show anyway. Safe to live inside this rise-in div
            (unlike the old inline conversation) because this control has
            no `position: fixed` descendant of its own. */}
        <div className="mt-6">
          <PennyPromptBar
            onCompose={() => open({ screen: "home" })}
            onAsk={(q) => open({ screen: "home", ask: q })}
            showChips={false}
          />
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
