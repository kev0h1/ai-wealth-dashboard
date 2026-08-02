"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import type { CompanionItem, PlanDest, SafeToSpend } from "@/lib/api";
import { api } from "@/lib/api";
import TutorialTrigger from "@/components/TutorialTrigger";
import { BankBadge, BANK_META, bankKey } from "@/components/AccountMiniCard";

interface HomeBriefProps {
  items: CompanionItem[];
  firstName?: string;
  safeToSpend: SafeToSpend | null;
  loading: boolean;
  syncing: boolean;
  syncError: boolean;
  onSync: () => void;
  onHelp?: () => void;
  hideNetWorth?: boolean;
  onRefresh?: () => void;
}

function BriefSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
      <div className="h-4 w-1/2 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
    </div>
  );
}

function SyncErrorBanner() {
  return (
    <div role="alert" className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
      <AlertTriangle size={13} aria-hidden="true" className="text-amber-500 dark:text-amber-400 flex-shrink-0" />
      <p className="text-sm text-amber-700 dark:text-amber-300 flex-1">Sync didn&apos;t complete — try again in a moment.</p>
    </div>
  );
}

function resolveBankChip(provider: string) {
  const key = bankKey({ provider });
  const meta = BANK_META[key];
  return {
    logoSrc: meta?.logoFile
      ? `/banks/${meta.logoFile}`
      : meta?.domain
      ? `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`
      : null,
    initials: meta?.initials ?? (provider || "?").slice(0, 2).toUpperCase(),
    label: meta?.label ?? (provider || "Bank"),
    bg: meta?.bg,
    initialsSize: meta?.initialsSize,
  };
}

interface AskPaydayCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  hideNetWorth: boolean;
  maskAmounts: (text: string) => string;
  onRefresh?: () => void;
}

function AskPaydayCard({ item, router, maskAmounts, onRefresh }: AskPaydayCardProps) {
  const [busy, setBusy] = useState<null | "confirm" | "decline">(null);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  async function handleConfirm() {
    if (busy) return;
    setBusy("confirm");
    try {
      await api.confirmPayday();
      setHidden(true);
      onRefresh?.();
    } catch {
      // On error: un-busy, leave card visible, no red/alarm
    } finally {
      setBusy(v => v === "confirm" ? null : v);
    }
  }

  async function handleDecline() {
    if (busy) return;
    setBusy("decline");
    try {
      await api.dismissTodayItem(item.id);
    } catch { /* swallow */ }
    if (typeof window !== "undefined") {
      sessionStorage.setItem("wealth_open_pay_period", "1");
    }
    setHidden(true);
    router.push("/planning");
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Penny gradient chip */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
          style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
        >
          ✦ Penny
        </span>
      </div>
      {/* Headline */}
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}</strong>
      </p>
      {/* Body */}
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        {maskAmounts(item.body ?? "")}
      </p>
      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleConfirm}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 min-h-[44px]"
        >
          {busy === "confirm" ? "Confirming…" : (item.action?.label ?? "Yes, that's it")}
        </button>
        <button
          onClick={handleDecline}
          disabled={busy !== null}
          className="inline-flex items-center text-slate-500 dark:text-slate-400 text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-80 active:opacity-70 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 min-h-[44px]"
        >
          {item.secondary_action?.label ?? "No — set it myself"}
        </button>
      </div>
    </div>
  );
}

interface BriefBodyProps {
  items: CompanionItem[];
  safeToSpend: SafeToSpend | null;
  router: ReturnType<typeof useRouter>;
  hideNetWorth?: boolean;
  onRefresh?: () => void;
}

