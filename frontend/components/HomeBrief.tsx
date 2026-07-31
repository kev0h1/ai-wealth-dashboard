"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import type { CompanionItem, PlanDest, SafeToSpend } from "@/lib/api";
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

interface BriefBodyProps {
  items: CompanionItem[];
  safeToSpend: SafeToSpend | null;
  router: ReturnType<typeof useRouter>;
  hideNetWorth?: boolean;
}

function BriefBody({ items, safeToSpend, router, hideNetWorth = false }: BriefBodyProps) {
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
  const celebrationItems = items.filter(i => i.type === "celebration");
  const otherItems = items.filter(i => i.type !== "move" && i.type !== "celebration" && i.type !== "needle");

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

        {/* Needle item — the month-close reward */}
        {needleItem && (() => {
          // card_delta < 0 means cards shrank → earns emerald accent on movement line
          // The field _card_delta is extra metadata; absent means neutral
          const cardDelta = (needleItem as any)._card_delta ?? 0;
          const cardsShrankOrSteady = cardDelta <= 0;
          // Split body: movement line is first sentence (ends with period), rest is cash + streak
          const bodyParts = needleItem.body.split(". ").filter(Boolean);
          const movementText = bodyParts[0] ? bodyParts[0] + "." : "";
          const restText = bodyParts.slice(1).join(". ");
          const maskedMovement = maskAmounts(movementText);
          const maskedRest = maskAmounts(restText);

          return (
            <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 p-4">
              <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug mb-2">
                {needleItem.headline}
              </p>
              <div className="space-y-1">
                {maskedMovement && (
                  <p className={`text-[14px] leading-relaxed ${
                    cardsShrankOrSteady
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-slate-600 dark:text-slate-400"
                  }`}>
                    {maskedMovement}
                  </p>
                )}
                {maskedRest && (
                  <p className="text-[14px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {maskedRest}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {otherItems.map(item => (
          <p key={item.id} className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed max-w-prose">
            <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}.</strong>{" "}
            {item.body}
          </p>
        ))}

        {moveItem && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 p-4">
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
                  const destChip = resolveBankChip(dest.provider);
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
                      <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-snug mt-1.5">
                        {maskAmounts(`needs £${dest.needs_total.toLocaleString("en-GB")} by ${dest.needs_by} — ${dest.bills.map(b => `£${b.amount.toLocaleString("en-GB")} ${b.label}`).join(" + ")}`)}
                      </p>
                    </div>
                  );
                })()}

                {/* b+c) Sources ledger tile */}
                {(() => {
                  type LegEntry = { provider: string; name: string; amount: number };
                  let legs: LegEntry[];
                  if (moveItem.moves && moveItem.moves.length > 0) {
                    legs = moveItem.moves.map(m => ({
                      provider: m.move_map.from.provider,
                      name: m.move_map.from.name,
                      amount: m.amount ?? 0,
                    }));
                  } else if (moveItem.move_map) {
                    legs = [{
                      provider: moveItem.move_map.from.provider,
                      name: moveItem.move_map.from.name,
                      amount: moveItem.amount ?? 0,
                    }];
                  } else {
                    legs = [];
                  }
                  const totalAmount = legs.reduce((s, l) => s + l.amount, 0);
                  const dest = moveItem.plan_dest!;
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
                        {moveItem.covered && (
                          <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                            {dest.bills.length === 1
                              ? "✓ payment clears"
                              : dest.bills.length === 2
                              ? "✓ both payments clear"
                              : "✓ payments clear"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Source-safety guarantee — rendered only when every source leg passed the min-running check */}
                {moveItem.sources_safe && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug mb-3">
                    Every account above still covers its own bills this window.
                  </p>
                )}

                {/* d) Residual line */}
                {moveItem.residual && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug mb-3">{maskAmounts(moveItem.residual)}</p>
                )}

                {/* e) Excluded-income honesty note */}
                {moveItem.income_note && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug mb-3">{maskAmounts(moveItem.income_note)}</p>
                )}
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

export default function HomeBrief({ items, firstName, safeToSpend, loading, syncing, syncError, onSync, hideNetWorth }: HomeBriefProps) {
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
          <BriefBody items={items} safeToSpend={safeToSpend} router={router} hideNetWorth={hideNetWorth} />
        )}
      </div>
    </div>
  );
}
