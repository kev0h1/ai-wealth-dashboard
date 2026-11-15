"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CreditCard, FileText, LockKeyhole, Upload, X } from "lucide-react";
import { api, type CardOfferCandidate, type CardOffersExtraction, type CardTerms, type CardTermsCard, type ExistingCardOffer, type CardOfferType } from "@/lib/api";
import { makeOfferDrafts, validateCardOfferReview, type CardOfferDraft } from "@/lib/cardOfferReview";
import { todayIso } from "@/lib/calendar";
import { displayAccountName } from "@/lib/accountName";
import { usePreferences } from "@/components/PreferencesContext";
import { SheetFrame } from "@/components/SheetFrame";
import { confirmSheet } from "@/components/ConfirmSheet";
import { DateField } from "@/components/DatePicker";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import MoneyText from "@/components/MoneyText";
import { OfferAmount, offerDate } from "./OfferCards";
import styles from "./CardOffers.module.css";

export type CardOfferServices = Pick<typeof api, "extractCardOffers" | "confirmCardOffers"> & Partial<Pick<typeof api, "getCardTerms">>;
export type CardOfferSaved = { accountId: string; terms: CardTerms };
export interface CardOfferImportSheetProps {
  cards: CardTermsCard[];
  startAccountId?: string;
  onClose: () => void;
  onSaved?: (result: CardOfferSaved) => void | Promise<void>;
  services?: CardOfferServices;
  nested?: boolean;
  themeClass?: string;
  hiddenOverride?: boolean;
}

const TYPE_LABELS: Record<CardOfferType, string> = { purchase: "Purchases", balance_transfer: "Balance transfer", money_transfer: "Money transfer", cash: "Cash advance" };
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Treat names and model/server strings as text and never expose a full PAN. */
function safeText(value: string): string {
  return value.replace(/(?:\d[ -]?){12,19}/g, digits => `•••• ${digits.replace(/\D/g, "").slice(-4)}`).slice(0, 500);
}

function existingFromCard(card?: CardTermsCard): ExistingCardOffer[] {
  return (card?.terms?.promos ?? []).map(promo => ({ id: promo.id ?? null, kind: promo.kind, offer_type: promo.offer_type ?? null, apr_pct: promo.apr_pct, balance: promo.balance ?? null, ends: promo.until || null }));
}

function SourcedField({ id, label, source, error, children }: { id: string; label: string; source: string; error?: string; children: ReactNode }) {
  return <div className={styles.field}><label className={styles.fieldLabel} htmlFor={id}>{label}</label>{children}<small id={`${id}-source`} className={styles.fieldSource}>{source}</small>{error && <p id={`${id}-error`} className={styles.fieldError}><MoneyText text={error} unmasked /></p>}</div>;
}

