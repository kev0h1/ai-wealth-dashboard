/* eslint-disable @next/next/no-img-element -- This fixed export canvas preserves the exact production capture pixels. */
import styles from "./posters.module.css";

export type PosterVariant = "amount" | "account" | "working";
export type PosterTheme = "light" | "dark";
export type PosterFormat = "feed" | "story";
type Props = { variant?: PosterVariant; theme?: PosterTheme; format?: PosterFormat };

export default function PosterCanvas({ variant = "amount", theme = "light", format = "feed" }: Props) {
  const proof = variant === "amount" ? "safe" : variant === "account" ? "accounts" : "working";
  return <article className={`${styles.poster} ${styles[theme]} ${styles[format]} ${styles[variant]}`} data-next-artboard data-variant={variant} aria-label={`${variant} campaign image`}>
    <header><span>Sorted</span><small>{variant === "account" ? "By account" : "Safe to Spend"}</small></header>
    {variant === "amount" ? <>
      <h2>What is yours<br />to spend?</h2>
      <div className={styles.result}>£312</div>
      <p className={styles.resultLabel}>Estimated until 30 Oct 2026</p>
    </> : variant === "account" ? <>
      <h2>The total isn’t<br />the whole story.</h2>
      <div className={styles.accountAmounts}><div><span>Bills account</span><b>£68</b></div><div><span>Expected payment</span><b>£188</b></div></div>
      <p className={styles.shortfall}><i /> <span>£120</span> short for this payment.</p>
    </> : <>
      <h2>Show the<br />working.</h2>
      <p className={styles.workingLabel}>Your estimate. Every step in view.</p>
    </>}
    <figure><img src={`/design-media/c22/next/proof-${proof}-${theme}.png`} alt="Current production interface with fictional data" /></figure>
    <footer>{variant === "account" ? "Fictional example · Payment expected 18 October 2026" : "Fictional example · Estimated until 30 Oct 2026"}</footer>
  </article>;
}
