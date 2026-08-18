"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ScanFace } from "lucide-react";
import { api, CompanionItem, SafeToSpend } from "@/lib/api";
import { BRAND_GRADIENT } from "@/lib/brand";
import PennyMark from "@/components/PennyMark";
import { usePreferences } from "@/components/PreferencesContext";
import BottomNav from "@/components/BottomNav";
import { BriefBody, BriefSkeleton, PaydayPlanSection } from "@/components/HomeBrief";
import { isPaydayWindowActive, writePaydayDotCache } from "@/lib/paydayWindow";

export default function PennyPage() {
  const router = useRouter();
  const { hideNetWorth } = usePreferences();
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

  // Penny hub IA rule (owner, 2026-08-18): /penny surfaces only cash-move
  // recommendations, payday suggestions, and the Mirror entry — anything
  // that already lives on another page (Spend, Accounts, Debt plan, Month,
  // Mirror, Planning) is filtered out here so it isn't duplicated. `items`
  // itself stays unfiltered (Home's dot-cache write-through above depends on
  // the full feed), this derived array is only for what Penny renders.
  const pennyItems = items.filter(
    (i) => i.type === "move" || i.type === "payday_plan" || (i.type === "ask" && i.id === "ask:payday")
  );

  return (
    <div
      className="relative isolate min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 rise-in"
      style={{ "--rise-index": 0, paddingTop: "env(safe-area-inset-top, 0px)" } as React.CSSProperties}
    >
      <div className="px-4 pt-6 lg:px-0 lg:pt-6 lg:max-w-2xl lg:mx-auto">
        {/* a. Header — Penny's own gradient mark, the only gradient surface
            on this screen besides the nav button that led here. */}
        <div className="flex items-center gap-2.5 mb-6">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: BRAND_GRADIENT }}
          >
            <PennyMark size={16} className="text-white" />
          </span>
          <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
            Penny
          </h1>
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

        {/* Can I…? removed from Penny 2026-08-18 — owner's IA rule: it lives
            on Planning. Reinstate by restoring CanISection here if that was
            wrong. */}
      </div>

      <BottomNav />
    </div>
  );
}
