/* eslint-disable @next/next/no-img-element -- Exact exported production pixels are the artwork. */
import type { CSSProperties } from "react";
import { FORMATS, MEDIA, OPTIONS, type Slot, type Theme, type Variant } from "./catalog";
import styles from "./creative.module.css";

export default function CreativeCanvas({ slot, variant, theme }: { slot: Slot; variant: Variant; theme: Theme }) {
  const format = FORMATS[slot];
  const proof = `${MEDIA}/proof-${OPTIONS[variant].proof}-${theme}.png`;
  const showProof = slot === "search" || variant === "a";
  const vars = {
    "--canvas-width": `${format.width}px`, "--canvas-height": `${format.height}px`,
    "--safe-x": `${format.safe.x}px`, "--safe-y": `${format.safe.y}px`,
    "--safe-width": `${format.safe.width}px`, "--safe-height": `${format.safe.height}px`,
  } as CSSProperties;
  return <article data-c41-artboard data-slot={slot} data-variant={variant} data-theme={theme}
    data-c41-alt={slot === "header" && variant === "b" ? "Sorted. Your money. A clearer picture. A conversation with your money adviser." : OPTIONS[variant].alt}
    aria-label={`${format.label}, option ${variant.toUpperCase()}, ${theme}`}
    className={`${styles.canvas} ${styles[slot]} ${styles[theme]} ${styles[`option${variant.toUpperCase()}`]}`} style={vars}>
    <div className={styles.safeContent}>
      <div className={styles.artCopy}>
        <h1 data-c41-key="headline">
          {variant === "a" ? <>Money,<br />shown plainly.</> : slot === "header" ? <>Your money.<br />A clearer picture.</> : <>Ask Penny.<br />See the<br />comparison.</>}
        </h1>
        <p data-c41-key="supporting" className={styles.artSupporting}>
          {variant === "a" ? "One estimate until payday." : slot === "header" ? "A conversation with your money adviser." : "Your spending, alongside usual."}
        </p>
        <p data-c41-key="wordmark" className={styles.wordmark}>Sorted</p>
        {showProof && <p data-c41-key="qualification" className={styles.artQualification}>
          {variant === "a" ? <>Fictional example · October 2026<br />An estimate, not financial advice.</> : <>Fictional example · November 2026<br />Same period, through day 10.</>}
        </p>}
      </div>
      {showProof && <img data-c41-key="production-proof" data-c41-proof-image className={styles.artProof} src={proof} width={variant === "a" ? 1170 : 1440} height={variant === "a" ? 1275 : 1191} alt={OPTIONS[variant].alt} />}
    </div>
  </article>;
}
