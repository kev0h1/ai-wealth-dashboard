"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, ScanFace } from "lucide-react";
import { api, CompanionItem, SafeToSpend } from "@/lib/api";
import { BRAND_GRADIENT } from "@/lib/brand";
import PennyMark from "@/components/PennyMark";
import PennyConversation from "@/components/PennyConversation";
import { usePreferences } from "@/components/PreferencesContext";
import BottomNav from "@/components/BottomNav";
import { BriefBody, BriefSkeleton, PaydayPlanSection, isPennyVisible } from "@/components/HomeBrief";
import { isPaydayWindowActive, writePaydayDotCache } from "@/lib/paydayWindow";
import { readHomeDismissedAdvice, restoreOnHome } from "@/lib/homeDismissedAdvice";
import MoneyText from "@/components/MoneyText";

export default function PennyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hideNetWorth } = usePreferences();
  // ?ask=<question> submits once on mount; ?compose=1 just focuses the
  // docked composer. Read once — PennyConversation only consumes the first
  // value it sees (initialFiredRef), so a later param change on the same
  // mount wouldn't resubmit anyway.
  const askParam = searchParams.get("ask");
  const composeParam = searchParams.get("compose") === "1";
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

  // "Cleared from Home" archive — items the user hid on Home (localStorage,
  // lib/homeDismissedAdvice.ts) that aren't in Penny's primary list (below).
  // Lazy-init straight from localStorage: this page only ever mounts fresh
  // client-side (App Router remounts the page component on navigation), so
  // there's no SSR markup to mismatch and no stale value to worry about.
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() =>
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

  useEffect(() => {
    api.getMirror()
      .then((portrait) => {
        if (portrait.status === "ok" && portrait.traits.length > 0) {
          setMirrorHeadline(portrait.traits[0].title.replace(/^Your Signature:\s*/i, ""));
        }
      })
      .catch(() => {});
  }, []);

  // Penny hub IA rule (owner, 2026-08-18): /penny's PRIMARY section surfaces
  // only cash-move recommendations, payday suggestions, and the Mirror entry
  // — anything that already lives on another page (Spend, Accounts, Debt
  // plan, Month, Mirror, Planning) is filtered out here so it isn't
  // duplicated. `items` itself stays unfiltered (Home's dot-cache
  // write-through above depends on the full feed), this derived array is
  // only for what Penny's primary section renders. isPennyVisible lives in
  // HomeBrief.tsx so this filter and Home's "cleared" pointer copy share one
  // definition, not two that can drift apart.
  const pennyItems = items.filter(isPennyVisible);

  // "Cleared from Home" archive (below the primary section) — anything the
  // user dismissed on Home (`dismissedKeys`) that ISN'T already shown above
  // in `pennyItems`. A dismissed move/payday_plan/ask:payday item is already
  // in the primary list regardless of dismissal (Penny always shows the
  // full feed for those types), so excluding isPennyVisible items here is
  // what keeps nothing appearing twice. Read against the live `items` feed
  // (not iterating the dismissed-keys store directly) so a stale key for an
  // item that's stopped being generated just naturally finds no match.
  const clearedItems = items.filter(i => !isPennyVisible(i) && dismissedKeys.has(i.id));

  // Mask £ figures in a string when hideNetWorth is on — same helper as
  // HomeBrief's BriefBody (not exported from there, so duplicated here for
  // this page-local "cleared" list; BriefBody itself already masks anything
  // rendered in the primary section above).
  function maskAmounts(text: string): string {
    if (!hideNetWorth) return text;
    return text.replace(/£[\d,]+/g, "£••••");
  }

  // "Show on Home again" — the archive's only interactive control. Removes
  // the localStorage entry (lib/homeDismissedAdvice.ts) so the card
  // reappears on Home next time it loads, and drops it from the local set so
  // it disappears from the archive immediately. No dismiss control lives in
  // this section — the whole point of the archive is that dismissing from
  // Penny can't lose things — so this is strictly the inverse action.
  function handleRestore(id: string) {
    restoreOnHome(id);
    setDismissedKeys(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <div
      className="relative isolate min-h-dvh pb-[calc(15rem+env(safe-area-inset-bottom,0px))] lg:pb-40"
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

          Second bite (owner caught this on iPhone Safari): moving rise-in
          here still trapped PennyConversation's docked composer, because
          that component was rendered INSIDE this div too — same hazard,
          just relocated. A `position: fixed` descendant is contained by the
          NEAREST transformed/filtered ancestor, so the fix isn't "move
          rise-in to a lower wrapper", it's "don't let anything with a fixed
          descendant live under a rise-in-bearing element at all". This div
          now only wraps sections a-d (header, brief, payday plan, cleared
          archive, Mirror entry) — none of which contain fixed elements.
          PennyConversation (section e, with its fixed composer) is rendered
          as this div's SIBLING below, so its containing block is the
          viewport again, same as BottomNav. */}
      <div className="px-4 pt-6 lg:px-0 lg:pt-6 lg:max-w-2xl lg:mx-auto rise-in" style={{ "--rise-index": 0 } as React.CSSProperties}>
        {/* a. Header — Penny's own gradient mark, the only gradient surface
            on this screen besides the nav button that led here. The context
            line ("£251 free · 10 days left") comes from the conversation's
            suggestions fetch below and is decorative only — its absence
            (old/unreachable backend) just leaves the header without it. */}
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
            data), filtered to `pennyItems` per the owner's Penny hub IA
            rule: only cash moves, payday suggestions, and the payday
            detection ask belong here — everything else already has a home
            on another page. payday_plan items are excluded here regardless —
            PaydayPlanSection below owns that content exclusively, so a live
            plan never double-renders. */}
        <div className="space-y-3">
          {loading ? <BriefSkeleton /> : (
            <BriefBody items={pennyItems} safeToSpend={safeToSpend} router={router} hideNetWorth={hideNetWorth} onRefresh={loadData} hideAttribution />
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
          <PaydayPlanSection items={pennyItems} safeToSpend={safeToSpend} hideNetWorth={hideNetWorth} onRefresh={loadData} />
        )}

        {/* c2. "Cleared from Home" archive — quiet, secondary to the primary
            cards above. Owner's option 3 (2026-08-19): Home is where you
            clear things, Penny is where they still live, but that was only
            true for move/payday_plan/ask:payday (the primary section);
            everything else a user dismisses on Home used to vanish
            everywhere until the 7-day localStorage expiry. This list is the
            fix — it renders nothing at all when empty (the common case), so
            it adds zero visual weight most of the time. Deliberately NOT
            reusing BriefBody's full glass-card-per-item treatment here: a
            stack of full advice cards would read as a second to-do list,
            the opposite of "archive". Instead this is a single dense list
            (Label header + divided rows), the same demotion pattern the
            Accounts page already uses for its collapsed "Inactive" section
            — muted uppercase Label typography plus row density, not a new
            visual language. No dismiss control anywhere here (the owner's
            rule: dismissing from Penny must never lose something for good)
            — the only control is "Show on Home", the inverse action. */}
        {clearedItems.length > 0 && (
          <div className="mt-6">
            <div className="flex items-baseline gap-1.5 px-1 mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Cleared from Home
              </span>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-600">· {clearedItems.length}</span>
            </div>
            <p className="px-1 mb-2 text-[12px] text-slate-500 dark:text-slate-400 leading-snug">
              Dismissed on Home, kept here so nothing quietly disappears.
            </p>
            <div className="glass-card rounded-2xl overflow-hidden">
              {clearedItems.map((item, i) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-2 px-3 py-2.5 ${i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 leading-snug">
                      <MoneyText text={maskAmounts(item.headline)} />
                    </p>
                    {item.body && (
                      <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
                        <MoneyText text={maskAmounts(item.body)} />
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestore(item.id)}
                    className="flex-shrink-0 self-center inline-flex items-center justify-center min-h-[44px] px-2 -my-2 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-500/10 active:scale-95 transition-[background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 whitespace-nowrap"
                  >
                    Show on Home
                  </button>
                </div>
              ))}
            </div>
          </div>
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
      </div>

      {/* e. The conversation — structured cards above stay put (cash moves,
          payday, Mirror, per the owner's Penny hub IA rule); this is the
          bounded oracle itself. Deep-linkable: ?ask=<question> submits on
          mount and scrolls to the answer, ?compose=1 focuses the docked
          composer without submitting anything.

          Deliberately a SIBLING of the rise-in div above, not nested inside
          it: PennyConversation docks a `position: fixed` composer to the
          viewport bottom (components/PennyConversation.tsx), and a fixed
          descendant of a rise-in ancestor gets trapped inside that
          ancestor's box instead of the real viewport (see the rise-in
          comment above). Rendering this section outside the transformed
          subtree keeps its containing block as the viewport — same reason
          BottomNav lives out here too. The px-4/lg:px-0/lg:max-w-2xl/
          lg:mx-auto/pt classes are repeated from the rise-in div above so
          the thread and chips still line up with the page content even
          though this is no longer nested inside it; only the entrance
          animation is lost for this section, which is an acceptable trade
          for not trapping the composer. */}
      <div className="px-4 lg:px-0 lg:max-w-2xl lg:mx-auto mt-6">
        <PennyConversation
          initialQuestion={askParam}
          autoFocusComposer={composeParam}
          onContextLine={setContextLine}
        />
      </div>

      <BottomNav />
    </div>
  );
}
