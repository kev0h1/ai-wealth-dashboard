"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Three candidate glyphs to replace the generic lucide `Sparkles` icon used
// across Penny's surfaces. The brand's canonical mark is the "settle" icon
// (capacitor-spike/assets/icon.png / public/icons/icon-192.png): three
// stacked, tilted slate bars settling into one flat, full-width bar rendered
// in the indigo->violet brand gradient. The gradient itself (the "Penny
// Gradient Rule") is NOT changing — only the glyph riding on top of it.
//
// Bar geometry below was measured pixel-for-pixel off the 1024x1024 master
// PNG (three horizontal-bar colour bands sampled by column/row), then scaled
// into a 24x24 viewBox (lucide's own convention, so these are drop-in
// replacements for <Sparkles size={..} />):
//   top bar    — width ~46.8% of canvas, thickness ~11.6%, rotated +6.1°
//                (right edge dips — clockwise)
//   middle bar — width ~50.0% of canvas, thickness ~11.6%, rotated -7.1°
//                (right edge lifts — counter-clockwise; the two grey bars
//                tilt in OPPOSITE directions, a little unsettled shuffle)
//   bottom bar — width ~54.6% of canvas, thickness ~12.6%, flat (0°),
//                centred — the "settled" bar, widest and flattest of the three
// Corner radius ~40% of each bar's own thickness (generously rounded, not a
// full stadium cap). Deep-linkable: /design/penny-glyph?mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";

type Mode = "light" | "dark";

const BRAND_GRADIENT = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)";

// ── Bar primitive ────────────────────────────────────────────────────────

function Bar({
  cx,
  cy,
  w,
  t,
  r,
  rotate = 0,
  opacity = 1,
}: {
  cx: number;
  cy: number;
  w: number;
  t: number;
  r: number;
  rotate?: number;
  opacity?: number;
}) {
  return (
    <rect
      x={cx - w / 2}
      y={cy - t / 2}
      width={w}
      height={t}
      rx={r}
      fill="currentColor"
      opacity={opacity}
      transform={rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined}
    />
  );
}

// ── Variant A — Settle mark ──────────────────────────────────────────────
// The three master bars, faithfully proportioned, rendered flat white (or
// currentColor) so they read on any surface — gradient tile, tinted chip,
// or plain canvas.

function SettleGlyph({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <Bar cx={12.4} cy={7.3} w={11.2} t={2.8} r={1.1} rotate={6} />
      <Bar cx={11.6} cy={12.0} w={12.0} t={2.8} r={1.1} rotate={-7} />
      <Bar cx={12.0} cy={16.8} w={13.1} t={3.0} r={1.2} rotate={0} />
    </svg>
  );
}

// ── Variant B — The penny drops ──────────────────────────────────────────
// A coin (the "penny") caught mid-fall above the stack — the idiom's literal
// moment of understanding. Full size keeps all 3 bars; `simplified` drops
// the middle (counter-tilted) bar and enlarges the remaining two shapes plus
// the dot, because at ~10-14px physical size four thin overlapping shapes
// blur into mush (a 1024px master bar scaled to a 24-unit viewBox already
// reads thin — cut that down further to a 10px render and the middle bar's
// area disappears under anti-aliasing before its opposite tilt can register).
// The dot sits left of the top bar's centre and a touch off-axis, following
// the bar's own clockwise lean — a falling object doesn't arrive dead
// centre, it drifts with the tilt it's about to land on.

function DropGlyph({
  size = 24,
  className,
  simplified = false,
}: {
  size?: number;
  className?: string;
  simplified?: boolean;
}) {
  if (simplified) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <circle cx={10.6} cy={5.4} r={2.3} fill="currentColor" />
        <Bar cx={12.6} cy={12.2} w={13.2} t={3.6} r={1.6} rotate={8} />
        <Bar cx={12.0} cy={18.4} w={15.2} t={3.8} r={1.7} rotate={0} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx={10.8} cy={3.0} r={1.4} fill="currentColor" />
      <Bar cx={12.4} cy={7.3} w={11.2} t={2.8} r={1.1} rotate={6} />
      <Bar cx={11.6} cy={12.0} w={12.0} t={2.8} r={1.1} rotate={-7} opacity={0.55} />
      <Bar cx={12.0} cy={16.8} w={13.1} t={3.0} r={1.2} rotate={0} />
    </svg>
  );
}

// ── Variant C — Monogram ─────────────────────────────────────────────────
// A geometric "P" built from the settle bars' own visual language: same
// stroke weight and corner radius, angled facets instead of a curved bowl.
// A first pass tried a fully closed round bowl assembled from tilted bar
// fragments — it looked like debris at 20px, none of it legible as a
// letterform. This is the "honest simpler P" the brief allows for: a
// vertical spine (kept perfectly vertical — a P's stem has to read
// unambiguously or the whole glyph fails) plus a faceted, kite-shaped bowl
// made of two bars that echo the master's own tilt family (+19.5°/-19.5°,
// same rotational idea as the settle mark's opposing top/middle bars) and
// deliberately don't weld flush to the spine — the master's own three bars
// never touch each other either, so a small gap at the joins is on-brand
// rather than a rendering miss.

