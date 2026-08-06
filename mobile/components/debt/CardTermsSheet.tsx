/**
 * CardTermsSheet — bottom sheet for per-card rate / promo / BT-offer entry.
 * Multi-card walk-through with phases: loading → found / candidates / manual → finished.
 * Ported from frontend/components/CardTermsSheet.tsx.
 *
 * Uses the existing mobile BottomSheet primitive (Modal + Animated slide-up).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import {
  lookupCardTerms,
  saveCardTerms,
  type BtOffer,
  type CardPromo,
  type CardPromoKind,
  type CardTermsCard,
  type CardTermsLookup,
  type CardTermsSaveBody,
} from "../../lib/api/debt";
import { tw } from "../../lib/tw";
import { BottomSheet } from "../ui/BottomSheet";
import { endOfMonthIso, MONTHS, THIS_MONTH } from "./helpers";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "loading" | "found" | "candidates" | "manual";
type ManualPrompt = "notfound" | "different" | "candidates" | "edit";
type BtOfferDraft = {
  month: number | null; // 0-based index into MONTHS
  year: number | null;
  fee: string;
  note: string;
};
type PromoDraft = {
  kind: CardPromoKind | null;
  month: number | null; // 1-based (Jan=1)
  year: number | null;
  rate: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROMO_KINDS: { value: CardPromoKind; label: string }[] = [
  { value: "purchases", label: "Purchases" },
  { value: "balance_transfer", label: "Balance transfers" },
  { value: "both", label: "Both" },
];

const THIS_YEAR = new Date().getFullYear();
const BASE_YEARS = [THIS_YEAR, THIS_YEAR + 1, THIS_YEAR + 2, THIS_YEAR + 3];

function buildBtOffers(rows: BtOfferDraft[], btOn: boolean | null): BtOffer[] {
  if (btOn !== true) return [];
  return rows
    .filter(
      r =>
        r.month !== null ||
        r.year !== null ||
        r.fee.trim() !== "" ||
        r.note.trim() !== "",
    )
    .map(r => ({
      ends:
        r.month != null && r.year != null
          ? endOfMonthIso(r.year, r.month)
          : null,
      fee_pct: r.fee.trim() ? Math.round(parseFloat(r.fee) * 100) / 100 : null,
      note: r.note.trim() ? r.note.trim().slice(0, 120) : null,
    }));
}

function validateBtOffers(
  rows: BtOfferDraft[],
  btOn: boolean | null,
  setError: (e: string) => void,
): boolean {
  if (btOn !== true) return true;
  const nonBlank = rows.filter(
    r =>
      r.month !== null ||
      r.year !== null ||
      r.fee.trim() !== "" ||
      r.note.trim() !== "",
  );
  for (const r of nonBlank) {
    if ((r.month != null) !== (r.year != null)) {
      setError("Pick both the month and year the offer ends.");
      return false;
    }
    if (r.fee.trim()) {
      const v = parseFloat(r.fee);
      if (!isFinite(v) || v < 0 || v > 15) {
        setError("Fees are usually small — enter 0 to 15%.");
        return false;
      }
    }
  }
  return true;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldLabel({
  children,
  dark,
}: {
  children: string;
  dark?: boolean;
}) {
  return (
    <Text style={[fl.text, dark && fl.textDark]}>{children}</Text>
  );
}
const fl = StyleSheet.create({
  text: {
    ...tw.text["11"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
    color: tw.color.slate500,
    marginBottom: tw.space[1.5],
  },
  textDark: { color: tw.color.slate400 },
});

function Chip({
  selected,
  disabled,
  onPress,
  children,
  dark,
}: {
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: string;
  dark?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        ch.base,
        selected
          ? [ch.selected, dark && ch.selectedDark]
          : [ch.idle, dark && ch.idleDark],
        disabled && ch.disabled,
        pressed && !disabled && ch.pressed,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
    >
      <Text
        style={[
          ch.label,
          selected ? [ch.labelSelected, dark && ch.labelSelectedDark] : [ch.labelIdle, dark && ch.labelIdleDark],
          disabled && ch.labelDisabled,
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}
const ch = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: tw.space[2],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  selected: {
    borderColor: tw.color.indigo500,
    backgroundColor: tw.color.indigo50,
  },
  selectedDark: {
    borderColor: tw.color.indigo400,
    backgroundColor: "rgba(79,70,229,0.15)",
  },
  idle: {
    borderColor: tw.color.slate200,
    backgroundColor: "transparent",
  },
  idleDark: {
    borderColor: tw.color.slate600,
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: tw.weight.semibold },
  labelSelected: { color: tw.color.indigo700 },
  labelSelectedDark: { color: tw.color.indigo300 },
  labelIdle: { color: tw.color.slate600 },
  labelIdleDark: { color: tw.color.slate300 },
  labelDisabled: { opacity: 0.5 },
});

// ── Props ─────────────────────────────────────────────────────────────────────

interface CardTermsSheetProps {
  visible: boolean;
  cards: CardTermsCard[];
  ready: boolean;
  startAccountId?: string | null;
  onClose: () => void;
  onSaved: () => void;
  dark?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CardTermsSheet({
  visible,
  cards,
  ready,
  startAccountId,
  onClose,
  onSaved,
  dark,
}: CardTermsSheetProps) {
  const insets = useSafeAreaInsets();

  const sequence = useMemo(
    () =>
      startAccountId
        ? cards.filter(c => c.account_id === startAccountId)
        : cards,
    [cards, startAccountId],
  );

  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  const current = sequence[index] ?? null;
  const currentId = current?.account_id ?? null;
  const total = sequence.length;

  // ── Per-card state ────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("loading");
  const [manualPrompt, setManualPrompt] = useState<ManualPrompt>("notfound");
  const [lookup, setLookup] = useState<CardTermsLookup | null>(null);
  const [showRateInput, setShowRateInput] = useState(false);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [rate, setRate] = useState("");
  const [promoOn, setPromoOn] = useState<boolean | null>(null);
  const [promoRows, setPromoRows] = useState<PromoDraft[]>([]);
  const [btOffer, setBtOffer] = useState<boolean | null>(null);
  const [btOffers, setBtOffers] = useState<BtOfferDraft[]>([]);
  const [usage, setUsage] = useState<"clear_monthly" | "carry" | null>(null);
  const [saving, setSaving] = useState<null | "save" | "later">(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state when current card changes
  useEffect(() => {
    if (!currentId || !current) return;
    setError(null);
    setSaving(null);
    setShowRateInput(false);
    setCandidate(null);
    setLookup(null);
    const t = current.terms;
    if (t && t.status === "confirmed") {
      setPhase("manual");
      setManualPrompt("edit");
      setRate(t.apr_pct != null ? String(t.apr_pct) : "");
      const promos = t.promos ?? [];
      setPromoOn(promos.length > 0 ? true : null);
      setPromoRows(
        promos.map((p: CardPromo) => {
          const d = new Date(`${p.until}T00:00:00`);
          return {
            kind: p.kind,
            month: d.getMonth() + 1, // 1-based
            year: d.getFullYear(),
            rate: p.apr_pct === 0 ? "" : String(p.apr_pct),
          };
        }),
      );
      const existingOffers = t.bt_offers ?? [];
      setBtOffer(existingOffers.length > 0 ? true : null);
      setBtOffers(
        existingOffers.map((o: BtOffer) => {
          if (o.ends) {
            const d = new Date(`${o.ends}T00:00:00`);
            return {
              month: d.getMonth(), // 0-based
              year: d.getFullYear(),
              fee: o.fee_pct != null ? String(o.fee_pct) : "",
              note: o.note ?? "",
            };
          }
          return { month: null, year: null, fee: o.fee_pct != null ? String(o.fee_pct) : "", note: o.note ?? "" };
        }),
      );
      setUsage(t.usage ?? null);
    } else {
      setPhase("loading");
      setManualPrompt("notfound");
      setRate("");
      setPromoOn(null);
      setPromoRows([]);
      setBtOffer(null);
      setBtOffers([]);
      setUsage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // Fire lookup when phase=loading
  useEffect(() => {
    if (!currentId || phase !== "loading") return;
    let cancelled = false;
    lookupCardTerms(currentId)
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
    return () => { cancelled = true; };
  }, [currentId, phase]);

  const productKey = lookup?.product_key ?? current?.terms?.product_key ?? null;

  function advance() {
    if (index + 1 >= total) {
      setFinished(true);
    } else {
      setIndex(i => i + 1);
    }
  }

  const postAndAdvance = useCallback(
    async (body: CardTermsSaveBody, which: "save" | "later") => {
      if (!currentId || saving) return;
      setSaving(which);
      setError(null);
      try {
        await saveCardTerms(currentId, body);
        onSaved();
        advance();
      } catch {
        setError("Couldn't save — please try again.");
      } finally {
        setSaving(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentId, saving, onSaved],
  );

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
      "save",
    );
  }

  function handleSaveManual() {
    const nonBlankRows =
      promoOn === true
        ? promoRows.filter(
            r =>
              r.kind != null ||
              r.month != null ||
              r.year != null ||
              r.rate.trim() !== "",
          )
        : [];

    if (promoOn === true) {
      for (const r of nonBlankRows) {
        if (r.kind == null) {
          setError("Pick what each deal covers — purchases, balance transfers, or both.");
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
            setError("Deal rates are small — enter 0 to 30.");
            return;
          }
        }
      }
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

    let aprPct: number | null = null;
    if (rate.trim() !== "") {
      const v = parseFloat(rate);
      if (!isFinite(v) || v < 0 || v > 100) {
        setError("Enter a rate between 0 and 100.");
        return;
      }
      aprPct = Math.round(v * 100) / 100;
    } else if (builtPromos.length === 0) {
      setError("Enter a rate between 0 and 100.");
      return;
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
      "save",
    );
  }

  function handleLater() {
    postAndAdvance(
      { status: "skipped", ...(productKey ? { product_key: productKey } : {}) },
      "later",
    );
  }

  const showFooterSave =
    !finished &&
    !!current &&
    (phase === "manual" ||
      (phase === "found" && showRateInput) ||
      (phase === "candidates" && candidate != null));

  const foundApr = lookup?.representative_apr;
  const foundName = lookup?.display_name || current?.name || "This card";

  const balanceStr = current
    ? `£${Math.abs(current.balance).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
    : "";

  const manualQuestion =
    manualPrompt === "notfound"
      ? "Couldn't find this card's advertised rate — what does yours charge?"
      : manualPrompt === "edit"
      ? "Here's what you've told me — edit anything that's changed."
      : "What's the rate on it?";

  const closingLine = startAccountId
    ? "That's updated — your card picture stays sharp."
    : total === 1
    ? "That's your only card — your card picture is sharp."
    : `That's all ${total} — your card picture is sharp.`;

  // ── Rate input ──────────────────────────────────────────────────────────
  const rateInput = (
    <View>
      <FieldLabel dark={dark}>What's the rate on it?</FieldLabel>
      <Text style={[inp.hint, dark && inp.hintDark]}>
        The card's standard rate — what it charges once no deal covers the balance.
      </Text>
      <View style={inp.wrap}>
        <TextInput
          value={rate}
          onChangeText={setRate}
          placeholder="24.9"
          placeholderTextColor={tw.color.slate400}
          keyboardType="decimal-pad"
          accessibilityLabel="Interest rate, percent APR"
          style={[inp.field, dark && inp.fieldDark]}
        />
        <Text style={[inp.suffix, dark && inp.suffixDark]}>%</Text>
      </View>
    </View>
  );

  // ── 0% promos section ───────────────────────────────────────────────────
  const promosSection = (
    <View style={sec.container}>
      <FieldLabel dark={dark}>
        {`Is any of this ${balanceStr} on a 0% deal?`}
      </FieldLabel>
      <Text style={[inp.hint, dark && inp.hintDark]}>
        Balance transfers you've already made count here — add each one and when it ends.
      </Text>
      <View style={sec.chipRow}>
        <Chip
          selected={promoOn === true}
          onPress={() => {
            setPromoOn(true);
            setError(null);
            if (promoRows.length === 0) {
              setPromoRows([{ kind: null, month: null, year: null, rate: "" }]);
            }
          }}
          dark={dark}
        >
          Yes
        </Chip>
        <Chip
          selected={promoOn === false}
          onPress={() => {
            setPromoOn(false);
            setPromoRows([]);
            setError(null);
          }}
          dark={dark}
        >
          No
        </Chip>
      </View>

      {promoOn === true &&
        promoRows.map((row, i) => {
          const rowYears = BASE_YEARS.includes(row.year ?? -1)
            ? BASE_YEARS
            : [...BASE_YEARS, row.year!].sort((a, b) => a - b);
          return (
            <View
              key={i}
              style={[sec.dealBlock, i > 0 && sec.dealBlockBorder, dark && sec.dealBlockBorderDark]}
            >
              <View style={sec.dealHeader}>
                <Text style={[sec.dealTitle, dark && sec.dealTitleDark]}>
                  Deal {i + 1}
                </Text>
                <Pressable
                  onPress={() => {
                    const next = promoRows.filter((_, j) => j !== i);
                    setPromoRows(
                      next.length === 0
                        ? [{ kind: null, month: null, year: null, rate: "" }]
                        : next,
                    );
                  }}
                  style={sec.removeBtn}
                  accessibilityLabel={`Remove deal ${i + 1}`}
                >
                  <X size={14} color={tw.color.slate400} />
                </Pressable>
              </View>

              <FieldLabel dark={dark}>On what?</FieldLabel>
              <View style={sec.chipGrid3}>
                {PROMO_KINDS.map(k => (
                  <Chip
                    key={k.value}
                    selected={row.kind === k.value}
                    onPress={() => {
                      const next = [...promoRows];
                      next[i] = { ...next[i], kind: k.value };
                      setPromoRows(next);
                      setError(null);
                    }}
                    dark={dark}
                  >
                    {k.label}
                  </Chip>
                ))}
              </View>

              <FieldLabel dark={dark}>Until</FieldLabel>
              <View style={sec.chipGrid4}>
                {MONTHS.map((m, mi) => (
                  <Chip
                    key={m}
                    selected={row.month === mi + 1}
                    disabled={row.year === THIS_YEAR && mi < THIS_MONTH}
                    onPress={() => {
                      const next = [...promoRows];
                      next[i] = { ...next[i], month: mi + 1 };
                      setPromoRows(next);
                      setError(null);
                    }}
                    dark={dark}
                  >
                    {m}
                  </Chip>
                ))}
              </View>
              <View style={[sec.chipGrid4, sec.mt2]}>
                {rowYears.map(y => (
                  <Chip
                    key={y}
                    selected={row.year === y}
                    onPress={() => {
                      const next = [...promoRows];
                      const newMonth =
                        y === THIS_YEAR &&
                        next[i].month != null &&
                        next[i].month! - 1 < THIS_MONTH
                          ? null
                          : next[i].month;
                      next[i] = { ...next[i], year: y, month: newMonth };
                      setPromoRows(next);
                      setError(null);
                    }}
                    dark={dark}
                  >
                    {String(y)}
                  </Chip>
                ))}
              </View>

              <FieldLabel dark={dark}>Deal rate</FieldLabel>
              <View style={inp.wrap}>
                <TextInput
                  value={row.rate}
                  onChangeText={v => {
                    const next = [...promoRows];
                    next[i] = { ...next[i], rate: v };
                    setPromoRows(next);
                  }}
                  placeholder="0"
                  placeholderTextColor={tw.color.slate400}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Rate for deal ${i + 1}, percent`}
                  style={[inp.field, inp.fieldNarrow, dark && inp.fieldDark]}
                />
                <Text style={[inp.suffix, dark && inp.suffixDark]}>%</Text>
              </View>
            </View>
          );
        })}

      {promoOn === true && promoRows.length < 4 && (
        <Pressable
          onPress={() =>
            setPromoRows([
              ...promoRows,
              { kind: null, month: null, year: null, rate: "" },
            ])
          }
          style={sec.addBtn}
        >
          <Text style={[sec.addBtnText, dark && sec.addBtnTextDark]}>
            + Add another deal
          </Text>
        </Pressable>
      )}
    </View>
  );

  // ── BT offers section ───────────────────────────────────────────────────
  const btSection = (
    <View style={sec.container}>
      <FieldLabel dark={dark}>Any 0% offers you haven't used yet?</FieldLabel>
      <Text style={[inp.hint, dark && inp.hintDark]}>
        Offers the card is dangling — not ones you've already taken.
      </Text>
      <View style={sec.chipRow}>
        <Chip
          selected={btOffer === true}
          onPress={() => {
            setBtOffer(true);
            setError(null);
            if (btOffers.length === 0) {
              setBtOffers([{ month: null, year: null, fee: "", note: "" }]);
            }
          }}
          dark={dark}
        >
          Yes
        </Chip>
        <Chip
          selected={btOffer === false}
          onPress={() => {
            setBtOffer(false);
            setBtOffers([]);
            setError(null);
          }}
          dark={dark}
        >
          No
        </Chip>
      </View>

      {btOffer === true &&
        btOffers.map((row, i) => {
          const rowYears = BASE_YEARS.includes(row.year ?? -1)
            ? BASE_YEARS
            : [...BASE_YEARS, row.year!].sort((a, b) => a - b);
          return (
            <View
              key={i}
              style={[sec.dealBlock, i > 0 && sec.dealBlockBorder, dark && sec.dealBlockBorderDark]}
            >
              <View style={sec.dealHeader}>
                <Text style={[sec.dealTitle, dark && sec.dealTitleDark]}>
                  Offer {i + 1}
                </Text>
                <Pressable
                  onPress={() => {
                    const next = btOffers.filter((_, j) => j !== i);
                    setBtOffers(
                      next.length === 0
                        ? [{ month: null, year: null, fee: "", note: "" }]
                        : next,
                    );
                  }}
                  style={sec.removeBtn}
                  accessibilityLabel={`Remove offer ${i + 1}`}
                >
                  <X size={14} color={tw.color.slate400} />
                </Pressable>
              </View>

              <FieldLabel dark={dark}>Ends</FieldLabel>
              <View style={sec.chipGrid4}>
                {MONTHS.map((m, mi) => (
                  <Chip
                    key={m}
                    selected={row.month === mi}
                    disabled={row.year === THIS_YEAR && mi < THIS_MONTH}
                    onPress={() => {
                      const next = [...btOffers];
                      next[i] = { ...next[i], month: mi };
                      setBtOffers(next);
                      setError(null);
                    }}
                    dark={dark}
                  >
                    {m}
                  </Chip>
                ))}
              </View>
              <View style={[sec.chipGrid4, sec.mt2]}>
                {rowYears.map(y => (
                  <Chip
                    key={y}
                    selected={row.year === y}
                    onPress={() => {
                      const next = [...btOffers];
                      const newMonth =
                        y === THIS_YEAR &&
                        next[i].month != null &&
                        next[i].month! < THIS_MONTH
                          ? null
                          : next[i].month;
                      next[i] = { ...next[i], year: y, month: newMonth };
                      setBtOffers(next);
                      setError(null);
                    }}
                    dark={dark}
                  >
                    {String(y)}
                  </Chip>
                ))}
              </View>

              <FieldLabel dark={dark}>Fee</FieldLabel>
              <View style={inp.wrap}>
                <TextInput
                  value={row.fee}
                  onChangeText={v => {
                    const next = [...btOffers];
                    next[i] = { ...next[i], fee: v };
                    setBtOffers(next);
                  }}
                  placeholder="3"
                  placeholderTextColor={tw.color.slate400}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Fee for offer ${i + 1}, percent`}
                  style={[inp.field, inp.fieldNarrow, dark && inp.fieldDark]}
                />
                <Text style={[inp.suffix, dark && inp.suffixDark]}>%</Text>
              </View>

              <FieldLabel dark={dark}>Note</FieldLabel>
              <TextInput
                value={row.note}
                onChangeText={v => {
                  const next = [...btOffers];
                  next[i] = { ...next[i], note: v };
                  setBtOffers(next);
                }}
                maxLength={120}
                placeholder="e.g. 0% for 12 months"
                placeholderTextColor={tw.color.slate400}
                accessibilityLabel={`Note for offer ${i + 1}`}
                style={[inp.field, inp.fieldFull, dark && inp.fieldDark]}
              />
            </View>
          );
        })}

      {btOffer === true && btOffers.length < 6 && (
        <Pressable
          onPress={() =>
            setBtOffers([...btOffers, { month: null, year: null, fee: "", note: "" }])
          }
          style={sec.addBtn}
        >
          <Text style={[sec.addBtnText, dark && sec.addBtnTextDark]}>
            + Add another offer
          </Text>
        </Pressable>
      )}
    </View>
  );

  // ── Usage section ───────────────────────────────────────────────────────
  const usageSection = (
    <View style={sec.container}>
      <FieldLabel dark={dark}>How do you use this card?</FieldLabel>
      <Text style={[inp.hint, dark && inp.hintDark]}>
        Optional — it helps me read this card's balance right.
      </Text>
      <View style={sec.chipRow}>
        <Chip
          selected={usage === "clear_monthly"}
          onPress={() =>
            setUsage(prev => (prev === "clear_monthly" ? null : "clear_monthly"))
          }
          dark={dark}
        >
          I clear it monthly
        </Chip>
        <Chip
          selected={usage === "carry"}
          onPress={() => setUsage(prev => (prev === "carry" ? null : "carry"))}
          dark={dark}
        >
          I carry a balance
        </Chip>
      </View>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {/* Header */}
      <View style={[hd.row, dark && hd.rowDark]}>
        <View style={hd.titleArea}>
          {!finished && current ? (
            <>
              <Text style={[hd.name, dark && hd.nameDark]} numberOfLines={1}>
                {current.name}
              </Text>
              <Text style={[hd.sub, dark && hd.subDark]}>
                {balanceStr} on it
                {total > 1 ? ` · ${index + 1} of ${total}` : ""}
              </Text>
            </>
          ) : (
            <>
              <Text style={[hd.name, dark && hd.nameDark]}>Card rates</Text>
              <Text style={[hd.sub, dark && hd.subDark]}>
                So plans can work with what each card really costs.
              </Text>
            </>
          )}
        </View>
        <Pressable
          onPress={onClose}
          style={hd.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <X size={15} color={dark ? tw.color.slate400 : tw.color.slate500} />
        </Pressable>
      </View>

      {/* Scrollable body */}
      <ScrollView
        style={sv.scroll}
        contentContainerStyle={[
          sv.content,
          { paddingBottom: insets.bottom + tw.space[6] },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!ready ? (
          <View style={sv.center}>
            <ActivityIndicator color={tw.color.indigo600} />
          </View>
        ) : finished ? (
          <View style={sv.gap}>
            <View style={[sv.closingBox, dark && sv.closingBoxDark]}>
              <Text style={[sv.closingText, dark && sv.closingTextDark]}>
                {closingLine}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [sv.primaryBtn, pressed && sv.btnPressed]}
              accessibilityRole="button"
            >
              <Text style={sv.primaryBtnText}>Done</Text>
            </Pressable>
          </View>
        ) : !current ? (
          <View style={sv.gap}>
            <Text style={[sv.bodyText, dark && sv.bodyTextDark]}>
              No credit cards connected — there's nothing to add here.
            </Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [sv.primaryBtn, pressed && sv.btnPressed]}
              accessibilityRole="button"
            >
              <Text style={sv.primaryBtnText}>Done</Text>
            </Pressable>
          </View>
        ) : phase === "loading" ? (
          <View style={sv.gap}>
            <Text style={[sv.bodyText, dark && sv.bodyTextDark]}>
              Checking this card's advertised rate…
            </Text>
            <View style={sv.skeletonLong} />
            <View style={sv.skeletonMid} />
          </View>
        ) : phase === "found" ? (
          <View style={sv.gap}>
            <Text style={[sv.bodyText, dark && sv.bodyTextDark]}>
              {`${foundName} advertises around ${foundApr}%. That's the representative rate, so yours may differ — is it close?`}
            </Text>
            <Pressable
              onPress={handleUseLookupRate}
              disabled={saving !== null}
              style={({ pressed }) => [
                sv.primaryBtn,
                saving !== null && sv.btnDisabled,
                pressed && sv.btnPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={sv.primaryBtnText}>
                {saving === "save" ? "Saving…" : `Use ${foundApr}%`}
              </Text>
            </Pressable>
            {!showRateInput && (
              <Pressable
                onPress={() => {
                  setError(null);
                  setShowRateInput(true);
                  setManualPrompt("different");
                }}
                style={({ pressed }) => [
                  sv.secondaryBtn,
                  dark && sv.secondaryBtnDark,
                  pressed && sv.btnPressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={[sv.secondaryBtnText, dark && sv.secondaryBtnTextDark]}>
                  It's different
                </Text>
              </Pressable>
            )}
            {showRateInput && rateInput}
            {showRateInput && promosSection}
            {promoOn !== true && (
              <Pressable
                onPress={() => {
                  setError(null);
                  setShowRateInput(true);
                  setPromoOn(true);
                  if (promoRows.length === 0) {
                    setPromoRows([{ kind: null, month: null, year: null, rate: "" }]);
                  }
                }}
                style={({ pressed }) => [
                  sv.secondaryBtn,
                  dark && sv.secondaryBtnDark,
                  pressed && sv.btnPressed,
                ]}
              >
                <Text style={[sv.secondaryBtnText, dark && sv.secondaryBtnTextDark]}>
                  It's on a 0% deal
                </Text>
              </Pressable>
            )}
            {showRateInput && btSection}
            {usageSection}
          </View>
        ) : phase === "candidates" ? (
          <View style={sv.gap}>
            <Text style={[sv.bodyText, dark && sv.bodyTextDark]}>
              Which card is this?
            </Text>
            <View style={[sv.candidateList, dark && sv.candidateListDark]}>
              {(lookup?.candidates ?? []).map(name => (
                <Pressable
                  key={name}
                  onPress={() => { setCandidate(name); setError(null); }}
                  style={({ pressed }) => [
                    sv.candidateRow,
                    dark && sv.candidateRowDark,
                    pressed && sv.btnPressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: candidate === name }}
                >
                  <Text
                    style={[sv.candidateName, dark && sv.candidateNameDark]}
                  >
                    {name}
                  </Text>
                  {/* Radio dot */}
                  <View
                    style={[
                      sv.radioDot,
                      candidate === name && sv.radioDotSelected,
                    ]}
                  />
                </Pressable>
              ))}
            </View>
            {candidate != null && (
              <>
                {rateInput}
                {promosSection}
                {promoOn !== true && (
                  <Pressable
                    onPress={() => {
                      setError(null);
                      setPromoOn(true);
                      if (promoRows.length === 0) {
                        setPromoRows([{ kind: null, month: null, year: null, rate: "" }]);
                      }
                    }}
                    style={({ pressed }) => [
                      sv.secondaryBtn,
                      dark && sv.secondaryBtnDark,
                      pressed && sv.btnPressed,
                    ]}
                  >
                    <Text style={[sv.secondaryBtnText, dark && sv.secondaryBtnTextDark]}>
                      It's on a 0% deal
                    </Text>
                  </Pressable>
                )}
                {btSection}
                {usageSection}
              </>
            )}
          </View>
        ) : (
          /* phase === "manual" */
          <View style={sv.gap}>
            <Text style={[sv.bodyText, dark && sv.bodyTextDark]}>
              {manualQuestion}
            </Text>
            {rateInput}
            {promosSection}
            {promoOn !== true && (
              <Pressable
                onPress={() => {
                  setError(null);
                  setPromoOn(true);
                  if (promoRows.length === 0) {
                    setPromoRows([{ kind: null, month: null, year: null, rate: "" }]);
                  }
                }}
                style={({ pressed }) => [
                  sv.secondaryBtn,
                  dark && sv.secondaryBtnDark,
                  pressed && sv.btnPressed,
                ]}
              >
                <Text style={[sv.secondaryBtnText, dark && sv.secondaryBtnTextDark]}>
                  It's on a 0% deal
                </Text>
              </Pressable>
            )}
            {btSection}
            {usageSection}
          </View>
        )}

        {error && !finished && current && (
          <Text style={sv.error} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </ScrollView>

      {/* Footer: Later + Save */}
      {!finished && ready && current && phase !== "loading" && (
        <View
          style={[
            ft.row,
            dark && ft.rowDark,
            { paddingBottom: Math.max(insets.bottom, tw.space[3]) },
          ]}
        >
          <Pressable
            onPress={handleLater}
            disabled={saving !== null}
            style={({ pressed }) => [
              ft.laterBtn,
              saving !== null && ft.btnDisabled,
              pressed && sv.btnPressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={[ft.laterText, dark && ft.laterTextDark]}>
              {saving === "later" ? "Noting…" : "Later"}
            </Text>
          </Pressable>
          <View style={ft.spacer} />
          {showFooterSave && (
            <Pressable
              onPress={handleSaveManual}
              disabled={saving !== null}
              style={({ pressed }) => [
                ft.saveBtn,
                saving !== null && ft.btnDisabled,
                pressed && sv.btnPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={ft.saveBtnText}>
                {saving === "save" ? "Saving…" : "Save"}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </BottomSheet>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const hd = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    paddingHorizontal: tw.space[5],
    paddingTop: tw.space[2],
    paddingBottom: tw.space[3],
  },
  rowDark: {},
  titleArea: { flex: 1, minWidth: 0 },
  name: {
    ...tw.text.base,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate900,
  },
  nameDark: { color: tw.color.slate100 },
  sub: { ...tw.text.xs, color: tw.color.slate500 },
  subDark: { color: tw.color.slate400 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: tw.radius.full,
    backgroundColor: tw.color.slate100,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginLeft: tw.space[2],
  },
});

const sv = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: tw.space[5],
    paddingTop: tw.space[2],
    gap: tw.space[4],
  },
  gap: { gap: tw.space[4] },
  center: { paddingVertical: tw.space[12], alignItems: "center" },
  closingBox: {
    borderRadius: tw.radius["2xl"],
    backgroundColor: tw.color.indigo50,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[5],
  },
  closingBoxDark: { backgroundColor: "rgba(79,70,229,0.15)" },
  closingText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate900,
    lineHeight: 20,
  },
  closingTextDark: { color: tw.color.slate100 },
  bodyText: { ...tw.text.sm, lineHeight: 20, color: tw.color.slate700 },
  bodyTextDark: { color: tw.color.slate200 },
  skeletonLong: {
    height: 16,
    borderRadius: tw.radius.lg,
    backgroundColor: tw.color.slate100,
    width: "75%",
  },
  skeletonMid: {
    height: 16,
    borderRadius: tw.radius.lg,
    backgroundColor: tw.color.slate100,
    width: "50%",
  },
  primaryBtn: {
    minHeight: 48,
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.indigo600,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  secondaryBtn: {
    minHeight: 48,
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    borderColor: tw.color.slate200,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnDark: { borderColor: tw.color.slate600 },
  secondaryBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate700,
  },
  secondaryBtnTextDark: { color: tw.color.slate200 },
  btnDisabled: { opacity: 0.6 },
  btnPressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  candidateList: {
    borderRadius: tw.radius.xl,
    borderWidth: 1,
    borderColor: tw.color.slate200,
    overflow: "hidden",
  },
  candidateListDark: { borderColor: tw.color.slate600 },
  candidateRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2.5],
    borderTopWidth: 0,
  },
  candidateRowDark: {},
  candidateName: {
    flex: 1,
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
    color: tw.color.slate700,
  },
  candidateNameDark: { color: tw.color.slate200 },
  radioDot: {
    width: 18,
    height: 18,
    borderRadius: tw.radius.full,
    borderWidth: 2,
    borderColor: tw.color.slate300,
    flexShrink: 0,
  },
  radioDotSelected: {
    borderColor: tw.color.indigo600,
    backgroundColor: tw.color.indigo600,
  },
  error: {
    ...tw.text.sm,
    color: tw.color.rose500,
    marginTop: tw.space[1],
  },
});

const inp = StyleSheet.create({
  hint: {
    ...tw.text.xs,
    color: tw.color.slate400,
    marginBottom: tw.space[1.5],
    lineHeight: 16,
  },
  hintDark: { color: tw.color.slate500 },
  wrap: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 160,
  },
  field: {
    flex: 1,
    minHeight: 48,
    paddingLeft: tw.space[3],
    paddingRight: tw.space[9],
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.slate50,
    borderWidth: 1,
    borderColor: "transparent",
    ...tw.text.sm,
    color: tw.color.slate900,
  },
  fieldDark: {
    backgroundColor: tw.color.slate700,
    color: tw.color.slate100,
  },
  fieldNarrow: { maxWidth: 120 },
  fieldFull: { maxWidth: undefined, flex: 1, paddingRight: tw.space[3] },
  suffix: {
    position: "absolute",
    right: tw.space[3],
    color: tw.color.slate500,
    ...tw.text.sm,
  },
  suffixDark: { color: tw.color.slate400 },
});

const sec = StyleSheet.create({
  container: { gap: tw.space[3] },
  chipRow: {
    flexDirection: "row",
    gap: tw.space[2],
  },
  chipGrid3: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[2],
  },
  chipGrid4: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[2],
  },
  dealBlock: {
    marginTop: tw.space[3],
    gap: tw.space[3],
  },
  dealBlockBorder: {
    paddingTop: tw.space[3],
    borderTopWidth: 1,
    borderTopColor: tw.color.cardBorderLight,
  },
  dealBlockBorderDark: {
    borderTopColor: tw.color.cardBorderDark,
  },
  dealHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dealTitle: {
    ...tw.text["11"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
    color: tw.color.slate500,
  },
  dealTitleDark: { color: tw.color.slate400 },
  removeBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tw.radius.full,
  },
  addBtn: {
    minHeight: 44,
    justifyContent: "center",
  },
  addBtnText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: tw.weight.semibold,
    color: tw.color.indigo600,
  },
  addBtnTextDark: { color: tw.color.indigo400 },
  mt2: { marginTop: tw.space[2] },
});

const ft = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    paddingHorizontal: tw.space[5],
    paddingTop: tw.space[3],
    borderTopWidth: 1,
    borderTopColor: tw.color.cardBorderLight,
  },
  rowDark: { borderTopColor: tw.color.cardBorderDark },
  spacer: { flex: 1 },
  laterBtn: {
    minHeight: 48,
    paddingHorizontal: tw.space[4],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tw.radius.xl,
  },
  laterText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate500,
  },
  laterTextDark: { color: tw.color.slate400 },
  saveBtn: {
    minHeight: 48,
    paddingHorizontal: tw.space[8],
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.indigo600,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  btnDisabled: { opacity: 0.6 },
});
