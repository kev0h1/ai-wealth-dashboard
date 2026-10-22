import { Audio, Composition, continueRender, delayRender, registerRoot, staticFile } from "remotion";
import type { CSSProperties } from "react";
import { BalanceStory } from "./BalanceStory";
import { AccountStory } from "./AccountStory";
import "../style.css";

if (typeof document !== "undefined") {
  const handle = delayRender("Load local campaign fonts");
  const fontPath = "design-media/c22/crafted/fonts";
  Promise.all([
    new FontFace("CampaignFigtree", `url(${staticFile(`${fontPath}/Figtree.ttf`)})`, { weight: "100 900" }).load(),
    new FontFace("CampaignMono", `url(${staticFile(`${fontPath}/JetBrainsMono.ttf`)})`, { weight: "100 900" }).load(),
  ]).then((fonts) => { fonts.forEach((font) => document.fonts.add(font)); continueRender(handle); }).catch((error) => { throw error; });
}

function Film({ story, theme }: { story: "balance" | "account"; theme: "light" | "dark" }) {
  return <div style={{ "--font-figtree": "CampaignFigtree", "--font-jbmono": "CampaignMono" } as CSSProperties}>
    {story === "balance" ? <BalanceStory theme={theme} /> : <AccountStory theme={theme} />}
    <Audio src={staticFile(`design-media/c22/next/${story}-sound.wav`)} />
  </div>;
}

function Root() {
  return <>{(["balance", "account"] as const).flatMap((story) => (["light", "dark"] as const).map((theme) =>
    <Composition key={`${story}-${theme}`} id={`Next-${story}-${theme}`} component={Film} defaultProps={{ story, theme }} width={1080} height={1920} fps={30} durationInFrames={450} />
  ))}</>;
}
registerRoot(Root);
