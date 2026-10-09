"use client";

import { useLayoutEffect, useRef, useState } from "react";
import ProductionProof, { type FeatureId } from "./ProductionProof";
import content from "./content.json";
import styles from "./marketing.module.css";

export type Format = keyof typeof content.formats;
export type Theme = "light" | "dark";
export type Direction = "a" | "b";

export function ProofPlate({ feature, theme, expanded = false }: { feature: FeatureId; theme: Theme; expanded?: boolean }) {
  return <div className={`${theme === "dark" ? "dark" : ""} ${styles.plate}`} data-proof-plate style={{ width: 390 }}>
    <div inert><ProductionProof feature={feature} expanded={expanded} /></div>
  </div>;
}

export default function Artboard({ feature, format, theme, direction }: { feature: FeatureId; format: Format; theme: Theme; direction: Direction }) {
  const item = content.features.find((f) => f.id === feature)!;
  const size = content.formats[format];
  const box = useRef<HTMLDivElement>(null);
  const proof = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const measure = () => {
      if (!box.current || !proof.current) return;
      setScale(Math.min(box.current.clientWidth / 390, box.current.clientHeight / Math.max(1, proof.current.scrollHeight)));
    };
    const observer = new ResizeObserver(measure);
    if (box.current) observer.observe(box.current);
    if (proof.current) observer.observe(proof.current);
    void document.fonts.ready.then(measure);
    measure();
    return () => observer.disconnect();
  }, [feature, format]);
  const wide = format === "landing" || format === "feed";
  const story = format === "story";
  return <article aria-label={`${item.name}, direction ${direction.toUpperCase()}, ${theme}`} data-artboard className={`${styles.artboard} ${theme === "dark" ? "dark" : ""} ${wide ? styles.wide : ""} ${direction === "b" ? styles.question : ""} ${story ? styles.story : ""}`} style={{ width: size.width, height: size.height }}>
    <div className={styles.brand}><span>Sorted</span><span className={styles.brandDetail}>Your money, in view.</span></div>
    <div className={styles.composition}>
      <div className={styles.message}><h1>{item[direction]}</h1><p>{item.body}</p></div>
      <div className={styles.proofBox} ref={box}>
        <div ref={proof} className={styles.proof} style={{ width: 390, top: wide && direction === "a" ? "50%" : 0, transformOrigin: wide && direction === "a" ? "center" : "top center", transform: `${wide && direction === "a" ? "translateY(-50%) " : ""}scale(${scale})` }} inert><ProductionProof feature={feature} /></div>
      </div>
    </div>
    <footer className={styles.artFooter}><p>{item.legal}</p><span>Explore Sorted</span></footer>
  </article>;
}
