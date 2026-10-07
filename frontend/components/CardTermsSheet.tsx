"use client";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import { RadioDot } from "@/components/PlanOneOffSheet";
import { api, BtOffer, CardPromo, CardPromoKind, CardTermsCard, CardTermsLookup } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import Spinner from "@/components/Spinner";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import { DateField } from "@/components/DatePicker";

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
    logoSrc: bankLogoSrc(meta),
    initials: meta?.initials ?? (provider || "?").slice(0, 2).toUpperCase(),
    label: meta?.label ?? (provider || "Bank"),
    bg: meta?.bg,
    initialsSize: meta?.initialsSize,
  };
}

// Selection chip: in-sheet row/grid buttons, never a native picker.
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

// One text-input skin for every field in the sheet: a typed value is ink,
// only the true placeholder is grey (G225).
const INPUT_CLS =
  "w-full min-h-[48px] rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm tabular-nums";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
      {children}
    </p>
  );
}

function Helper({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 leading-snug">{children}</p>;
}

/** Month picker row over the G136 DateField; drafts keep their own month base (0 or 1). */
function monthValue(year: number | null, month: number | null, base: 0 | 1): string {
  if (year == null || month == null) return "";
  return `${year}-${String(month + (base === 0 ? 1 : 0)).padStart(2, "0")}`;
}
function parseMonthValue(v: string, base: 0 | 1): { year: number | null; month: number | null } {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return { year: null, month: null };
  return { year: Number(m[1]), month: Number(m[2]) - (base === 0 ? 1 : 0) };
}

type Phase = "loading" | "found" | "candidates" | "manual";
type ManualPrompt = "notfound" | "different" | "candidates" | "edit";
type BtOfferDraft = { month: number | null; year: number | null; fee: string; note: string };
type PromoDraft = { kind: CardPromoKind | null; month: number | null; year: number | null; rate: string };

function buildBtOffers(rows: BtOfferDraft[], btOffer: boolean | null): BtOffer[] {
  if (btOffer !== true) return [];
  return rows
    .filter(r => r.month !== null || r.year !== null || r.fee.trim() !== "" || r.note.trim() !== "")
    .map(r => ({
      ends: (r.month != null && r.year != null) ? endOfMonthIso(r.year, r.month) : null,
      fee_pct: r.fee.trim() ? Math.round(parseFloat(r.fee) * 100) / 100 : null,
      note: r.note.trim() ? r.note.trim().slice(0, 120) : null,
    }));
}

function validateBtOffers(rows: BtOfferDraft[], btOffer: boolean | null, setError: (e: string) => void): boolean {
  if (btOffer !== true) return true;
  const nonBlank = rows.filter(r => r.month !== null || r.year !== null || r.fee.trim() !== "" || r.note.trim() !== "");
  for (const r of nonBlank) {
    if ((r.month != null) !== (r.year != null)) {
      setError("Pick both the month and year the offer ends.");
      return false;
    }
    if (r.fee.trim()) {
      const v = parseFloat(r.fee);
      if (!isFinite(v) || v < 0 || v > 15) {
        setError("Fees are usually small, enter 0 to 15%.");
        return false;
      }
    }
  }
  return true;
}

type CardDraft = {
  phase: Phase;
  manualPrompt: ManualPrompt;
  rate: string;
  promoOn: boolean | null;
  promoRows: PromoDraft[];
  btOffer: boolean | null;
  btOffers: BtOfferDraft[];
  usage: "clear_monthly" | "carry" | null;
};

/** Everything the sheet shows for one card before the user touches it. Confirmed terms prefill in full so a re-save simply overwrites. */
function draftFor(card: CardTermsCard | null): CardDraft {
  const t = card?.terms;
  if (t && t.status === "confirmed") {
    const promos = t.promos ?? [];
    const existingOffers = t.bt_offers ?? [];
    return {
      phase: "manual",
      manualPrompt: "edit",
      rate: t.apr_pct != null ? String(t.apr_pct) : "",
      promoOn: promos.length > 0 ? true : null,
      promoRows: promos.map((p: CardPromo) => {
        const d = new Date(`${p.until}T00:00:00`);
        return { kind: p.kind, month: d.getMonth() + 1, year: d.getFullYear(), rate: p.apr_pct === 0 ? "" : String(p.apr_pct) };
      }),
      btOffer: existingOffers.length > 0 ? true : null,
      btOffers: existingOffers.map((o: BtOffer) => {
        const fee = o.fee_pct != null ? String(o.fee_pct) : "";
        if (o.ends) {
          const d = new Date(`${o.ends}T00:00:00`);
          return { month: d.getMonth(), year: d.getFullYear(), fee, note: o.note ?? "" };
        }
        return { month: null, year: null, fee, note: o.note ?? "" };
      }),
      usage: t.usage ?? null,
    };
  }
  return { phase: "loading", manualPrompt: "notfound", rate: "", promoOn: null, promoRows: [], btOffer: null, btOffers: [], usage: null };
}

export default function CardTermsSheet({ cards, ready, startAccountId, onClose, onSaved }: CardTermsSheetProps) {
  const { hideNetWorth } = usePreferences();

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
  const initial = useMemo(() => draftFor(current), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [phase, setPhase] = useState<Phase>(initial.phase);
  const [manualPrompt, setManualPrompt] = useState<ManualPrompt>(initial.manualPrompt);
  const [lookup, setLookup] = useState<CardTermsLookup | null>(null);
  const [showRateInput, setShowRateInput] = useState(false);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [rate, setRate] = useState(initial.rate);
  const [promoOn, setPromoOn] = useState<boolean | null>(initial.promoOn);
  const [promoRows, setPromoRows] = useState<PromoDraft[]>(initial.promoRows);
  const [btOffer, setBtOffer] = useState<boolean | null>(initial.btOffer);
  const [btOffers, setBtOffers] = useState<BtOfferDraft[]>(initial.btOffers);
  const [saving, setSaving] = useState<null | "save" | "later">(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<"clear_monthly" | "carry" | null>(initial.usage);

  useEffect(() => {
    if (!currentId || !current) return;
    setError(null);
    setSaving(null);
    setShowRateInput(false);
    setCandidate(null);
    setLookup(null);
    const d = draftFor(current);
    setPhase(d.phase);
    setManualPrompt(d.manualPrompt);
    setRate(d.rate);
    setPromoOn(d.promoOn);
    setPromoRows(d.promoRows);
    setBtOffer(d.btOffer);
    setBtOffers(d.btOffers);
    setUsage(d.usage);
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
      setError("Couldn't save, please try again.");
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
        promos: [],
        usage,
        ...(productKey ? { product_key: productKey } : {}),
      },
      "save"
    );
  }

  function handleSaveManual() {
    // ── Build promos from non-blank rows ─────────────────────────────────────
    const nonBlankRows = promoOn === true
      ? promoRows.filter(r => r.kind != null || r.month != null || r.year != null || r.rate.trim() !== "")
      : [];

    if (promoOn === true) {
      for (const r of nonBlankRows) {
        if (r.kind == null) {
          setError("Pick what each deal covers: purchases, balance transfers, or both.");
          return;
        }
        if (r.month == null || r.year == null) {
          setError("Pick the month and year each deal ends.");
          return;
        }
        const isoEnd = endOfMonthIso(r.year, r.month - 1);
        const today = new Date();
        const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        if (isoEnd < todayIso) {
          setError("Pick a month that's still ahead.");
          return;
        }
        if (r.rate.trim()) {
          const rv = parseFloat(r.rate);
          if (!isFinite(rv) || rv < 0 || rv > 30) {
            setError("Deal rates are small, enter 0 to 30.");
            return;
          }
        }
      }
      // Check duplicate kind + end date
      const seen = new Set<string>();
      for (const r of nonBlankRows) {
        if (r.kind != null && r.month != null && r.year != null) {
          const key = `${r.kind}|${r.year}-${r.month}`;
          if (seen.has(key)) {
            setError("Two deals of the same kind need different end dates.");
            return;
          }
          seen.add(key);
        }
      }
    }

    const builtPromos: CardPromo[] = nonBlankRows
      .filter(r => r.kind != null && r.month != null && r.year != null)
      .map(r => ({
        kind: r.kind!,
        apr_pct: r.rate.trim() ? Math.round(parseFloat(r.rate) * 100) / 100 : 0,
        until: endOfMonthIso(r.year!, r.month! - 1),
      }));

    // ── Standard rate validation ──────────────────────────────────────────────
    let aprPct: number | null = null;
    if (rate.trim() !== "") {
      const v = parseFloat(rate);
      if (!isFinite(v) || v < 0 || v > 100) {
        setError("Enter a rate between 0 and 100.");
        return;
      }
      aprPct = Math.round(v * 100) / 100;
    } else {
      // Blank rate allowed only when there is at least one valid promo
      if (builtPromos.length === 0) {
        setError("Enter a rate between 0 and 100.");
        return;
      }
      aprPct = null;
    }

    if (!validateBtOffers(btOffers, btOffer, setError)) return;

    postAndAdvance(
      {
        status: "confirmed",
        apr_pct: aprPct,
        promos: builtPromos,
        bt_offers: buildBtOffers(btOffers, btOffer),
        usage,
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
    handleSaveManual();
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
  const thisMonthIso = `${thisYear}-${String(thisMonth + 1).padStart(2, "0")}`;

  // No mount guard here: SheetFrame portals and renders nothing until the
  // document exists, so this component is safe on the server and the markup
  // can be asserted by check:g225-card-terms. Never add an early return above
  // a hook (React #310).

  const manualQuestion =
    manualPrompt === "notfound"
      ? "Couldn't find this card's advertised rate. What does yours charge?"
      : manualPrompt === "edit"
      ? "Here's what you've told me. Edit anything that's changed."
      : "What's the rate on it?";

  const closingLine =
    startAccountId
      ? "That's updated, your card picture stays sharp."
      : total === 1
      ? "That's your only card, your card picture is sharp."
      : `That's all ${total}, your card picture is sharp.`;

  const showFooterSave =
    !finished &&
    !!current &&
    (phase === "manual" ||
      (phase === "found" && showRateInput) ||
      (phase === "candidates" && candidate != null));

  const rateInput = (
    <div>
      <FieldLabel>What&apos;s the rate on it?</FieldLabel>
      <Helper>The card&apos;s standard rate: what it charges once no deal covers the balance.</Helper>
      <div className="relative max-w-[160px]">
        <input
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={e => setRate(e.target.value)}
          placeholder="24.9"
          aria-label="Interest rate, percent APR"
          className={`${INPUT_CLS} pl-3 pr-9`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">
          %
        </span>
      </div>
    </div>
  );

  // A card with nothing on it has no "any of this" to point at, so ask about the card instead.
  const noBalance = !current || Math.round(Math.abs(current.balance)) === 0;
  const promoQuestion = noBalance ? "Is this card on a 0% deal?" : `Is any of this ${balanceStr} on a 0% deal?`;

  const promosSection = (
    <div className="space-y-4">
      <div>
        <FieldLabel><MoneyText text={promoQuestion} /></FieldLabel>
        <Helper>Balance transfers you&apos;ve already made count here, add each one and when it ends.</Helper>
        <div role="radiogroup" aria-label={noBalance ? "Is this card on a 0% deal?" : "Is any of this balance on a 0% deal?"} className="grid grid-cols-2 gap-2">
          <Chip
            selected={promoOn === true}
            onClick={() => {
              setPromoOn(true);
              setError(null);
              if (promoRows.length === 0) setPromoRows([{ kind: null, month: null, year: null, rate: "" }]);
            }}
          >
            Yes
          </Chip>
          <Chip
            selected={promoOn === false}
            onClick={() => {
              setPromoOn(false);
              setPromoRows([]);
              setError(null);
            }}
          >
            No
          </Chip>
        </div>
      </div>
      {promoOn === true && (
        <div className="space-y-4">
          {promoRows.map((row, i) => {
            return (
              <div key={i} className={i > 0 ? "pt-4 border-t border-slate-100 dark:border-slate-700/60" : ""}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0">
                    Deal {i + 1}
                  </p>
                  <button
                    type="button"
                    aria-label={`Remove deal ${i + 1}`}
                    onClick={() => {
                      const next = promoRows.filter((_, j) => j !== i);
                      setPromoRows(next.length === 0 ? [{ kind: null, month: null, year: null, rate: "" }] : next);
                    }}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <FieldLabel>On what?</FieldLabel>
                    <div role="radiogroup" aria-label={`What deal ${i + 1} covers`} className="grid grid-cols-3 gap-2">
                      {PROMO_KINDS.map(k => (
                        <Chip
                          key={k.value}
                          selected={row.kind === k.value}
                          onClick={() => {
                            const next = [...promoRows];
                            next[i] = { ...next[i], kind: k.value };
                            setPromoRows(next);
                            setError(null);
                          }}
                        >
                          {k.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Until</FieldLabel>
                    <DateField
                      mode="month"
                      label={`Month deal ${i + 1} ends`}
                      title="When does this deal end?"
                      min={thisMonthIso}
                      value={monthValue(row.year, row.month, 1)}
                      onChange={v => {
                        const { year, month } = parseMonthValue(v, 1);
                        const next = [...promoRows];
                        next[i] = { ...next[i], year, month };
                        setPromoRows(next);
                        setError(null);
                      }}
                    />
                  </div>
                  <div>
                    <FieldLabel>Deal rate</FieldLabel>
                    <div className="relative max-w-[120px]">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.rate}
                        onChange={e => {
                          const next = [...promoRows];
                          next[i] = { ...next[i], rate: e.target.value };
                          setPromoRows(next);
                        }}
                        placeholder="0"
                        aria-label={`Rate for deal ${i + 1}, percent`}
                        className={`${INPUT_CLS} pl-3 pr-9`}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {promoRows.length < 4 && (
            <button
              type="button"
              onClick={() => setPromoRows([...promoRows, { kind: null, month: null, year: null, rate: "" }])}
              className="min-h-[44px] inline-flex items-center text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
            >
              + Add another deal
            </button>
          )}
        </div>
      )}
    </div>
  );

  const btSection = (
    <div className="space-y-4">
      <div>
        <FieldLabel>Any 0% offers you haven&apos;t used yet?</FieldLabel>
        <Helper>Offers your card is advertising that you haven&apos;t used yet, not ones you&apos;ve already taken.</Helper>
        <div role="radiogroup" aria-label="Any 0% offers you haven't used yet?" className="grid grid-cols-2 gap-2">
          <Chip
            selected={btOffer === true}
            onClick={() => {
              setBtOffer(true);
              setError(null);
              if (btOffers.length === 0) setBtOffers([{ month: null, year: null, fee: "", note: "" }]);
            }}
          >
            Yes
          </Chip>
          <Chip
            selected={btOffer === false}
            onClick={() => {
              setBtOffer(false);
              setBtOffers([]);
              setError(null);
            }}
          >
            No
          </Chip>
        </div>
      </div>
      {btOffer === true && (
        <div className="space-y-4">
          {btOffers.map((row, i) => {
            return (
              <div key={i} className={i > 0 ? "pt-4 border-t border-slate-100 dark:border-slate-700/60" : ""}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0">
                    Offer {i + 1}
                  </p>
                  <button
                    type="button"
                    aria-label={`Remove offer ${i + 1}`}
                    onClick={() => {
                      const next = btOffers.filter((_, j) => j !== i);
                      setBtOffers(next.length === 0 ? [{ month: null, year: null, fee: "", note: "" }] : next);
                    }}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <FieldLabel>Ends</FieldLabel>
                    <DateField
                      mode="month"
                      label={`Month offer ${i + 1} ends`}
                      title="When does this offer end?"
                      min={thisMonthIso}
                      value={monthValue(row.year, row.month, 0)}
                      onChange={v => {
                        const { year, month } = parseMonthValue(v, 0);
                        const next = [...btOffers];
                        next[i] = { ...next[i], year, month };
                        setBtOffers(next);
                        setError(null);
                      }}
                    />
                  </div>
                  <div>
                    <FieldLabel>Fee</FieldLabel>
                    <div className="relative max-w-[120px]">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.fee}
                        onChange={e => {
                          const next = [...btOffers];
                          next[i] = { ...next[i], fee: e.target.value };
                          setBtOffers(next);
                        }}
                        placeholder="3"
                        aria-label={`Fee for offer ${i + 1}, percent`}
                        className={`${INPUT_CLS} pl-3 pr-9`}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">
                        %
                      </span>
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Note</FieldLabel>
                    <input
                      type="text"
                      value={row.note}
                      onChange={e => {
                        const next = [...btOffers];
                        next[i] = { ...next[i], note: e.target.value };
                        setBtOffers(next);
                      }}
                      maxLength={120}
                      placeholder="e.g. 0% for 12 months"
                      aria-label={`Note for offer ${i + 1}`}
                      className={`${INPUT_CLS} px-3`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {btOffers.length < 6 && (
            <button
              type="button"
              onClick={() => setBtOffers([...btOffers, { month: null, year: null, fee: "", note: "" }])}
              className="min-h-[44px] inline-flex items-center text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
            >
              + Add another offer
            </button>
          )}
        </div>
      )}
    </div>
  );

  const usageSection = (
    <div>
      <div>
        <FieldLabel>How do you use this card?</FieldLabel>
        <Helper>Optional, it helps me read this card&apos;s balance right.</Helper>
        <div role="radiogroup" aria-label="How do you use this card?" className="grid grid-cols-2 gap-2">
          <Chip
            selected={usage === "clear_monthly"}
            onClick={() => setUsage(prev => prev === "clear_monthly" ? null : "clear_monthly")}
          >
            I clear it monthly
          </Chip>
          <Chip
            selected={usage === "carry"}
            onClick={() => setUsage(prev => prev === "carry" ? null : "carry")}
          >
            I carry a balance
          </Chip>
        </div>
      </div>
    </div>
  );

  return (
    <SheetFrame
      variant="compact"
      title={!finished && current ? current.name : "Card rates"}
      description={!finished && current ? <><MoneyText text={`${balanceStr} on it`} />{total > 1 && <span> · {index + 1} of {total}</span>}</> : "So plans can work with what each card really costs."}
      leading={!finished && current && chip ? <BankBadge logoSrc={chip.logoSrc} initials={chip.initials} initialsSize={chip.initialsSize} altText={chip.label} brandBg={chip.bg} /> : undefined}
      onClose={onClose}
      dismissDisabled={saving !== null}
      footer={({ close }) => {
        if (finished || (ready && !current)) {
          return <button type="button" onClick={close} className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white active:scale-95">Done</button>;
        }
        if (!finished && ready && current && phase !== "loading") {
          return <div className="flex items-center gap-2">
            <button type="button" onClick={handleLater} disabled={saving !== null} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 active:scale-95 disabled:opacity-50 dark:text-slate-400">{saving === "later" ? "Noting…" : "Later"}</button>
            <div className="flex-1" />
            {phase === "found" && !showRateInput ? (
              <button type="button" onClick={handleUseLookupRate} disabled={saving !== null} className="rounded-xl bg-indigo-600 px-8 py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60">{saving === "save" ? "Saving…" : `Use ${fmtApr(foundApr!)}%`}</button>
            ) : showFooterSave ? (
              <button type="button" onClick={handleSave} disabled={saving !== null} className="rounded-xl bg-indigo-600 px-8 py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60">{saving === "save" ? "Saving…" : "Save"}</button>
            ) : null}
          </div>;
        }
        return null;
      }}
    >
            <div className="space-y-6">
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
              </div>
            ) : !current ? (
              /* No credit cards at all */
              <div className="space-y-4 py-2">
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  No credit cards connected, there&apos;s nothing to add here.
                </p>
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
                  rate, so yours may differ. Is it close?
                </p>
                <div className="space-y-6">
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
                  {showRateInput && promosSection}
                  {showRateInput && btSection}
                  {usageSection}
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
                  <div className="space-y-6">
                    {rateInput}
                    {promosSection}
                      {btSection}
                    {usageSection}
                  </div>
                )}
              </>
            ) : (
              /* phase === "manual" */
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {manualQuestion}
                </p>
                {rateInput}
                {promosSection}
                {btSection}
                {usageSection}
              </>
            )}

            {/* Error: calm line, field stays quiet */}
            {error && !finished && current && (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                {error}
              </p>
            )}
            </div>
    </SheetFrame>
  );
}
