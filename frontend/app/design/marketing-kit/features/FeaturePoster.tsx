/* eslint-disable @next/next/no-img-element -- Preserve the exact captured interface in exported artwork. */
import MoneyText from "@/components/MoneyText";
import { FEATURES, type FeatureId } from "./catalog";
import styles from "./feature-poster.module.css";

export default function FeaturePoster({ feature, theme, format }: { feature: FeatureId; theme: "light" | "dark"; format: "feed" | "story" }) {
  const item = FEATURES[feature];
  const proof = `/design-media/c22/features/proof-${item.proof}-${theme}.png`;
  return <article data-feature-artboard data-feature={feature} className={`${styles.poster} ${styles[theme]} ${styles[format]} ${styles[feature]}`}>
    <header><span>Sorted</span><small>{item.title}</small></header>
    <h2>{item.heading.split("\n").map((line, i) => <span key={line}>{i > 0 && <br />}{line}</span>)}</h2>
    {feature === "movement" && <div className={styles.flow}><div><span>Suggested move</span><b>£120</b></div><p>Everyday → Bills account</p></div>}
    {feature === "month" && <div className={styles.monthNumbers}><div><span>In</span><b>£2,400</b></div><div><span>Spent</span><b>£1,800</b></div><div><span>Moved</span><b>£400</b></div><div><span>Left</span><b>£200</b></div></div>}
    {feature === "spend" && <div className={styles.spendNumbers}><b>£860</b><span>Spending this pay period</span><p><MoneyText text="£400 moved is shown separately." unmasked /></p></div>}
    {feature === "split" && <div className={styles.splitGuide}><div><b>50%</b><span>Fixed</span></div><div><b>30%</b><span>Free</span></div><div><b>20%</b><span>Moved</span></div><p>Adapted reference · Your actual split is below</p></div>}
    {feature === "penny" && <p className={styles.request}><MoneyText text="“Create a £200 envelope for annual costs.”" unmasked /><span>Ask. Review. Confirm.</span></p>}
    {feature === "aside" && <div className={styles.asideNumbers}><b>£200</b><span>Annual costs · Every pay period</span><p>A plan for the money. You control the bank transfer.</p></div>}
    <figure><img src={proof} alt={`Current ${item.title} interface with fictional data`} /></figure>
    <footer>{item.legal}</footer>
  </article>;
}
