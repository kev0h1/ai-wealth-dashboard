import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

export type FeatureStory = "movement" | "month" | "spend" | "split" | "penny" | "aside";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easing = Easing.bezier(.22, 1, .36, 1);
const motion = (frame: number, from: number, to: number, start: number, end: number) =>
  interpolate(frame, [from, to], [start, end], { ...clamp, easing });

const mono: CSSProperties = {
  fontFamily: "var(--font-jbmono), monospace",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-.07em",
};


function Copy({ text }: { text: string }) {
  return <>{text.split(/([−+]?£[\d,.]+)/).map((part, i) => <span key={i} style={part.includes("£") ? mono : undefined}>{part}</span>)}</>;
}

type StoryContent = {
  eyebrow: string;
  hook: ReactNode;
  hookFigure?: string;
  hookSupport: string;
  analysisTitle: ReactNode;
  analysisRows: Array<{ label: string; value: string; tone?: "risk" | "penny" }>;
  proofShot3: string;
  proofShot4: string;
  proofTitle: ReactNode;
  proofSupport: string;
  close: ReactNode;
  caption: string;
};

/* Root owns the captured production UI; this file only frames those captures. */
const stories: Record<FeatureStory, StoryContent> = {
  movement: {
    eyebrow: "Money movement",
    hook: <>Right amount.<br />Right account.</>,
    hookFigure: "£120",
    hookSupport: "A suggested move for an upcoming payment.",
    analysisTitle: <>A bill of <span style={mono}>£188</span>.<br />Only <span style={mono}>£68</span> there.</>,
    analysisRows: [
      { label: "Energy expected", value: "£188" },
      { label: "Bills account", value: "−£68" },
      { label: "Gap to cover", value: "£120", tone: "risk" },
    ],
    proofShot3: "accounts",
    proofShot4: "movement",
    proofTitle: <>A suggested path.<br />You make the transfer.</>,
    proofSupport: "Sorted can show the account and amount to review. Your bank remains where you move money.",
    close: <>See what needs<br />moving.</>,
    caption: "Fictional example · Your bank handles any transfer",
  },
  month: {
    eyebrow: "Your month",
    hook: <>September.<br />In review.</>,
    hookFigure: "£200",
    hookSupport: "Left after spending and money moved to savings.",
    analysisTitle: <>What came in.<br />What went out.</>,
    analysisRows: [
      { label: "Income", value: "£2,400" },
      { label: "Spending", value: "−£1,800" },
      { label: "Moved to savings", value: "−£400" },
    ],
    proofShot3: "month-spending",
    proofShot4: "month-categories",
    proofTitle: <>A month of<br />real decisions.</>,
    proofSupport: "£1,600 shown + £200 other = £1,800 spent. £400 moved. £200 left.",
    close: <>Review the month.<br />Keep the context.</>,
    caption: "Fictional example · September 2026",
  },
  spend: {
    eyebrow: "Spending",
    hook: <>October.<br />So far.</>,
    hookFigure: "£860",
    hookSupport: "Out this pay period. Moved money is separate.",
    analysisTitle: <>A pace you can<br />actually see.</>,
    analysisRows: [
      { label: "Out", value: "£860" },
      { label: "Usual pace", value: "£850" },
      { label: "In", value: "£2,400" },
      { label: "Moved", value: "£400" },
    ],
    proofShot3: "spend",
    proofShot4: "spend-detail",
    proofTitle: <>The pace.<br />Then the shape.</>,
    proofSupport: "Spending and money moved are shown separately. See the pattern for this pay period.",
    close: <>See the spend.<br />Keep the pace.</>,
    caption: "Fictional example · 8–30 October 2026",
  },
  split: {
    eyebrow: "50 / 30 / 20",
    hook: <>A reference.<br />Not a verdict.</>,
    hookFigure: "£2,400",
    hookSupport: "Take-home pay. Compare the split with a reference.",
    analysisTitle: <>A 50 / 30 / 20<br />reference.</>,
    analysisRows: [
      { label: "Fixed", value: "£1,200" },
      { label: "Free", value: "£720" },
      { label: "Moved", value: "£480" },
    ],
    proofShot3: "split-card",
    proofShot4: "split-rows",
    proofTitle: <>The reference.<br />Beside your month.</>,
    proofSupport: "£1,200 fixed, £600 free and £400 moved, with £200 left. A comparison, not a score.",
    close: <>Compare your month.<br />Keep your context.</>,
    caption: "Fictional example · A reference, not financial advice",
  },
  penny: {
    eyebrow: "Penny",
    hook: <>Ask Penny.<br />Keep the final say.</>,
    hookFigure: "£200",
    hookSupport: "Create an envelope after you review and confirm.",
    analysisTitle: <>Ask. Review.<br />Then confirm.</>,
    analysisRows: [
      { label: "Annual costs envelope", value: "£200", tone: "penny" },
      { label: "Your review", value: "Required" },
      { label: "Bank transfer", value: "None" },
    ],
    proofShot3: "penny-request",
    proofShot4: "penny-done",
    proofTitle: <>Review the plan.<br />Confirm to create it.</>,
    proofSupport: "Your £200 annual costs envelope is set up after you confirm. You stay in control.",
    close: <>Let Penny bring<br />the task forward.</>,
    caption: "Fictional example · A plan, not a bank transfer",
  },
  aside: {
    eyebrow: "Set aside",
    hook: <>Give future costs<br />a place.</>,
    hookFigure: "£200",
    hookSupport: "An envelope for annual costs, each pay period.",
    analysisTitle: <>One cost.<br />Made more manageable.</>,
    analysisRows: [
      { label: "Name", value: "Annual costs" },
      { label: "Each pay period", value: "£200" },
      { label: "Source", value: "Everyday account" },
    ],
    proofShot3: "aside-form",
    proofShot4: "aside-saved",
    proofTitle: <>Set money aside.<br />Keep the context.</>,
    proofSupport: "Planning for a cost changes your estimate. It does not move money in your bank.",
    close: <>Make room for<br />what is ahead.</>,
    caption: "Fictional example · Setting aside does not move money",
  },
};

