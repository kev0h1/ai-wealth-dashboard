"use client";
/* eslint-disable @next/next/no-img-element -- Review and download exact exported artwork without re-encoding. */

import { useSearchParams } from "next/navigation";
import MoneyText from "@/components/MoneyText";
import PosterCanvas, { type PosterFormat, type PosterTheme, type PosterVariant } from "./PosterCanvas";
import FeaturePoster from "../features/FeaturePoster";
import { FEATURES, FEATURE_IDS, isFeature } from "../features/catalog";
import styles from "./gallery.module.css";

type Media = { id: string; title: string; caption: string; base: string; topic: string };
const original = "/design-media/c22/next";
const featureBase = "/design-media/c22/features";
const originalImages: Media[] = [
  { id: "amount", title: "The amount", caption: "£312 estimated Safe to Spend until 30 October 2026, with the current app view.", base: original, topic: "original" },
  { id: "account", title: "The account", caption: "A £68 bills account, a £188 expected payment and a £120 shortfall.", base: original, topic: "original" },
  { id: "working", title: "The working", caption: "£610 cash less £188 expected bills and £110 buffer leaves £312 estimated.", base: original, topic: "original" },
];
const featureMedia: Media[] = FEATURE_IDS.map(id => ({ id, ...FEATURES[id], base: featureBase, topic: id }));
const images = [...originalImages, ...featureMedia];
const films: Media[] = [
  { id: "balance", title: "Balance, in view", caption: "An estimate that shows its working.", base: original, topic: "original" },
  { id: "account", title: "The bills account", caption: "Which account needs attention before a payment.", base: original, topic: "original" },
  ...featureMedia,
];

export default function CampaignGallery() {
  const search = useSearchParams();
  const theme: PosterTheme = search.get("mode") === "dark" ? "dark" : "light";
  const format: PosterFormat = search.get("format") === "story" ? "story" : "feed";
  const variant = search.get("variant");
  const rawTopic = search.get("topic") ?? (isFeature(variant) ? variant : "all");
  const topic = rawTopic === "original" || isFeature(rawTopic) ? rawTopic : "all";
  const update = (key: "mode" | "format" | "topic", value: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set(key, value);
    window.history.replaceState(null, "", `?${next.toString()}${window.location.hash}`);
  };
  if (search.get("art") === "1") {
    if (isFeature(variant)) return <FeaturePoster feature={variant} theme={theme} format={format} />;
    const oldVariant: PosterVariant = variant === "account" || variant === "working" ? variant : "amount";
    return <PosterCanvas variant={oldVariant} theme={theme} format={format} />;
  }
  const visibleImages = images.filter(item => topic === "all" || item.topic === topic);
  const visibleFilms = films.filter(item => topic === "all" || item.topic === topic);
  return <main className={styles.gallery} aria-label="Campaign media library">
    <a className={styles.skip} href="#images">Skip to campaign images</a>
    <div className={styles.top}>
      <div><p className={styles.eyebrow}>C22 · CAMPAIGN REVIEW</p><h1>Money, shown plainly.</h1><p className={styles.intro}>Images and films use fictional examples and current production interface captures.</p></div>
      <div className={styles.controls}>
        <fieldset><legend>Theme</legend>{(["light", "dark"] as const).map(value => <button type="button" key={value} aria-pressed={theme === value} onClick={() => update("mode", value)}>{value === "light" ? "Light" : "Dark"}</button>)}</fieldset>
        <fieldset><legend>Format</legend>{(["feed", "story"] as const).map(value => <button type="button" key={value} aria-pressed={format === value} onClick={() => update("format", value)}>{value === "feed" ? "Feed" : "Story"}</button>)}</fieldset>
      </div>
    </div>
    <fieldset className={styles.topics}><legend>Explore a feature</legend>{[{ id: "all", title: "All" }, { id: "original", title: "First round" }, ...FEATURE_IDS.map(id => ({ id, title: FEATURES[id].title }))].map(item => <button type="button" key={item.id} aria-pressed={topic === item.id} onClick={() => update("topic", item.id)}>{item.title}</button>)}</fieldset>
    <nav className={styles.jump} aria-label="Media sections"><a href="#videos">Watch the videos</a><a href="#images">View the images</a></nav>
    <p className={styles.draft}>36 images · 16 MP4s · Draft review media with fictional data.</p>
    <section id="images" aria-labelledby="images-title">
      <div className={styles.sectionHead}><p>01</p><h2 id="images-title">Images</h2></div>
      <div className={styles.imageGrid}>{visibleImages.map((item, index) => {
        const source = `${item.base}/${item.id}-${theme}-${format}.png`;
        return <article key={item.id}>
          <a className={styles.fullImage} href={source}><img src={source} loading={index < 3 ? "eager" : "lazy"} width="1080" height={format === "story" ? 1920 : 1350} alt={`${item.title} campaign image. ${item.caption}`} /></a>
          <h3>{item.title}</h3><p><MoneyText text={item.caption} unmasked /></p>
          <a href={source} download>Download PNG</a> · <a href={source}>Full size</a>
        </article>;
      })}</div>
    </section>
    <section id="videos" aria-labelledby="videos-title">
      <div className={styles.sectionHead}><p>02</p><h2 id="videos-title">Videos</h2></div>
      <div className={styles.videoGrid}>{visibleFilms.map(film => <article key={`${film.id}-${theme}`}>
        <video aria-label={film.title} controls playsInline preload="metadata" poster={`${film.base}/${film.id}-${theme}-poster.jpg`}>
          <source src={`${film.base}/${film.id}-${theme}.mp4`} type="video/mp4" />
          <track kind="captions" srcLang="en-GB" label="English" default src={`${film.base}/${film.id}.vtt`} />
        </video>
        <h3>{film.title}</h3><p><MoneyText text={film.caption} unmasked /> 15 seconds, with sound.</p>
        <a href={`${film.base}/${film.id}-${theme}.mp4`} download>Download MP4</a>
      </article>)}</div>
    </section>
    <footer className={styles.archive}><a href="?topic=original">Approved first round</a><a href="?round=crafted">Earlier crafted round</a><a href="?round=worlds">Worlds round</a><a href="?library=1">Media library</a><a href="/design-media/c22/features/manifest.json">Feature manifest</a></footer>
  </main>;
}
