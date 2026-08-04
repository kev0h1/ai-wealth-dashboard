"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { BANK_META, BankBadge, bankKey } from "@/components/AccountMiniCard";
import { RadioDot } from "@/components/PlanOneOffSheet";
import { api, CardPromoKind, CardTermsCard, CardTermsLookup } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import Spinner from "@/components/Spinner";

interface CardTermsSheetProps {
  /** All the user's credit cards, from GET /card-terms */
  cards: CardTermsCard[];
  /** True once the parent's /card-terms fetch has resolved */
  ready: boolean;
  /** When set, the sheet is a single-card session (pill / Add rates tap) */
  startAccountId?: string | null;
  onClose: () => void;
  /** Called after every successful save so the parent can refresh pills */
  onSaved: () => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PROMO_KINDS: { value: CardPromoKind; label: string }[] = [
  { value: "purchases", label: "Purchases" },
  { value: "balance_transfer", label: "Balance transfers" },
  { value: "both", label: "Both" },
];

/** Last day of a month as a local ISO date (a 0% deal runs to the end of its month). */
function endOfMonthIso(year: number, monthIndex: number): string {
  const d = new Date(year, monthIndex + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtApr(n: number): string {
  return String(n);
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

// Selection chip — in-sheet row/grid buttons, never a native picker.
function Chip({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[44px] px-2 py-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-35 disabled:active:scale-100 ${
        selected
          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
          : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
      {children}
    </p>
  );
}

type Phase = "loading" | "found" | "candidates" | "manual" | "promo";
type ManualPrompt = "notfound" | "different" | "candidates" | "edit";

export default function CardTermsSheet({ cards, ready, startAccountId, onClose, onSaved }: CardTermsSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const { hideNetWorth } = usePreferences();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Single-card session (pill tap) or the full walk (deep link / ask card).
  const sequence = useMemo(
    () => (startAccountId ? cards.filter(c => c.account_id === startAccountId) : cards),
    [cards, startAccountId]
  );

  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  const current = sequence[index] ?? null;
  const currentId = current?.account_id ?? null;

  // ── Per-card state, reset whenever the current card changes ──────────────
  const [phase, setPhase] = useState<Phase>("loading");
  const [manualPrompt, setManualPrompt] = useState<ManualPrompt>("notfound");
  const [lookup, setLookup] = useState<CardTermsLookup | null>(null);
  const [showRateInput, setShowRateInput] = useState(false);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [rate, setRate] = useState("");
  const [promoMonth, setPromoMonth] = useState<number | null>(null);
  const [promoYear, setPromoYear] = useState<number | null>(null);
  const [promoKind, setPromoKind] = useState<CardPromoKind | null>(null);
  const [btOffer, setBtOffer] = useState<boolean | null>(null);
  const [btNote, setBtNote] = useState("");
  const [saving, setSaving] = useState<null | "save" | "later">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentId || !current) return;
    setError(null);
    setSaving(null);
    setShowRateInput(false);
    setCandidate(null);
    setLookup(null);
    const t = current.terms;
    if (t && t.status === "confirmed") {
      // Already answered — prefill everything so a re-save simply overwrites.
      setPhase(t.on_promo ? "promo" : "manual");
      setManualPrompt("edit");
      setRate(t.apr_pct != null ? String(t.apr_pct) : "");
      if (t.on_promo && t.promo_end) {
        const d = new Date(`${t.promo_end}T00:00:00`);
        setPromoMonth(d.getMonth());
        setPromoYear(d.getFullYear());
      } else {
        setPromoMonth(null);
        setPromoYear(null);
      }
      setPromoKind(t.promo_kind ?? null);
      setBtOffer(t.bt_offer_available ?? null);
      setBtNote(t.bt_offer_note ?? "");
    } else {
      setPhase("loading");
      setManualPrompt("notfound");
      setRate("");
      setPromoMonth(null);
      setPromoYear(null);
      setPromoKind(null);
      setBtOffer(null);
      setBtNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // Fire the representative-rate lookup when a card without confirmed terms opens.
  useEffect(() => {
    if (!currentId || phase !== "loading") return;
    let cancelled = false;
    api
      .lookupCardTerms(currentId)
      .then(r => {
        if (cancelled) return;
        setLookup(r);
        if (r.representative_apr != null) {
          setPhase("found");
        } else if (r.candidates && r.candidates.length > 0) {
          setPhase("candidates");
          setManualPrompt("candidates");
        } else {
          setPhase("manual");
          setManualPrompt("notfound");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("manual");
        setManualPrompt("notfound");
      });
    return () => {
      cancelled = true;
    };
  }, [currentId, phase]);

  const total = sequence.length;
  const productKey = lookup?.product_key ?? current?.terms?.product_key ?? null;

  function advance() {
    if (index + 1 >= total) {
      setFinished(true);
    } else {
      setIndex(i => i + 1);
    }
  }

  async function postAndAdvance(body: Parameters<typeof api.saveCardTerms>[1], which: "save" | "later") {
    if (!currentId || saving) return;
    setSaving(which);
    setError(null);
    try {
      await api.saveCardTerms(currentId, body);
      onSaved();
      advance();
    } catch {
      setError("Couldn't save — please try again.");
    } finally {
      setSaving(null);
    }
  }

  function handleUseLookupRate() {
    if (lookup?.representative_apr == null) return;
    postAndAdvance(
      {
        status: "confirmed",
        apr_pct: lookup.representative_apr,
        on_promo: false,
        ...(productKey ? { product_key: productKey } : {}),
      },
      "save"
    );
  }

  function handleSaveManual() {
    const v = parseFloat(rate);
    if (!isFinite(v) || v < 0 || v > 100) {
      setError("Enter a rate between 0 and 100.");
      return;
    }
    postAndAdvance(
      {
        status: "confirmed",
        apr_pct: Math.round(v * 100) / 100,
        on_promo: false,
        ...(productKey ? { product_key: productKey } : {}),
      },
      "save"
    );
  }

  function handleSavePromo() {
    if (promoMonth == null || promoYear == null) {
      setError("Pick the month the 0% deal ends.");
      return;
    }
    if (!promoKind) {
      setError("Pick purchases, balance transfers, or both.");
      return;
    }
    const iso = endOfMonthIso(promoYear, promoMonth);
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (iso < todayIso) {
      setError("Pick a month that's still ahead.");
      return;
    }
    postAndAdvance(
      {
        status: "confirmed",
        apr_pct: null,
        on_promo: true,
        promo_kind: promoKind,
        promo_end: iso,
        ...(btOffer != null ? { bt_offer_available: btOffer } : {}),
        ...(btOffer && btNote.trim() ? { bt_offer_note: btNote.trim().slice(0, 300) } : {}),
        ...(productKey ? { product_key: productKey } : {}),
      },
      "save"
    );
  }

  function handleLater() {
    postAndAdvance(
      { status: "skipped", ...(productKey ? { product_key: productKey } : {}) },
      "later"
    );
  }

  function handleSave() {
    if (phase === "promo") handleSavePromo();
    else handleSaveManual();
  }

  // ── Derived display bits ──────────────────────────────────────────────────
  const chip = current ? resolveBankChip(current.provider) : null;
  const currencyPrefix = current?.currency === "GBP" || !current ? "£" : `${current.currency} `;
  const balanceStr = current
    ? hideNetWorth
      ? `${currencyPrefix}••••`
      : `${currencyPrefix}${Math.abs(current.balance).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
    : "";
  const foundApr = lookup?.representative_apr;
  const foundName = lookup?.display_name || current?.name || "This card";

  const thisYear = new Date().getFullYear();
  const thisMonth = new Date().getMonth();
  const yearOptions = useMemo(() => {
    const base = [thisYear, thisYear + 1, thisYear + 2, thisYear + 3];
    if (promoYear != null && !base.includes(promoYear)) base.push(promoYear);
    return base.sort((a, b) => a - b);
  }, [thisYear, promoYear]);

  // Portal guard — must stay BELOW every hook: an early return above useMemo
  // made render N and N+1 disagree on hook count (React #310).
  if (!mounted) return null;

  const manualQuestion =
    manualPrompt === "notfound"
      ? "Couldn't find this card's advertised rate — what does yours charge?"
      : manualPrompt === "edit"
      ? "Here's what you've told me — edit anything that's changed."
      : "What's the rate on it?";

  const closingLine =
    startAccountId
      ? "That's updated — your card picture stays sharp."
      : total === 1
      ? "That's your only card — your card picture is sharp."
      : `That's all ${total} — your card picture is sharp.`;

  const showFooterSave =
    !finished &&
    !!current &&
    (phase === "promo" ||
      phase === "manual" ||
      (phase === "found" && showRateInput) ||
      (phase === "candidates" && candidate != null));

  const rateInput = (
    <div>
      <FieldLabel>What&apos;s the rate on it?</FieldLabel>
      <div className="relative max-w-[160px]">
        <input
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={e => setRate(e.target.value)}
          placeholder="24.9"
          aria-label="Interest rate, percent APR"
          className="w-full min-h-[48px] pl-3 pr-9 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm tabular-nums"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">
          %
        </span>
      </div>
    </div>
  );

  const zeroDealButton = (
    <button
      type="button"
      onClick={() => {
        setError(null);
        setPhase("promo");
      }}
      className="w-full min-h-[48px] rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-700 dark:text-slate-200 active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      It&apos;s on a 0% deal
    </button>
  );

  return createPortal(
    <>
      {/* Backdrop — the page behind blurs via #app-shell.sheet-open (useSheetOpen) */}
      <div
        className="fixed inset-0 bg-black/40 z-[65] fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Card rates"
        className="fixed inset-x-0 bottom-0 z-[70]"
        style={reduceMotion ? undefined : { animation: "slideUpSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both" }}
      >
        <div className="mx-auto w-full max-w-[500px] glass-sheet rounded-t-3xl max-h-[85dvh] flex flex-col">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-2 pb-3 flex-shrink-0">
            {!finished && current && chip ? (
              <>
                <span className="flex-shrink-0">
                  <BankBadge
                    logoSrc={chip.logoSrc}
                    initials={chip.initials}
                    initialsSize={chip.initialsSize}
                    altText={chip.label}
                    brandBg={chip.bg}
                  />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {current.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 num">
                    {balanceStr} on it
                    {total > 1 && <span> · {index + 1} of {total}</span>}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-slate-900 dark:text-slate-100">Card rates</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  So plans can work with what each card really costs.
                </p>
              </div>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2 active:bg-slate-200 dark:active:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              <X size={15} />
            </button>
          </div>

          {/* Scrollable body */}
          <div
            className="overflow-y-auto flex-1 px-5 space-y-4"
            style={{ paddingBottom: showFooterSave || (!finished && current) ? "1rem" : "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
          >
            {!ready ? (
              <div className="flex items-center justify-center py-12">
                <Spinner size={28} />
              </div>
            ) : finished ? (
              /* Closing state */
              <div className="space-y-4 py-2">
                <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 px-4 py-5">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                    {closingLine}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  Done
                </button>
              </div>
            ) : !current ? (
              /* No credit cards at all */
              <div className="space-y-4 py-2">
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  No credit cards connected — there&apos;s nothing to add here.
                </p>
                <button
                  onClick={onClose}
                  className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  Done
                </button>
              </div>
            ) : phase === "loading" ? (
              <div className="space-y-2 py-2" aria-live="polite">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Checking this card&apos;s advertised rate…
                </p>
                <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
                <div className="h-4 w-1/2 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
              </div>
            ) : phase === "found" ? (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {foundName} advertises around {fmtApr(foundApr!)}%. That&apos;s the representative
                  rate, so yours may differ — is it close?
                </p>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleUseLookupRate}
                    disabled={saving !== null}
                    className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    {saving === "save" ? "Saving…" : `Use ${fmtApr(foundApr!)}%`}
                  </button>
                  {!showRateInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setShowRateInput(true);
                        setManualPrompt("different");
                      }}
                      className="w-full min-h-[48px] rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-700 dark:text-slate-200 active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      It&apos;s different
                    </button>
                  )}
                  {showRateInput && rateInput}
                  {zeroDealButton}
                </div>
              </>
            ) : phase === "candidates" ? (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  Which card is this?
                </p>
                <div
                  role="radiogroup"
                  aria-label="Which card is this?"
                  className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden"
                >
                  {(lookup?.candidates ?? []).map(name => (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      aria-checked={candidate === name}
                      onClick={() => {
                        setCandidate(name);
                        setError(null);
                      }}
                      className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                    >
                      <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 dark:text-slate-200">
                        {name}
                      </span>
                      <RadioDot selected={candidate === name} />
                    </button>
                  ))}
                </div>
                {candidate != null && (
                  <div className="space-y-3">
                    {rateInput}
                    {zeroDealButton}
                  </div>
                )}
              </>
            ) : phase === "manual" ? (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {manualQuestion}
                </p>
                {rateInput}
                {zeroDealButton}
              </>
            ) : (
              /* phase === "promo" — the 0% branch */
              <>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setPhase(lookup?.representative_apr != null ? "found" : "manual");
                  }}
                  className="min-h-[44px] inline-flex items-center text-[13px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
                >
                  ← It&apos;s not on a 0% deal
                </button>

                <div>
                  <FieldLabel>Until when?</FieldLabel>
                  <div role="radiogroup" aria-label="Month the 0% deal ends" className="grid grid-cols-4 gap-2 mb-2">
                    {MONTHS.map((m, i) => (
                      <Chip
                        key={m}
                        selected={promoMonth === i}
                        disabled={promoYear === thisYear && i < thisMonth}
                        onClick={() => {
                          setPromoMonth(i);
                          setError(null);
                        }}
                      >
                        {m}
                      </Chip>
                    ))}
                  </div>
                  <div role="radiogroup" aria-label="Year the 0% deal ends" className="grid grid-cols-4 gap-2">
                    {yearOptions.map(y => (
                      <Chip
                        key={y}
                        selected={promoYear === y}
                        onClick={() => {
                          setPromoYear(y);
                          // A month that's already gone this year can't be kept
                          if (y === thisYear && promoMonth != null && promoMonth < thisMonth) {
                            setPromoMonth(null);
                          }
                          setError(null);
                        }}
                      >
                        {y}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div>
                  <FieldLabel>On purchases or balance transfers?</FieldLabel>
                  <div role="radiogroup" aria-label="What the 0% deal covers" className="grid grid-cols-3 gap-2">
                    {PROMO_KINDS.map(k => (
                      <Chip
                        key={k.value}
                        selected={promoKind === k.value}
                        onClick={() => {
                          setPromoKind(k.value);
                          setError(null);
                        }}
                      >
                        {k.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div>
                  <FieldLabel>Any balance-transfer offers available on this card?</FieldLabel>
                  <div role="radiogroup" aria-label="Balance-transfer offers available" className="grid grid-cols-2 gap-2">
                    <Chip selected={btOffer === true} onClick={() => setBtOffer(true)}>
                      Yes
                    </Chip>
                    <Chip selected={btOffer === false} onClick={() => { setBtOffer(false); setBtNote(""); }}>
                      No
                    </Chip>
                  </div>
                  {btOffer === true && (
                    <input
                      type="text"
                      value={btNote}
                      onChange={e => setBtNote(e.target.value)}
                      maxLength={300}
                      placeholder="One line is plenty — e.g. 0% for 12 months, 3% fee"
                      aria-label="Balance-transfer offer note"
                      className="mt-2 w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm"
                    />
                  )}
                </div>
              </>
            )}

            {/* Error — calm line, field stays quiet */}
            {error && !finished && current && (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                {error}
              </p>
            )}
          </div>

          {/* Footer — Save advances; Later records the skip and advances */}
          {!finished && ready && current && phase !== "loading" && (
            <div
              className="flex-shrink-0 px-5 pt-3 flex items-center gap-2 border-t border-slate-100 dark:border-slate-700/60"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <button
                type="button"
                onClick={handleLater}
                disabled={saving !== null}
                className="min-h-[48px] px-4 rounded-xl text-sm font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {saving === "later" ? "Noting…" : "Later"}
              </button>
              <div className="flex-1" />
              {showFooterSave && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving !== null}
                  className="min-h-[48px] px-8 rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  {saving === "save" ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
