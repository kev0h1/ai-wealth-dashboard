"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, CreditCard, FileText, Image as ImageIcon, LockKeyhole, Upload, X } from "lucide-react";
import { DateField } from "@/components/DatePicker";
import { CARDS, OFFERS, PREVIEW_DATE, formatDate, formatGBP, monthlyIllustration, sortOffersByExpiry, timeLeft } from "./fixtures";
import styles from "./CardOffers.module.css";

type Offer = (typeof OFFERS)[number];
type Screen = "offers" | "rates" | "upload" | "review" | "needs-check" | "empty" | "error" | "expired" | "loading" | "confirmed";
const SCREENS: { id: Screen; label: string }[] = [
  { id: "offers", label: "Offers" }, { id: "rates", label: "Rates and deals" },
  { id: "upload", label: "Upload" }, { id: "review", label: "Review" },
  { id: "needs-check", label: "Missing date" }, { id: "empty", label: "No offers" },
  { id: "error", label: "Upload problem" }, { id: "expired", label: "Ended offer" },
  { id: "loading", label: "Reading file" },
];
const DIRECTIONS = [
  { id: "a", name: "Expiry cards", description: "The balance leads. Each offer keeps its dates, rate and evidence together, with the working one tap away." },
  { id: "b", name: "Expiry diary", description: "The date leads. A calendar of offers keeps the next expiry in view, with source evidence beside the review." },
];

function Money({ value, hidden }: { value: number; hidden: boolean }) {
  return <span className={styles.money}>{hidden ? "£••••" : formatGBP(value)}</span>;
}

function Field({ label, source, children }: { label: string; source: string; children: ReactNode }) {
  return <div className={styles.field}><span className={styles.fieldLabel}>{label}</span>{children}<small className={styles.fieldSource}>{source}</small></div>;
}

