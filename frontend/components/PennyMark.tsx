import type { SVGProps } from "react";

/**
 * Penny's mark — "the penny drops" (the moment of understanding). Chosen
 * 2026-08-18 as the canonical glyph for Penny/AI identity across the app;
 * the generic lucide `Sparkles` icon and the literal "✦" character are
 * retired from that role.
 *
 * A coin caught mid-fall above the settle-mark bar stack: the dot sits
 * left-of and above the top bar, following the top bar's own clockwise
 * lean (a falling object drifts with the tilt it's about to land on, it
 * doesn't arrive dead centre).
 *
 * Lucide-compatible API — drop-in replacement for `<Sparkles size={..} />`:
 * accepts `size` (default 24) and `className`, spreads any other SVG props.
 * `strokeWidth` is accepted but ignored — this is a filled mark, not a
 * stroked one. Renders in `currentColor` so it inherits text colour exactly
 * like a lucide icon would.
 *
 * Auto-selects geometry by `size`: the FULL mark (dot + 3 bars) at >=16px,
 * the SIMPLIFIED mark (dot + 2 enlarged bars, the middle counter-tilted bar
 * dropped) below 16px — at small physical sizes the middle bar's thin,
 * oppositely-tilted shape disappears under anti-aliasing before it can ever
 * register, so the simplified version drops it and enlarges what's left.
 *
 * Geometry pinned to Variant B ("The penny drops") in
 * app/design/penny-glyph/PennyGlyphClient.tsx — see that file for the full
 * design rationale and the candidates it was chosen over.
 */
interface PennyMarkProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
  /** Accepted for lucide-icon API parity, ignored — this mark is filled, not stroked. */
  strokeWidth?: number | string;
}

function Bar({
  cx,
  cy,
  w,
  t,
  r,
  rotate = 0,
  opacity = 1,
}: {
  cx: number;
  cy: number;
  w: number;
  t: number;
  r: number;
  rotate?: number;
  opacity?: number;
}) {
  return (
    <rect
      x={cx - w / 2}
      y={cy - t / 2}
      width={w}
      height={t}
      rx={r}
      fill="currentColor"
      opacity={opacity}
      transform={rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined}
    />
  );
}

export default function PennyMark({ size = 24, className, strokeWidth: _strokeWidth, ...rest }: PennyMarkProps) {
  const simplified = size < 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {simplified ? (
        <>
          <circle cx={10.6} cy={5.4} r={2.3} fill="currentColor" />
          <Bar cx={12.6} cy={12.2} w={13.2} t={3.6} r={1.6} rotate={8} />
          <Bar cx={12.0} cy={18.4} w={15.2} t={3.8} r={1.7} rotate={0} />
        </>
      ) : (
        <>
          <circle cx={10.8} cy={3.0} r={1.4} fill="currentColor" />
          <Bar cx={12.4} cy={7.3} w={11.2} t={2.8} r={1.1} rotate={6} />
          <Bar cx={11.6} cy={12.0} w={12.0} t={2.8} r={1.1} rotate={-7} opacity={0.55} />
          <Bar cx={12.0} cy={16.8} w={13.1} t={3.0} r={1.2} rotate={0} />
        </>
      )}
    </svg>
  );
}
