"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ForecastContext, MovementCampaignProof, MovementGraphics, PaymentGraphics, UpcomingCampaignProof } from "./CampaignProof";
import ProductionProof from "./ProductionProof";
import { SAFE_TO_SPEND } from "./fixtures";
import styles from "./worlds.module.css";

const worlds = {
  c: { name: "Real life", image: "real-life", feature: "safe-to-spend", title: ["Life happens.", "See what fits."], sub: "Meet your Safe to Spend.", summary: "Everyday life, lifted out of the screen.", detail: "A tactile burst of coffee, groceries and plans around the real Safe to Spend view. Bright, human and built for a first introduction to Sorted.", film: "The objects lift into view, then settle around the phone. The estimated Safe to Spend card comes forward and holds still to read.", legal: "Fictional example. Safe to Spend is an estimate, not financial advice.", theme: "light" },
  d: { name: "Payday path", image: "connected-payments", feature: "upcoming", title: ["See it coming.", "Before it goes."], sub: "Upcoming payments, brought together.", summary: "Different accounts. One clear picture.", detail: "Two payment cards sit outside the phone at a readable scale. Calendar trails gather Monzo and Barclays activity into the forecast, with dates, amounts and the payment shortfall still visible.", film: "The bank activity arrives along the paper trails. Mobile and Energy lift into view, then the forecast settles. These are information flows, not bank transfers.", legal: "Fictional forecast. Payments can take a day or two to appear. Account information via Finexer Ltd. AURIQ LTD is its agent.", theme: "dark" },
  e: { name: "Money movement", image: "money-movement", feature: "suggestions", title: ["One less thing", "to work out."], sub: "Sorted suggests the move.\nYou transfer with your bank.", summary: "The move, already worked out.", detail: "A clear route from Monzo Everyday to Barclays Bills, with a suggested £120 move. The real cover plan explains why. This replaces the Penny bubbles with the money task itself.", film: "The source and destination appear, then the suggested amount is placed on the route. Hold on the cover plan. The sequence ends before any transfer: you make it with your bank.", legal: "Fictional suggestion. Sorted does not move money. You make the transfer with your bank.", theme: "light" },
} as const;
type Campaign = keyof typeof worlds;
type Canvas = "feed" | "story";

function RealScreen({ campaign }: { campaign: Campaign }) {
  const world = worlds[campaign];
  return <div className={`${styles.screen} ${world.theme === "dark" ? "dark" : ""}`} inert>
    <div className={styles.screenInner}>
      <div className={styles.screenTitle}>{campaign === "c" ? "Home" : campaign === "d" ? "Before payday" : "Your cover plan"}</div>
      {campaign === "d" ? <UpcomingCampaignProof /> : campaign === "e" ? <MovementCampaignProof /> : <ProductionProof feature={world.feature} />}
    </div>
  </div>;
}

