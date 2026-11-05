import type { PennyAppearance } from "@/lib/pennyAppearance";
import { PHOSPHOR_NAV_ICONS } from "@/lib/navigation/phosphorIcons";
import type { BottomNavTab } from "@/lib/navigation/bottomNav";

/** Original Phosphor geometry. MIT notice: PHOSPHOR-LICENSE.txt. */
export default function PhosphorNavIcon({ tab, selected, appearance }: {
  tab: BottomNavTab;
  selected: boolean;
  appearance: PennyAppearance | "pending";
}) {
  const weight = !selected || appearance === "outline" || appearance === "pending"
    ? "regular" : appearance === "ink" ? "fill" : "duotone";
  const icon = PHOSPHOR_NAV_ICONS[tab];
  return <svg width="24" height="24" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" data-phosphor-icon={icon.name} data-phosphor-weight={weight}>
    {icon[weight].map((path, index) => <path key={index} d={path.d} opacity={path.opacity} />)}
  </svg>;
}
