"use client";
/* eslint-disable @next/next/no-img-element -- Review and download the exact exported artwork without image re-encoding. */

import { useSearchParams } from "next/navigation";
import MoneyText from "@/components/MoneyText";
import PosterCanvas, { type PosterFormat, type PosterTheme, type PosterVariant } from "./PosterCanvas";
import styles from "./gallery.module.css";

const variants: { id: PosterVariant; title: string; caption: string }[] = [
  { id: "amount", title: "The amount", caption: "£312 estimated Safe to Spend until 30 October 2026, with the current app view." },
  { id: "account", title: "The account", caption: "A £68 bills account, a £188 expected payment and a £120 shortfall." },
  { id: "working", title: "The working", caption: "£610 cash less £188 expected bills and £110 buffer leaves £312 estimated." },
];
const films = [{ id: "balance", title: "Balance, in view", caption: "A short film about the estimate." }, { id: "account", title: "The bills account", caption: "A short film about an upcoming shortfall." }];

export default function CampaignGallery() {
  const search = useSearchParams();
  const theme: PosterTheme = search.get("mode") === "dark" ? "dark" : "light";
  const format: PosterFormat = search.get("format") === "story" ? "story" : "feed";
  const queryVariant = (search.get("variant") === "account" || search.get("variant") === "working") ? search.get("variant") : "amount";
  const update = (key: "mode" | "format", value: string) => {
    // Read the current URL so two quick control taps preserve each other.
    const next = new URLSearchParams(window.location.search);
    next.set(key, value);
    // Next preserves its internal history state and synchronises useSearchParams.
    window.history.replaceState(null, "", `?${next.toString()}${window.location.hash}`);
  };
  const setTheme = (value: PosterTheme) => update("mode", value);
  const setFormat = (value: PosterFormat) => update("format", value);
  if (search.get("art") === "1") return <PosterCanvas variant={queryVariant as PosterVariant} theme={theme} format={format} />;
  return <main className={styles.gallery} aria-label="Campaign media library">
    <div className={styles.top}><div><p className={styles.eyebrow}>C22 · CAMPAIGN REVIEW</p><h1>Money, shown plainly.</h1><p className={styles.intro}>Images and films use fictional examples and production interface captures.</p></div><div className={styles.controls}><fieldset><legend>Theme</legend><button aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light</button><button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark</button></fieldset><fieldset><legend>Format</legend><button aria-pressed={format === "feed"} onClick={() => setFormat("feed")}>Feed</button><button aria-pressed={format === "story"} onClick={() => setFormat("story")}>Story</button></fieldset></div></div>
    <nav className={styles.jump} aria-label="Media sections"><a href="#videos">Watch the videos</a><a href="#images">View the images</a></nav>
    <p className={styles.draft}>12 images · 4 MP4s · Draft review media with fictional data.</p><section id="images" aria-labelledby="images-title"><div className={styles.sectionHead}><p>01</p><h2 id="images-title">Images</h2></div><div className={styles.imageGrid}>{variants.map((item) => { const source = `/design-media/c22/next/${item.id}-${theme}-${format}.png`; return <article key={item.id}><a className={styles.fullImage} href={source}><img src={source} width="1080" height={format === "story" ? 1920 : 1350} alt={`${item.title} campaign image. ${item.caption}`} /></a><h3>{item.title}</h3><p><MoneyText text={item.caption} unmasked /></p><a href={source} download>Download PNG</a> · <a href={source}>Full size</a></article>; })}</div></section>
    <section id="videos" aria-labelledby="videos-title"><div className={styles.sectionHead}><p>02</p><h2 id="videos-title">Videos</h2></div><div className={styles.videoGrid}>{films.map((film) => <article key={`${film.id}-${theme}`}><video aria-label={film.title} controls playsInline preload="metadata" poster={`/design-media/c22/next/${film.id}-${theme}-poster.jpg`}><source src={`/design-media/c22/next/${film.id}-${theme}.mp4`} type="video/mp4" /><track kind="captions" srcLang="en-GB" label="English" default src={`/design-media/c22/next/${film.id}.vtt`} /></video><h3>{film.title}</h3><p>{film.caption} 15 seconds, with sound.</p><a href={`/design-media/c22/next/${film.id}-${theme}.mp4`} download>Download MP4</a></article>)}</div></section>
    <footer className={styles.archive}><a href="?round=crafted">Crafted round</a><a href="?round=worlds">Worlds round</a><a href="?library=1">Media library</a><a href="/design-media/c22/next/manifest.json">Manifest</a></footer>
  </main>;
}