export function FeatureFilm({ story, theme }: { story: FeatureStory; theme: "light" | "dark" }) {
  const frame = useCurrentFrame();
  const content = stories[story];
  const dark = theme === "dark";
  const ink = dark ? "#f1f5f9" : "#0f172a";
  const mist = dark ? "#0f172a" : "#f0f2f7";
  const muted = dark ? "#cbd5e1" : "#475569";
  const line = dark ? "#334155" : "#cbd5e1";
  const risk = dark ? "#fb7185" : "#be123c";
  const penny = dark ? "#c4b5fd" : "#5b21b6";
  const pennyGradient = "linear-gradient(90deg, #4f46e5, #8b5cf6)";
  const proofFor = (name: string) => staticFile(`design-media/c22/${name === "accounts" ? "next" : "features"}/proof-${name}-${theme}.png`);
  const proofShot3 = proofFor(story === "penny" ? "penny-proposal" : content.proofShot3);
  const proofShot4 = proofFor(content.proofShot4);
  const proofTitle3 = story === "movement" ? <>The paying account.<br />The gap to cover.</> : story === "month" ? <>What went out.</> : story === "spend" ? <>The pace.<br />At a glance.</> : content.proofTitle;
  const proofTitle4 = story === "penny" ? <>Done.<br />Your plan is set up.</> : story === "month" ? <>Where it went.</> : story === "spend" ? <>The shape.<br />In detail.</> : content.proofTitle;
  const tone = (kind?: "risk" | "penny") => kind === "risk" ? risk : kind === "penny" ? penny : ink;
  const rowHeight = content.analysisRows.length > 3 ? 125 : 157;
  const shot = (start: number, end: number, child: ReactNode) => frame >= start && frame < end ? <AbsoluteFill>{child}</AbsoluteFill> : null;

  return <AbsoluteFill style={{ background: mist, color: ink, fontFamily: "var(--font-figtree), sans-serif", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 148, left: 72, fontSize: 32, fontWeight: 750, letterSpacing: "-.05em" }}>
      Sorted <span style={{ marginLeft: 20, color: muted, fontSize: 20, fontWeight: 500, letterSpacing: 0 }}>{content.eyebrow}</span>
    </div>

    {shot(0, 65, <>
      <div style={{ position: "absolute", top: 318, left: 72, width: 835, fontSize: 80, lineHeight: .99, fontWeight: 650, letterSpacing: "-.058em" }}>{content.hook}</div>
      {content.hookFigure && <div style={{ position: "absolute", top: motion(frame, 0, 18, 665, 625), left: 64, ...mono, fontSize: 212, fontWeight: 700 }}>{content.hookFigure}</div>}
      <div style={{ position: "absolute", left: 72, top: content.hookFigure ? 965 : 805, width: 755, fontSize: 35, lineHeight: 1.19, color: muted, opacity: motion(frame, 17, 30, 0, 1), transform: `translateY(${motion(frame, 17, 30, 30, 0)}px)` }}><Copy text={content.hookSupport} /></div>
      <div style={{ position: "absolute", left: 72, top: 1225, height: 8, width: motion(frame, 12, 35, 0, 810), background: ink }} />
    </>)}

    {shot(65, 140, story === "penny" ? <>
      <div style={{ position:"absolute", left:72, top:318, width:810, fontSize:76, lineHeight:1.02, fontWeight:650, letterSpacing:"-.05em" }}>Start with<br />what you want done.</div>
      <Img src={proofFor("penny-request")} style={{position:"absolute",left:72,top:690,width:810}} />
      <div style={{position:"absolute",left:72,top:1100,fontSize:34,color:muted}}>Create a plan for annual costs.</div>
    </> : <>
      <div style={{ position: "absolute", top: 300, left: 72, width: 835, fontSize: 70, lineHeight: 1.03, fontWeight: 650, letterSpacing: "-.052em" }}>{content.analysisTitle}</div>
      {story === "split" && <div style={{ position: "absolute", top: 535, left: 72, color: muted, fontSize: 22, fontWeight: 600 }}>REFERENCE AMOUNTS · NOT YOUR ACTUAL SPLIT</div>}
      <div style={{ position: "absolute", left: 72, top: 650, width: 810 }}>
        {content.analysisRows.map((row, index) => <div key={row.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", height: rowHeight, borderBottom: `1px solid ${line}`, opacity: motion(frame, 70 + index * 15, 78 + index * 15, 0, 1), transform: `translateX(${motion(frame, 70 + index * 15, 84 + index * 15, 58, 0)}px)` }}>
          <span style={{ width: 450, fontSize: 33, lineHeight: 1.08 }}>{row.label}</span>
          <span style={row.value.includes("£") ? { ...mono, color: ink, fontSize: row.value.length < 5 ? 82 : 42, fontWeight: 650, textAlign: "right" } : { color: tone(row.tone), fontSize: 35, fontWeight: 650, textAlign: "right", letterSpacing: "-.03em" }}>{row.value}</span>
        </div>)}
      </div>
      {story === "split" && <div style={{ position: "absolute", left: 72, top: 1190, display: "flex", width: 810, height: 36, gap: 5, opacity: motion(frame, 112, 125, 0, 1) }}>
        <div style={{ width: 400, background: ink, padding: "7px 13px", color: mist, fontSize: 18, fontWeight: 700 }}>50</div>
        <div style={{ width: 240, background: muted, padding: "7px 13px", color: mist, fontSize: 18, fontWeight: 700 }}>30</div>
        <div style={{ width: 160, background: line, padding: "7px 13px", color: ink, fontSize: 18, fontWeight: 700 }}>20</div>
      </div>}
      <div style={{ position: "absolute", left: 72, top: 1270, width: motion(frame, 116, 132, 0, 810), height: 4, background: ink }} />
    </>)}

    {shot(140, story === "penny" ? 260 : 225, <>
      <div style={{ position: "absolute", top: 300, left: 72, width: 820, fontSize: 70, lineHeight: 1.04, fontWeight: 650, letterSpacing: "-.052em" }}>{proofTitle3}</div>
      {story === "penny" && <div style={{ position: "absolute", top: 510, left: 72, color: muted, fontSize: 26, fontWeight: 600, letterSpacing: ".02em" }}>
        YOUR CONFIRMATION COMES FIRST
      </div>}
      <div style={{ position: "absolute", left: 72, top: motion(frame, 140, 152, 630, 590), width: 810, borderTop: `1px solid ${line}`, paddingTop: 28 }}>
        <Img src={proofShot3} style={{ display: "block", width: 810, maxHeight: 785, height: story === "aside" ? 785 : undefined, objectFit: story === "aside" ? "cover" : "contain", objectPosition: "top", borderRadius: story === "aside" ? 28 : undefined }} />
      </div>
    </>)}

    {shot(story === "penny" ? 260 : 225, 355, <>
      <div style={{ position: "absolute", top: 288, left: 72, width: 820, fontSize: 64, lineHeight: 1.03, fontWeight: 650, letterSpacing: "-.052em" }}>{proofTitle4}</div>
      <Img src={proofShot4} style={{ position: "absolute", left: 72, top: motion(frame, story === "penny" ? 260 : 225, story === "penny" ? 273 : 238, 540, 510), width: 810, maxHeight: 845, objectFit: "contain", objectPosition: "top", borderRadius: 28 }} />
      <div style={{ position: "absolute", left: 72, top: 1372, width: 805, borderTop: `1px solid ${line}`, paddingTop: 27, fontSize: 27, lineHeight: 1.22, color: muted }}><Copy text={content.proofSupport} /></div>
    </>)}

    {shot(355, 450, <>
      <div style={{ position: "absolute", left: 72, top: motion(frame, 355, 369, 450, 420), fontSize: 184, fontWeight: 750, letterSpacing: "-.075em" }}>Sorted</div>
      <div style={{ position: "absolute", left: 72, top: 700, width: 830, fontSize: 76, fontWeight: 600, lineHeight: 1.02, letterSpacing: "-.052em" }}>{content.close}</div>
      <div style={{ position: "absolute", left: 72, top: 1080, width: 810, height: 4, background: story === "penny" ? pennyGradient : ink }} />
      <div style={{ position: "absolute", left: 72, top: 1160, fontSize: 36, fontWeight: 600 }}>Explore Sorted <span style={{ marginLeft: 36 }}>↗</span></div>
    </>)}

    <div style={{ position: "absolute", top: 1500, left: 72, color: muted, fontSize: 22 }}>{content.caption}</div>
  </AbsoluteFill>;
}
