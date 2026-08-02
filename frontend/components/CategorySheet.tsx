"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, ChevronDown, ChevronRight, Fuel, ReceiptText } from "lucide-react";
import FuelSavingsCard from "@/components/FuelSavingsCard";
import GroceryBasketCard from "@/components/GroceryBasketCard";
import { Transaction, api, Checkpoint } from "@/lib/api";
import { useColours } from "@/components/ColourProvider";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import TransactionRow from "@/components/TransactionRow";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useSheetA11y } from "@/lib/useSheetA11y";

interface DoorProps {
  category: string;
  multiple: number | null;
  suggestedAim: number | null;
  checkpoint: Checkpoint | null;
  intent: "one_off" | "new_normal" | null;
  doorEngaged: boolean;
  isCurrentPeriod: boolean;
  sym: string;
  onChanged: () => void;
}

interface Props {
  name: string;
  title?: string;
  total: number;
  count: number;
  transactions: Transaction[];
  onClose: () => void;
  onTransactionClick: (tx: Transaction) => void;
  sym?: string;
  isPro?: boolean;
  door?: DoorProps;
}

function fmtWhole(n: number, sym: string): string {
  return `${sym}${Math.round(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function daysLabel(days: number): string {
  if (days <= 0) return "last day";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

function DoorBlock({ door }: { door: DoorProps }) {
  const { category, multiple, suggestedAim, doorEngaged, isCurrentPeriod, sym, onChanged } = door;

  // Local state overrides — so the block responds instantly without waiting for parent refetch
  const [localCheckpoint, setLocalCheckpoint] = useState<Checkpoint | null>(door.checkpoint);
  const [localIntent, setLocalIntent] = useState<"one_off" | "new_normal" | null>(door.intent);
  const [localDoorEngaged, setLocalDoorEngaged] = useState(doorEngaged);
  const [doorOpen, setDoorOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Keep local state in sync if parent pushes a new checkpoint after refetch
  useEffect(() => {
    setLocalCheckpoint(door.checkpoint);
    setLocalIntent(door.intent);
    setLocalDoorEngaged(door.doorEngaged);
  }, [door.checkpoint, door.intent, door.doorEngaged]);

  // State A — live checkpoint
  if (localCheckpoint) {
    const { id, aim_amount, spent_so_far, days_left } = localCheckpoint;
    return (
      <div className="border-b border-slate-100 dark:border-slate-700 px-4 py-3">
        <p className="text-[13px] text-slate-500 dark:text-slate-400">
          {fmtWhole(spent_so_far, sym)} of your {fmtWhole(aim_amount, sym)} aim · {daysLabel(days_left)}
        </p>
        <button
          onClick={async () => {
            try {
              await api.cancelCheckpoint(id);
              setLocalCheckpoint(null);
              onChanged();
            } catch {
              // silent — user can try again
            }
          }}
          className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400 active:opacity-60 transition-opacity"
        >
          Cancel this aim
        </button>
      </div>
    );
  }

  // State C — the ask (intent capture)
  // Show when: no checkpoint, not door-engaged, no intent yet, multiple >= 1.5, suggestedAim present, door not open
  const showAsk = !localDoorEngaged && localIntent == null && multiple != null && multiple >= 1.5 && suggestedAim != null && !doorOpen;

  if (showAsk) {
    return (
      <div className="border-b border-slate-100 dark:border-slate-700 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
          {category} ran {multiple.toFixed(1)}× your usual.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => {
              try {
                await api.recordTrendIntent(category, "one_off");
                setLocalIntent("one_off");
                setLocalDoorEngaged(true);
                onChanged();
              } catch {
                // silent
              }
            }}
            className="text-[13px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-full px-3 py-1.5 active:scale-95 transition-transform"
          >
            That was a one-off
          </button>
          <button
            onClick={async () => {
              try {
                await api.recordTrendIntent(category, "new_normal");
                setLocalIntent("new_normal");
                setLocalDoorEngaged(true);
                onChanged();
              } catch {
                // silent
              }
            }}
            className="text-[13px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-full px-3 py-1.5 active:scale-95 transition-transform"
          >
            That&apos;s my new normal
          </button>
          <button
            onClick={() => setDoorOpen(true)}
            className="text-[13px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-full px-3 py-1.5 active:scale-95 transition-transform"
          >
            I&apos;d like to change this
          </button>
        </div>
      </div>
    );
  }

  // State B — the Door (aim setting)
  // Show when: doorOpen AND suggestedAim non-null
  if (doorOpen && suggestedAim != null) {
    async function handleSetAim(amount?: number) {
      setSaving(true);
      setSaveError(false);
      try {
        const cp = await api.createCheckpoint(category, amount);
        setLocalCheckpoint(cp);
        setLocalDoorEngaged(true);
        setDoorOpen(false);
        setCustomMode(false);
        setCustomValue("");
        onChanged();
      } catch {
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    }

    const parsedCustom = parseFloat(customValue.replace(/[^0-9.]/g, ""));
    const customValid = !isNaN(parsedCustom) && parsedCustom > 0;

    return (
      <div className="border-b border-slate-100 dark:border-slate-700 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Your usual {category} is about {fmtWhole(suggestedAim, sym)} a period.
        </p>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 mb-3">
          {isCurrentPeriod ? "Aim for that this period?" : "Aim for that in the current period?"}
        </p>
        {!customMode ? (
          <div className="flex flex-wrap gap-2">
            <button
              disabled={saving}
              onClick={() => handleSetAim(undefined)}
              className="text-[13px] font-semibold text-white rounded-xl px-4 py-2 active:scale-95 transition-transform disabled:opacity-60"
              style={{ backgroundColor: "#4f46e5" }}
            >
              Set this aim
            </button>
            <button
              disabled={saving}
              onClick={() => setCustomMode(true)}
              className="text-[13px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-2 active:scale-95 transition-transform disabled:opacity-60"
            >
              Choose a different amount
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-700 focus-within:ring-2 focus-within:ring-indigo-500">
              <span className="text-[13px] text-slate-500 dark:text-slate-400">{sym}</span>
              <input
                autoFocus
                inputMode="decimal"
                placeholder={String(Math.round(suggestedAim))}
                value={customValue}
                onChange={e => { setCustomValue(e.target.value); setSaveError(false); }}
                className="text-[13px] text-slate-900 dark:text-slate-100 bg-transparent outline-none w-20"
              />
            </div>
            <button
              disabled={saving || !customValid}
              onClick={() => handleSetAim(parsedCustom)}
              className="text-[13px] font-semibold text-white rounded-xl px-4 py-2 active:scale-95 transition-transform disabled:opacity-60"
              style={{ backgroundColor: "#4f46e5" }}
            >
              Set this aim
            </button>
          </div>
        )}
        {saveError && (
          <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
            That didn&apos;t save. Try again.
          </p>
        )}
      </div>
    );
  }

  // State D — render nothing
  return null;
}

export default function CategorySheet({ name, title, total, count, transactions, onClose, onTransactionClick, sym = "£", isPro, door }: Props) {
  useLockBodyScroll();
  useSheetOpen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const colour = colours[name] ?? CATEGORY_COLOURS[name as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const [toolOpen, setToolOpen] = useState(false);
  const router = useRouter();
  const [debtVerdict, setDebtVerdict] = useState<{ totalDebt: number; debtFreeLabel: string } | null>(null);

  useEffect(() => {
    if (name !== "Debt") return;
    api.debtInsights().then(d => {
      const months = d.months_at_current_rate;
      let debtFreeLabel = "";
      if (months && isFinite(months) && months > 0 && months < 600) {
        const target = new Date();
        target.setMonth(target.getMonth() + Math.ceil(months));
        debtFreeLabel = target.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      }
      setDebtVerdict({ totalDebt: d.total_debt, debtFreeLabel });
    }).catch(() => {});
  }, [name]);

  if (!mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${title ?? name} category`}
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] glass-sheet rounded-t-3xl z-[70] max-h-[80dvh] flex flex-col"
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-2 pb-4 flex-shrink-0">
          {(() => {
            const Icon = getCategoryIcon(name, iconOverrides);
            return (
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${colour}26` }}
              >
                <Icon size={16} style={{ color: colour }} />
              </span>
            );
          })()}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title ?? name}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{count} transaction{count !== 1 ? "s" : ""}</p>
          </div>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100 flex-shrink-0">
            {sym}{total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 flex-shrink-0 ml-1"
          >
            <X size={15} color="#64748b" />
          </button>
        </div>

        {/* Transaction list */}
        <div className="overflow-y-auto flex-1 border-t border-slate-100 dark:border-slate-700" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {door && <DoorBlock door={door} />}
          {/* Compact tool launchers — collapsed by default so transactions lead */}
          {name === "Debt" && (
            <div className="border-b border-slate-100 dark:border-slate-700 px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                {debtVerdict ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      £{debtVerdict.totalDebt.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} left
                    </span>
                    {debtVerdict.debtFreeLabel && (
                      <> · debt-free {debtVerdict.debtFreeLabel} at this rate</>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Payoff planner</p>
                )}
              </div>
              <button
                onClick={() => router.push("/debt")}
                className="flex-shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors whitespace-nowrap"
              >
                See your payoff plan ›
              </button>
            </div>
          )}
          {name.toLowerCase() === "transport" && (
            <div className="border-b border-slate-100 dark:border-slate-700">
              <button
                onClick={() => setToolOpen(o => !o)}
                aria-expanded={toolOpen}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 text-[11px]">
                  <Fuel size={10} style={{ color: colour }} />
                  <span>Cheaper fuel nearby</span>
                  <ChevronRight size={10} className="text-slate-400 dark:text-slate-500" />
                </span>
                <ChevronDown
                  size={14}
                  className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-auto transition-transform motion-reduce:transition-none"
                  style={{ transform: toolOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>
              {toolOpen && (
                <div className="px-4 pb-3">
                  <FuelSavingsCard />
                </div>
              )}
            </div>
          )}
          {name.toLowerCase() === "groceries" && isPro && (
            <div className="border-b border-slate-100 dark:border-slate-700">
              <button
                onClick={() => setToolOpen(o => !o)}
                aria-expanded={toolOpen}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 text-[11px]">
                  <ReceiptText size={10} style={{ color: colour }} />
                  <span>Scan &amp; compare receipts</span>
                  <ChevronRight size={10} className="text-slate-400 dark:text-slate-500" />
                </span>
                <ChevronDown
                  size={14}
                  className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-auto transition-transform motion-reduce:transition-none"
                  style={{ transform: toolOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>
              {toolOpen && (
                <div className="px-4 pb-3">
                  <GroceryBasketCard />
                </div>
              )}
            </div>
          )}
          {transactions.map(tx => (
            <TransactionRow
              key={tx.id}
              transaction={tx}
              onClick={() => { onClose(); setTimeout(() => onTransactionClick(tx), 50); }}
            />
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}
