import type { SVGProps } from "react";

/**
 * The settle mark — three stacked bars (two tilted in opposite directions,
 * one flat and widest at the bottom) settling into rest. This is the app
 * icon itself (`capacitor-spike/assets/icon.png`), pinned to Variant A
 * ("Settle mark") in app/design/penny-glyph/PennyGlyphClient.tsx.
 *
 * Semantic split from `PennyMark` (the coin-plus-bars glyph):
 * - `PennyMark` = "Penny, the AI adviser, is speaking here" — authored
 *   advice, insight, an AI-derived verdict. The glyph for authorship.
 * - `SettleMark` (this component) = "this is settled / sorted / covered" —
 *   a state of resolution, the product's own voice, not the adviser's.
 * Neither is a category icon and neither is decoration. Reach for
 * `SettleMark` when a UI moment is celebrating that something is now
 * resolved (a bill covered, a goal cleared); reach for `PennyMark` when
 * Penny herself is the one talking.
 *
 * Lucide-compatible API — drop-in replacement for `<Sparkles size={..} />`
 * or a literal "✦": accepts `size` (default 24) and `className`, spreads
 * any other SVG props. `strokeWidth` is accepted but ignored — this is a
 * filled mark, not a stroked one. Renders in `currentColor` so it inherits
 * text colour exactly like a lucide icon would.
 *
 * Auto-selects geometry by `size`: the FULL mark (3 bars) at >=16px, a
 * SIMPLIFIED mark (2 enlarged bars, the middle counter-tilted bar dropped)
 * below 16px — at small physical sizes the middle bar's thin, oppositely-
 * tilted shape disappears under anti-aliasing before it can ever register,
 * same failure mode `PennyMark` was built to avoid. The simplified bars
 * here are not new numbers: they are `PennyMark`'s own simplified top/
 * bottom bars (w=13.2/t=3.6/rotate=8 and w=15.2/t=3.8/rotate=0) reused
 * verbatim, since `PennyMark`'s simplified geometry already IS this mark's
 * two remaining bars, enlarged, with a coin added on top. Reusing them here
 * keeps the two marks reading as one family at every size, differing only
 * by the coin.
 *
 * Full-size geometry pinned to Variant A ("Settle mark") in
 * app/design/penny-glyph/PennyGlyphClient.tsx — see that file for the
 * pixel measurements taken off the 1024x1024 master PNG.
 */
interface SettleMarkProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
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
}: {
  cx: number;
  cy: number;
  w: number;
  t: number;
  r: number;
  rotate?: number;
}) {
  return (
    <rect
      x={cx - w / 2}
      y={cy - t / 2}
      width={w}
      height={t}
      rx={r}
      fill="currentColor"
      transform={rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined}
    />
  );
}

export default function SettleMark({ size = 24, className, strokeWidth: _strokeWidth, ...rest }: SettleMarkProps) {
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
          <Bar cx={12.6} cy={12.2} w={13.2} t={3.6} r={1.6} rotate={8} />
          <Bar cx={12.0} cy={18.4} w={15.2} t={3.8} r={1.7} rotate={0} />
        </>
      ) : (
        <>
          <Bar cx={12.4} cy={7.3} w={11.2} t={2.8} r={1.1} rotate={6} />
          <Bar cx={11.6} cy={12.0} w={12.0} t={2.8} r={1.1} rotate={-7} />
          <Bar cx={12.0} cy={16.8} w={13.1} t={3.0} r={1.2} rotate={0} />
        </>
      )}
    </svg>
  );
}
