import { Img, interpolate, useCurrentFrame } from "remotion";
import { BEAT, COPY, SAFE_BOX } from "./constants";
import { clamp, ease, pop } from "./motion";

// 12.5 to 15s. Icon and wordmark, the line, the CTA, the fine print.
export const DISCLAIMER = "Example figures. Safe to Spend is an estimate.";

export const End = ({ iconSrc }: { iconSrc: string }) => {
  const frame = useCurrentFrame();
  const s = BEAT.end.from + 14;
  if (frame < s - 4) return null;
  const brand = pop(frame, s, { damping: 16, stiffness: 150 });
  const words = COPY.tagline.split(" ");
  const cta = pop(frame, s + 34, { damping: 12, stiffness: 170, mass: 0.7 });
  const pulse = frame > s + 50 ? 1 + 0.025 * Math.sin((frame - s - 50) / 5) * Math.max(0, 1 - (frame - s - 50) / 40) : 1;
  return (
    <div className="absolute flex flex-col items-start justify-center" style={{ left: SAFE_BOX.left, top: SAFE_BOX.top, width: SAFE_BOX.width, height: SAFE_BOX.height, gap: 56 }}>
      <div className="flex items-center" style={{ gap: 36, opacity: interpolate(frame, [s, s + 6], [0, 1], clamp), transform: `translateY(${(1 - brand) * 70}px) scale(${0.9 + 0.1 * brand})`, transformOrigin: "0 50%" }}>
        <Img src={iconSrc} width={168} height={168} className="block rounded-[42px] ring-1 ring-white/20" style={{ width: 168, height: 168 }} />
        <span className="text-[148px] font-extrabold leading-none tracking-[-0.04em] text-slate-50">Sorted</span>
      </div>
      <h2 className="text-[96px] font-extrabold leading-[1.04] tracking-[-0.035em] text-slate-50" style={{ textWrap: "balance" }}>
        {words.map((w, i) => {
          const p = ease(frame, s + 10 + i * 4, s + 22 + i * 4);
          return (
            <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 40}px)`, marginRight: "0.24em" }}>
              {w}
            </span>
          );
        })}
      </h2>
      <div
        className="inline-flex items-center whitespace-nowrap rounded-[36px] bg-indigo-600 px-[72px] py-[38px] text-[68px] font-bold leading-none tracking-[-0.01em] text-white"
        style={{ opacity: interpolate(frame, [s + 34, s + 40], [0, 1], clamp), transform: `translateY(${(1 - cta) * 50}px) scale(${pulse})`, transformOrigin: "0 50%" }}
      >
        {COPY.cta}
      </div>
      <p className="text-[34px] leading-[1.3] text-slate-400" style={{ opacity: interpolate(frame, [s + 44, s + 54], [0, 1], clamp) }}>
        {DISCLAIMER}
      </p>
    </div>
  );
};
