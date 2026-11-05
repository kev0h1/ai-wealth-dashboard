"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { DateField } from "@/components/DatePicker";
import { SheetFrame } from "@/components/SheetFrame";
import { usePreferences } from "@/components/PreferencesContext";
import { api, type CardPromoKind, type CardRatesSaveBody, type CardTermsCard } from "@/lib/api";
import { Choices, TextField } from "./Fields";
import styles from "./CardSettings.module.css";

export type RatesServices = Pick<typeof api, "saveCardRates">;

export interface RatesSheetProps {
  card: CardTermsCard;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  hiddenOverride?: boolean;
  services?: RatesServices;
  themeClass?: string;
}

type PromoDraft = { id: string; kind: CardPromoKind; until: string; originalUntil: string | null; rate: string; rateEditing: boolean };
type OfferDraft = { id: string; ends: string; originalEnds: string | null; fee: string; note: string };

const monthEnd = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  const year = Number(match[1]); const month = Number(match[2]);
  return `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
};
const monthValue = (iso: string | null) => iso ? iso.slice(0, 7) : "";
const validPercent = (value: string, max: number) => /^\d+(\.\d{1,2})?$/.test(value) && Number(value) >= 0 && Number(value) <= max;

function initialPromos(card: CardTermsCard): PromoDraft[] {
  return (card.terms?.promos ?? []).map((promo, index) => ({ id: `promo-${index}`, kind: promo.kind, until: monthValue(promo.until), originalUntil: promo.until, rate: String(promo.apr_pct), rateEditing: promo.apr_pct !== 0 }));
}
function initialOffers(card: CardTermsCard): OfferDraft[] {
  return (card.terms?.bt_offers ?? []).map((offer, index) => ({ id: `offer-${index}`, ends: monthValue(offer.ends), originalEnds: offer.ends, fee: offer.fee_pct == null ? "" : String(offer.fee_pct), note: offer.note ?? "" }));
}

export default function RatesSheet({ card, onClose, onSaved, hiddenOverride, services = api, themeClass }: RatesSheetProps) {
  const { hideNetWorth, preferencesReady } = usePreferences();
  // Retain the seam so callers can make privacy-ready renders deterministic.
  void (hiddenOverride ?? (hideNetWorth || !preferencesReady));
  const terms = card.terms;
  const [apr, setApr] = useState(terms?.apr_pct == null ? "" : String(terms.apr_pct));
  const [promos, setPromos] = useState(() => initialPromos(card));
  const [offers, setOffers] = useState(() => initialOffers(card));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(Math.max(terms?.promos?.length ?? 0, terms?.bt_offers?.length ?? 0));
  const errorRef = useRef<HTMLParagraphElement>(null);
  const closeRef = useRef<(() => void) | null>(null);
  // Card class comes from the bank; never guess this from the account name.
  const chargeCard = card.card_class === "charge_card";

  useEffect(() => { if (error) requestAnimationFrame(() => errorRef.current?.focus()); }, [error]);
  const fail = (message: string) => setError(message);
  const addId = (prefix: string) => `${prefix}-${sequence.current++}`;
  const updatePromo = (id: string, patch: Partial<PromoDraft>) => setPromos(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  const updateOffer = (id: string, patch: Partial<OfferDraft>) => setOffers(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));

  async function save() {
    if (saving || chargeCard) return;
    setError(null);
    if (apr && !validPercent(apr, 100)) return fail("Enter a standard rate from 0 to 100%, with up to 2 decimal places.");
    if (promos.some(row => !monthEnd(row.until))) return fail("Choose the month each 0% deal ends.");
    if (promos.some(row => !validPercent(row.rate, 30))) return fail("Enter each deal rate from 0 to 30%, with up to 2 decimal places.");
    if (offers.some(row => row.ends && !monthEnd(row.ends))) return fail("Choose a valid month for each offer.");
    if (offers.some(row => row.fee && !validPercent(row.fee, 15))) return fail("Enter an offer fee from 0 to 15%, or leave it blank.");
    const body: CardRatesSaveBody = {
      status: "confirmed",
      apr_pct: apr === "" ? null : Number(apr),
      promos: promos.map(row => ({ kind: row.kind, apr_pct: Number(row.rate), until: row.until === monthValue(row.originalUntil) ? row.originalUntil! : monthEnd(row.until)! })),
      bt_offers: offers.map(row => ({ ends: row.ends === monthValue(row.originalEnds) ? row.originalEnds : monthEnd(row.ends), fee_pct: row.fee === "" ? null : Number(row.fee), note: row.note.trim() || null })),
      ...(terms?.product_key ? { product_key: terms.product_key } : {}),
    };
    setSaving(true);
    try {
      await services.saveCardRates(card.account_id, body);
      try { await onSaved?.(); closeRef.current?.(); } catch { setSaved(true); setRefreshFailed(true); }
    } catch { setError("Rates and deals could not be saved. Your changes are still here. Try saving again."); }
    finally { setSaving(false); }
  }

  const title = card.name || "Card";
  return <SheetFrame variant="focused" title="Rates and deals" description={title} themeClass={`${styles.surface} ${themeClass ?? ""}`} onClose={onClose} dismissDisabled={saving} bodyClassName={styles.body}
    footer={({ close }) => { closeRef.current = close; return saved ? <div className={styles.footer}><button type="button" className={styles.button} onClick={close}>Done</button></div> : chargeCard ? <div className={styles.footer}><button type="button" className={styles.button} onClick={close}>Done</button></div> : <>{error && <p className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}<div className={styles.footer}><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={close} disabled={saving}>Cancel</button><button type="button" data-save-rates className={styles.button} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save rates and deals"}</button></div></>; }}>
    <div data-rates-editor className={styles.stack}>
      {saved && <p className={styles.helper} role="status">Rates and deals saved.{refreshFailed ? " The account details could not refresh. You can close this sheet or reload the page." : ""}</p>}
      {chargeCard ? <section className={styles.group}><h3>No interest rate to record</h3><p>This is recorded as a charge card, so it has no APR or promotional offers to record.</p></section> : <>
        <section className={styles.group}><h3>Standard rate</h3><TextField label="Standard purchase rate (% APR)"><input name="standard-purchase-apr" autoComplete="off" className={styles.input} inputMode="decimal" value={apr} onChange={event => setApr(event.target.value)} placeholder="Not recorded" maxLength={6} /></TextField><p>Copy the rate on your card statement. Leave it blank if you are unsure.</p></section>
        <section className={styles.group}><h3>{promos.some(row => Number(row.rate) !== 0) ? "Deals you are using" : "0% deals you are using"}</h3><p>A deal already applying to this card.</p>{promos.map((row, index) => <div className={styles.record} key={row.id}><div className={styles.recordHeading}>Deal {index + 1}<button type="button" className={styles.iconButton} aria-label={`Remove deal ${index + 1}`} onClick={() => setPromos(values => values.filter(value => value.id !== row.id))}><X size={17} aria-hidden="true" /></button></div><Choices label={`Deal ${index + 1} applies to`} value={row.kind} options={[{ id: "purchases", label: "Purchases" }, { id: "balance_transfer", label: "Balance transfers" }, { id: "both", label: "Both" }]} onChange={kind => updatePromo(row.id, { kind: kind as CardPromoKind })} pills /><TextField label={`Deal ${index + 1} ends`}><DateField mode="month" label={`Deal ${index + 1} ends`} value={row.until} onChange={until => updatePromo(row.id, { until })} allowClear themeClass={themeClass} /></TextField>{row.rateEditing ? <TextField label={`Deal ${index + 1} rate (% APR)`}><input name={`deal-${index + 1}-rate`} autoComplete="off" className={styles.input} inputMode="decimal" value={row.rate} onChange={event => updatePromo(row.id, { rate: event.target.value })} maxLength={5} /></TextField> : <button type="button" className={styles.link} onClick={() => updatePromo(row.id, { rateEditing: true })}>Edit deal rate</button>}</div>)}{promos.length === 0 && <p>None recorded.</p>}<button type="button" className={styles.link} disabled={promos.length >= 4 || saving || saved} onClick={() => setPromos(values => [...values, { id: addId("promo"), kind: "purchases", until: "", originalUntil: null, rate: "0", rateEditing: false }])}><Plus size={16} aria-hidden="true" />Add a 0% deal</button></section>
        <section className={styles.group}><h3>Unused offers</h3><p>An offer available to you, but not yet taken.</p>{offers.map((row, index) => <div className={styles.record} key={row.id}><div className={styles.recordHeading}>Offer {index + 1}<button type="button" className={styles.iconButton} aria-label={`Remove offer ${index + 1}`} onClick={() => setOffers(values => values.filter(value => value.id !== row.id))}><X size={17} aria-hidden="true" /></button></div><TextField label={`Offer ${index + 1} available until`}><DateField mode="month" label={`Offer ${index + 1} available until`} value={row.ends} onChange={ends => updateOffer(row.id, { ends })} allowClear themeClass={themeClass} /></TextField><TextField label={`Offer ${index + 1} transfer fee (%)`}><input name={`offer-${index + 1}-fee`} autoComplete="off" className={styles.input} inputMode="decimal" value={row.fee} onChange={event => updateOffer(row.id, { fee: event.target.value })} placeholder="Not recorded" maxLength={5} /></TextField><TextField label={`Offer ${index + 1} note (optional)`}><input name={`offer-${index + 1}-note`} autoComplete="off" className={styles.input} value={row.note} onChange={event => updateOffer(row.id, { note: event.target.value })} maxLength={120} /></TextField></div>)}{offers.length === 0 && <p>None recorded.</p>}<button type="button" className={styles.link} disabled={offers.length >= 6 || saving || saved} onClick={() => setOffers(values => [...values, { id: addId("offer"), ends: "", originalEnds: null, fee: "", note: "" }])}><Plus size={16} aria-hidden="true" />Add an unused offer</button></section>
      </>}
    </div>
  </SheetFrame>;
}
