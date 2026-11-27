"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CreditCard, LockKeyhole, Upload } from "@/lib/phosphorIcons";
import { api, type CardTermsCard } from "@/lib/api";
import { todayIso } from "@/lib/calendar";
import { displayAccountName } from "@/lib/accountName";
import { usePreferences } from "@/components/PreferencesContext";
import OfferCards from "./OfferCards";
import CardOfferImportSheet, { type CardOfferSaved } from "./CardOfferImportSheet";
import { listCardOffers } from "@/lib/cardOffers";
import styles from "./CardOffers.module.css";

export default function CardOffersPage() {
  const params = useSearchParams();
  const { hideNetWorth, preferencesReady, setHideNetWorth } = usePreferences();
  const hidden = hideNetWorth || !preferencesReady;
  const [cards, setCards] = useState<CardTermsCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importCardId, setImportCardId] = useState<string | undefined>();
  const [notice, setNotice] = useState("");
  const request = useRef(0);
  const live = useRef(true);
  const filter = cards.some(card => card.account_id === params.get("card")) ? params.get("card")! : "all";
  const filteredCards = filter === "all" ? cards : cards.filter(card => card.account_id === filter);
  const offers = listCardOffers(filteredCards);
  const canImport = cards.some(card => card.currency === "GBP" && card.card_class !== "charge_card");
  const today = todayIso();

  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setFailed(false);
    try {
      const response = await api.getCardTerms();
      if (live.current && request.current === current) { setCards(response.cards); setLoaded(true); }
    } catch (problem) {
      if (live.current && request.current === current) setFailed(true);
      throw problem;
    } finally { if (live.current && request.current === current) setLoading(false); }
  }, []);
  useEffect(() => { live.current = true; void refresh().catch(() => {}); return () => { live.current = false; request.current += 1; }; }, [refresh]);

  function openImport(accountId?: string) {
    const target = accountId ?? (filter === "all" ? undefined : filter);
    setImportCardId(cards.some(card => card.account_id === target && card.currency === "GBP" && card.card_class !== "charge_card") ? target : undefined);
    setImportOpen(true);
  }
  function filterHref(accountId: string) {
    const next = new URLSearchParams(params.toString());
    if (accountId === "all") next.delete("card"); else next.set("card", accountId);
    return `/accounts/card-offers${next.size ? `?${next}` : ""}`;
  }
  async function onSaved(result: CardOfferSaved) {
    setCards(values => values.map(card => card.account_id === result.accountId ? { ...card, terms: result.terms } : card));
    setNotice("Card details confirmed.");
    await refresh();
  }

  return <main className={`${styles.surface} ${styles.page}`} id="card-offers-content" tabIndex={-1}>
    <a className={styles.skip} href="#card-offers-content">Skip to card offers</a>
    <div className={styles.pageInner}>
      <header className={styles.pageHeader}>
        <div className={styles.headingRow}><Link href="/accounts" className={styles.back}><ArrowLeft size={15} aria-hidden="true" />Accounts</Link><button type="button" className={styles.privacy} onClick={() => setHideNetWorth(!hideNetWorth)} disabled={!preferencesReady}><LockKeyhole size={14} aria-hidden="true" />{hidden ? "Show balances" : "Hide balances"}</button></div>
        <h1>Your card offers</h1><p>Know when each offer ends, and what rate comes next.</p>
      </header>
      {notice && <p role="status" className={styles.notice}><Check size={18} aria-hidden="true" />{notice}</p>}
      {failed && <div className={styles.notice} role="status"><div><p>{loaded ? "The offers could not refresh. Showing the last known details." : "Your card offers could not be loaded."}</p><button type="button" className={styles.textButton} onClick={() => void refresh().catch(() => {})} disabled={loading}>Try again</button></div></div>}
      {loading && !loaded ? <div role="status" aria-label="Loading card offers"><p className={styles.helper}>Loading your card offers…</p><div className={styles.skeleton} /><div className={styles.skeleton} /></div> : loaded && <div className={styles.layout}>
        <section aria-label="Recorded card offers">
          <nav className={styles.filters} aria-label="Filter offers by card"><Link href={filterHref("all")} aria-current={filter === "all" ? "page" : undefined}>All cards</Link>{cards.filter(card => card.card_class !== "charge_card").map(card => <Link key={card.account_id} href={filterHref(card.account_id)} aria-current={filter === card.account_id ? "page" : undefined}>{displayAccountName(card.name)}</Link>)}</nav>
          <div className={styles.sectionIntro}><h2>{offers.length} {offers.length === 1 ? "offer" : "offers"} {filter === "all" ? "across your cards" : "on this card"}</h2>{canImport && <button type="button" className={styles.textButton} onClick={() => openImport()}>Add a file<Upload size={15} aria-hidden="true" /></button>}<p>{loading ? "Updating the recorded details…" : "Soonest end date first"}</p></div>
          {offers.length ? <OfferCards cards={filteredCards} hidden={hidden} today={today} onUpdate={openImport} /> : <div className={styles.empty}><CreditCard size={28} aria-hidden="true" /><h2>No offers recorded yet</h2><p>{canImport ? "Add a statement or screenshot to record each offer’s rate, balance and exact end date." : "Add a GBP credit card in Accounts to read its rates and offers from a file."}</p>{canImport ? <button type="button" className={styles.button} onClick={() => openImport()}>Add from a file<Upload size={16} aria-hidden="true" /></button> : <Link href="/accounts" className={styles.button}>Go to Accounts</Link>}</div>}
          <p className={styles.pageCaveat}>Balances belong to individual offers. They are recorded snapshots and may not add up to today’s card balance.</p>
        </section>
        <div className={styles.sidePanel}><h2>Keep the details current</h2><p>Read rates and offers from a statement or a screenshot of your card app. You check the values before saving.</p>{canImport && <button type="button" className={styles.button} onClick={() => openImport()}>Add from a file<Upload size={16} aria-hidden="true" /></button>}<p>To edit a card’s details by hand, open the card in Accounts, then choose Rates and deals.</p></div>
      </div>}
      {importOpen && <CardOfferImportSheet cards={cards} startAccountId={importCardId} onClose={() => setImportOpen(false)} onSaved={onSaved} />}
    </div>
  </main>;
}
