/* eslint-disable @next/next/no-img-element -- captured interface artwork */
import MoneyText from "@/components/MoneyText";
import { FEATURES, type FeatureId } from "./catalog";
import styles from "./feature-poster.module.css";

function StoryFact({ feature }: { feature: FeatureId }) {
  switch (feature) {
    case "movement": return <div className={styles.flow}><div><span>Suggested cover</span><b>£120</b></div><p><MoneyText text="£80 Everyday + £40 Joint · Bills has £68 for £188 due" unmasked /></p></div>;
    case "month": return <div className={styles.monthNumbers}><div><span>In</span><b>£2,400</b></div><div><span>Spent</span><b>£1,800</b></div><div><span>Moved</span><b>£400</b></div><div><span>Left</span><b>£200</b></div></div>;
    case "spend": return <div className={styles.spendNumbers}><b>£860</b><span><MoneyText text="Out by day 10 · usual £740" unmasked /></span><p><MoneyText text="Eating Out £240 · £120 above usual by day 10." unmasked /></p></div>;
    case "split": return <div className={styles.splitGuide}><div><b>50%</b><span>Fixed</span></div><div><b>30%</b><span>Free</span></div><div><b>20%</b><span>Moved</span></div><p>Adapted reference · Your actual split is below</p></div>;
    case "penny": return <p className={styles.request}>“Show me my spending by category.”<span>Ask a question. See the chart.</span></p>;
    case "aside": return <div className={styles.asideNumbers}><b>£250</b><span>Groceries · Every pay period</span><p>A plan for the money. You control the bank transfer.</p></div>;
    case "upcoming": return <div className={styles.asideNumbers}><b>£95</b><span>Boiler service · Due 26 November</span><p><MoneyText text="Updated from £90 due 24 November." unmasked /></p></div>;
    case "plans": return <div className={styles.asideNumbers}><b>£200</b><span>Car insurance · Three paydays</span><p>30 Nov · 30 Dec · 30 Jan</p></div>;
    case "schedule": return <div className={styles.asideNumbers}><b>£95</b><span>Boiler payment · 26 November</span><p><MoneyText text="Updated from £90 due 24 November." unmasked /></p></div>;
  }
}

export default function FeaturePoster({ feature, theme, format }: { feature: FeatureId; theme: "light" | "dark"; format: "feed" | "story" }) {
  const item = FEATURES[feature];
  const proof = `/design-media/c22/features/proof-${item.proof}-${theme}.png`;
  return <article data-feature-artboard data-feature={feature} className={`${styles.poster} ${styles[theme]} ${styles[format]} ${styles[feature]}`}>
    <header><span>Sorted</span><small>{item.title}</small></header>
    <h2>{item.heading.split("\n").map((line, i) => <span key={line}>{i > 0 && <br />}{line}</span>)}</h2>
    <StoryFact feature={feature} />
    <figure><img src={proof} alt={`Current ${item.title} interface with fictional data`} /></figure>
    <footer>{item.legal}</footer>
  </article>;
}
