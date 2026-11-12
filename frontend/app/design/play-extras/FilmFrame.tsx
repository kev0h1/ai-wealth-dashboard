/* eslint-disable @next/next/no-img-element -- Export artboard uses exact, freshly captured production pixels. */
import MoneyText from "@/components/MoneyText";
import { MEDIA_ROOT, SHOTS } from "./catalog";
import styles from "./play-extras.module.css";

export default function FilmFrame({ shot, theme }: { shot: number; theme: "light" | "dark" }) {
  const item = SHOTS[shot] ?? SHOTS[0];
  return <article data-film-artboard data-shot={shot} className={`${styles.frame} ${styles[theme]}`}>
    <header className={styles.filmBrand}>Sorted</header>
    <div className={styles.filmCopy}>
      <h1>{item.title}</h1>
      <p><MoneyText text={item.body} unmasked /></p>
    </div>
    <div className={styles.proofWell}>
      <img src={`${MEDIA_ROOT}/proof-${item.proof}-${theme}.png`} alt="" />
    </div>
    <footer className={styles.filmQualifier}><MoneyText text={item.qualifier} unmasked /></footer>
  </article>;
}
