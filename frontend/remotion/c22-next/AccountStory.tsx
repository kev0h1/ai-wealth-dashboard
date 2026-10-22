import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { CSSProperties, ReactNode } from "react";

const bounds = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const move = (f: number, start: number, end: number, a: number, b: number) => interpolate(f, [start, end], [a, b], { ...bounds, easing: Easing.bezier(.22, 1, .36, 1) });
const mono: CSSProperties = { fontFamily: "var(--font-jbmono), monospace", fontVariantNumeric: "tabular-nums", letterSpacing: "-.07em" };

export function AccountStory({ theme }: { theme: "light" | "dark" }) {
  const f = useCurrentFrame();
  const dark = theme === "dark";
  const ink = dark ? "#f1f5f9" : "#0f172a";
  const muted = dark ? "#cbd5e1" : "#475569";
  const bg = dark ? "#0f172a" : "#f0f2f7";
  const rule = dark ? "#334155" : "#cbd5e1";
  const risk = dark ? "#fb7185" : "#be123c";
  const file = (s: string) => staticFile(`design-media/c22/next/proof-${s}-${theme}.png`);
  const label: CSSProperties = { color: muted, fontSize: 28, lineHeight: 1.25 };
  const image = (src: string, top: number, width: number, left = 72, style: CSSProperties = {}) => <Img src={file(src)} style={{ position: "absolute", left, top, width, borderRadius: 28, ...style }} />;
  const shot = (from: number, to: number, children: ReactNode) => f >= from && f < to ? <AbsoluteFill>{children}</AbsoluteFill> : null;

  return <AbsoluteFill style={{ background: bg, color: ink, fontFamily: "var(--font-figtree), sans-serif", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 148, left: 72, fontSize: 32, fontWeight: 750, letterSpacing: "-.05em" }}>Sorted<span style={{ marginLeft: 20, color: muted, fontSize: 20, fontWeight: 500, letterSpacing: 0 }}>By account</span></div>

    {shot(0, 65, <>
      <div style={{ position: "absolute", top: 338, left: 72, width: 820, fontSize: 80, lineHeight: .98, fontWeight: 650, letterSpacing: "-.055em" }}>Enough<br />overall.</div>
      <div style={{ position: "absolute", top: move(f, 0, 20, 750, 716), left: 64, ...mono, fontSize: 226, fontWeight: 700 }}>£610</div>
      <div style={{ position: "absolute", top: 1000, left: 72, ...label }}>Across two current accounts.</div>
      <div style={{ position: "absolute", left: 72, top: 1170, width: move(f, 10, 32, 0, 810), height: 8, background: ink }} />
      <div style={{ position: "absolute", top: 1230, left: 72, fontSize: 32, opacity: move(f, 25, 35, 0, 1) }}>But bills leave one account.</div>
    </>)}

    {shot(65, 140, <>
      <div style={{ position: "absolute", top: 320, left: 72, width: 820, fontSize: 80, lineHeight: 1.03, fontWeight: 650, letterSpacing: "-.055em" }}>Short in<br />one account.</div>
      <div style={{ position: "absolute", left: 72, top: 640, width: 810 }}>
        <div style={{ ...label, marginBottom: 16 }}>Everyday · Monzo</div>
        <div style={{ ...mono, fontSize: 92, fontWeight: 650 }}>£542</div>
        <div style={{ height: 8, marginTop: 26, background: ink, width: move(f, 65, 82, 0, 720) }} />
      </div>
      <div style={{ position: "absolute", left: 72, top: 970, width: 810, transform: `translateY(${move(f, 69, 83, 45, 0)}px)` }}>
        <div style={{ ...label, marginBottom: 16 }}>Bills account · Barclays</div>
        <div style={{ ...mono, fontSize: 148, fontWeight: 700 }}>£68</div>
        <div style={{ height: 8, marginTop: 26, background: ink, width: move(f, 69, 88, 0, 90) }} />
      </div>
      <div style={{ position: "absolute", top: 1330, left: 72, fontSize: 32, color: muted, opacity: move(f, 95, 104, 0, 1) }}>Energy payment expected: <span style={mono}>£188</span></div>
    </>)}

    {shot(140, 225, <>
      <div style={{ position: "absolute", top: 320, left: 72, width: 820, fontSize: 70, lineHeight: 1.05, fontWeight: 650, letterSpacing: "-.05em" }}>See the payment.<br />And the gap.</div>
      <div style={{ position: "absolute", top: 540, left: 72, ...label }}>Expected 18 October 2026</div>
      {image("payment", move(f, 140, 151, 690, 660), 810)}
      <div style={{ position: "absolute", left: 72, top: 1015, display: "flex", gap: 26, alignItems: "baseline" }}><span style={{ ...mono, fontSize: 150, fontWeight: 700 }}>£120</span><span style={{ fontSize: 38, color: muted }}>short</span></div>
      <div style={{ position: "absolute", top: 1260, left: 72, height: 4, width: move(f, 157, 176, 0, 810), background: risk }} />
      <div style={{ position: "absolute", left: 72, top: 1310, ...label }}><span style={mono}>£188 − £68 = £120</span> shortfall</div>
    </>)}

    {shot(225, 355, <>
      <div style={{ position: "absolute", top: 320, left: 72, width: 820, fontSize: 73, lineHeight: 1.02, fontWeight: 650, letterSpacing: "-.05em" }}>The account<br />gets the attention.</div>
      {image("accounts", move(f, 225, 238, 688, 650), 810)}
      <div style={{ position: "absolute", left: 72, top: 1175, width: 790, borderTop: `1px solid ${rule}`, paddingTop: 34, fontSize: 34, lineHeight: 1.25 }}>Sorted shows which account<br />needs attention before a bill.</div>
      <div style={{ position: "absolute", left: 72, top: 1380, fontSize: 27, color: muted }}>You stay in control. No money is moved.</div>
    </>)}

    {shot(355, 450, <>
      <div style={{ position: "absolute", left: 72, top: move(f, 355, 369, 450, 420), fontSize: 184, fontWeight: 750, letterSpacing: "-.075em" }}>Sorted</div>
      <div style={{ position: "absolute", left: 72, top: 700, width: 800, fontSize: 76, fontWeight: 600, lineHeight: 1.02, letterSpacing: "-.05em" }}>Before the<br />next bill.</div>
      <div style={{ position: "absolute", left: 72, top: 1080, width: 810, height: 4, background: ink }} />
      <div style={{ position: "absolute", left: 72, top: 1160, fontSize: 36, fontWeight: 600 }}>Explore Sorted <span style={{ marginLeft: 36 }}>↗</span></div>
    </>)}
    <div style={{ position: "absolute", top: 1500, left: 72, color: muted, fontSize: 22 }}>Fictional example · 8–30 October 2026</div>
  </AbsoluteFill>;
}
