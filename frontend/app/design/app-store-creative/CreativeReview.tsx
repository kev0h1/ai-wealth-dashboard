"use client";
/* eslint-disable @next/next/no-img-element -- Review exact downloadable artwork, including its safe-area crop. */

import { useEffect, useRef, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import CreativeCanvas from "./CreativeCanvas";
import { assetFile, FORMATS, MEDIA, OPTIONS, SLOTS, THEMES, VARIANTS, type Slot, type Theme } from "./catalog";
import styles from "./creative.module.css";

const CreativeProof = dynamic(() => import("./CreativeProof"), { ssr: false });
const VIEWS = ["safe", "full", "small"] as const;
type View = (typeof VIEWS)[number];

export default function CreativeReview() {
  const params = useSearchParams();
  const gallery = useRef<HTMLElement>(null);
  const theme: Theme = params.get("mode") === "dark" ? "dark" : "light";
  const slot: Slot = (params.get("slot") ?? params.get("state")) === "search" ? "search" : "header";
  const variant = params.get("variant") === "b" ? "b" : "a";
  const view: View = params.get("view") === "full" ? "full" : params.get("view") === "small" ? "small" : "safe";
  const proof = params.get("proof");
  useEffect(() => {
    const html = document.documentElement;
    const previousDark = html.classList.contains("dark");
    const previousScheme = html.style.colorScheme;
    let restoreMetas = () => {};
    // Run after the parent app preference effects have set their initial
    // theme. This isolated review follows the URL, never a saved preference.
    const frame = requestAnimationFrame(() => {
      const metas = ["theme-color", "color-scheme"].map((name) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`));
      const previousMetaValues = metas.map((meta) => meta?.content);
      restoreMetas = () => metas.forEach((meta, index) => { if (meta && previousMetaValues[index]) meta.content = previousMetaValues[index]!; });
      html.classList.toggle("dark", theme === "dark");
      html.style.colorScheme = theme === "dark" ? "dark" : "only light";
      if (metas[0]) metas[0].content = theme === "dark" ? "#0f172a" : "#f0f2f7";
      if (metas[1]) metas[1].content = theme === "dark" ? "dark" : "only light";
      gallery.current?.setAttribute("data-c41-ready", "true");
    });
    return () => {
      cancelAnimationFrame(frame);
      html.classList.toggle("dark", previousDark);
      html.style.colorScheme = previousScheme;
      restoreMetas();
    };
  }, [theme]);
  if (proof === "amount" || proof === "penny") return <CreativeProof kind={proof} theme={theme} />;
  if (params.get("export") === "1") return <CreativeCanvas slot={slot} variant={variant} theme={theme} />;

  function href(update: Record<string, string>) {
    const query = new URLSearchParams({ slot, mode: theme, view, ...update });
    return `?${query}`;
  }
  const format = FORMATS[slot];
  const crop = {
    "--crop-ratio": `${format.safe.width} / ${format.safe.height}`,
    "--image-width": `${100 * format.width / format.safe.width}%`,
    "--image-left": `${-100 * format.safe.x / format.safe.width}%`,
    "--image-top": `${-100 * format.safe.y / format.safe.height}%`,
  } as CSSProperties;
  return <main ref={gallery} data-c41-gallery data-c41-ready="false" className={`${styles.gallery} ${styles[theme]}`}>
    <a className={styles.skip} href="#options">Skip to the options</a>
    <header className={styles.galleryHeader}>
      <Link className={styles.back} href="/design">Back to design previews</Link>
      <h1>App Store creative</h1>
      <p>Two directions for each placement, in the approved C22 style. Choose a Header and a Search Results image independently.</p>
      <p className={styles.status}>Creative review · C41 · Fictional examples</p>
    </header>

    <div className={styles.controls}>
      <nav aria-label="Placement">{SLOTS.map((value) => <Link key={value} href={href({ slot: value })} aria-current={slot === value ? "true" : undefined}>{FORMATS[value].label}</Link>)}</nav>
      <nav aria-label="Artwork theme">{THEMES.map((value) => <Link key={value} href={href({ mode: value })} aria-current={theme === value ? "true" : undefined}>{value === "light" ? "Light" : "Dark"}</Link>)}</nav>
      <nav aria-label="Artwork view">{VIEWS.map((value) => <Link key={value} href={href({ view: value })} aria-current={view === value ? "true" : undefined}>{value === "safe" ? "Safe-area close-up" : value === "full" ? "Full artwork" : "At 390 px"}</Link>)}</nav>
    </div>

    <section id="options" aria-labelledby="placement-heading" className={styles.options}>
      <div className={styles.sectionHeading}>
        <h2 id="placement-heading">{format.label}</h2>
        <p>{format.width.toLocaleString("en-GB")} × {format.height.toLocaleString("en-GB")} px · Opaque RGB PNG</p>
      </div>
      <p className={styles.viewNote}>
        {view === "safe" ? "Magnified to Apple’s art safe area for comparison. Downloads contain the full artwork." : view === "full" ? "The complete export. All essential copy and product evidence sits inside Apple’s template safe area." : "The full image at up to 390 pixels wide. This is a size check, not an App Store device preview."}
      </p>
      <div className={styles.optionGrid}>
        {VARIANTS.map((value) => {
          const option = OPTIONS[value];
          const file = assetFile(slot, value, theme);
          const alt = slot === "header" && value === "b" ? "Sorted. Your money. A clearer picture. A conversation with your money adviser." : option.alt;
          return <article key={value} className={styles.option}>
            <div className={`${styles.artView} ${view === "safe" ? styles.crop : ""} ${view === "small" ? styles.small : ""}`} style={view === "safe" ? crop : undefined}>
              <img src={`${MEDIA}/${file}`} alt={alt} width={format.width} height={format.height} loading={value === "b" ? "lazy" : "eager"} fetchPriority={value === "a" ? "high" : "auto"} />
            </div>
            <h3>{value.toUpperCase()} · {option.name}</h3>
            <p>{option.description}</p>
            <div className={styles.downloads}>
              <a href={`${MEDIA}/${file}`} download={file}>Download {format.label} {value.toUpperCase()} · {theme}</a>
              {slot === "search" && <a href={`${MEDIA}/${assetFile(slot, value, theme, true)}`} download>1920 × 1280 version</a>}
            </div>
          </article>;
        })}
      </div>
    </section>

    <section className={styles.handoff} aria-labelledby="handoff-heading">
      <div>
        <h2 id="handoff-heading">Ready for your choice</h2>
        <p>Use each download in its named App Store Connect slot. Apple accepts one asset per slot, so choose one option and theme for each.</p>
        <div className={styles.downloads}>
          <a href={`${MEDIA}/sorted-app-store-creative-options.zip`} download>Download all 12 images</a>
          <a href={`${MEDIA}/manifest.json`} download>Export manifest</a>
        </div>
      </div>
      <div>
        <h3>Checked against Apple’s templates</h3>
        <p>Specifications checked on 12 November 2026. Keep the full dimensions when uploading, then check the device crops in App Store Connect’s Preview tool.</p>
        <p><a href="https://developer.apple.com/app-store/asset-best-practices/">Apple’s asset guidance</a> · <a href="https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/">Image specifications</a></p>
      </div>
    </section>
    <footer className={styles.footer}>
      <p>Current production UI with fictional C22 fixtures. The Left to spend example is dated October 2026; Penny’s comparison is dated November 2026. No customer data is used.</p>
      <p>Open banking is provided by Finexer Ltd. AURIQ LTD acts as its agent.</p>
    </footer>
  </main>;
}
