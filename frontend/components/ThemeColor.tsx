"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const ROUTE_COLORS: Record<string, string> = {
  "/":         "#4f46e5",
  "/spend":    "#0891b2",
  "/budget":   "#059669",
  "/debt":     "#b91c1c",
  "/accounts": "#2563eb",
  "/settings": "#475569",
  "/insights": "#d97706",
};

export default function ThemeColor({ color }: { color?: string } = {}) {
  const path = usePathname();

  useEffect(() => {
    const resolved = color ?? ROUTE_COLORS[path] ?? "#4f46e5";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = resolved;
  }, [color, path]);

  return null;
}
