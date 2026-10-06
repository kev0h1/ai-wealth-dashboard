import { useCurrentFrame } from "remotion";
import { SAFE_BOX } from "./constants";
import { clamp, ease } from "./motion";
import { interpolate } from "remotion";

// Burned-in caption (most viewers watch muted). Sits in the lower part of the
// safe box, above the 420px platform UI band. Words fade up one after another.
export const CAPTION_TOP = 1290;

export const Caption = ({ text, from, to }: { text: string; from: number; to: number }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > to) return null;
  const words = text.split(" ");
  const out = interpolate(frame, [to - 8, to], [1, 0], clamp);
  return (
    <div
      style={{ left: SAFE_BOX.left, top: CAPTION_TOP, width: SAFE_BOX.width, height: 190, opacity: out }}
      className="absolute flex items-center justify-center text-center"
    >
      <p className="text-[56px] font-bold leading-[1.15] tracking-[-0.02em] text-slate-50" style={{ textWrap: "balance" }}>
        {words.map((w, i) => {
          const p = ease(frame, from + i * 3, from + i * 3 + 10);
          return (
            <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 22}px)`, marginRight: "0.28em" }}>
              {w}
            </span>
          );
        })}
      </p>
    </div>
  );
};
