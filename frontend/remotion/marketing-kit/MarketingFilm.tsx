import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import content from "../../app/design/marketing-kit/content.json";
import { FONT_VARS } from "../fonts";
import { type FeatureId, type MarketingFilmId, type MarketingTheme, filmDefinitions, proofSrc } from "./constants";

export type MarketingFilmProps = { film: MarketingFilmId; theme: MarketingTheme };
type Beat = { feature: FeatureId; title: string; caption: string };
type Layout = { width: number; left: number; right: number; proofLeft: number; proofWidth: number; proofTop: number; proofHeight: number; captionWidth: number; titleSize: number };

const legalByFeature = new Map(content.features.map((feature) => [feature.id, feature.legal]));
const legal = (feature: FeatureId) => legalByFeature.get(feature) ?? "Fictional example.";

const featureBeats: Record<Exclude<MarketingFilmId, "overview" | "app-preview">, Beat> = {
  "safe-to-spend": { feature: "safe-to-spend", title: "What can I spend?", caption: "Estimated Safe to Spend, after bills, plans and your buffer." },
  upcoming: { feature: "upcoming", title: "What is coming up?", caption: "See an estimated forecast for upcoming payments." },
  penny: { feature: "penny", title: "Can I change my plan?", caption: "Review a proposed change before you choose." },
};
const overviewBeats: Beat[] = [
  { feature: "connect", title: "Connect your bank", caption: "Review the connection before continuing to Finexer." },
  featureBeats["safe-to-spend"], featureBeats.upcoming,
  { feature: "suggestions", title: "Suggestions", caption: "Review the accounts considered before your next step." },
  { feature: "payday", title: "Payday", caption: "Review the proposed split for this pay period." },
  { feature: "investments", title: "Investments", caption: "Keep recorded investment balances in view." },
  featureBeats.penny,
];
const appPreviewBeats: Beat[] = [
  { feature: "connect", title: "Choose your bank", caption: "Component-rendered editorial draft." },
  featureBeats["safe-to-spend"], featureBeats.upcoming, featureBeats.penny,
];
const reelLayout: Layout = { width: 1080, left: 72, right: 130, proofLeft: 150, proofWidth: 780, proofTop: 480, proofHeight: 800, captionWidth: 770, titleSize: 64 };
// A native 886px App Store composition, not a scaled 1080px reel.
const appLayout: Layout = { width: 886, left: 56, right: 106, proofLeft: 118, proofWidth: 650, proofTop: 470, proofHeight: 820, captionWidth: 640, titleSize: 56 };

function settleY(frame: number) {
  return interpolate(frame, [0, 8], [8, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
}
function ProofPlate({ feature, theme, layout, beatFrame }: { feature: FeatureId; theme: MarketingTheme; layout: Layout; beatFrame: number }) {
  // The complete opaque proof capture is shown, never reconstructed or cropped.
  return <div style={{ position: "absolute", left: layout.proofLeft, top: layout.proofTop, width: layout.proofWidth, height: layout.proofHeight, display: "flex", alignItems: "center", justifyContent: "center", transform: `translateY(${settleY(beatFrame)}px)` }}>
    <Img src={staticFile(proofSrc(feature, theme))} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
  </div>;
}
function Caption({ title, caption, layout, beatFrame, end = false }: { title: string; caption: string; layout: Layout; beatFrame: number; end?: boolean }) {
  return <div style={{ position: "absolute", top: end ? 280 : 178, left: layout.left, width: layout.captionWidth, transform: `translateY(${settleY(beatFrame)}px)` }}>
    <div style={{ fontSize: end ? layout.titleSize + 8 : layout.titleSize, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.04 }}>{title}</div>
    <div style={{ marginTop: 18, fontSize: 29, lineHeight: 1.28, maxWidth: layout.captionWidth - 56, color: "var(--mk-muted)" }}>{caption}</div>
  </div>;
}
function FilmEnd({ layout, beatFrame }: { layout: Layout; beatFrame: number }) {
  return <Caption layout={layout} beatFrame={beatFrame} end title="Sorted" caption="See your next step, calmly." />;
}
function SingleFeatureFilm({ beat, theme, layout }: { beat: Beat; theme: MarketingTheme; layout: Layout }) {
  const frame = useCurrentFrame();
  const closing = frame >= 350;
  return <><ProofPlate feature={beat.feature} theme={theme} layout={layout} beatFrame={closing ? frame - 350 : frame} />{!closing && <Caption title={beat.title} caption={frame < 90 ? "A calm answer starts with the right view." : beat.caption} layout={layout} beatFrame={frame} />}{closing && <FilmEnd layout={layout} beatFrame={frame - 350} />}</>;
}
function SequenceFilm({ beats, theme, appPreview, layout }: { beats: Beat[]; theme: MarketingTheme; appPreview?: boolean; layout: Layout }) {
  const frame = useCurrentFrame();
  const definition = filmDefinitions[appPreview ? "app-preview" : "overview"];
  const usable = definition.durationInFrames - 120;
  const beatFrames = usable / beats.length;
  const beatIndex = Math.min(beats.length - 1, Math.floor(frame / beatFrames));
  const beat = beats[beatIndex];
  const beatFrame = frame - beatIndex * beatFrames;
  return <><ProofPlate feature={beat.feature} theme={theme} layout={layout} beatFrame={frame < usable ? beatFrame : frame - usable} />{frame < usable && <Caption title={beat.title} caption={beat.caption} layout={layout} beatFrame={beatFrame} />}{frame >= usable && <FilmEnd layout={layout} beatFrame={frame - usable} />}</>;
}
export const MarketingFilm = ({ film, theme }: MarketingFilmProps) => {
  const frame = useCurrentFrame();
  const single = film === "safe-to-spend" || film === "upcoming" || film === "penny";
  const definition = filmDefinitions[film];
  const appPreview = film === "app-preview";
  const layout = appPreview ? appLayout : reelLayout;
  const sequence = film === "overview" ? overviewBeats : appPreviewBeats;
  const usable = definition.durationInFrames - 120;
  const activeFeature = single ? featureBeats[film].feature : sequence[Math.min(sequence.length - 1, Math.floor(Math.min(frame, usable - 1) / (usable / sequence.length)))].feature;
  const light = theme === "light";
  return <AbsoluteFill style={{ ...FONT_VARS, "--mk-muted": light ? "#475569" : "#cbd5e1", background: light ? "#f0f2f7" : "#0f172a", color: light ? "#0f172a" : "#f8fafc", fontFamily: "var(--font-figtree), Figtree, system-ui, sans-serif", overflow: "hidden", width: layout.width } as CSSProperties}>
    {single ? <SingleFeatureFilm beat={featureBeats[film]} theme={theme} layout={layout} /> : <SequenceFilm beats={sequence} theme={theme} appPreview={appPreview} layout={layout} />}
    <div style={{ position: "absolute", left: layout.left, bottom: 370, right: layout.right, color: light ? "#475569" : "#cbd5e1", fontSize: 24, lineHeight: 1.3 }}>{legal(activeFeature)}</div>
    {appPreview && <div style={{ position: "absolute", left: layout.left, top: 122, fontSize: 16, letterSpacing: "0.08em", fontWeight: 700, color: light ? "#64748b" : "#94a3b8" }}>EDITORIAL DRAFT</div>}
  </AbsoluteFill>;
};
