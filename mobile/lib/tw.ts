// Tailwind → React Native parity map. Web (frontend/) is the source of truth.
// Every value here is a deterministic Tailwind default or a frontend customisation.
// Rule: screen code imports from here — no raw numeric type/spacing/radius/colour literals.

import { StyleSheet } from "react-native";

export const tw = {
  // ── Type: fontSize + lineHeight ALWAYS together (RN has no default line-height —
  //    omitting lineHeight is the #1 source of vertical drift vs web). ──
  text: {
    "10":  { fontSize: 10, lineHeight: 14 }, // text-[10px] (custom; RN needs an explicit LH — 14 ≈ Tailwind leading-none floor for 10px)
    "11":  { fontSize: 11, lineHeight: 16 }, // text-[11px] (custom)
    xs:    { fontSize: 12, lineHeight: 16 }, // text-xs
    sm:    { fontSize: 14, lineHeight: 20 }, // text-sm
    base:  { fontSize: 16, lineHeight: 24 }, // text-base
    lg:    { fontSize: 18, lineHeight: 28 }, // text-lg
    xl:    { fontSize: 20, lineHeight: 28 }, // text-xl
    "2xl": { fontSize: 24, lineHeight: 32 }, // text-2xl
    "3xl": { fontSize: 30, lineHeight: 36 }, // text-3xl
    "4xl": { fontSize: 36, lineHeight: 40 }, // text-4xl
  },
  // leading-none override for figures that use text-*/leading-none on web (e.g. balance).
  // lineHeight === fontSize.
  leadingNone: (fontSize: number): number => fontSize, // leading-none → lineHeight = fontSize
  weight: {
    medium:   "500" as const, // font-medium
    semibold: "600" as const, // font-semibold
    bold:     "700" as const, // font-bold
  },
  // ── Spacing scale (p / m / gap / space-y) → px. Tailwind unit × 4. ──
  space: {
    0.5: 2,  // 0.5
    1:   4,  // 1
    1.5: 6,  // 1.5
    2:   8,  // 2
    2.5: 10, // 2.5
    3:   12, // 3
    3.5: 14, // 3.5
    4:   16, // 4
    5:   20, // 5
    6:   24, // 6
    7:   28, // 7
    8:   32, // 8
    9:   36, // 9
    10:  40, // 10
    12:  48, // 12
  },
  radius: {
    lg:     8,    // rounded-lg
    xl:     12,   // rounded-xl
    "2xl":  16,   // rounded-2xl
    "3xl":  24,   // rounded-3xl
    full:   9999, // rounded-full
  },
  // letterSpacing: Tailwind tracking-* is in em; RN wants points.
  // FORMULA: points = emValue × fontSize. tracking-wide = 0.025em, tracking-widest = 0.1em,
  // tracking-tight = -0.025em. Compute per use with tracking(em, fontSize).
  tracking: (em: number, fontSize: number): number => em * fontSize,
  trackingEm: {
    tight:   -0.025, // tracking-tight
    wide:    0.025,  // tracking-wide
    widest:  0.1,    // tracking-widest
  },
  color: {
    // slate
    slate50:  "#f8fafc", slate100: "#f1f5f9", slate200: "#e2e8f0", slate300: "#cbd5e1",
    slate400: "#94a3b8", slate500: "#64748b", slate600: "#475569", slate700: "#334155",
    slate800: "#1e293b", slate900: "#0f172a",
    // indigo
    indigo50:  "#eef2ff", indigo200: "#c7d2fe", indigo300: "#a5b4fc",
    indigo400: "#818cf8", indigo500: "#6366f1", indigo600: "#4f46e5",
    indigo700: "#4338ca", indigo800: "#3730a3", indigo900: "#312e81",
    // violet (Penny gradient end + spotlight link)
    violet50:  "#f5f3ff", violet200: "#ddd6fe", violet500: "#8b5cf6",
    violet600: "#7c3aed", violet800: "#5b21b6",
    // emerald — FIX: emerald600 was wrong (#065f46 ≈ emerald-900); correct value is #059669
    emerald50:  "#ecfdf5", emerald100: "#d1fae5", emerald200: "#a7f3d0",
    emerald400: "#34d399", emerald500: "#10b981", emerald600: "#059669",
    emerald800: "#065f46",
    // amber
    amber50:  "#fffbeb", amber200: "#fde68a", amber300: "#fcd34d",
    amber400: "#fbbf24", amber500: "#f59e0b", amber600: "#d97706",
    amber700: "#b45309", amber800: "#92400e", amber900: "#78350f",
    // rose / red
    rose500: "#f43f5e", rose300: "#fca5a5", rose700: "#b91c1c",
    rose800: "#9f1239", red600: "#dc2626",
    white: "#ffffff",
    // app canvas + card tokens (globals.css :root / .dark)
    canvasLight: "#f0f2f7", canvasDark: "#0f172a",
    cardLight:   "#ffffff", cardDark:   "#1e293b",
    cardBorderLight: "#f1f5f9", cardBorderDark: "#334155",
  },
} as const;

export const HAIRLINE = StyleSheet.hairlineWidth; // 1px borders → hairlineWidth