function MonogramGlyph({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x={5.6} y={5.0} width={2.8} height={14.5} rx={1.3} fill="currentColor" />
      <Bar cx={12.2} cy={6.95} w={8.1} t={2.4} r={1.1} rotate={19.5} />
      <Bar cx={12.2} cy={9.65} w={8.1} t={2.4} r={1.1} rotate={-19.5} />
    </svg>
  );
}

// ── Swatches ─────────────────────────────────────────────────────────────

function FabSwatch({ icon }: { icon: React.ReactNode }) {
  return (
    <div
      className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-white"
      style={{ background: BRAND_GRADIENT, boxShadow: "0 4px 14px rgba(79,70,229,0.35)" }}
    >
      {icon}
    </div>
  );
}

function PillSwatch({ icon }: { icon: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1 flex-shrink-0"
      style={{ background: BRAND_GRADIENT }}
    >
      {icon}
      Penny
    </span>
  );
}

function ChipSwatch({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex items-center gap-1 flex-shrink-0">
      {icon}
      New
    </span>
  );
}

function InlineSwatch({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10">
      {icon}
    </span>
  );
}

function SwatchRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-4">{children}</div>;
}

function VariantLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
      {children}
    </p>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function PennyGlyphClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-16" style={{ colorScheme: mode }}>
        <div className="mx-auto max-w-[430px] px-4 pt-6">
          <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mb-4">
            /design/penny-glyph — temporary preview
          </p>

          <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Penny glyph</h1>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            Three candidates to replace the sparkle. Same gradient, new mark.
          </p>

          <div className="mt-2 flex gap-3">
            <a
              href="?mode=light"
              className={`text-[11px] font-medium underline underline-offset-2 ${mode === "light" ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`}
            >
              light
            </a>
            <a
              href="?mode=dark"
              className={`text-[11px] font-medium underline underline-offset-2 ${mode === "dark" ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`}
            >
              dark
            </a>
          </div>

          {/* Current state — the sparkle being replaced, for direct comparison.
              FAB + pill use lucide Sparkles (BottomNav.tsx / PennyPage.tsx);
              the pill in production actually uses a literal "✦" character, not
              an icon component (CanISection.tsx's PennyChip) — replicated
              exactly. The "New" chip uses Sparkles size=10 (HomeInsightSpotlight.tsx). */}
          <div className="mt-6 glass-card-flat rounded-2xl p-4">
            <VariantLabel>Current · sparkle</VariantLabel>
            <SwatchRow>
              <FabSwatch icon={<Sparkles size={22} strokeWidth={2} />} />
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1 flex-shrink-0"
                style={{ background: BRAND_GRADIENT }}
              >
                ✦ Penny
              </span>
              <ChipSwatch icon={<Sparkles size={10} />} />
              <InlineSwatch icon={<Sparkles size={20} />} />
            </SwatchRow>
          </div>

          {/* Variant A — Settle mark */}
          <div className="mt-4 glass-card-flat rounded-2xl p-4">
            <VariantLabel>A · Settle mark</VariantLabel>
            <SwatchRow>
              <FabSwatch icon={<SettleGlyph size={22} />} />
              <PillSwatch icon={<SettleGlyph size={11} />} />
              <ChipSwatch icon={<SettleGlyph size={10} />} />
              <InlineSwatch icon={<SettleGlyph size={20} />} />
            </SwatchRow>
          </div>

          {/* Variant B — The penny drops */}
          <div className="mt-4 glass-card-flat rounded-2xl p-4">
            <VariantLabel>B · The penny drops</VariantLabel>
            <SwatchRow>
              <FabSwatch icon={<DropGlyph size={24} />} />
              <PillSwatch icon={<DropGlyph size={12} simplified />} />
              <ChipSwatch icon={<DropGlyph size={11} simplified />} />
              <InlineSwatch icon={<DropGlyph size={20} />} />
            </SwatchRow>
            <p className="mt-2.5 text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
              Pill and chip use the simplified 2-bar drop (middle bar dropped, dot and remaining bars enlarged) — the
              full 4-shape version disappears below ~16px.
            </p>
          </div>

          {/* Variant C — Monogram */}
          <div className="mt-4 glass-card-flat rounded-2xl p-4">
            <VariantLabel>C · Monogram</VariantLabel>
            <SwatchRow>
              <FabSwatch icon={<MonogramGlyph size={24} />} />
              <PillSwatch icon={<MonogramGlyph size={11} />} />
              <ChipSwatch icon={<MonogramGlyph size={10} />} />
              <InlineSwatch icon={<MonogramGlyph size={20} />} />
            </SwatchRow>
          </div>

          <p className="mt-8 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-center">
            Temporary preview — delete after design review.
          </p>
        </div>
      </div>
    </div>
  );
}
