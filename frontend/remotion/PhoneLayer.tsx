import { useLayoutEffect, useRef, useState } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { AD_DATA, AD_SPEND_FROM, PERSONA } from "@/app/design/ad-safe-to-spend/fixtures";
import { BEAT, SAFE_BOX } from "./constants";
import { clamp, ease, easeIO, settle } from "./motion";

// Phone frame plus the PRODUCTION SafeToSpendCard (same fixtures and props as
// the G222 ad). The card markup is never forked: motion happens around it
// (frame slide, scale, glow, highlight overlays) and the figure is the card's
// own `safe_to_spend` prop counted up frame by frame.

const noop = () => {};

// The production card ships a 250ms CSS entrance (.hero-arrive) and colour
// transitions. Those run on the wall clock, which a frame-by-frame render must
// not depend on, so inside the reel they are switched off from the outside.
// The card's markup is untouched; motion is driven by the frame instead.
const FREEZE_CSS = `.reel-card, .reel-card *, .reel-card *::before, .reel-card *::after { animation: none !important; transition: none !important; }
.reel-card .hero-arrive { opacity: 1 !important; transform: none !important; }`;
const CARD_W = 360; // the card's natural phone-column width in CSS px
const SCALE = 2; // 360 -> 720
const BEZEL = 22;
const PHONE_W = CARD_W * SCALE + BEZEL * 2; // 764
const PHONE_H = 880;
const SCREEN_PAD_TOP = 96;

const COUNT_FROM = 178;
const COUNT_TO = 238;

type Box = { left: number; top: number; width: number; height: number };

// Locate text inside the rendered card (card-local, unscaled CSS px) so the
// highlights follow the real layout instead of hard-coded coordinates.
function useCardMarks(ref: React.RefObject<HTMLDivElement | null>) {
  const [marks, setMarks] = useState<{ estimated: Box[]; context: Box[]; figure: Box | null }>({ estimated: [], context: [], figure: null });
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const c = root.getBoundingClientRect();
    const k = c.width / CARD_W;
    if (!k) return;
    const local = (r: DOMRect): Box => ({ left: (r.left - c.left) / k, top: (r.top - c.top) / k, width: r.width / k, height: r.height / k });
    const rangesFor = (needle: RegExp, sub?: string) => {
      const out: Box[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent ?? "";
        if (!needle.test(t)) continue;
        const range = document.createRange();
        const i = sub ? t.indexOf(sub) : 0;
        range.setStart(n, i);
        range.setEnd(n, sub ? i + sub.length : t.length);
        for (const r of Array.from(range.getClientRects())) if (r.width > 1) out.push(local(r));
        break;
      }
      return out;
    };
    // The "After upcoming bills, plans and your £100 buffer." line is split
    // across several text nodes (MoneyText), so take its element's rects.
    const lineRects = (starts: string) => {
      const out: Box[] = [];
      let best: Element | null = null;
      for (const el of Array.from(root.querySelectorAll("p, span, div"))) {
        if ((el.textContent ?? "").startsWith(starts) && (!best || best.contains(el))) best = el;
      }
      if (best) {
        const range = document.createRange();
        range.selectNodeContents(best);
        for (const r of Array.from(range.getClientRects())) if (r.width > 1 && r.height > 1) out.push(local(r));
      }
      return out;
    };
    const estimated = rangesFor(/estimated/, "estimated");
    const context = lineRects("After ");
    const fig = root.querySelector("#safe-to-spend-heading .money");
    const figure = fig ? local(fig.getBoundingClientRect()) : null;
    const same = (a: Box[], b: Box[]) => a.length === b.length && a.every((x, i) => Math.abs(x.left - b[i].left) + Math.abs(x.top - b[i].top) + Math.abs(x.width - b[i].width) < 1);
    setMarks((m) => (same(m.estimated, estimated) && same(m.context, context) && (m.figure?.width ?? 0) === (figure?.width ?? 0) && (m.figure?.top ?? 0) === (figure?.top ?? 0) ? m : { estimated, context, figure }));
  });
  return marks;
}

const Sweep = ({ boxes, progress, pad = 8 }: { boxes: Box[]; progress: number; pad?: number }) => {
  // One soft marker bar per text line, wiping left to right in sequence.
  const n = boxes.length;
  return (
    <>
      {boxes.map((b, i) => {
        const p = interpolate(progress, [i / n, (i + 1) / n], [0, 1], clamp);
        if (p <= 0.001) return null;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: b.left - pad,
              top: b.top - 2,
              width: (b.width + pad * 2) * p,
              height: b.height + 4,
              borderRadius: 6,
              background: "rgba(129,140,248,0.34)",
              boxShadow: "0 0 0 1px rgba(129,140,248,0.55)",
              pointerEvents: "none",
            }}
          />
        );
      })}
    </>
  );
};

