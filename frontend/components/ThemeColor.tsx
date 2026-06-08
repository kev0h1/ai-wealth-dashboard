"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const ROUTE_COLORS: Record<string, string> = {
  "/":         "#4f46e5",
  "/spend":    "#4f46e5",
  "/budget":   "#059669",
  "/debt":     "#b91c1c",
  "/accounts": "#4f46e5",
  "/settings": "#4f46e5",
  "/insights": "#0f172a",
};

export default function ThemeColor() {
  const path = usePathname();

  useEffect(() => {
    const color = ROUTE_COLORS[path] ?? "#4f46e5";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [path]);

  return null;
}
