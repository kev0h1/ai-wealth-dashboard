"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Artboard, { ProofPlate, type Direction, type Format, type Theme } from "./Artboard";
import { type FeatureId } from "./ProductionProof";
import content from "./content.json";
import styles from "./marketing.module.css";

const ReelPreview = dynamic(() => import("./ReelPreview"), { ssr: false, loading: () => <p>Loading film controls…</p> });
const filmIds = ["safe-to-spend", "upcoming", "penny", "overview", "app-preview"] as const;
type Film = typeof filmIds[number];

export default function MarketingKit() {
  const params = useSearchParams();
  const initialFeature = content.features.some((f) => f.id === params.get("feature")) ? params.get("feature") as FeatureId : "safe-to-spend";
  const [feature, setFeature] = useState<FeatureId>(initialFeature);
  const [theme, setTheme] = useState<Theme>(params.get("theme") === "dark" ? "dark" : "light");
  const [direction, setDirection] = useState<Direction>(params.get("direction") === "b" ? "b" : "a");
  const [format, setFormat] = useState<Format>((params.get("format") ?? "") in content.formats ? params.get("format") as Format : "feed");
  const [film, setFilm] = useState<Film>("safe-to-spend");
  const [showFilm, setShowFilm] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.25);
  const exact = params.get("export") === "1";
  const plate = params.get("plate") === "1";
  const size = content.formats[format];
  useEffect(() => {
    if (!exact && !plate) window.history.replaceState(null, "", `?feature=${feature}&format=${format}&direction=${direction}&theme=${theme}`);
  }, [feature, format, direction, theme, exact, plate]);
  useLayoutEffect(() => {
    const measure = () => { if (holder.current) setFit(Math.min(holder.current.clientWidth / size.width, 760 / size.height)); };
    const observer = new ResizeObserver(measure);
    if (holder.current) observer.observe(holder.current);
    measure();
    return () => observer.disconnect();
  }, [size.width, size.height]);
  if (plate) return <ProofPlate feature={feature} theme={theme} expanded={params.get("expanded") === "1"} />;
  if (exact) return <div className={styles.exact}><Artboard feature={feature} format={format} theme={theme} direction={direction} /></div>;
  const item = content.features.find((f) => f.id === feature)!;
  const file = `${direction}-${feature}-${format}-${theme}.png`;
  return <main className={`${styles.workbench} ${theme === "dark" ? "dark" : ""}`}>
    <div className={styles.shell}>
      <header className={styles.header}><Link href="/design">Design library</Link><h1>Sorted, out in the world.</h1><p>Marketing kit · C22 · Drafts for review, not approved advertising.</p><p>Two treatments. Seven stories. The real app, with fictional figures.</p></header>
      <section aria-label="Artwork controls" className={styles.controls}>
        <label>Story<select aria-label="Story" name="feature" value={feature} onChange={(e) => setFeature(e.target.value as FeatureId)}>{content.features.map((f) => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
        <label>Format<select aria-label="Format" name="format" value={format} onChange={(e) => setFormat(e.target.value as Format)}>{Object.entries(content.formats).map(([key, value]) => <option value={key} key={key}>{value.label} · {value.width} × {value.height}</option>)}</select></label>
        <fieldset><legend>Campaign</legend>{([['a', 'A · Answer first'], ['b', 'B · The question']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={direction === value} onClick={() => setDirection(value)}>{label}</button>)}</fieldset>
        <fieldset><legend>Theme</legend>{(["light", "dark"] as const).map((value) => <button type="button" key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === "light" ? "Light" : "Dark"}</button>)}</fieldset>
      </section>
      <section className={styles.reviewGrid} aria-label="Artwork preview">
        <div ref={holder} className={styles.stage}><div style={{ width: size.width * fit, height: size.height * fit }}><div style={{ transform: `scale(${fit})`, transformOrigin: "top left" }}><Artboard feature={feature} format={format} theme={theme} direction={direction} /></div></div></div>
        <div role="complementary" aria-label="Artwork details" className={styles.notes}><h2>{item.name}</h2><p>{item.proof}</p><p>{item.legal}</p><a href={`/design-media/c22/${file}`} download={file}>Download this PNG</a><a href={`?feature=${feature}&theme=${theme}&format=${format}&direction=${direction}&export=1`} target="_blank" rel="noreferrer">Open exact-size artwork</a><a href={`?feature=${feature}&theme=${theme}&plate=1&expanded=1`} target="_blank" rel="noreferrer">Inspect the production proof</a>{["connect", "suggestions", "penny"].includes(feature) && <a href={`/design-media/c22/detail-${feature}-${theme}.png`} download>Download the full detail</a>}<p>Fictional Alex Taylor. Examples do not connect a bank, grant permission or move money.</p></div>
      </section>
      <section className={styles.section}><h2>The films</h2><p>Three 15-second feature stories, a 30-second overview and an editorial App Store preview. Silent drafts, with captions. Playback is your choice.</p><div className={styles.filmControls}><label>Film<select aria-label="Film" name="film" value={film} onChange={(e) => setFilm(e.target.value as Film)}>{filmIds.map((id) => <option key={id} value={id}>{id.replaceAll("-", " ")}</option>)}</select></label><button type="button" onClick={() => setShowFilm(!showFilm)}>{showFilm ? "Close player" : "Open player"}</button><a href={`/design-media/c22/${film}-${theme}.mp4`} download>Download MP4</a></div>{showFilm && <ReelPreview film={film} theme={theme} />}</section>
      <section className={styles.section}><h2>{content.positioning}</h2><div className={styles.pillars}>{content.pillars.map((pillar) => <div key={pillar.title}><h3>{pillar.title}</h3><p>{pillar.body}</p></div>)}</div></section>
      <section className={styles.section}><h2>Store listing copy</h2><p>Shared draft for C5. Counts are checked by the export validator. Google Play has no separate keywords or subtitle field.</p><dl className={styles.copy}>{Object.entries(content.store).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1").toLowerCase()} <span>{key === "keywords" ? new TextEncoder().encode(value).length + " bytes" : value.length + " characters"}</span></dt><dd>{value}</dd></div>)}</dl></section>
      <section className={styles.section}><h2>Landing-page sections</h2><p>Draft copy and matching images, ready for direction review. No live landing page is changed.</p>{content.features.map((f) => <article className={styles.landingRow} key={f.id}><div><h3>{f.landing}</h3><p>{f.landingBody}</p></div><a href={`/design-media/c22/${direction}-${f.id}-landing-${theme}.png`} download>Download {f.name.toLowerCase()} image</a></article>)}</section>
      <section className={styles.section}><h2>Before anything goes live</h2><ul>{content.reviewChecks.map((check) => <li key={check}>{check}</li>)}</ul><p><a href="/design-media/c22/manifest.json" download>Asset manifest and provenance</a> · <a href="/design-media/c22/listing-copy.json" download>Download listing copy</a></p><details><summary>Platform sources checked on 8 October 2026</summary><ul>{content.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></details></section>
    </div>
  </main>;
}