export const PhoneLayer = () => {
  const frame = useCurrentFrame();
  const cardRef = useRef<HTMLDivElement>(null);
  const marks = useCardMarks(cardRef);
  const a = BEAT.answer.from;
  if (frame < a || frame > 396) return null;

  // Slide up and settle (no overshoot), then a gentle zoom for the proof beat,
  // then out.
  const up = settle(frame, a);
  const finalTop = 250;
  const slideY = (1 - up) * 1400;
  const punch = frame >= COUNT_TO ? Math.sin(Math.min(1, (frame - COUNT_TO) / 12) * Math.PI) * 0.025 : 0;
  const zoom = easeIO(frame, BEAT.proof.from, BEAT.proof.from + 22);
  const exit = easeIO(frame, 372, 396);
  const scale = 1 + punch + zoom * 0.08;
  const focusY = zoom * -40;

  const figure = Math.round(interpolate(frame, [COUNT_FROM, COUNT_TO], [12, PERSONA.safe], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) }));
  const data = { ...AD_DATA, safe_to_spend: figure, safe_to_spend_cash: figure };

  // Emerald ring around the figure as the count lands.
  const ring = interpolate(frame, [COUNT_TO - 4, COUNT_TO + 22], [0, 1], clamp);
  const glow = ease(frame, COUNT_FROM - 8, COUNT_FROM + 14) * (1 - exit);

  const estP = easeIO(frame, 306, 328);
  const ctxP = easeIO(frame, 330, 366);
  const dim = zoom * (1 - exit);
  const left = SAFE_BOX.left + (SAFE_BOX.width - PHONE_W) / 2;

  return (
    <>
    <style>{FREEZE_CSS}</style>
    <div
      className="absolute"
      style={{ left, top: finalTop, width: PHONE_W, height: PHONE_H, transform: `translateY(${slideY + focusY + exit * 240}px) scale(${scale * (1 - exit * 0.08)})`, opacity: 1 - exit, transformOrigin: "50% 28%" }}
    >
      {/* soft emerald glow: colour is information, the figure is on track */}
      <div className="absolute" style={{ left: -60, top: SCREEN_PAD_TOP - 40, width: PHONE_W + 120, height: 300, borderRadius: 140, background: "radial-gradient(closest-side, rgba(16,185,129,0.30), rgba(16,185,129,0))", opacity: glow * 0.9 }} />
      <div className="absolute inset-0 rounded-[76px] bg-slate-800 ring-2 ring-slate-600" style={{ boxShadow: "0 40px 120px rgba(2,6,23,0.7)" }}>
        <div
          className="absolute overflow-hidden rounded-[56px] bg-slate-900"
          style={{ left: BEZEL, top: BEZEL, width: CARD_W * SCALE, height: PHONE_H - BEZEL * 2 }}
        >
          <div className="absolute left-1/2 top-[18px] h-[30px] w-[150px] -translate-x-1/2 rounded-full bg-slate-950" />
          <div className="dark" style={{ colorScheme: "dark" }}>
            <div ref={cardRef} className="reel-card absolute font-sans" style={{ width: CARD_W, left: 0, top: SCREEN_PAD_TOP, transform: `scale(${SCALE})`, transformOrigin: "0 0" }}>
              <SafeToSpendCard data={data} loading={false} onRetry={noop} spendFrom={AD_SPEND_FROM} previewBalancesVisible />
              {marks.figure && ring > 0 && ring < 1 && (
                <div
                  style={{
                    position: "absolute",
                    left: marks.figure.left - 10 - ring * 6,
                    top: marks.figure.top - 6 - ring * 6,
                    width: marks.figure.width + 20 + ring * 12,
                    height: marks.figure.height + 12 + ring * 12,
                    borderRadius: 12,
                    border: "1.5px solid rgba(52,211,153,0.9)",
                    opacity: 1 - ring,
                    pointerEvents: "none",
                  }}
                />
              )}
              <Sweep boxes={marks.estimated} progress={estP} pad={3} />
              <Sweep boxes={marks.context} progress={ctxP} pad={3} />
            </div>
          </div>
        </div>
      </div>
    </div>
  </>
  );
};
