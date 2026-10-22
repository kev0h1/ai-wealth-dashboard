"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import CampaignCanvas, { type Direction } from "./CampaignCanvas";
import CraftedProof from "./CraftedProof";
import styles from "./gallery.module.css";

const concepts = [
  { id: "receipt", name: "The receipt", title: "Show the working.", detail: "A physical receipt makes the estimate tangible. Original Blender geometry, paper, lighting and typesetting, paired with the real Safe to Spend component.", motion: "The paper enters, the calculation is revealed, then the app supplies the answer." },
  { id: "friday", name: "Friday?", title: "Start with a real decision.", detail: "One familiar question, expressed through lettering and timing. No stock lifestyle scene. The estimate is evidence for checking your options, not a promise that a night out is affordable.", motion: "The question changes rhythm, the working arrives, then the product holds long enough to read." },
  { id: "calendar", name: "The month, laid out", title: "Give the dates a shape.", detail: "Upcoming payments live on an October calendar, with their dates and bank context. A real Upcoming view keeps the pooled forecast separate from individual account shortfalls.", motion: "Payment dates appear in order before the Upcoming view reveals the account detail." },
] as const;
const base = "/design-media/c22/crafted";

export default function CraftedGallery() {
  const params = useSearchParams();
  const selected = params.get("direction") ?? params.get("variant");
  const [direction, setDirection] = useState<Direction>(selected === "friday" || selected === "calendar" ? selected : "receipt");
  const [theme, setTheme] = useState<"light" | "dark">(params.get("mode") === "dark" || params.get("theme") === "dark" ? "dark" : "light");
  const [format, setFormat] = useState<"feed" | "story">(params.get("format") === "story" ? "story" : "feed");
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const exact = params.get("art") === "1";
  const proof = params.get("crafted-proof");
  const frame = params.has("frame") ? Math.min(359, Math.max(0, Number(params.get("frame")) || 0)) : 330;
  const concept = concepts.find((item) => item.id === direction)!;
  const query = `direction=${direction}&mode=${theme}&format=${format}`;
  const height = format === "story" ? 1920 : 1350;

  useEffect(() => {
    if (!exact && !proof) window.history.replaceState(window.history.state, "", `?${query}`);
  }, [query, exact, proof]);
  useLayoutEffect(() => {
    if (!stage.current) return;
    const measure = () => setScale((stage.current?.clientWidth ?? 324) / 1080);
    const observer = new ResizeObserver(measure);
    observer.observe(stage.current);
    measure();
    return () => observer.disconnect();
  }, [exact, proof]);

  if (proof) return <div className={`${styles.proofPlate} ${theme === "dark" ? "dark" : ""}`} data-crafted-proof inert><CraftedProof feature={proof === "upcoming" ? "upcoming" : "safe-to-spend"} /></div>;
  if (exact) return <div className={styles.exact}><CampaignCanvas direction={direction} theme={theme} format={format} frame={frame} /></div>;

  return <main className={`${styles.page} ${theme === "dark" ? styles.dark : ""}`}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/design">Design library</Link>
        <h1>Money, without<br />the theatre.</h1>
        <p>Three new campaign directions for Sorted. Real questions, deliberate motion and the product doing the explaining.</p>
      </header>

      <div className={styles.controls}>
        <fieldset><legend>Campaign direction</legend><div>{concepts.map((item) => <button type="button" key={item.id} aria-pressed={item.id === direction} onClick={() => setDirection(item.id)}>{item.name}</button>)}</div></fieldset>
        <fieldset><legend>Appearance</legend><div>{(["light", "dark"] as const).map((value) => <button type="button" key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === "light" ? "Light" : "Dark"}</button>)}</div></fieldset>
        <fieldset><legend>Format</legend><div>{(["feed", "story"] as const).map((value) => <button type="button" key={value} aria-pressed={format === value} onClick={() => setFormat(value)}>{value === "feed" ? "Feed" : "Story"}</button>)}</div></fieldset>
      </div>

      <div className={styles.review}>
        <div ref={stage} className={styles.stage} style={{ height: height * scale }}>
          <div style={{ width: 1080, transform: `scale(${scale})`, transformOrigin: "top left" }} inert><CampaignCanvas direction={direction} theme={theme} format={format} /></div>
        </div>
        <section className={styles.notes} aria-label="Creative direction details">
          <h2>{concept.title}</h2><p>{concept.detail}</p>
          <a href={`${base}/${direction}-${format}-${theme}.png`} download>Download {format} image</a>
          <Link href={`?${query}&art=1`} target="_blank" rel="noreferrer">Open full-size artwork</Link>
          <h3>The 12-second film</h3><p>{concept.motion}</p>
          <video key={`${direction}-${theme}`} className={styles.film} controls playsInline preload="none" poster={`${base}/${direction}-story-${theme}.png`} aria-label={`${concept.name}, ${theme}, 12-second film`}>
            <source src={`${base}/${direction}-${theme}.mp4`} type="video/mp4" />
            <track kind="captions" src={`${base}/${direction}.vtt`} srcLang="en-GB" label="English" default />
          </video>
          <a href={`${base}/${direction}-${theme}.mp4`} download>Download the MP4</a>
          <p className={styles.caption}>Silent, caption-led creative. Playback is your choice.</p>
        </section>
      </div>

      <section className={styles.production}>
        <h2>Made with a point of view.</h2>
        <p>The receipt uses an editable Blender scene. The other two directions use authored type and calendar animation. All app evidence comes from current production components with fictional demo data. No generated actors, voices or lifestyle photographs are used in this round.</p>
        <p>Skills reviewed: Impeccable and frontend-design for art direction; official Remotion guidance for deterministic animation; ad-creative for grounding hooks in actual product evidence. A skill can improve the process. It cannot supply customer research or prove an advert will perform.</p>
        <p>Creative drafts for Kevin’s review. Publication, claims and platform placement still need approval. This round explores direction; it does not replace the full store screenshot library.</p>
        <div className={styles.links}><a href={`${base}/manifest.json`}>Asset manifest</a><Link href="?round=worlds">Previous 3D concepts</Link><Link href="?library=1">Product proof, store copy and earlier films</Link></div>
      </section>
    </div>
  </main>;
}
