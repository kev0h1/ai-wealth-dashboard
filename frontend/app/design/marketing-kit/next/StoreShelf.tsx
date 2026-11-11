"use client";
/* eslint-disable @next/next/no-img-element -- Show the exact downloadable store exports. */
import { useSearchParams } from "next/navigation";
import MoneyText from "@/components/MoneyText";
import { STORE_IDS, STORE_ART, STORE_SIZES, isStorePlatform, storeAssetName, type StoreTheme, type StorePlatform } from "../store/catalog";
import styles from "./gallery.module.css";

const platforms: { id: StorePlatform; label: string }[] = [
  { id: "apple-medium", label: "iPhone · Medium" },
  { id: "apple-large", label: "iPhone · Large" },
  { id: "apple-classic", label: "iPhone · Classic" },
  { id: "play", label: "Google Play" },
];
const base = "/design-media/c22/store";

export default function StoreShelf({ theme }: { theme: StoreTheme }) {
  const search = useSearchParams();
  const requested = search.get("store");
  const platform: StorePlatform = isStorePlatform(requested) && requested !== "feature" ? requested : "apple-medium";
  const size = STORE_SIZES[platform];
  function update(value: StorePlatform) {
    const next = new URLSearchParams(window.location.search);
    next.set("store", value);
    window.history.replaceState(null, "", `?${next.toString()}${window.location.hash}`);
  }
  return <section id="stores" aria-labelledby="stores-title" tabIndex={-1}>
    <div className={styles.sectionHead}><h2 id="stores-title">Store screenshots</h2></div>
    <div className={styles.storeHead}>
      <p>Eight screens, in order. Choose a size, then download the set or individual images.</p>
      <a href={`${base}/sorted-${platform}-${theme}-upload.zip`} download>Download this set · ZIP</a>
    </div>
    <fieldset className={styles.topics}><legend>Store format</legend>{platforms.map(item => <button key={item.id} type="button" aria-pressed={platform === item.id} onClick={() => update(item.id)}>{item.label}</button>)}</fieldset>
    <p className={styles.draft}>{size.width} × {size.height} PNG · {theme === "dark" ? "Dark" : "Light"} · Fictional examples</p>
    <div className={`${styles.imageGrid} ${styles.storeGrid}`}>{STORE_IDS.map((id, index) => {
      const item = STORE_ART[id];
      const src = `${base}/${storeAssetName(platform, id, theme)}`;
      return <article key={id}>
        <a className={styles.fullImage} href={src}><img src={src} alt={item.alt} width={size.width} height={size.height} loading={index < 3 ? "eager" : "lazy"} /></a>
        <h3>{index + 1}. {item.title}</h3><p><MoneyText text={item.caption} unmasked /></p>
        <a href={src} download>Download PNG</a> · <a href={src}>Full size</a>
      </article>;
    })}</div>
    <div className={styles.featureGraphic}>
      <div><h3>Google Play feature graphic</h3><p>1024 × 500 PNG, with the same product-led treatment.</p><a href={`${base}/${storeAssetName("feature", "amount", theme)}`} download>Download feature graphic</a></div>
      <a href={`${base}/${storeAssetName("feature", "amount", theme)}`}><img src={`${base}/${storeAssetName("feature", "amount", theme)}`} width={1024} height={500} alt="Sorted Google Play feature graphic, showing the left to spend estimate." loading="lazy" /></a>
    </div>
  </section>;
}
