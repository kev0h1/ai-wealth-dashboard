"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import PennyMark from "@/components/PennyMark";
import ProductionProof from "./ProductionProof";
import { SAFE_TO_SPEND } from "./fixtures";
import styles from "./worlds.module.css";

const worlds = {
  c: { name: "Real life", image: "real-life", feature: "safe-to-spend", title: ["Life happens.", "See what fits."], sub: "Meet your Safe to Spend.", summary: "Everyday life, lifted out of the screen.", detail: "A tactile burst of coffee, groceries and plans around the real Safe to Spend view. Bright, human and built for a first introduction to Sorted.", film: "The objects lift into view, then settle around the phone. The estimated Safe to Spend card comes forward and holds still to read.", legal: "Fictional example. Safe to Spend is an estimate, not financial advice.", theme: "light" },
  d: { name: "Payday path", image: "payday-path", feature: "upcoming", title: ["See it coming.", "Before it goes."], sub: "Upcoming payments. Account by account.", summary: "The days before payday become a place.", detail: "A sculpted calendar winds around the phone. A cinematic direction for showing what is coming and where a payment could leave an account short.", film: "The camera follows the calendar towards the phone, then stops on the account view. Payment risks stay visible, not hidden behind an upbeat headline.", legal: "Fictional forecast. Payments can take a day or two to appear.", theme: "dark" },
  e: { name: "Ask Penny", image: "penny", feature: "penny", title: ["Money on", "your mind?"], sub: "Ask Penny. Review the next step.", summary: "A conversation you can almost touch.", detail: "Pearlescent speech bubbles rise around a dark phone, with Penny's indigo and violet reserved for the conversation. The real proposal keeps you in control.", film: "A question rises from the phone. Penny's proposal comes forward with Confirm and Cancel both visible. No money moves and nothing confirms itself.", legal: "Fictional conversation. General information, not regulated financial advice.", theme: "dark" },
} as const;
type Campaign = keyof typeof worlds;
type Canvas = "feed" | "story";

function RealScreen({ campaign }: { campaign: Campaign }) {
  const world = worlds[campaign];
  return <div className={`${styles.screen} ${world.theme === "dark" ? "dark" : ""}`} inert>
    <div className={styles.screenInner}>
      <div className={styles.screenTitle}>{campaign === "c" ? "Home" : campaign === "d" ? "Before payday" : <><PennyMark size={22} /> Ask Penny</>}</div>
      <ProductionProof feature={world.feature} />
    </div>
  </div>;
}

export function CampaignArtboard({ campaign, canvas }: { campaign: Campaign; canvas: Canvas }) {
  const world = worlds[campaign];
  const safeToSpend = SAFE_TO_SPEND.status === "ok" ? SAFE_TO_SPEND.safe_to_spend : null;
  return <article data-campaign-artboard className={`${styles.artboard} ${styles[campaign]} ${canvas === "story" ? styles.story : ""}`} aria-label={`${world.name} campaign concept`}>
    <div className={styles.brand}>Sorted<span>The money-planning app</span></div>
    <div className={styles.headline}><h2>{world.title.map((line) => <span key={line}>{line}</span>)}</h2><p>{world.sub}</p></div>
    <div data-campaign-scene className={styles.scene}>
      {/* Generated scenery has a blank screen. Product UI is rendered above it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/design-media/c22/worlds/${world.image}.png`} width={1254} height={1254} alt="" />
      <RealScreen campaign={campaign} />
      {campaign === "c" && safeToSpend != null && <div className={styles.liftedFigure}><span className={styles.money}>{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(safeToSpend)}</span><span>Safe to Spend<span className={styles.estimate}>Estimated · until 30 Oct</span></span></div>}
      {campaign === "e" && <div className={styles.pennySculpture}><PennyMark size={92} /></div>}
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
    <header className={styles.header}><Link href="/design">Design library</Link><h1>Less screenshot.<br />More campaign.</h1><p>Three new directions for C22. Sculpted phones, real-life objects and app elements that step out of the screen.</p></header>
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
