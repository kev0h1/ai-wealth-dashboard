import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import type { PennyAppearance } from "@/lib/pennyAppearance";

/** The approved Penny choices share one glyph across settings and advice doors. */
export default function PennyAppearanceIcon({ appearance, size = 28, originalMarkSize = Math.round(size * 0.6), className = "" }: {
  appearance: PennyAppearance;
  size?: number;
  originalMarkSize?: number;
  className?: string;
}) {
  if (appearance === "original") {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center text-white ${className}`}
        style={{ width: size, height: size, borderRadius: size * 2 / 7, background: BRAND_GRADIENT }}
      >
        <PennyMark size={originalMarkSize} />
      </span>
    );
  }

  const ink = `shrink-0 text-[#4338ca] dark:text-[#c7d2fe] ${className}`;
  if (appearance === "ink") return <PennyMark size={size} className={ink} />;

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={ink}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={10.8} cy={3} r={1.4} />
      <rect x={6.8} y={5.9} width={11.2} height={2.8} rx={1.1} transform="rotate(6 12.4 7.3)" />
      <rect x={5.6} y={10.6} width={12} height={2.8} rx={1.1} transform="rotate(-7 11.6 12)" />
      <rect x={5.45} y={15.3} width={13.1} height={3} rx={1.2} />
    </svg>
  );
}
