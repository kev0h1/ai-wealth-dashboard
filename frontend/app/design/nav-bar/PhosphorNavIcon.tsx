import type { PennyAppearance } from "@/lib/pennyAppearance";
import icons from "./phosphor-icons.json";

export type NavTab = keyof typeof icons;

/** Original Phosphor geometry, retrieved through Better Icons. See SOURCES.md. */
export default function PhosphorNavIcon({ tab, selected, appearance }: {
  tab: NavTab;
  selected: boolean;
  appearance: PennyAppearance | "pending";
}) {
  const weight = !selected || appearance === "outline" || appearance === "pending"
    ? "regular" : appearance === "ink" ? "fill" : "duotone";
  const icon = icons[tab];
  return <svg
    width="24"
    height="24"
    viewBox="0 0 256 256"
    fill="currentColor"
    aria-hidden="true"
    data-phosphor-icon={icon.name}
    data-phosphor-weight={weight}
  >
    {icon[weight].map((path, index) => <path key={index} d={path.d} opacity={path.opacity} />)}
  </svg>;
}
