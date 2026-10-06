import { interpolate, useCurrentFrame } from "remotion";
import { BEAT, COPY, SAFE_BOX } from "./constants";
import { clamp, easeIO, pop } from "./motion";

// 0 to 2s. Kinetic type. Words spring in from frame 0 (movement inside the
// first 0.5s), the question follows, then the whole block lifts away.
const Word = ({ children, at, size, className }: { children: string; at: number; size: number; className: string }) => {
  const frame = useCurrentFrame();
  const p = pop(frame, at, { damping: 14, stiffness: 190, mass: 0.6 });
  const o = interpolate(frame, [at, at + 5], [0, 1], clamp);
  return (
    <span
      className={`inline-block font-extrabold tracking-[-0.04em] ${className}`}
      style={{ fontSize: size, lineHeight: 1.02, opacity: o, transform: `translateY(${(1 - p) * 90}px) scale(${0.86 + 0.14 * p})`, marginRight: "0.22em" }}
    >
      {children}
    </span>
  );
};

export const Hook = () => {
  const frame = useCurrentFrame();
  if (frame > BEAT.hook.to) return null;
  const exit = easeIO(frame, 52, 66);
  const line1 = COPY.hook1.split(" ");
  const line2 = COPY.hook2.split(" ");
  return (
    <div
      className="absolute flex flex-col justify-center"
      style={{ left: SAFE_BOX.left, top: SAFE_BOX.top, width: SAFE_BOX.width, height: SAFE_BOX.height, opacity: 1 - exit, transform: `translateY(${-exit * 60}px)` }}
    >
      <div className="mb-10">
        {line1.map((w, i) => (
          <Word key={i} at={i * 3} size={150} className="text-slate-50">
            {w}
          </Word>
        ))}
      </div>
      <div>
        {line2.map((w, i) => (
          <Word key={i} at={20 + i * 4} size={104} className="text-slate-300">
            {w}
          </Word>
        ))}
      </div>
    </div>
  );
};