function BriefBody({ items, safeToSpend, router, hideNetWorth = false, onRefresh }: BriefBodyProps) {
  if (items.length === 0) {
    let fallbackText: string;
    if (!safeToSpend || safeToSpend.status === "insufficient_data") {
      fallbackText = "Nothing needs you today. I'm keeping an eye on the bills — just check back later.";
    } else if (safeToSpend.state === "tight") {
      fallbackText = "Nothing needs you today — payday's close. The first week's bills are already mapped, so just cruise.";
    } else if (safeToSpend.state === "short") {
      fallbackText = "One thing's worth a look below — otherwise I've got the rest mapped.";
    } else {
      fallbackText = "Nothing needs you today. You've got headroom, and I'm watching the bills — enjoy it.";
    }
    return (
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed">{fallbackText}</p>
    );
  }

  const moveItem = items.find(i => i.type === "move");
  const needleItem = items.find(i => i.type === "needle");
  const askItem = items.find(i => i.type === "ask");
  const celebrationItems = items.filter(i => i.type === "celebration");
  const otherItems = items.filter(i => i.type !== "move" && i.type !== "celebration" && i.type !== "needle" && i.type !== "ask");

  // Mask £ figures in a string when hideNetWorth is on
  function maskAmounts(text: string): string {
    if (!hideNetWorth) return text;
    return text.replace(/£[\d,]+/g, "£••••");
  }

  return (
    <div className="space-y-3">
        {celebrationItems.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {celebrationItems.map(item => (
              <button
                key={item.id}
                onClick={() => router.push("/mirror")}
                className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm font-medium px-3 py-1.5 rounded-full border border-emerald-100 dark:border-emerald-800/40 hover:opacity-80 active:scale-95 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span aria-hidden="true">✦</span>
                {item.headline}
              </button>
            ))}
          </div>
        )}

        {/* Payday auto-confirm ask card */}
        {askItem && (
          <AskPaydayCard
            item={askItem}
            router={router}
            hideNetWorth={hideNetWorth}
            maskAmounts={maskAmounts}
            onRefresh={onRefresh}
          />
        )}

        {/* Needle item — invitation to review the closed month */}
        {needleItem && (
          <div className="glass-card rounded-2xl p-4">
            <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300 leading-snug mb-2">
              {needleItem.headline}
            </p>
            {needleItem.action && (
              <button
                onClick={() => router.push(needleItem.action!.route)}
                className="text-[14px] text-indigo-600 dark:text-indigo-400 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                {needleItem.action.label}
              </button>
            )}
          </div>
        )}

        {otherItems.map(item => (
          <p key={item.id} className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed max-w-prose">
            <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}.</strong>{" "}
            {item.body}
          </p>
        ))}

        {moveItem && (
          <div className="glass-card rounded-2xl p-4">
            {/* Penny gradient chip — marks this as a proactive advice surface */}
            <div className="flex items-center gap-2 mb-3">
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
                style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
              >
                ✦ Penny
              </span>
            </div>
            {moveItem.plan_dest ? (
              <>
                {/* Headline */}
                <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
                  <strong className="text-slate-900 dark:text-slate-100 font-semibold">{moveItem.headline}.</strong>
                </p>

                {/* a) Destination tile */}
                {(() => {
                  const dest: PlanDest = moveItem.plan_dest!;
                  const destChip = resolveBankChip(dest.provider ?? "");
                  const billCount = (dest.bills ?? []).length;
                  const billWord = billCount === 1 ? "payment" : "payments";
                  return (
                    <div className="glass-tile rounded-xl p-3 mb-2">
                      <div className="flex items-center gap-2.5">
                        <BankBadge
                          logoSrc={destChip.logoSrc}
                          initials={destChip.initials}
                          initialsSize={destChip.initialsSize}
                          altText={destChip.label}
                          brandBg={destChip.bg}
                        />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate flex-1">{dest.name}</span>
                        <span className="num text-sm font-medium text-slate-400 dark:text-slate-500 flex-shrink-0">
                          {hideNetWorth ? "£•••• held" : `£${Math.round(dest.balance).toLocaleString("en-GB")} held`}
                        </span>
                      </div>
                      {/* Summary line */}
                      <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-snug mt-1.5">
                        {maskAmounts(`needs £${(dest.needs_total ?? 0).toLocaleString("en-GB")} by ${dest.needs_by} · ${billCount} ${billWord}`)}
                      </p>
                      {/* Bill rows — hairline separator */}
                      <div className="border-t border-white/[0.06] dark:border-white/[0.06] mt-2 pt-2 space-y-1">
                        {(dest.bills ?? []).slice(0, 6).map((b: any, i: number) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="text-[12px] text-slate-500 dark:text-slate-400 truncate">{b.label}</span>
                            <span className="num text-[12px] text-slate-500 dark:text-slate-400 flex-shrink-0">
                              {hideNetWorth ? "£••••" : `£${b.amount.toLocaleString("en-GB")}`}
                            </span>
                          </div>
                        ))}
                        {(dest.bills ?? []).length > 6 && (
                          <p className="text-[12px] text-slate-400 dark:text-slate-500">+{(dest.bills ?? []).length - 6} more</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* b+c) Sources ledger tile */}
                {(() => {
                  type LegEntry = { provider: string; name: string; amount: number };
                  let legs: LegEntry[];
                  if (moveItem.moves && moveItem.moves.length > 0) {
                    legs = moveItem.moves.map(m => ({
                      provider: (m.move_map.from as any)?.provider,
                      name: (m.move_map.from as any)?.name,
                      amount: m.amount ?? 0,
                    }));
                  } else if (moveItem.move_map) {
                    legs = [{
                      provider: (moveItem.move_map?.from as any)?.provider,
                      name: (moveItem.move_map?.from as any)?.name,
                      amount: moveItem.amount ?? 0,
                    }];
                  } else {
                    legs = [];
                  }
                  const totalAmount = legs.reduce((s, l) => s + l.amount, 0);
                  return (
                    <div className="glass-tile rounded-xl divide-y divide-slate-100 dark:divide-slate-700/60 mb-2">
                      {legs.map((leg, idx) => {
                        const chip = resolveBankChip(leg.provider);
                        return (
                          <div key={idx} className="flex items-center gap-2.5 px-3 min-h-[44px]">
                            <BankBadge
                              logoSrc={chip.logoSrc}
                              initials={chip.initials}
                              initialsSize={chip.initialsSize}
                              altText={chip.label}
                              brandBg={chip.bg}
                            />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate flex-1">{leg.name}</span>
                            <span className="num text-sm font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">
                              {hideNetWorth ? "£••••" : `£${Math.round(leg.amount).toLocaleString("en-GB")}`}
                            </span>
                          </div>
                        );
                      })}
                      {/* Total row */}
                      <div className="flex items-center justify-between gap-2.5 px-3 min-h-[44px]">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Moving <span className="num">{hideNetWorth ? "£••••" : `£${Math.round(totalAmount).toLocaleString("en-GB")}`}</span>
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Footer — guarantee line + residual, each on its own line */}
                <div className="mt-3 space-y-1.5">
                  {moveItem.covered && (moveItem.plan_dest?.bills ?? []).length > 0 && (
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-snug">
                      {(moveItem.plan_dest?.bills ?? []).length === 1
                        ? `This move clears the payment at ${moveItem.plan_dest!.name}.`
                        : `This move clears all ${(moveItem.plan_dest?.bills ?? []).length} payments at ${moveItem.plan_dest!.name}.`}
                    </p>
                  )}
                  {moveItem.sources_safe && (
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-snug">
                      Every account above still covers its own bills this window.
                    </p>
                  )}
                  {moveItem.residual && (
                    <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug">{maskAmounts(String(moveItem.residual))}</p>
                  )}
                  {moveItem.income_note && (
                    <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug">{maskAmounts(moveItem.income_note)}</p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
                <strong className="text-slate-900 dark:text-slate-100 font-semibold">{moveItem.headline}.</strong>{" "}
                {moveItem.body}
              </p>
            )}
            {moveItem.action && (
              <button
                onClick={() => router.push(moveItem.action!.route)}
                className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {moveItem.action.label}
              </button>
            )}
          </div>
        )}
    </div>
  );
}

export default function HomeBrief({ items, firstName, safeToSpend, loading, syncing, syncError, onSync, hideNetWorth, onRefresh }: HomeBriefProps) {
  const router = useRouter();
  const name = firstName || "there";

  // Hydration guard: render a neutral greeting on first paint to avoid SSR/client
  // mismatch from new Date().getHours(), then swap to the time-aware version after mount.
  const [greeting, setGreeting] = useState(`Hi, ${name}`);
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(
      hour < 12
        ? `Good morning, ${name}`
        : hour < 18
        ? `Good afternoon, ${name}`
        : `Good evening, ${name}`
    );
  }, [name]);

  return (
    <div className="rise-in" style={{ "--rise-index": 0 } as React.CSSProperties}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">{greeting}</h1>
        <div className="flex items-center gap-2">
          <TutorialTrigger variant="dark-on-white" />
          <button
            onClick={onSync}
            disabled={syncing}
            aria-label={syncing ? "Syncing…" : "Sync accounts"}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <RefreshCw size={14} aria-hidden="true" className={`text-slate-500 dark:text-slate-400 ${syncing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Brief body */}
      <div className="space-y-3">
        {syncError && <SyncErrorBanner />}
        {loading ? (
          <BriefSkeleton />
        ) : (
          <BriefBody items={items} safeToSpend={safeToSpend} router={router} hideNetWorth={hideNetWorth} onRefresh={onRefresh} />
        )}
      </div>
    </div>
  );
}
