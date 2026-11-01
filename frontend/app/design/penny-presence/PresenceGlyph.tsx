import { MessageCircleMore } from "lucide-react";

import PennyMark from "../../../components/PennyMark";

export type RefinementVariant = "d" | "e" | "f";

interface PresenceGlyphProps {
  variant: RefinementVariant;
  size?: number;
}

/**
 * Monochrome glyph alternatives for the Penny presence refinement preview.
 * These deliberately inherit currentColor so the surrounding door owns tone.
 */
export default function PresenceGlyph({ variant, size = 26 }: PresenceGlyphProps) {
  if (variant === "e") {
    return <MessageCircleMore aria-hidden="true" size={size} strokeWidth={1.8} />;
  }

  if (variant === "f") {
    return <PennyMark size={size} />;
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
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