export default function CardOfferImportSheet({ cards, startAccountId, onClose, onSaved, services = api, nested = false, themeClass, hiddenOverride }: CardOfferImportSheetProps) {
  const { hideNetWorth, preferencesReady, setHideNetWorth } = usePreferences();
  const hidden = hiddenOverride ?? (hideNetWorth || !preferencesReady);
  const today = todayIso();
  const eligibleCards = cards.filter(card => card.card_class !== "charge_card" && card.currency === "GBP");
  const [stage, setStage] = useState<"upload" | "review" | "saved">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [extraction, setExtraction] = useState<CardOffersExtraction | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cardId, setCardId] = useState("");
  const [cardAck, setCardAck] = useState(false);
  const [unknownAck, setUnknownAck] = useState(false);
  const [statementDate, setStatementDate] = useState("");
  const [purchaseApr, setPurchaseApr] = useState("");
  const [cashApr, setCashApr] = useState("");
  const [drafts, setDrafts] = useState<CardOfferDraft[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [savedResult, setSavedResult] = useState<CardOfferSaved | null>(null);
  const [savedWarnings, setSavedWarnings] = useState<string[]>([]);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingCard, setRefreshingCard] = useState(false);
  const [freshExisting, setFreshExisting] = useState<Record<string, ExistingCardOffer[]>>({});
  const [reviewNotice, setReviewNotice] = useState("");
  const live = useRef(true);
  const readController = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const selectedCard = eligibleCards.find(card => card.account_id === cardId);
  const candidate: CardOfferCandidate | undefined = extraction?.match.candidates.find(card => card.account_id === cardId);
  const existing = freshExisting[cardId] ?? candidate?.existing ?? existingFromCard(selectedCard);
  const ackRequired = !!extraction && (extraction.match.status !== "matched" || extraction.match.account_id !== cardId || (!!startAccountId && cardId !== startAccountId));
  const included = drafts.filter(draft => draft.include);
  const hasUnknown = included.some(draft => !draft.balance.trim() || !draft.revertRate.trim());
  const sourceLabel = extraction?.source.kind === "pdf" ? "Uploaded PDF" : "Uploaded image";

  useEffect(() => { live.current = true; return () => { live.current = false; readController.current?.abort(); }; }, []);
  useEffect(() => { if (error) requestAnimationFrame(() => errorRef.current?.focus()); }, [error]);

  function mark(key: string) { setEdited(values => new Set([...values, key])); }
  function fieldSource(key: string, original: unknown) { return edited.has(key) ? `Edited by you · ${sourceLabel}` : original == null || original === "" ? "Not found in this source" : sourceLabel; }
  function describedBy(id: string) { return `${id}-source${errors[id] ? ` ${id}-error` : ""}`; }
  function changeDraft(key: string, patch: Partial<CardOfferDraft>) {
    setDrafts(values => values.map(draft => draft.key === key ? { ...draft, ...patch } : draft));
    Object.keys(patch).forEach(field => mark(`${key}-${field}`));
  }
  function selectCard(nextId: string) {
    setCardId(nextId); setCardAck(false); setRemoveIds([]); mark("card");
    const matches = extraction?.match.candidates.find(card => card.account_id === nextId)?.offer_matches ?? [];
    setDrafts(values => values.map((draft, index) => ({ ...draft, updateId: matches[index] ?? null })));
  }
  function cancelReading() { readController.current?.abort(); readController.current = null; setReading(false); setSelectedFile(null); setPassword(""); if (fileInput.current) fileInput.current.value = ""; }

  async function canDiscard() {
    if (stage !== "review") return true;
    return confirmSheet({ title: "Discard this review?", body: "Nothing in this proposal has been saved. You can upload the file again later.", confirmLabel: "Discard review", cancelLabel: "Keep reviewing" });
  }
  async function chooseAnotherFile() {
    if (!await canDiscard() || !live.current) return;
    setStage("upload"); setExtraction(null); setDrafts([]); setErrors({}); setError(""); setEdited(new Set());
  }

  async function readFile() {
    if (reading) return;
    if (!selectedFile) { setError("Choose a statement PDF or a JPG, PNG or WebP image first."); return; }
    const controller = new AbortController(); readController.current = controller;
    setReading(true); setError("");
    try {
      const result = await services.extractCardOffers(selectedFile, password, controller.signal);
      if (!live.current || controller.signal.aborted) return;
      setExtraction(result);
      const matched = result.match.status === "matched" && eligibleCards.some(card => card.account_id === result.match.account_id) ? result.match.account_id! : "";
      setCardId(matched); setCardAck(false); setUnknownAck(false); setRemoveIds([]);
      setStatementDate(result.proposal.statement_date ?? "");
      setPurchaseApr(result.proposal.purchase_apr_pct == null ? "" : String(result.proposal.purchase_apr_pct));
      setCashApr(result.proposal.cash_apr_pct == null ? "" : String(result.proposal.cash_apr_pct));
      setDrafts(makeOfferDrafts(result.proposal.offers, matched ? result.match.offer_matches : []));
      setEdited(new Set()); setErrors({}); setStage("review");
      setFreshExisting({}); setReviewNotice("");
    } catch (problem) {
      if (live.current && !controller.signal.aborted) setError(safeText(problem instanceof Error ? problem.message : "The file could not be read. Try a clearer image or another PDF."));
    } finally {
      // Retain source identity, never the file or its password after the read.
      if (readController.current === controller) {
        readController.current = null;
        if (live.current) { setSelectedFile(null); setPassword(""); setReading(false); if (fileInput.current) fileInput.current.value = ""; }
      }
    }
  }

  async function confirmDetails() {
    if (saving || !extraction) return;
    setError("");
    const validation = validateCardOfferReview({ drafts, existing, removeIds, statementDate, purchaseApr, cashApr, cardId, ackRequired, acknowledged: cardAck, unknownAcknowledged: unknownAck, today });
    setErrors(validation.errors);
    if (!validation.body || !selectedCard) {
      requestAnimationFrame(() => {
        const invalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]");
        if (invalid) { invalid.focus(); invalid.scrollIntoView({ block: "center" }); }
        else { setError(Object.values(validation.errors)[0] || "Choose the card and check the details above."); }
      });
      return;
    }
    setSaving(true);
    try {
      const result = await services.confirmCardOffers(selectedCard.account_id, validation.body);
      if (!live.current) return;
      const saved = { accountId: selectedCard.account_id, terms: result.terms };
      setSavedResult(saved); setSavedWarnings(result.warnings ?? []); setStage("saved");
      try { await onSaved?.(saved); } catch { if (live.current) setRefreshFailed(true); }
    } catch (problem) {
      if (live.current) setError(safeText(problem instanceof Error ? problem.message : "The details could not be saved. Your review is still here. Check the card and offers, then try again."));
    } finally { if (live.current) setSaving(false); }
  }

  async function retryRefresh() {
    if (!savedResult || refreshing) return;
    setRefreshing(true);
    try { await onSaved?.(savedResult); if (live.current) setRefreshFailed(false); }
    catch { if (live.current) setRefreshFailed(true); }
    finally { if (live.current) setRefreshing(false); }
  }

  async function refreshCardDetails() {
    if (refreshingCard || saving) return;
    setRefreshingCard(true); setError("");
    try {
      const response = await (services.getCardTerms ?? api.getCardTerms)();
      if (!live.current) return;
      const next = Object.fromEntries(response.cards.map(card => [card.account_id, existingFromCard(card)]));
      setFreshExisting(next);
      const ids = new Set((next[cardId] ?? []).map(offer => offer.id));
      setRemoveIds(values => values.filter(id => ids.has(id)));
      setReviewNotice("Card details refreshed. Check the existing offers and any selected updates or removals before confirming.");
    } catch { if (live.current) setError("The current card details could not be loaded. Your review is still here. Try refreshing again."); }
    finally { if (live.current) setRefreshingCard(false); }
  }

  function decimalField(id: string, label: string, value: string, onChange: (value: string) => void, original: unknown, money = false) {
    return <SourcedField id={id} label={label} source={fieldSource(id, original)} error={errors[id]}>{money && hidden ? <p className={styles.hiddenInput}>Balance hidden. Use Show balances above to edit this amount.</p> : <input id={id} name={id} aria-invalid={!!errors[id]} aria-describedby={describedBy(id)} className={`${styles.input} ${money ? styles.money : ""}`} value={value} onChange={event => onChange(event.target.value)} inputMode="decimal" type="text" autoComplete="off" maxLength={money ? 16 : 6} disabled={saving} />}</SourcedField>;
  }

  return <BalancesHiddenContext.Provider value={hidden}><SheetFrame variant="focused" title={stage === "upload" ? "Add from a file" : stage === "review" ? "Check what we found" : "Card details confirmed"} description={stage === "upload" ? "A statement PDF or a screenshot from your card app." : stage === "review" ? "Check each value against its source. Nothing is saved until you confirm." : selectedCard ? displayAccountName(selectedCard.name) : undefined}
    onClose={onClose} beforeClose={canDiscard} dismissDisabled={saving} nested={nested} themeClass={`${styles.surface} ${themeClass ?? ""}`} bodyClassName={`${styles.surface} ${styles.body}`}
    onBack={stage === "review" ? () => { void chooseAnotherFile(); } : undefined} onEscape={stage === "review" ? () => { void chooseAnotherFile(); } : undefined} onHistoryBack={stage === "review" ? () => { void chooseAnotherFile(); } : undefined} backLabel="Choose another file"
    footer={({ close }) => <><div className={styles.surface}>
      {error && <p className={styles.footerNote} tabIndex={-1} ref={errorRef} role="alert"><MoneyText text={error} /></p>}
      {stage === "saved" ? <div className={styles.footer}><button type="button" className={styles.button} onClick={close} disabled={saving}>Done</button></div> : stage === "upload" ? <div className={styles.footer}><button type="button" className={styles.secondaryButton} onClick={reading ? cancelReading : close}>{reading ? "Cancel reading" : "Cancel"}</button><button type="button" className={styles.button} onClick={() => void readFile()} disabled={reading || eligibleCards.length === 0}>{reading ? "Reading…" : "Read this file"}</button></div> : <><p className={styles.footerNote}>{included.length} {included.length === 1 ? "offer" : "offers"} included{removeIds.length ? ` · ${removeIds.length} existing ${removeIds.length === 1 ? "offer" : "offers"} to remove` : ""}{selectedCard ? ` · ${displayAccountName(selectedCard.name)}` : ""}</p><div className={styles.footer}><button type="button" className={styles.secondaryButton} onClick={close} disabled={saving}>Cancel</button><button type="button" className={styles.button} onClick={() => void confirmDetails()} disabled={saving}>{saving ? "Confirming…" : "Confirm these details"}</button></div></>}
    </div></>}
  >
    {stage === "upload" && <div>
      {startAccountId && <p className={styles.helper}>{displayAccountName(cards.find(card => card.account_id === startAccountId)?.name ?? "Your card")}. You will check the card match before saving.</p>}
      {eligibleCards.length === 0 ? <p className={styles.helper}>Add a GBP credit card account in Accounts before reading its rates and offers. Per-offer balances from files are currently recorded in GBP.</p> : reading ? <div role="status"><h3>Reading the details…</h3><p className={styles.helper}>Looking for the card, standard rates and each promotional offer.</p><div className={styles.skeleton} /></div> : <>
        <label className={styles.fileDrop}><Upload size={28} aria-hidden="true" /><strong>Choose a PDF or image</strong><span>PDF, JPG, PNG or WebP · up to 10 MB</span><input ref={fileInput} type="file" name="card-offer-file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => {
          const file = event.target.files?.[0]; setError("");
          if (!file) return;
          const supported = ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type) || (!file.type && /\.(pdf|png|jpe?g|webp)$/i.test(file.name));
          if (!supported || !file.size || file.size > MAX_FILE_BYTES) { setError(!file.size ? "That file is empty. Choose a statement or screenshot." : !supported ? "Choose a PDF, JPG, PNG or WebP. Convert HEIC images to JPG first." : "Choose a file no larger than 10 MB."); setSelectedFile(null); event.target.value = ""; return; }
          setSelectedFile(file); setSourceName(safeText(file.name));
        }} /></label>
        {selectedFile && <div className={styles.selectedFile}><FileText size={20} aria-hidden="true" /><span><MoneyText text={sourceName} /></span><button type="button" aria-label="Remove selected file" onClick={() => { setSelectedFile(null); if (fileInput.current) fileInput.current.value = ""; }}><X size={18} aria-hidden="true" /></button></div>}
        <p className={styles.helper}>Include the rates or promotional offers table. For a screenshot, show the offer’s balance and end date. Avoid showing a full card number.</p>
        <details className={styles.details}><summary>PDF password, if needed</summary><label className={styles.field}><span className={styles.fieldLabel}>PDF password</span><input className={styles.input} name="card-offer-pdf-password" type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} maxLength={200} /></label></details>
        <div className={styles.privacyNote}><LockKeyhole size={17} aria-hidden="true" /><p>The file is removed after reading and card numbers are masked. This does not use your Statements upload allowance.</p></div>
      </>}
    </div>}
    {stage === "review" && extraction && <form ref={formRef} noValidate onSubmit={event => { event.preventDefault(); void confirmDetails(); }}>
      <div className={styles.reviewSource}><FileText size={21} aria-hidden="true" /><div><strong><MoneyText text={sourceName || sourceLabel} /></strong><small>{sourceLabel} · {drafts.length} {drafts.length === 1 ? "offer" : "offers"} read · not saved</small></div></div>
      <p className={styles.helper}>The original file has been removed. Compare these values with your own copy.</p>
      {hidden && <div className={styles.notice}><LockKeyhole size={16} aria-hidden="true" /><div><p>Balances are hidden.</p><button type="button" className={styles.textButton} disabled={!preferencesReady || saving} onClick={() => setHideNetWorth(false)}>Show balances</button></div></div>}
      {reviewNotice && <p className={styles.helper} role="status">{reviewNotice}</p>}
      {extraction.proposal.warnings.map((warning, index) => <p key={index} className={styles.caution}><MoneyText text={safeText(warning)} /></p>)}
      <fieldset disabled={saving}>
        <section className={styles.reviewGroup}><h3>Card and statement</h3>
          <p className={styles.helper}>Read from the file: {safeText(extraction.proposal.issuer ?? "issuer not found")}{extraction.proposal.last4 ? ` · ending ${extraction.proposal.last4}` : " · last four digits not found"}.</p>
          <div className={styles.cardChoices} role="group" aria-label="Card for these details">{eligibleCards.map(card => {
            const match = extraction.match.candidates.find(candidate => candidate.account_id === card.account_id);
            return <button key={card.account_id} type="button" aria-pressed={cardId === card.account_id} aria-invalid={!!errors.card} aria-describedby={errors.card ? "card-error" : undefined} onClick={() => selectCard(card.account_id)}><span><strong>{displayAccountName(card.name)}</strong><small>{safeText(card.provider)}{match?.last4 ? ` · ending ${match.last4}` : ""}</small></span>{cardId === card.account_id && <Check size={17} aria-hidden="true" />}</button>;
          })}</div>
          {errors.card && <p id="card-error" className={styles.fieldError}>{errors.card}</p>}
          {ackRequired && selectedCard && <><p className={styles.caution}>Check this card choice against the source before confirming.</p><label className={styles.checkbox}><input type="checkbox" name="card-offer-match-ack" checked={cardAck} aria-invalid={!!errors.cardAck} aria-describedby={errors.cardAck ? "cardAck-error" : undefined} onChange={event => setCardAck(event.target.checked)} /><span>I have checked that these details belong to {displayAccountName(selectedCard.name)}.</span></label>{errors.cardAck && <p id="cardAck-error" className={styles.fieldError}>{errors.cardAck}</p>}</>}
          <SourcedField id="statementDate" label="Figures as at" source={fieldSource("statementDate", extraction.proposal.statement_date)} error={errors.statementDate}><DateField id="statementDate" mode="day" label="Statement or screenshot date" value={statementDate} onChange={value => { setStatementDate(value); mark("statementDate"); }} max={today} today={today} allowClear disabled={saving} describedBy={describedBy("statementDate")} invalid={!!errors.statementDate} themeClass={themeClass} /></SourcedField>
        </section>
        <section className={styles.reviewGroup}><h3>Standard rates</h3><div className={styles.twoFields}>
          {decimalField("purchaseApr", "Purchase APR (%)", purchaseApr, value => { setPurchaseApr(value); mark("purchaseApr"); }, extraction.proposal.purchase_apr_pct)}
          {decimalField("cashApr", "Cash APR (%)", cashApr, value => { setCashApr(value); mark("cashApr"); }, extraction.proposal.cash_apr_pct)}
        </div><p className={styles.helper}>A blank standard rate keeps the rate already on this card.</p></section>
        {drafts.map((draft, index) => <section key={draft.key} className={styles.reviewGroup}>
          <div className={styles.reviewHeading}><h3>Offer {index + 1}</h3><span>{draft.ends ? `Ends ${offerDate(draft.ends)}` : "End date missing"}</span></div>
          <label className={styles.checkbox}><input type="checkbox" name={`${draft.key}-include`} checked={draft.include} onChange={event => changeDraft(draft.key, { include: event.target.checked })} /><span>Include this offer in the confirmation</span></label>
          <fieldset disabled={!draft.include || saving}>
            <div className={styles.field}><span className={styles.fieldLabel}>Offer type</span><div className={styles.choices} role="group" aria-label={`Offer ${index + 1} type`}>{(Object.entries(TYPE_LABELS) as [CardOfferType, string][]).map(([type, label]) => <button type="button" key={type} aria-pressed={draft.offerType === type} onClick={() => changeDraft(draft.key, { offerType: type })}>{label}</button>)}</div><small className={styles.fieldSource}>{fieldSource(`${draft.key}-offerType`, draft.original.offer_type)}</small></div>
            <div className={styles.twoFields}>{decimalField(`${draft.key}-rate`, "Offer rate (%)", draft.rate, value => changeDraft(draft.key, { rate: value }), draft.original.apr_pct)}{decimalField(`${draft.key}-balance`, "Balance on this offer (£)", draft.balance, value => changeDraft(draft.key, { balance: value }), draft.original.balance, true)}</div>
            <SourcedField id={`${draft.key}-ends`} label="Exact end date" source={fieldSource(`${draft.key}-ends`, draft.original.ends)} error={errors[`${draft.key}-ends`]}><DateField id={`${draft.key}-ends`} mode="day" label={`Offer ${index + 1} exact end date`} value={draft.ends} onChange={value => changeDraft(draft.key, { ends: value })} today={today} allowClear disabled={saving || !draft.include} describedBy={describedBy(`${draft.key}-ends`)} invalid={!!errors[`${draft.key}-ends`]} themeClass={themeClass} /></SourcedField>
            {decimalField(`${draft.key}-revertRate`, "APR after the offer (%)", draft.revertRate, value => changeDraft(draft.key, { revertRate: value }), draft.original.revert_apr_pct)}
            {!draft.ends && <p className={styles.caution}>Add the exact end date before confirming this offer, or leave it out of this confirmation. No date will be guessed.</p>}
            <details className={styles.details}><summary>{draft.updateId ? "Updates an existing offer" : "Adds a new offer"}</summary><div className={styles.choices} role="group" aria-label={`Save offer ${index + 1} as`}><button type="button" aria-pressed={!draft.updateId} onClick={() => changeDraft(draft.key, { updateId: null })}>New offer</button>{existing.filter(offer => offer.id).map(offer => <button type="button" key={offer.id} aria-pressed={draft.updateId === offer.id} onClick={() => changeDraft(draft.key, { updateId: offer.id })}>Update {offer.offer_type ? TYPE_LABELS[offer.offer_type] : "existing offer"} · {offerDate(offer.ends)}</button>)}</div></details>
            {draft.updateId && <p className={styles.helper}>Updates the existing offer ending {offerDate(existing.find(offer => offer.id === draft.updateId)?.ends)}. Its details will be replaced with the values above.</p>}
            {errors[`${draft.key}-updateId`] && <p className={styles.fieldError} role="alert">{errors[`${draft.key}-updateId`]}</p>}
          </fieldset>
        </section>)}
        {extraction.proposal.ended.length > 0 && <details className={styles.details}><summary>{extraction.proposal.ended.length} ended {extraction.proposal.ended.length === 1 ? "offer" : "offers"} found</summary><p className={styles.helper}>These offers have ended and will not be saved.</p>{extraction.proposal.ended.map((offer, index) => <p className={styles.helper} key={index}>{TYPE_LABELS[offer.offer_type]} · {offer.apr_pct}% · ended {offerDate(offer.ends)}</p>)}</details>}
        {existing.length > 0 && <section className={styles.reviewGroup}><h3>Existing offers on this card</h3><p className={styles.helper}>Offers not updated above stay as they are. Select a removal only if you want it applied when you confirm. A card can hold up to 4 offers.</p>{existing.map((offer, index) => <div key={offer.id ?? index}><p className={styles.helper}>{offer.offer_type ? TYPE_LABELS[offer.offer_type] : "Existing offer"} · {offer.apr_pct}% · ends {offerDate(offer.ends)} · <OfferAmount value={offer.balance} currency={selectedCard?.currency ?? "GBP"} hidden={hidden} /></p>{offer.id && <label className={styles.checkbox}><input type="checkbox" name={`remove-${offer.id}`} checked={removeIds.includes(offer.id)} onChange={event => setRemoveIds(ids => event.target.checked ? [...ids, offer.id!] : ids.filter(id => id !== offer.id))} /><span>Remove this existing offer when I confirm</span></label>}</div>)}</section>}
        {hasUnknown && <><label className={styles.checkbox}><input type="checkbox" name="card-offer-unknown-ack" checked={unknownAck} aria-invalid={!!errors.unknown} aria-describedby={errors.unknown ? "unknown-error" : undefined} onChange={event => setUnknownAck(event.target.checked)} /><span>Keep unread offer balances or revert rates as unknown. No values will be guessed.</span></label>{errors.unknown && <p id="unknown-error" className={styles.fieldError}>{errors.unknown}</p>}</>}
        {errors.offers && <p className={styles.fieldError} role="alert">{errors.offers}</p>}
        <button type="button" className={styles.textButton} onClick={() => void refreshCardDetails()} disabled={refreshingCard || saving}>{refreshingCard ? "Refreshing card details…" : "Refresh current card details"}</button>
        <p className={styles.helper}>Only the confirmed rates, selected offers and explicit removals change. Your payment settings and unused offers stay as they are.</p>
      </fieldset>
    </form>}
    {stage === "saved" && <div className={styles.stack}><div className={styles.notice} role="status"><Check size={20} aria-hidden="true" /><p>Your card details are confirmed. The original file has been removed.</p></div>{savedWarnings.map((warning, index) => <p key={index} className={styles.caution}><MoneyText text={safeText(warning)} /></p>)}{refreshFailed && <div><p className={styles.caution}>The details were saved, but the account view could not refresh. Refreshing does not save them again.</p><button type="button" className={styles.textButton} onClick={() => void retryRefresh()} disabled={refreshing}>{refreshing ? "Refreshing…" : "Try refreshing"}</button></div>}</div>}
  </SheetFrame></BalancesHiddenContext.Provider>;
}
