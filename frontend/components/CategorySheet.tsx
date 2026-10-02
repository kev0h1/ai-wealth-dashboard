"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { X, ChevronDown, ChevronRight, Fuel, ReceiptText } from "lucide-react";
import FuelSavingsCard from "@/components/FuelSavingsCard";
import GroceryBasketCard from "@/components/GroceryBasketCard";
import { Transaction, api, Checkpoint } from "@/lib/api";
import { invalidateVerdictCache } from "@/lib/verdictCache";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import TransactionRow from "@/components/TransactionRow";
import { SheetFrame } from "@/components/SheetFrame";
import { fmtWhole, daysLabel } from "@/lib/aimFormat";
import MoneyText from "@/components/MoneyText";

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
  // From an insight deep-link: merchant display names whose rows should be
  // highlighted (case-insensitive substring match on merchant/description).
  highlightMerchants?: string[];
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
          <MoneyText text={`${fmtWhole(spent_so_far, sym)} of your ${fmtWhole(aim_amount, sym)} aim · ${daysLabel(days_left)}`} />
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
                // G83 fix-round: same category_intent_col write as
                // SpendPage's own intent handlers — see HomeBrief.tsx's
                // identical comment.
                invalidateVerdictCache();
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
                invalidateVerdictCache();
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
            Set an aim
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
          <MoneyText text={`Your usual ${category} is about ${fmtWhole(suggestedAim, sym)} a period.`} />
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
                className="text-[13px] text-slate-900 dark:text-slate-100 bg-transparent outline-none w-20 [@media(pointer:coarse)]:w-24"
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

export default function CategorySheet({ name, title, total, count, transactions, onClose, onTransactionClick, sym = "£", isPro, door, highlightMerchants }: Props) {
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const colour = getCategoryColour(name, colours);
  const [toolOpen, setToolOpen] = useState(false);

  // ── Merchant-scoped deep-link (insight CTA) ──────────────────────────────
  // Default view: every transaction, matching rows highlighted + scrolled to.
  // The chip toggles a stricter view that hides non-matching rows; its ×
  // dismisses the whole idea and returns the sheet to normal.
  const merchantNeedles = useMemo(
    () => (highlightMerchants ?? []).map(m => m.trim().toLowerCase()).filter(Boolean),
    [highlightMerchants]
  );
  const matchesMerchant = useCallback(
    (tx: Transaction) => {
      if (merchantNeedles.length === 0) return false;
      const hay = `${tx.merchant_name ?? ""} ${tx.description ?? ""}`.toLowerCase();
      return merchantNeedles.some(n => hay.includes(n));
    },
    [merchantNeedles]
  );
  const [merchantChipDismissed, setMerchantChipDismissed] = useState(false);
  const [merchantFilterOn, setMerchantFilterOn] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const hasMerchantMatch = useMemo(
    () => transactions.some(matchesMerchant),
    [transactions, matchesMerchant]
  );
  const merchantMode = merchantNeedles.length > 0 && !merchantChipDismissed && hasMerchantMatch;
  const visibleTxns = merchantMode && merchantFilterOn ? transactions.filter(matchesMerchant) : transactions;
  const merchantLabel = (highlightMerchants ?? []).map(m => m.trim()).filter(Boolean)[0] ?? "";
  const merchantExtra = merchantNeedles.length - 1;

  // Bring the first matching row into view once the sheet has rendered.
  useEffect(() => {
    if (!merchantMode) return;
    const el = listRef.current?.querySelector('[data-merchant-match="true"]');
    if (!el) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (el as HTMLElement).scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  }, [merchantMode]);

  return (
    <SheetFrame title={title ?? name} onClose={onClose}>
      {({ closeThen }) => <>
        <div className="flex items-center gap-3 pb-4">
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
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100"><MoneyText text={title ?? name} /></h2>
            {/* Scope/comparison basis stated up front (Show Your Working) —
                this sheet is always scoped to the period it was opened from. */}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {count} transaction{count !== 1 ? "s" : ""} · this period
            </p>
          </div>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100 flex-shrink-0 font-mono tabular-nums">
            {sym}{total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        {/* Fuel/receipts hints — live in the header area, not as per-row
            ad-chips (approved spec: "NO ad-chips on rows"). Collapsed by
            default so the header stays quiet. */}
        {(name.toLowerCase() === "transport" || (name.toLowerCase() === "groceries" && isPro)) && (
          <div className="pb-3 flex-shrink-0">
            <button
              onClick={() => setToolOpen((o) => !o)}
              aria-expanded={toolOpen}
              className="inline-flex items-center gap-1 min-h-[28px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 text-[11px] active:opacity-70 transition-opacity"
            >
              {name.toLowerCase() === "transport" ? (
                <><Fuel size={10} style={{ color: colour }} /><span>Cheaper fuel nearby</span></>
              ) : (
                <><ReceiptText size={10} style={{ color: colour }} /><span>Scan &amp; compare receipts</span></>
              )}
              <ChevronDown
                size={11}
                className="transition-transform motion-reduce:transition-none"
                style={{ transform: toolOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </button>
            {toolOpen && (
              <div className="mt-2">
                {name.toLowerCase() === "transport" ? <FuelSavingsCard /> : <GroceryBasketCard />}
              </div>
            )}
          </div>
        )}

        {/* Merchant deep-link chip — quiet, dismissible. Tap toggles between
            "highlight in all" and "only these rows"; × clears it. */}
        {merchantMode && (
          <div className="flex items-center pb-1 flex-shrink-0">
            <button
              onClick={() => setMerchantFilterOn(v => !v)}
              aria-pressed={merchantFilterOn}
              className="min-h-[44px] -my-1.5 flex items-center active:scale-95 transition-transform"
            >
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  merchantFilterOn
                    ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700/60"
                    : "bg-slate-100/80 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 border-transparent"
                }`}
              >
                <span>
                  {merchantFilterOn ? "Showing " : "Highlighting "}
                  {merchantLabel}
                  {merchantExtra > 0 ? ` +${merchantExtra}` : ""}
                </span>
                <ChevronRight size={10} className="opacity-60" />
              </span>
            </button>
            <button
              onClick={() => { setMerchantChipDismissed(true); setMerchantFilterOn(false); }}
              aria-label="Clear merchant highlight"
              className="min-h-[44px] min-w-[44px] -my-1.5 flex items-center justify-center text-slate-400 dark:text-slate-500 active:scale-95 transition-transform"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Transaction list */}
        <div ref={listRef} className="border-t border-slate-100 dark:border-slate-700">
          {door && <DoorBlock door={door} />}
          {visibleTxns.map(tx => {
            const isMatch = merchantMode && matchesMerchant(tx);
            return (
              <div
                key={tx.id}
                data-merchant-match={isMatch || undefined}
                className={isMatch ? "rounded-xl ring-2 ring-inset ring-indigo-300 dark:ring-indigo-500/50 bg-indigo-50/40 dark:bg-indigo-900/15" : undefined}
              >
                <TransactionRow
                  transaction={tx}
                  onClick={() => closeThen(() => onTransactionClick(tx))}
                />
              </div>
            );
          })}
        </div>
      </>}
    </SheetFrame>
  );
}
