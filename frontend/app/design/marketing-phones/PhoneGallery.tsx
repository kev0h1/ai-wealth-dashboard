"use client";
/* eslint-disable @next/next/no-img-element -- this gallery deliberately presents the exact exported PNG files. */

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePreferences } from "@/components/PreferencesContext";
import { ASSET_BASE, EXTRA_STORY_IDS, FORMATS, FORMAT_IDS, imageName, isFormat, isStory, packName, PACK_STORY_IDS, STORIES, STORY_IDS, VARIANTS, type PhoneFormat, type PhoneTheme, type PhoneVariant, type StoryId } from "./catalog";
import styles from "./phones.module.css";

const PhoneArtboard = dynamic(() => import("./PhoneArtboard"), { ssr: false, loading: () => <div className={styles.artboardLoading} /> });
const formatValue = (value: string | null): PhoneFormat => isFormat(value) ? value : "iphone-63";
const storyValue = (value: string | null): StoryId => isStory(value) ? value : "amount";
const themeValue = (value: string | null): PhoneTheme => value === "dark" ? "dark" : "light";
const variantValue = (value: string | null): PhoneVariant => value === "b" ? "b" : "a";

export default function PhoneGallery() {
  const search = useSearchParams();
  const format = formatValue(search.get("format"));
  const story = storyValue(search.get("story") ?? search.get("state"));
  const theme = themeValue(search.get("mode"));
  const variant = variantValue(search.get("variant"));
  const exportOnly = search.get("export") === "1";
  const { darkMode: savedDarkMode } = usePreferences();
  const savedDarkRef = useRef(savedDarkMode);
  const originalSchemeRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  useLayoutEffect(() => { savedDarkRef.current = savedDarkMode; }, [savedDarkMode]);
  useEffect(() => {
    const root = document.documentElement;
    if (originalSchemeRef.current === null) originalSchemeRef.current = root.style.colorScheme;
    const apply = () => {
      root.classList.toggle("dark", theme === "dark");
      root.style.colorScheme = theme;
    };
    apply();
    // The app preference provider also applies its initial theme after mount.
    // Finish the isolated preview's choice after that pass, without saving it.
    const frame = requestAnimationFrame(apply);
    return () => {
      cancelAnimationFrame(frame);
      root.classList.toggle("dark", savedDarkRef.current);
      root.style.colorScheme = originalSchemeRef.current ?? "";
    };
  }, [theme, savedDarkMode]);
  useLayoutEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const measure = () => setPreviewWidth(element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const href = (updates: Record<string, string>) => {
    const query = new URLSearchParams({ variant, format, mode: theme, story, ...updates });
    return `/design/marketing-phones?${query.toString()}`;
  };
  const select = (key: "format" | "story", value: string) => { window.location.assign(href({ [key]: value })); };

  if (exportOnly) return <PhoneArtboard format={format} story={story} theme={theme} variant={variant} />;
  const model = FORMATS[format];
  const selectedPack = `${ASSET_BASE}/${packName(variant, format, theme)}`;
  const previewScale = Math.min(Math.max((previewWidth - 24) / model.cssWidth, 0), 400 / model.cssWidth, 1);

  return <main className={`${styles.gallery} ${styles[`gallery${theme[0].toUpperCase()}${theme.slice(1)}`]}`}>
    <a className={styles.skip} href="#downloads">Skip to downloads</a>
    <header className={styles.header}>
      <Link href="/design">Design previews</Link>
      <h1>Sorted on your phone.</h1>
      <p>Eight product stories and an additional 50/30/20 image, framed for iPhone and Android review.</p>
    </header>

    <section className={styles.controls} aria-label="Artwork controls">
      <fieldset><legend>Direction</legend>{(Object.keys(VARIANTS) as PhoneVariant[]).map(value => <Link key={value} href={href({ variant: value })} aria-current={variant === value ? "true" : undefined}>{VARIANTS[value].label}</Link>)}</fieldset>
      <label className={styles.selectControl}>Device export<select aria-label="Device export" value={format} onChange={event => select("format", event.target.value)}>{FORMAT_IDS.map(value => <option key={value} value={value}>{FORMATS[value].label}</option>)}</select></label>
      <fieldset><legend>Theme</legend>{(["light", "dark"] as PhoneTheme[]).map(value => <Link key={value} href={href({ mode: value })} aria-current={theme === value ? "true" : undefined}>{value === "light" ? "Light" : "Dark"}</Link>)}</fieldset>
    </section>

    <section className={styles.selected} aria-labelledby="preview-title">
      <div className={styles.previewShell} ref={previewRef} data-c22-preview-ready={previewWidth > 0 ? "true" : "false"}><div className={styles.previewScale} style={{ width: model.cssWidth * previewScale, height: model.cssHeight * previewScale }}><div style={{ width: model.cssWidth, height: model.cssHeight, transform: `scale(${previewScale})`, transformOrigin: "top left" }}><PhoneArtboard format={format} story={story} theme={theme} variant={variant} /></div></div></div>
      <div className={styles.selectedCopy}><label className={styles.selectControl}>Story<select aria-label="Story" value={story} onChange={event => select("story", event.target.value)}>{STORY_IDS.map(value => <option key={value} value={value}>{STORIES[value].title}</option>)}</select></label><h2 id="preview-title">{STORIES[story].title}</h2><p>{VARIANTS[variant].description} {model.modelLabel} proportions are illustrative.</p><p>{model.width} × {model.height} pixels</p><a href={href({ export: "1" })} target="_blank" rel="noreferrer">Preview exact artwork</a></div>
    </section>

    <section id="downloads" className={styles.downloads} aria-labelledby="downloads-title">
      <div><h2 id="downloads-title">Ready-to-review exports</h2><p>One ordered eight-image set for the selected format, direction and theme.</p></div>
      <a className={styles.packLink} href={selectedPack} download>Download eight PNGs · ZIP</a>
      <ol className={styles.thumbGrid}>{PACK_STORY_IDS.map((id, index) => {
        const image = `${ASSET_BASE}/${imageName(variant, format, theme, id)}`;
        return <li key={id}><a href={image}><img src={image} width={model.width} height={model.height} alt={`${STORIES[id].title} in an illustrative ${model.modelLabel} frame`} loading={index < 2 ? "eager" : "lazy"} /></a><div><strong>{index + 1}. {STORIES[id].title}</strong><a href={image} download>PNG</a><a href={image}>Full size</a></div></li>;
      })}</ol>
    </section>

    <section className={styles.downloads} aria-labelledby="additional-title" data-c22-extra-downloads>
      <div><h2 id="additional-title">Additional image</h2><p>A completed pay period compared with the 50/30/20 example. Download separately from the eight-image ZIP.</p></div>
      <ul className={styles.thumbGrid}>{EXTRA_STORY_IDS.map(id => {
        const image = `${ASSET_BASE}/${imageName(variant, format, theme, id)}`;
        return <li key={id}><a href={image}><img src={image} width={model.width} height={model.height} alt={`${STORIES[id].title} in an illustrative ${model.modelLabel} frame`} loading="lazy" /></a><div><strong>{STORIES[id].title}</strong><a href={image} download>PNG</a><a href={image}>Full size</a></div></li>;
      })}</ul>
    </section>

    <footer className={styles.footer}><p>Each handset is an illustrative frame around live coded product components. It is not a screenshot from an iOS or Android simulator.</p><Link href="/design/marketing-kit">Open the earlier social and video library</Link></footer>
  </main>;
}
