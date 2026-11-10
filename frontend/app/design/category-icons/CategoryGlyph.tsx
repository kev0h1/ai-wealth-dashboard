import type { CSSProperties } from "react";
import { getCategoryColour } from "@/lib/categories";
import { ICON_GEOMETRY } from "./iconGeometry";
import { CATEGORY_ICON_KEYS, suggestIcon } from "./icons";

/** Preview-only renderer for the original Phosphor regular vectors. */
export function CategoryGlyph({ iconKey = "tag", size = 16, className, style }: {
  iconKey?: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const safeKey = Object.hasOwn(ICON_GEOMETRY, iconKey) ? iconKey as keyof typeof ICON_GEOMETRY : "tag";
  const paths: readonly { d: string; opacity?: number }[] = ICON_GEOMETRY[safeKey];
  return <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor"
    aria-hidden="true" focusable="false" className={className} style={style}
    data-phosphor-icon={safeKey} data-phosphor-weight="regular">
    {paths.map((path, index) => <path key={index} d={path.d} opacity={path.opacity} />)}
  </svg>;
}

export function CategoryTile({ name, iconKey, tileSize = 32, iconSize = 15, colour }: {
  name: string;
  iconKey?: string;
  tileSize?: number;
  iconSize?: number;
  colour?: string;
}) {
  const resolvedColour = colour ?? getCategoryColour(name);
  return <span aria-hidden="true" data-category-tile={name} style={{
    width: tileSize, height: tileSize, flex: "0 0 auto", borderRadius: 8,
    backgroundColor: `${resolvedColour}26`, color: resolvedColour,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  }}>
    <CategoryGlyph iconKey={iconKey ?? CATEGORY_ICON_KEYS[name] ?? suggestIcon(name)} size={iconSize} />
  </span>;
}
