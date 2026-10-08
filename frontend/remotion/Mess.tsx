import { interpolate, useCurrentFrame } from "remotion";
import { BEAT, COPY, SAFE_BOX } from "./constants";
import { clamp, easeIO, pop } from "./motion";
import { Caption } from "./Caption";

// 2 to 5s. The late-month maths from G222 variant C. Lines tumble in one by
// one and finish on a big "?". Signs are the real minus (U+2212).
const ROWS: { figure: string; label: string }[] = [
  { figure: "£640", label: "in the account" },
  { figure: "−£236", label: "bills" },
  { figure: "−£120", label: "plans" },
  { figure: "−£100", label: "buffer" },
];

const Row = ({ figure, label, at }: { figure: string; label: string; at: number }) => {
  const frame = useCurrentFrame();
  const p = pop(frame, at, { damping: 11, stiffness: 150, mass: 0.8 });
  const o = interpolate(frame, [at, at + 4], [0, 1], clamp);
  const rot = (1 - p) * -7;
  return (
    <div
      className="grid items-baseline text-[76px] font-semibold leading-[1.18] text-slate-300"
      style={{ gridTemplateColumns: "330px 1fr", columnGap: 28, opacity: o, transform: `translateY(${(1 - p) * -260}px) rotate(${rot}deg)`, transformOrigin: "0% 50%" }}
    >
      <span className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{figure}</span>
      <span>{label}</span>
    </div>
  );
};

export const Mess = () => {
  const frame = useCurrentFrame();
  if (frame < BEAT.mess.from || frame > BEAT.mess.to) return null;
  const exit = easeIO(frame, 140, 156);
  const q = pop(frame, 96, { damping: 9, stiffness: 140, mass: 0.9 });
  const wobble = Math.sin((frame - 96) / 3.2) * 5 * Math.max(0, 1 - (frame - 96) / 40);
  return (
    <>
      <div
        className="absolute flex flex-col justify-center"
        style={{ left: SAFE_BOX.left, top: SAFE_BOX.top, width: SAFE_BOX.width, height: 1100, opacity: 1 - exit, transform: `scale(${1 - exit * 0.06}) translateY(${-exit * 40}px)` }}
      >
        <p
          className="mb-6 text-[48px] font-semibold text-slate-400"
          style={{ opacity: interpolate(frame, [BEAT.mess.from + 2, BEAT.mess.from + 12], [0, 1], clamp) }}
        >
          {COPY.messTitle}
        </p>
        {ROWS.map((r, i) => (
          <Row key={r.label} figure={r.figure} label={r.label} at={BEAT.mess.from + 8 + i * 9} />
        ))}
        <div className="grid items-center" style={{ gridTemplateColumns: "330px 1fr", columnGap: 28, marginTop: 6 }}>
          <span
            className="text-right text-[300px] font-extrabold leading-[0.9] text-slate-50"
            style={{ opacity: interpolate(frame, [96, 100], [0, 1], clamp), transform: `scale(${0.3 + 0.7 * q}) rotate(${wobble}deg)`, transformOrigin: "60% 60%" }}
          >
            ?
          </span>
          <span
            className="text-[76px] font-bold leading-[1.1] text-slate-50"
            style={{ opacity: interpolate(frame, [104, 114], [0, 1], clamp) }}
          >
            left to spend
          </span>
        </div>
      </div>
      <Caption text={COPY.messCaption} from={BEAT.mess.from + 12} to={BEAT.mess.to - 4} />
    </>
  );
};
