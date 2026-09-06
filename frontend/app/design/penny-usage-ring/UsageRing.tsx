"use client";

// Thin, single-stroke SVG progress ring for the Penny message-allowance
// meter (design/penny-usage-ring, all three variants). Track is a low-alpha
// muted-slate hairline; progress reads in Penny's indigo->violet gradient
// (the one surface this preview claims the gradient for, per DESIGN.md's
// Penny Gradient Rule — this meter lives on Penny's own chrome) below the
// amber threshold, then crossfades to Watch Amber at 80% used and stays
// amber whether at 80% or fully capped at 100% — never red (DESIGN.md's Red
// Is Risk Rule: running low on chat messages isn't a genuine financial
// risk, so red is off the table at every fill level).
//
// Starts at 12 o'clock and fills clockwise: SVG's native start point for a
// circle's stroke-dasharray is 3 o'clock, so the progress circle carries
// `transform="rotate(-90 cx cy)"` to move that start point to 12, and an
// increasing dash length still reads clockwise from there.
//
// Returns null when `limit` is null (an uncapped tier) — each caller
// decides separately whether to say anything in that case (see the
// "unlimited" handling in MockSheetFrame.tsx and MockBottomNav.tsx).
export default function UsageRing({
  id,
  size,
  strokeWidth = 2.5,
  used,
  limit,
  className,
}: {
  /** Must be unique per rendered instance — this component defines its own
   * <linearGradient>, and two instances sharing one id on the same page
   * would silently make the second instance's gradient resolve to
   * whichever <defs> the browser happened to paint first. */
  id: string;
  size: number;
  strokeWidth?: number;
  used: number;
  limit: number | null;
  className?: string;
}) {
  if (limit == null) return null;

  const pct = Math.max(0, Math.min(1, limit > 0 ? used / limit : 0));
  const amber = pct >= 0.8;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,0.28)" strokeWidth={strokeWidth} />
      {/* Progress */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={amber ? "#f59e0b" : `url(#${id})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    </svg>
  );
}
