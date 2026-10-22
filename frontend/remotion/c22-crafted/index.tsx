import { Composition, continueRender, delayRender, registerRoot, staticFile, useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";
import CampaignCanvas, { type Direction } from "../../app/design/marketing-kit/crafted/CampaignCanvas";
import "../style.css";

const path = "design-media/c22/crafted";
// Font loading is explicit and entirely local, including in an offline render.
if (typeof document !== "undefined") {
  const handle = delayRender("Load local Sorted fonts");
  Promise.all([
    new FontFace("CraftedFigtree", `url(${staticFile(`${path}/fonts/Figtree.ttf`)})`, { weight: "100 900" }).load(),
    new FontFace("CraftedMono", `url(${staticFile(`${path}/fonts/JetBrainsMono.ttf`)})`, { weight: "100 900" }).load(),
  ]).then((faces) => { faces.forEach((face) => document.fonts.add(face)); continueRender(handle); }).catch((error) => { throw error; });
}

type Props = { direction: Direction; theme: "light" | "dark" };
function Film({ direction, theme }: Props) {
  const frame = useCurrentFrame();
  const feature = direction === "calendar" ? "upcoming" : "safe-to-spend";
  return <div style={{ "--font-figtree": "CraftedFigtree", "--font-jbmono": "CraftedMono" } as CSSProperties}>
    <CampaignCanvas direction={direction} theme={theme} format="story" frame={frame}
      proofSrc={staticFile(`${path}/proof-${feature}-${theme}.png`)} textureSrc={staticFile(`${path}/receipt-scene.png`)} />
  </div>;
}

function Root() {
  return <>{(["receipt", "friday", "calendar"] as const).flatMap((direction) => (["light", "dark"] as const).map((theme) =>
    <Composition key={`${direction}-${theme}`} id={`Craft-${direction}-${theme}`} component={Film} defaultProps={{ direction, theme }} width={1080} height={1920} fps={30} durationInFrames={360} />
  ))}</>;
}
registerRoot(Root);
