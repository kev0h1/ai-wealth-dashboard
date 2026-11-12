/* eslint-disable @next/next/no-img-element -- Store artboards preserve the exact frozen production proof pixels. */
import { STORE_ART, STORE_SIZES, type StoreId, type StorePlatform, type StoreTheme } from "./catalog";
import type { CSSProperties } from "react";
import MoneyText from "@/components/MoneyText";
import styles from "./store.module.css";

type Props = { id: StoreId; platform: StorePlatform; theme: StoreTheme };

export default function StoreCanvas({ id, platform, theme }: Props) {
  const art = STORE_ART[id];
  const size = STORE_SIZES[platform];
  const isFeature = platform === "feature";
  const proof = `/design-media/c22/${art.proof}-${theme}.png`;
  const vars = { "--art-w": `${size.width}px`, "--art-h": `${size.height}px` } as CSSProperties;
  if (isFeature) return <article data-store-artboard data-store-id={id} style={vars} className={`${styles.canvas} ${styles.feature} ${styles[theme]}`} aria-label={`${id} Google Play feature graphic`}>
    <div className={styles.featureCopy}><span>Sorted</span><h1>{id === "amount" ? "Money, shown plainly." : art.headline}</h1><p>{id === "amount" ? "See what is yours to spend." : art.supporting}</p></div>
    <img className={styles.featureProof} src={proof} alt="" />
  </article>;
  return <article data-store-artboard data-store-id={id} style={vars} className={`${styles.canvas} ${styles.store} ${styles[platform]} ${styles[theme]} ${styles[id]}`} aria-label={`${id} store screenshot`}>
    <header><span>Sorted</span><small>{art.kicker}</small></header>
    <div className={styles.copy}><h1>{art.headline}</h1><p><MoneyText text={art.supporting} unmasked /></p></div>
    <figure><img src={proof} alt="" /></figure>
    <footer>{art.qualifier}</footer>
  </article>;
}
