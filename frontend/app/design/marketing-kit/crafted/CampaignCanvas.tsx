"use client";
import CraftedProof from "./CraftedProof";
import { campaignDirection, type Direction } from "./data";
import styles from "./campaign.module.css";

export type { Direction } from "./data";
type Props = { direction: Direction; theme: "light" | "dark"; format: "feed" | "story"; frame?: number; proofSrc?: string; textureSrc?: string };
const progress = (frame: number, start: number, end: number) => Math.max(0, Math.min(1, (frame - start) / (end - start)));
const ease = (value: number) => 1 - (1 - value) ** 3;

function Proof({ feature, proofSrc }: { feature: "safe-to-spend" | "upcoming"; proofSrc?: string }) {
  return <div className={styles.proofInner}>{proofSrc ?
    // Exact production capture: image optimisation would change the export pixels.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.proofImage} src={proofSrc} width={390} height={feature === "upcoming" ? 150 : 374} alt="" /> : <CraftedProof feature={feature} />}</div>;
}

function Receipt({ frame, proofSrc, textureSrc }: { frame: number; proofSrc?: string; textureSrc?: string }) {
  const proofIn = ease(progress(frame, 232, 286));
  const receiptIn = ease(progress(frame, 45, 208));
  return <>
    <div className={styles.slate} aria-hidden="true" />
    {/* Original Blender scene, shared by the stills and film. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className={styles.receiptRender} src={textureSrc ?? "/design-media/c22/crafted/receipt-scene.png"} width={1080} height={1350} alt="" style={{ clipPath: `inset(0 0 ${100 - receiptIn * 100}% 0)` }} />
    <div className={styles.receiptHeading} style={{ transform: `translateY(${(1 - ease(progress(frame, 0, 42))) * 10}px)` }}><span className={styles.brand}>Sorted</span><h2>Know the number<br />before you leave.</h2></div>
    <div className={styles.receiptProof} style={{ opacity: proofIn, translate: `0 ${(1 - proofIn) * 24}px` }}><Proof feature="safe-to-spend" proofSrc={proofSrc} /></div>
    <p className={styles.footnote}>Fictional example. Estimated after expected bills and buffer.<br />Explore Sorted.</p>
  </>;
}

function Friday({ frame, proofSrc }: { frame: number; proofSrc?: string }) {
  const question = ease(progress(frame, 0, 50));
  const answer = ease(progress(frame, 68, 142));
  const proof = ease(progress(frame, 150, 240));
  return <>
    <div className={styles.fridayCopy}><span className={styles.brand}>Sorted</span>
      <h2 style={{ translate: `${(1 - question) * 22}px 0`, letterSpacing: `${-.02 - question * .02}em` }}>Friday?</h2>
      <p style={{ clipPath: `inset(0 ${100 - answer * 100}% 0 0)` }}>Check what is yours<br />to spend.</p>
      <div className={styles.fridayDecision} style={{ opacity: answer }}><span>Tonight’s plan</span><b>Drinks after work</b><i>Start with your number.</i></div>
    </div>
    <div className={styles.fridayProof} style={{ opacity: proof, translate: `0 ${(1 - proof) * 44}px` }}><Proof feature="safe-to-spend" proofSrc={proofSrc} /></div>
    <p className={styles.footnote}>Fictional example. Estimates can change.<br />Explore Sorted.</p>
  </>;
}

// October 2026 begins on Thursday in this Monday-first calendar.
const calendarDays = [...Array.from({ length: 3 }, () => null), ...Array.from({ length: 31 }, (_, i) => i + 1)];
function Calendar({ frame, proofSrc }: { frame: number; proofSrc?: string }) {
  const reveal = ease(progress(frame, 0, 65));
  const dates = ease(progress(frame, 88, 210));
  const proof = ease(progress(frame, 205, 275));
  return <>
    <div className={styles.calendarTitle}><span className={styles.brand}>Sorted</span><h2>October,<br />in view.</h2><p>Expected payments, placed in time.</p></div>
    <section className={styles.calendarPage} style={{ opacity: .3 + reveal * .7 }}>
      <div className={styles.calendarTop}><span>October 2026</span><b>Payday · Fri 30</b></div>
      <div className={styles.weekdays}>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className={styles.days}>{calendarDays.map((day, index) => {
        const payment = day === 18;
        const payday = day === 30;
        const dateIn = day === null ? 1 : ease(progress(frame, 72 + index * 3, 112 + index * 3));
        return <div className={`${styles.day} ${payment ? styles.payment : ""} ${payday ? styles.payday : ""}`} key={index} style={{ opacity: dateIn }}>{day !== null && <><span>{day}</span>{payment && <small><i aria-hidden="true" />Energy<br /><b className={styles.money}>£188</b></small>}{payday && <small>PAYDAY</small>}</>}</div>;
      })}</div>
      <p className={styles.calendarNote} style={{ opacity: dates }}><span className={styles.money}>£188</span> expected before payday</p>
    </section>
    <div className={styles.calendarProof} style={{ opacity: proof, translate: `0 ${(1 - proof) * 30}px` }}><Proof feature="upcoming" proofSrc={proofSrc} /></div>
    <p className={styles.footnote}>Fictional example. Expected payments can change.<br />Explore Sorted.</p>
  </>;
}

export default function CampaignCanvas({ direction, theme, format, frame = 330, proofSrc, textureSrc }: Props) {
  const safeFrame = Math.max(0, Math.min(359, frame));
  return <article className={`${styles.canvas} ${styles[theme]} ${theme === "dark" ? "dark" : ""} ${styles[format]} ${styles[direction]}`} data-crafted-artboard data-direction={direction} aria-label={`${campaignDirection(direction).title}, ${theme} ${format}`}>
    {direction === "receipt" ? <Receipt frame={safeFrame} proofSrc={proofSrc} textureSrc={textureSrc} /> : direction === "friday" ? <Friday frame={safeFrame} proofSrc={proofSrc} /> : <Calendar frame={safeFrame} proofSrc={proofSrc} />}
  </article>;
}