export function CampaignArtboard({ campaign, canvas }: { campaign: Campaign; canvas: Canvas }) {
  const world = worlds[campaign];
  const safeToSpend = SAFE_TO_SPEND.status === "ok" ? SAFE_TO_SPEND.safe_to_spend : null;
  return <article data-campaign-artboard className={`${styles.artboard} ${styles[campaign]} ${canvas === "story" ? styles.story : ""}`} aria-label={`${world.name} campaign concept`}>
    <div className={styles.brand}>Sorted<span>The money-planning app</span></div>
    <div className={styles.headline}><h2>{world.title.map((line) => <span key={line}>{line}</span>)}</h2><p>{world.sub}</p></div>
    {campaign === "d" && <ForecastContext />}
    <div data-campaign-scene className={styles.scene}>
      {/* Generated scenery has a blank screen. Product UI is rendered above it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/design-media/c22/worlds/${world.image}.png`} width={1254} height={1254} alt="" />
      <RealScreen campaign={campaign} />
      {campaign === "c" && safeToSpend != null && <div className={styles.liftedFigure}><span className={styles.money}>{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(safeToSpend)}</span><span>Safe to Spend<span className={styles.estimate}>Estimated · until 30 Oct</span></span></div>}
      {campaign === "d" && <PaymentGraphics />}
      {campaign === "e" && <MovementGraphics />}
    </div>
    <footer className={styles.artFooter}><p>{world.legal}</p><span>Meet Sorted <span aria-hidden="true">↗</span></span></footer>
  </article>;
}

export default function CampaignWorlds() {
  const params = useSearchParams();
  const chosen = params.get("campaign") ?? params.get("variant");
  const [campaign, setCampaign] = useState<Campaign>(chosen === "d" || chosen === "e" ? chosen : "c");
  const [canvas, setCanvas] = useState<Canvas>(params.get("canvas") === "story" ? "story" : "feed");
  const exact = params.get("art") === "1";
  const world = worlds[campaign];
  const holder = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(.3);
  const height = canvas === "story" ? 1920 : 1350;
  useEffect(() => {
    if (!exact) window.history.replaceState(window.history.state, "", `?campaign=${campaign}&canvas=${canvas}`);
  }, [campaign, canvas, exact]);
  useLayoutEffect(() => {
    const measure = () => { if (holder.current) setFit(holder.current.clientWidth / 1080); };
    const observer = new ResizeObserver(measure);
    if (holder.current) observer.observe(holder.current);
    measure();
    return () => observer.disconnect();
  }, []);
  if (exact) return <div className={styles.exact}><CampaignArtboard campaign={campaign} canvas={canvas} /></div>;
  return <main className={styles.workbench}>
    <header className={styles.header}><Link href="/design">Design library</Link><h1>Less screenshot.<br />More campaign.</h1><p>C stays as it was. D now gathers upcoming payments outside the phone; E replaces the Penny bubbles with a suggested money move.</p></header>
    <div className={styles.controls}>
      <fieldset><legend>Creative direction</legend>{(Object.keys(worlds) as Campaign[]).map((id) => <button type="button" key={id} aria-pressed={campaign === id} onClick={() => setCampaign(id)}>{id.toUpperCase()} · {worlds[id].name}</button>)}</fieldset>
      <fieldset><legend>Canvas</legend>{(["feed", "story"] as const).map((id) => <button type="button" key={id} aria-pressed={canvas === id} onClick={() => setCanvas(id)}>{id === "feed" ? "Feed" : "Story"}</button>)}</fieldset>
    </div>
    <div className={styles.review}>
      <div ref={holder} className={styles.stage} style={{ height: height * fit }}><div style={{ transform: `scale(${fit})`, transformOrigin: "top left" }}><CampaignArtboard campaign={campaign} canvas={canvas} /></div></div>
      <section className={styles.notes} aria-label="Concept details"><h2>{world.summary}</h2><p>{world.detail}</p><h3>How it could move</h3><p>{world.film}</p><p className={styles.draft}>Creative direction only. These are new still concepts, not the finished 3D films.</p><a href={`?campaign=${campaign}&canvas=${canvas}&art=1`} target="_blank" rel="noreferrer">Open full-size artwork <span aria-hidden="true">↗</span></a><a href={`/design-media/c22/worlds/${campaign}-${canvas}.png`} download>Download this concept</a><details><summary>What is real, what is rendered?</summary><p>The phone and surrounding objects are generated 3D-style artwork. The screen renders Sorted’s actual components with fictional figures. No bank is connected, no money moves and no consent is given.</p><p>The scene is an advertising illustration, not a photograph of a device or a redesign of the app.</p></details></section>
    </div>
    <section className={styles.next}><h2>Choose the world.<br />Then build the campaign.</h2><p>We can carry the chosen direction across the seven feature stories, light and dark executions, social films and landing-page artwork. Store screenshots remain a separate, more literal product treatment.</p><Link href="?library=1">Product proof and copy</Link><p className={styles.small}>The earlier A/B material is retained as a reference library, not the approved campaign. All concepts still need creative and compliance approval before publication.</p></section>
  </main>;
}
