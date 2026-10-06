import { useLayoutEffect } from "react";
import { AbsoluteFill } from "remotion";
import { FONT_VARS } from "./fonts";
import { Hook } from "./Hook";
import { Mess } from "./Mess";
import { PhoneLayer } from "./PhoneLayer";
import { Caption } from "./Caption";
import { End } from "./End";
import { BEAT, COPY } from "./constants";

// Sorted reel, G223: 15s, 1080x1920, 30fps, no audio. Built from the G222
// Safe-to-Spend ad. Demo (fictional) data only. Colour is information: emerald
// figure, indigo CTA, no red, and never the indigo-to-violet gradient (Penny's).

export type SortedReelProps = { iconSrc: string };

// The app's Tailwind theme resolves --font-sans / --font-mono at :root from the
// --font-figtree / --font-jbmono variables next/font puts on <html>. Inside the
// Next app those already exist; in the Remotion renderer they do not, so set
// them on <html> there (and leave the app's own alone).
function useRootFontVars() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (getComputedStyle(root).getPropertyValue("--font-jbmono").trim()) return;
    const keys = Object.keys(FONT_VARS);
    keys.forEach((k) => root.style.setProperty(k, FONT_VARS[k]));
    return () => keys.forEach((k) => root.style.removeProperty(k));
  }, []);
}

export const SortedReel = ({ iconSrc }: SortedReelProps) => {
  useRootFontVars();
  return (
  <AbsoluteFill className="dark bg-slate-950 font-sans" style={{ ...FONT_VARS, colorScheme: "dark", overflow: "hidden" }}>
    <Hook />
    <Mess />
    <PhoneLayer />
    <Caption text={COPY.answerCaption} from={BEAT.answer.from + 40} to={BEAT.answer.to - 4} />
    <Caption text={COPY.proofCaption} from={BEAT.proof.from + 4} to={BEAT.proof.to - 4} />
    <End iconSrc={iconSrc} />
  </AbsoluteFill>
  );
};