export default function CardOffersClient() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const direction = DIRECTIONS.find(item => item.id === variant)!;
  const rawScreen = params.get("state");
  const screen: Screen = rawScreen === "confirmed" || SCREENS.some(item => item.id === rawScreen) ? rawScreen as Screen : "offers";
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hide") === "1";
  const filter = CARDS.some(card => card.id === params.get("card")) ? params.get("card")! : "all";
  const [savedOffers, setSavedOffers] = useState<Offer[]>([...OFFERS]);
  const [drafts, setDrafts] = useState<Offer[]>(() => OFFERS.filter(offer => offer.cardId === CARDS[0].id));
  const [purchaseApr, setPurchaseApr] = useState(String(CARDS[0].purchaseApr));
  const [cashApr, setCashApr] = useState(String(CARDS[0].cashApr));
  const [statementDate, setStatementDate] = useState(CARDS[0].statementDate);
  const [reviewCard, setReviewCard] = useState(CARDS[0].id);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [rawValues, setRawValues] = useState<Record<string, string>>({});
  const [unknownAccepted, setUnknownAccepted] = useState(false);
  const [differentCardAccepted, setDifferentCardAccepted] = useState(false);
  const [sourceKind, setSourceKind] = useState<"pdf" | "image">("pdf");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [notice, setNotice] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReview = screen === "review" || screen === "needs-check";
  const inUpload = screen === "upload" || screen === "error" || screen === "loading";
  const card = CARDS.find(item => item.id === (filter === "all" ? CARDS[0].id : filter))!;
  const matchedCard = CARDS.find(item => item.id === reviewCard)!;
  const reviewSource = sourceKind === "pdf" ? "Statement · p 2" : "Screenshot · image 1";

  function href(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    return `?${next.toString()}`;
  }
  function navigate(next: Screen, extra: Record<string, string> = {}) {
    window.history.pushState(null, "", href({ state: next, ...extra }));
    setDiscardPrompt(false);
  }
  function mark(key: string) { setEdited(values => new Set([...values, key])); }
  function source(key: string, original = reviewSource) { return edited.has(key) ? `Edited by you · ${original}` : original; }
  function updateOffer(id: string, patch: Partial<Offer>) {
    setDrafts(values => values.map(offer => offer.id === id ? { ...offer, ...patch } : offer));
    Object.keys(patch).forEach(key => mark(`${id}-${key}`));
  }

  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.removeProperty("color-scheme"); };
  }, [dark]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    setInputErrors({});
  }, [screen]);
  useEffect(() => {
    if (screen === "needs-check") {
      setDrafts(values => values.map((offer, index) => index === 0 ? { ...offer, endDate: null, revertRate: null } : offer));
      setUnknownAccepted(false);
    }
  }, [screen]);
  useEffect(() => {
    if (!isReview || edited.size === 0 || confirmed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isReview, edited.size, confirmed]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const baseOffers = screen === "empty" ? [] : screen === "expired"
    ? savedOffers.map((offer, index) => index === 0 ? { ...offer, endDate: "2026-11-01" } : offer)
    : savedOffers;
  const visibleOffers = sortOffersByExpiry(baseOffers.filter(offer => filter === "all" || offer.cardId === filter));
  const hasUnknown = drafts.some(offer => !offer.endDate || offer.revertRate == null);
  const sourceFile = sourceKind === "pdf" ? "Harbour-statement-example.pdf" : "Harbour-app-example.png";

  function beginReview(kind: "pdf" | "image") {
    setSourceKind(kind);
    setDrafts(OFFERS.filter(offer => offer.cardId === CARDS[0].id));
    setReviewCard(CARDS[0].id);
    setStatementDate(CARDS[0].statementDate);
    setPurchaseApr(String(CARDS[0].purchaseApr));
    setCashApr(String(CARDS[0].cashApr));
    setEdited(new Set());
    setRawValues({});
    setUnknownAccepted(false);
    setDifferentCardAccepted(false);
    setConfirmed(false);
    setBusy(true);
    timerRef.current = setTimeout(() => { setBusy(false); navigate("review"); }, 650);
  }

  function confirmDetails() {
    const errors: Record<string, string> = {};
    const validRate = (value: string | number) => /^\d+(\.\d{1,2})?$/.test(String(value)) && Number(value) <= 100;
    if (!validRate(purchaseApr)) errors.purchase = "Enter a purchase APR from 0 to 100%.";
    if (!validRate(cashApr)) errors.cash = "Enter a cash APR from 0 to 100%.";
    if (!statementDate) errors.statement = "Choose the date these figures are from.";
    drafts.forEach(offer => {
      if (!Number.isFinite(offer.balance) || offer.balance < 0 || !/^\d+(\.\d{1,2})?$/.test(rawValues[`${offer.id}-balance`] ?? String(offer.balance))) errors[`${offer.id}-balance`] = "Enter a balance of zero or more, with up to 2 decimal places.";
      if (!validRate(offer.rate)) errors[`${offer.id}-rate`] = "Enter an offer rate from 0 to 100%.";
      if (offer.revertRate != null && !validRate(offer.revertRate)) errors[`${offer.id}-revert`] = "Enter a revert APR from 0 to 100%, or leave it unknown.";
    });
    if (hasUnknown && !unknownAccepted) errors.unknown = "Confirm that the missing details should stay unknown, or add them above.";
    if (reviewCard !== CARDS[0].id && !differentCardAccepted) errors.card = "Confirm your choice of a different card, or select the card named in the source.";
    setInputErrors(errors);
    if (Object.keys(errors).length) {
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>("[aria-invalid=true]");
        if (first) { first.focus(); first.scrollIntoView({ block: "center", behavior: "instant" }); }
        else errorRef.current?.focus();
      });
      return;
    }
    setBusy(true);
    timerRef.current = setTimeout(() => {
      const ids = new Set(drafts.map(offer => offer.id));
      setSavedOffers(values => [...values.filter(offer => !ids.has(offer.id)), ...drafts.map(offer => ({ ...offer, cardId: reviewCard, source: { file: sourceFile, label: `${sourceKind === "pdf" ? "Statement" : "Card-app screenshot"}${edited.size ? ", checked and edited by you" : ", checked by you"}`, ...(sourceKind === "pdf" ? { page: 2 } : {}), asOf: statementDate } }))]);
      setConfirmed(true);
      setBusy(false);
      setEdited(new Set());
      setNotice(`${drafts.length} offers confirmed for ${matchedCard.name}. Preview only.`);
      navigate("confirmed", { card: reviewCard });
    }, 450);
  }

  function offerContent(offer: Offer) {
    const owner = CARDS.find(item => item.id === offer.cardId)!;
    const illustration = monthlyIllustration(offer);
    const ended = offer.endDate != null && offer.endDate < PREVIEW_DATE;
    return <>
      <div className={styles.offerIdentity}><span>{owner.name} <span className={styles.last4}>•• {owner.last4}</span></span><span className={styles.badge}>{ended ? "Offer ended" : timeLeft(offer.endDate)}</span></div>
      <div className={styles.offerLead}><div><p className={styles.label}>Balance on this offer</p><h3><Money value={offer.balance} hidden={hidden} /></h3></div><div className={styles.rate}><strong>{offer.rate}%</strong><span>offer rate</span></div></div>
      <p className={styles.offerType}>{offer.type}</p>
      <dl className={styles.offerFacts}><div><dt>{ended ? "Ended" : "Ends"}</dt><dd>{offer.endDate ? formatDate(offer.endDate) : "Not recorded"}</dd></div><div><dt>Rate after the offer</dt><dd>{offer.revertRate == null ? "Not recorded" : `${offer.revertRate}% APR`}</dd></div></dl>
      <p className={styles.factualLine}>{ended ? "This offer has ended. Check the current rate and balance with your card provider." : !offer.endDate ? "The end date is unknown. Check the statement or add a screenshot from your card app." : <><Money value={offer.balance} hidden={hidden} /> at {offer.rate}% until {formatDate(offer.endDate)}.{illustration ? <> About <Money value={illustration.monthlyPayment} hidden={hidden} /> a month could clear this recorded balance before then.</> : offer.rate > 0 ? " Interest may be added while this offer is running." : offer.balance === 0 ? " No balance remains on this recorded offer." : " This offer ends before the first payment in the monthly illustration."}</>}</p>
      <details className={styles.details}><summary>Offer details and source<ChevronDown size={16} aria-hidden="true" /></summary><div className={styles.detailBody}>
        <dl className={styles.evidenceList}><div><dt>Balance recorded on</dt><dd>{formatDate(offer.source.asOf)}</dd></div><div><dt>Source</dt><dd>{offer.source.label}{offer.source.page ? ` · p ${offer.source.page}` : ""}</dd></div><div><dt>Card</dt><dd>{owner.name} · ending {owner.last4}</dd></div></dl>
        <p>{offer.note || "This balance applies to this offer, rather than the whole card. Minimum payments and your provider’s payment allocation rules still apply."}</p>
        {illustration && !ended && <p>{illustration.paymentCount} monthly payments, starting {formatDate(illustration.firstPaymentDate)}, each before the offer ends. Rounded up to the next pound. Assumes no new spending or fees and the recorded balance is unchanged. This is an illustration, not a payment plan.</p>}
        {!illustration && !ended && offer.rate > 0 && <p>No monthly clearing figure is shown for an interest-bearing offer. The cost depends on how your provider applies interest and payments.</p>}
        <p>The balance may have changed since this source. Check your card app for today’s amount.</p>
        <button className={styles.textButton} type="button" onClick={() => navigate("upload", { card: owner.id })}>Update from a statement or screenshot<ArrowRight size={15} aria-hidden="true" /></button>
      </div></details>
    </>;
  }

  function rateInput(id: string, value: string, onChange: (value: string) => void, label: string) {
    const error = inputErrors[id === "purchase-apr" ? "purchase" : id === "cash-apr" ? "cash" : id];
    return <><input id={id} name={id} type="text" inputMode="decimal" autoComplete="off" maxLength={6} aria-label={label} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className={styles.input} value={rawValues[id] ?? (value === "NaN" ? "" : value)} onChange={event => { setRawValues(values => ({ ...values, [id]: event.target.value })); onChange(event.target.value); }} />{error && <p id={`${id}-error`} className={styles.fieldError}>{error}</p>}</>;
  }

  return <div className={`${styles.page} ${dark ? styles.dark : ""}`} data-variant={variant}>
    <a className={styles.skip} href="#offers-content">Skip to card offers</a>
    <div className={styles.previewBar}><div className={styles.previewInner}>
      <Link href="/design" className={styles.previewBack}><ArrowLeft size={15} aria-hidden="true" />Design rounds</Link>
      <span className={styles.previewName}>G471 · Fictional preview</span>
      <nav aria-label="Design direction" className={styles.directionNav}>{DIRECTIONS.map(item => <Link key={item.id} href={href({ variant: item.id })} aria-current={variant === item.id ? "page" : undefined}>{item.id.toUpperCase()} · {item.name}</Link>)}</nav>
      <Link href={href({ mode: dark ? "light" : "dark" })} className={styles.previewTheme}>{dark ? "Light" : "Dark"}</Link>
    </div></div>
    <div className={styles.stage}>
      <details className={styles.previewStates}><summary>Try a screen or an edge case<ChevronDown size={15} aria-hidden="true" /></summary><nav aria-label="Preview screen">{SCREENS.map(item => <Link key={item.id} href={href({ state: item.id })} aria-current={screen === item.id ? "page" : undefined}>{item.label}</Link>)}</nav><p>{direction.description} All figures are fictional, as at {formatDate(PREVIEW_DATE)}. This preview does not read or store uploaded files.</p></details>
      <main id="offers-content" className={styles.main}>
        <div className={styles.productBar}><span className={styles.wordmark}>Sorted<span aria-hidden="true">.</span></span><Link href={href({ hide: hidden ? "" : "1" })} className={styles.privacy}><LockKeyhole size={14} aria-hidden="true" />{hidden ? "Show figures" : "Hide figures"}</Link></div>
        <div className={styles.breadcrumb}><button type="button" onClick={() => isReview && edited.size ? setDiscardPrompt(true) : navigate(screen === "rates" ? "offers" : "rates")}><ArrowLeft size={15} aria-hidden="true" />{screen === "rates" ? "All card offers" : "Rates and deals"}</button></div>
        {discardPrompt && <div className={styles.notice} role="alert"><p>Discard the changes in this review?</p><div className={styles.inlineActions}><button type="button" onClick={() => setDiscardPrompt(false)}>Keep reviewing</button><button type="button" onClick={() => { setEdited(new Set()); navigate("rates"); }}>Discard review changes</button></div></div>}
        <header className={styles.heading}>
          <h1 tabIndex={-1} ref={headingRef}>{screen === "rates" ? "Rates and deals" : inUpload ? "Add from a file" : isReview ? "Check what we found" : "Your card offers"}</h1>
          <p>{screen === "rates" ? `${card.name} · ending ${card.last4}` : inUpload ? "A statement or card-app screenshot can fill in the details for you." : isReview ? "Check each value against its source. Nothing is saved until you confirm." : "Know when each offer ends, and what rate comes next."}</p>
        </header>
        <p className={styles.liveStatus} role="status" aria-live="polite">{notice}</p>
        {(screen === "offers" || screen === "empty" || screen === "expired" || screen === "confirmed") && <>
          {(confirmed || screen === "confirmed") && <div className={styles.confirmed}><Check size={18} aria-hidden="true" /><span>{drafts.length} offers confirmed in this preview. Your real card details have not changed.</span></div>}
          <div className={styles.offersLayout}>
            <section aria-label="Recorded offers" className={styles.offersSection}>
              <div className={styles.filterBar}><div className={styles.filters} role="group" aria-label="Filter offers by card"><Link href={href({ card: "all" })} aria-current={filter === "all" ? "true" : undefined}>All cards</Link>{CARDS.map(item => <Link key={item.id} href={href({ card: item.id })} aria-current={filter === item.id ? "true" : undefined}>{item.name.split(" ")[0]} · {item.last4}</Link>)}</div></div>
              <div className={styles.sectionIntro}><h2>{visibleOffers.length} {visibleOffers.length === 1 ? "offer" : "offers"} {filter === "all" ? "across your cards" : "on this card"}</h2><button type="button" className={styles.textButton} onClick={() => navigate("upload")}>Add a file<Upload size={15} aria-hidden="true" /></button><p>Soonest end date first</p></div>
              {visibleOffers.length === 0 ? <div className={styles.empty}><CreditCard size={28} aria-hidden="true" /><h2>No offers recorded yet</h2><p>Add a statement or screenshot to record the rate, balance and exact end date of each offer.</p><button type="button" className={styles.button} onClick={() => navigate("upload")}>Add from a file<Upload size={16} aria-hidden="true" /></button></div> : <ol className={variant === "b" ? styles.diary : styles.offerCards}>{visibleOffers.map(offer => <li key={offer.id} className={styles.offerItem}>{variant === "b" && <div className={styles.dateRail}><span>{offer.endDate ? new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${offer.endDate}T00:00:00Z`)) : "Date"}</span><strong>{offer.endDate ? new Date(`${offer.endDate}T00:00:00Z`).getUTCDate() : "?"}</strong><span>{offer.endDate ? offer.endDate.slice(0, 4) : "unknown"}</span></div>}<article className={styles.offer}>{offerContent(offer)}</article></li>)}</ol>}
              <p className={styles.pageCaveat}>Balances belong to individual offers. They are recorded snapshots and may not add up to today’s card balance.</p>
            </section>
            <div className={styles.sidePanel}><h2>Keep the details current</h2><p>Read rates and offers from a statement or a screenshot of your card app. You check the values before saving.</p><button type="button" className={styles.button} onClick={() => navigate("upload")}>Add from a file<Upload size={16} aria-hidden="true" /></button><button type="button" className={styles.textButton} onClick={() => navigate("rates")}>Rates and deals<ArrowRight size={15} aria-hidden="true" /></button><div className={styles.sideNote}><FileText size={18} aria-hidden="true" /><p>Preview date {formatDate(PREVIEW_DATE)}<br />Fictional cards and balances</p></div></div>
          </div>
        </>}
        {screen === "rates" && <div className={styles.ratesLayout}><section className={styles.panel}>
          <div className={styles.sectionHeading}><h2>Standard rates</h2><span>Recorded {formatDate(confirmed && card.id === reviewCard ? statementDate : card.statementDate)}</span></div>
          <dl className={styles.standardRates}><div><dt>Purchases</dt><dd>{confirmed && card.id === reviewCard ? purchaseApr : card.purchaseApr}% APR</dd></div><div><dt>Cash advances</dt><dd>{confirmed && card.id === reviewCard ? cashApr : card.cashApr}% APR</dd></div></dl>
          <div className={styles.uploadEntry}><Upload size={22} aria-hidden="true" /><div><h2>Add from a statement or screenshot</h2><p>Fill in rates, offer balances and exact end dates. Review everything before saving.</p><button className={styles.button} type="button" onClick={() => navigate("upload", { card: card.id })}>Upload a file<ArrowRight size={16} aria-hidden="true" /></button></div></div>
          <div className={styles.sectionHeading}><h2>Offers you are using</h2><span>{savedOffers.filter(offer => offer.cardId === card.id).length} recorded</span></div>
          {sortOffersByExpiry(savedOffers.filter(offer => offer.cardId === card.id)).map(offer => <div key={offer.id} className={styles.rateOffer}><div><strong>{offer.type} · {offer.rate}%</strong><p>{offer.endDate ? `Ends ${formatDate(offer.endDate)}` : "End date not recorded"}</p></div><Money value={offer.balance} hidden={hidden} /></div>)}
          <button className={styles.textButton} type="button" onClick={() => navigate("offers", { card: card.id })}>See offer details<ArrowRight size={15} aria-hidden="true" /></button>
          <div className={styles.rateOffer}><div><strong>Unused offers</strong><p>Offers available to take are kept separately from balances already on a deal.</p></div></div><p className={styles.helper}>None recorded in this example.</p>
        </section><div className={styles.sidePanel}><h2>One source, every detail</h2><p>A statement can carry more than one balance transfer, each with its own end date. Each one stays a separate offer.</p><p>A screenshot can add a date missing from a statement.</p></div></div>}
        {inUpload && <div className={styles.uploadLayout}><section className={styles.panel}>
          <div className={styles.accountIdentity}><CreditCard size={22} aria-hidden="true" /><div><strong>{card.name}</strong><span>Card ending {card.last4}</span></div></div>
          {(screen === "error" || fileError) && <div className={styles.notice} role="alert"><span className={styles.amberDot} aria-hidden="true" /><div><strong>We could not read this file</strong><p>{fileError || "The offer table was not clear enough. Try a clearer screenshot or a statement PDF."}</p><button type="button" className={styles.textButton} onClick={() => { setFileError(""); navigate("upload"); }}>Try another file</button></div></div>}
          {screen === "loading" || busy ? <div className={styles.reading} role="status"><FileText size={28} aria-hidden="true" /><h2>Reading the details…</h2><p>Looking for the card, standard rates and each promotional offer.</p><div className={styles.skeleton} /><div className={styles.skeleton} /><button type="button" className={styles.secondaryButton} onClick={() => { if (timerRef.current) clearTimeout(timerRef.current); setBusy(false); navigate("upload"); }}>Cancel reading</button></div> : <>
            <label className={styles.fileDrop}><Upload size={30} aria-hidden="true" /><strong>Choose a PDF or image</strong><span>Statement PDF, JPG, PNG or WebP · up to 10 MB in this proposal</span><input ref={fileRef} type="file" name="card-offer-source" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) { setFileError("Choose a PDF, JPG, PNG or WebP smaller than 10 MB."); event.target.value = ""; return; }
              setFileError(""); setFileName(file.name); setSourceKind(file.type === "application/pdf" ? "pdf" : "image");
            }} /></label>
            {fileName && <div className={styles.selectedFile}><FileText size={20} aria-hidden="true" /><span>{fileName}<small>Preview only. The file contents will not be read.</small></span><button type="button" aria-label="Remove selected file" onClick={() => { setFileName(null); if (fileRef.current) fileRef.current.value = ""; }}><X size={18} aria-hidden="true" /></button></div>}
            <p className={styles.helper}>Include the rates or promotional offers table. For a screenshot, show the offer’s balance and end date. Avoid showing a full card number.</p>
            <div className={styles.privacyNote}><LockKeyhole size={17} aria-hidden="true" /><p>The proposed flow removes the file after reading it and masks card numbers. This does not use your Statements upload allowance.</p></div>
            <button type="button" className={styles.button} onClick={() => fileName ? beginReview(sourceKind) : fileRef.current?.click()}>{fileName ? "Preview with example values" : "Choose a file"}<ArrowRight size={16} aria-hidden="true" /></button>
          </>}
        </section><div className={styles.examplePanel}><h2>Try the fictional examples</h2><p>Explore the review without uploading anything. The example always contains two separate balance-transfer offers.</p><button type="button" className={styles.exampleButton} disabled={busy} onClick={() => beginReview("pdf")}><FileText size={22} aria-hidden="true" /><span><strong>Statement PDF</strong><small>Two offers and standard rates</small></span><ArrowRight size={16} aria-hidden="true" /></button><button type="button" className={styles.exampleButton} disabled={busy} onClick={() => beginReview("image")}><ImageIcon size={22} aria-hidden="true" /><span><strong>Card-app screenshot</strong><small>Balance and exact end dates</small></span><ArrowRight size={16} aria-hidden="true" /></button></div></div>}
        {isReview && <form className={styles.reviewForm} noValidate onSubmit={event => { event.preventDefault(); confirmDetails(); }}>
          <div className={styles.reviewSourceHeader}><FileText size={21} aria-hidden="true" /><div><strong>{sourceFile}</strong><span>Example source · {drafts.length} offers found · not saved</span></div></div>
          <div className={variant === "b" ? styles.reviewBeside : styles.reviewStack}>
            <div className={styles.sourcePanel}><details open={variant === "b"}><summary>Read the source extract<ChevronDown size={16} aria-hidden="true" /></summary><div className={styles.sourcePaper}><span className={styles.sourceStamp}>FICTIONAL EXAMPLE</span><h2>Harbour Platinum</h2><p>Card ending 4826 · 12 November 2026</p>{hidden ? <p>Source amounts are hidden. Use Show figures to read the extract.</p> : <><div className={styles.sourceTable}><div><span>Promotional offers</span><span>Balance</span><span>Ends</span></div><div><span>Balance transfer · 0%</span><span className={styles.money}>{formatGBP(OFFERS[0].balance)}</span><span>{screen === "needs-check" ? "Not shown" : formatDate(OFFERS[0].endDate)}</span></div><div><span>Balance transfer · 0%</span><span className={styles.money}>{formatGBP(OFFERS[1].balance)}</span><span>{formatDate(OFFERS[1].endDate)}</span></div></div><p>Purchase APR 23.9% · Cash APR 29.9%</p><p>After the promotion: {screen === "needs-check" ? "not shown for the first offer" : "23.9% APR"}.</p></>}<p>{sourceKind === "pdf" ? "Recreated text from page 2 of the fictional statement." : "Recreated text from image 1 of the fictional card app."} The original upload is not retained.</p></div></details></div>
            <div className={styles.reviewFields}>
              <section className={styles.reviewGroup}><h2>Card and statement</h2><Field label="Save these details to" source={source("card", "Card ending 4826 · source header")}><div role="group" aria-label="Card for these details" className={styles.cardChoices}>{CARDS.map(item => <button type="button" key={item.id} aria-pressed={reviewCard === item.id} onClick={() => { setReviewCard(item.id); setDifferentCardAccepted(false); mark("card"); }}><span><strong>{item.name}</strong><small>ending {item.last4}</small></span>{reviewCard === item.id && <Check size={17} aria-hidden="true" />}</button>)}</div></Field>
                {reviewCard !== CARDS[0].id && <><p className={styles.caution}><span className={styles.amberDot} aria-hidden="true" />The source names Harbour, ending 4826. You selected a different card.</p><label className={styles.checkbox}><input type="checkbox" name="confirm-different-card" checked={differentCardAccepted} aria-invalid={!!inputErrors.card} aria-describedby={inputErrors.card ? "card-choice-error" : undefined} onChange={event => setDifferentCardAccepted(event.target.checked)} /><span>Use {matchedCard.name}, ending {matchedCard.last4}, for these details.</span></label>{inputErrors.card && <p className={styles.fieldError} id="card-choice-error">{inputErrors.card}</p>}</>}
                <Field label="Figures as at" source={source("statement", "Statement date · source header")}><DateField mode="day" label="Statement or screenshot date" value={statementDate} onChange={value => { setStatementDate(value); mark("statement"); }} today={PREVIEW_DATE} />{inputErrors.statement && <p className={styles.fieldError}>{inputErrors.statement}</p>}</Field>
              </section>
              <section className={styles.reviewGroup}><h2>Standard rates</h2><div className={styles.twoFields}><Field label="Purchase APR (%)" source={source("purchase")}>{rateInput("purchase-apr", purchaseApr, value => { setPurchaseApr(value); mark("purchase"); }, "Purchase APR (%)")}</Field><Field label="Cash APR (%)" source={source("cash")}>{rateInput("cash-apr", cashApr, value => { setCashApr(value); mark("cash"); }, "Cash APR (%)")}</Field></div></section>
              {drafts.map((offer, index) => <section key={offer.id} className={styles.reviewGroup}><div className={styles.sectionHeading}><h2>Offer {index + 1}</h2><span>{offer.endDate ? `Ends ${formatDate(offer.endDate)}` : "End date missing"}</span></div>
                <Field label="Offer type" source={source(`${offer.id}-type`)}><div role="group" aria-label={`Offer ${index + 1} type`} className={styles.typeChoices}>{["Balance transfer", "Purchases", "Money transfer"].map(type => <button type="button" key={type} aria-pressed={offer.type === type} onClick={() => updateOffer(offer.id, { type: type as Offer["type"] })}>{type}</button>)}</div></Field>
                <div className={styles.twoFields}><Field label="Offer rate (%)" source={source(`${offer.id}-rate`)}>{rateInput(`${offer.id}-rate`, String(offer.rate), value => updateOffer(offer.id, { rate: value === "" ? NaN : Number(value) }), `Offer ${index + 1} rate (%)`)}</Field><Field label="Balance on this offer (£)" source={source(`${offer.id}-balance`)}>{hidden ? <p className={styles.hiddenInput}>Figures hidden. Show figures to edit.</p> : <input className={`${styles.input} ${styles.money}`} name={`${offer.id}-balance`} aria-label={`Offer ${index + 1} balance (£)`} aria-invalid={!!inputErrors[`${offer.id}-balance`]} aria-describedby={inputErrors[`${offer.id}-balance`] ? `${offer.id}-balance-error` : undefined} type="text" inputMode="decimal" autoComplete="off" value={rawValues[`${offer.id}-balance`] ?? (Number.isNaN(offer.balance) ? "" : offer.balance)} onChange={event => { setRawValues(values => ({ ...values, [`${offer.id}-balance`]: event.target.value })); updateOffer(offer.id, { balance: event.target.value === "" ? NaN : Number(event.target.value) }); }} />}{inputErrors[`${offer.id}-balance`] && <p className={styles.fieldError} id={`${offer.id}-balance-error`}>{inputErrors[`${offer.id}-balance`]}</p>}</Field></div>
                <Field label="Exact end date" source={source(`${offer.id}-endDate`, !offer.endDate ? "Not found in this source" : reviewSource)}><DateField mode="day" label={`Offer ${index + 1} exact end date`} value={offer.endDate ?? ""} onChange={value => updateOffer(offer.id, { endDate: value || null })} today={PREVIEW_DATE} allowClear placeholder="Not found. Add a date" /></Field>
                <Field label="APR after the offer (%)" source={source(`${offer.id}-revertRate`, offer.revertRate == null ? "Not found in this source" : reviewSource)}>{rateInput(`${offer.id}-revert`, offer.revertRate == null ? "" : String(offer.revertRate), value => updateOffer(offer.id, { revertRate: value === "" ? null : Number(value) }), `Offer ${index + 1} APR after the offer (%)`)}</Field>
                {(!offer.endDate || offer.revertRate == null) && <p className={styles.caution}><span className={styles.amberDot} aria-hidden="true" />{!offer.endDate ? "The end date was not found. Add it from your card app, or leave it unknown." : "The rate after this offer was not found. Leave it unknown if you cannot verify it."}</p>}
              </section>)}
              {hasUnknown && <label className={styles.checkbox}><input type="checkbox" name="keep-unknown-details" checked={unknownAccepted} aria-invalid={!!inputErrors.unknown} aria-describedby={inputErrors.unknown ? "unknown-details-error" : undefined} onChange={event => setUnknownAccepted(event.target.checked)} /><span>Keep missing details as unknown. No end date or rate will be guessed.</span></label>}{inputErrors.unknown && <p className={styles.fieldError} id="unknown-details-error">{inputErrors.unknown}</p>}
              <p className={styles.helper}>Confirmation updates the values shown above. Other offers and your payment settings stay as they are.</p>
            </div>
          </div>
          <div className={styles.reviewFooter}>{Object.keys(inputErrors).length > 0 && <p ref={errorRef} tabIndex={-1} className={styles.formError} role="alert">{Object.values(inputErrors).join(" ")}</p>}<div className={styles.footerInner}><div><strong>{drafts.length} offers · {matchedCard.name}</strong><small>Confirm once you have checked the source.</small></div><button type="submit" className={styles.button} disabled={busy}>{busy ? "Confirming…" : "Confirm these details"}<Check size={16} aria-hidden="true" /></button></div></div>
        </form>}
      </main>
      <footer className={styles.previewFooter}>{variant.toUpperCase()} · {direction.name} · Fictional data as at {formatDate(PREVIEW_DATE)} · Design round, no live changes</footer>
    </div>
  </div>;
}
