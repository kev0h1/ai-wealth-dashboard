import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(.22, 1, .36, 1);
const move = (f: number, a: number, b: number, x: number, y: number) => interpolate(f, [a, b], [x, y], { ...clamp, easing: ease });
const mono: CSSProperties = { fontFamily: "var(--font-jbmono), monospace", fontVariantNumeric: "tabular-nums", letterSpacing: "-.07em" };

export function BalanceStory({ theme }: { theme: "light" | "dark" }) {
  const f = useCurrentFrame();
  const dark = theme === "dark";
  const ink = dark ? "#f1f5f9" : "#0f172a";
  const muted = dark ? "#cbd5e1" : "#475569";
  const bg = dark ? "#0f172a" : "#f0f2f7";
  const line = dark ? "#334155" : "#cbd5e1";
  const file = (name: string) => staticFile(`design-media/c22/next/proof-${name}-${theme}.png`);
  const shot = (from: number, to: number, children: ReactNode) => f >= from && f < to ? <AbsoluteFill>{children}</AbsoluteFill> : null;
  const title: CSSProperties = { position: "absolute", left: 72, top: 320, width: 810, fontSize: 80, fontWeight: 650, lineHeight: 1.02, letterSpacing: "-.055em" };

  return <AbsoluteFill style={{ background: bg, color: ink, fontFamily: "var(--font-figtree), sans-serif", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 148, left: 72, fontSize: 32, fontWeight: 750, letterSpacing: "-.05em" }}>Sorted<span style={{ marginLeft: 20, color: muted, fontSize: 20, fontWeight: 500, letterSpacing: 0 }}>Safe to Spend</span></div>
    {shot(0, 65, <>
      <div style={title}>In the bank.</div>
      <div style={{ position: "absolute", left: 64, top: move(f, 0, 18, 650, 610), ...mono, fontSize: 226, fontWeight: 700 }}>£610</div>
      <div style={{ position: "absolute", top: 970, left: 72, height: 8, width: move(f, 8, 26, 0, 810), background: ink }} />
      <div style={{ position: "absolute", top: 1070, left: 72, width: 780, fontSize: 47, lineHeight: 1.1, opacity: move(f, 24, 34, 0, 1), transform: `translateY(${move(f, 24, 34, 30, 0)}px)` }}>But what is yours<br />to spend?</div>
    </>)}
    {shot(65, 140, <>
      <div style={{ ...title, fontSize: 68 }}>Give the balance<br />some context.</div>
      <div style={{ position: "absolute", left: 72, top: 610, width: 810, display: "flex", alignItems: "baseline", justifyContent: "space-between", fontSize: 32 }}><span>Cash available</span><span style={{ ...mono, fontSize: 76, fontWeight: 650 }}>£610</span></div>
      <div style={{ position: "absolute", left: 72, top: 785, width: 810, display: "flex", alignItems: "baseline", justifyContent: "space-between", fontSize: 32, opacity: move(f, 76, 82, 0, 1), transform: `translateX(${move(f, 76, 86, 60, 0)}px)` }}><span>Expected bills</span><span style={{ ...mono, fontSize: 62 }}>−£188</span></div>
      <div style={{ position: "absolute", left: 72, top: 925, width: 810, display: "flex", alignItems: "baseline", justifyContent: "space-between", fontSize: 32, opacity: move(f, 93, 99, 0, 1), transform: `translateX(${move(f, 93, 103, 60, 0)}px)` }}><span>Your buffer</span><span style={{ ...mono, fontSize: 62 }}>−£110</span></div>
      <div style={{ position: "absolute", left: 72, top: 1080, width: 810, borderTop: `4px solid ${ink}`, paddingTop: 28, display: "flex", alignItems: "baseline", justifyContent: "space-between", opacity: move(f, 110, 116, 0, 1) }}><span style={{ fontSize: 32 }}>Estimated</span><span style={{ ...mono, fontSize: 124, fontWeight: 700 }}>£312</span></div>
    </>)}
    {shot(140, 225, <>
      <div style={{ ...title, fontSize: 72 }}>The working.<br />In plain view.</div>
      <div style={{ position: "absolute", left: 72, top: 625, width: 810, borderTop: `1px solid ${line}`, paddingTop: 35, transform: `translateY(${move(f, 140, 152, 35, 0)}px)` }}>
        {/* Match the frozen production capture matte so its edge disappears into the padding. */}
        <div style={{ padding: 36, borderRadius: 32, overflow: "hidden", background: dark ? "#1c2537" : "#ffffff", border: `1px solid ${line}` }}>
          <Img src={file("working")} style={{ width: "100%", display: "block" }} />
        </div>
      </div>
    </>)}
    {shot(225, 355, <>
      <div style={{ ...title, fontSize: 64, top: 290 }}>Your Safe to Spend.</div>
      <Img src={file("safe")} style={{ position: "absolute", left: 72, top: move(f, 225, 237, 515, 475), width: 810, borderRadius: 30 }} />
      <div style={{ position: "absolute", left: 72, top: 1360, color: muted, fontSize: 28 }}>An estimate from your bank data.</div>
    </>)}
    {shot(355, 450, <>
      <div style={{ position: "absolute", left: 72, top: move(f, 355, 369, 450, 420), fontSize: 184, fontWeight: 750, letterSpacing: "-.075em" }}>Sorted</div>
      <div style={{ position: "absolute", left: 72, top: 700, width: 800, fontSize: 76, fontWeight: 600, lineHeight: 1.02, letterSpacing: "-.05em" }}>See what is<br />yours to spend.</div>
      <div style={{ position: "absolute", left: 72, top: 1080, width: 810, height: 4, background: ink }} />
      <div style={{ position: "absolute", left: 72, top: 1160, fontSize: 36, fontWeight: 600 }}>Coming soon</div>
    </>)}
    <div style={{ position: "absolute", top: 1500, left: 72, color: muted, fontSize: 22 }}>Fictional example · Estimated until 30 Oct 2026</div>
  </AbsoluteFill>;
}
