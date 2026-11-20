import { PHOSPHOR_NAV_ICONS } from "@/lib/navigation/phosphorIcons";
import { PHOSPHOR_WELCOME_ICONS } from "@/lib/navigation/phosphorWelcomeIcons";

const GLYPHS = {
  wallet: PHOSPHOR_NAV_ICONS.spend,
  calendar: PHOSPHOR_NAV_ICONS.upcoming,
  flag: PHOSPHOR_NAV_ICONS.planning,
  bank: PHOSPHOR_WELCOME_ICONS.bank,
  upload: PHOSPHOR_WELCOME_ICONS.upload,
} as const;

export type PhosphorGlyphName = keyof typeof GLYPHS;

/** Original Phosphor geometry at the nav's idle (regular) weight. MIT notice: PHOSPHOR-LICENSE.txt. */
export default function PhosphorGlyph({ glyph, size = 18, className }: { glyph: PhosphorGlyphName; size?: number; className?: string }) {
  const icon = GLYPHS[glyph];
  return <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" className={className} data-phosphor-icon={icon.name} data-phosphor-weight="regular">
    {icon.regular.map((path, index) => <path key={index} d={path.d} opacity={path.opacity} />)}
  </svg>;
}
