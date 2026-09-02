"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Kevin's ask (2026-08-27): the Android launcher icon (app "Sorted", the
// "settle" glyph) currently has a faint radial purple wash behind the glyph
// that all but disappears once Android masks it to a circle and downscales
// it to launcher size (48-96px). Three glow variants below, built as
// stacked radial-gradient shapes rather than SVG filters (cairosvg does not
// blur feGaussianBlur — verified separately), tuned so the glow survives
// that downscale. Sources live in
// capacitor-spike/assets/masters/settle-glyph-*.svg. Kevin picks one before
// anything touches the live launcher assets.
//
// Each variant card shows the full 1024 render, then a launcher simulation:
// the icon circle-masked at 72px and 48px (Android's actual launcher mask)
// over a dark and a light/colourful wallpaper swatch, matching the kind of
// screenshot Kevin sent.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

type Mode = "light" | "dark";

const ASSET_BASE = "/design/app-icon";

type Variant = {
  slug: string;
  label: string;
  file: string;
  caption: string;
};

const VARIANTS: Variant[] = [
  {
    slug: "v1",
    label: "V1 · Lit panel",
    file: "icon-v1-lit-panel.png",
    caption:
      "Restrained light climbing from the gradient bar only, fading out before it reaches the top bar, so the panel reads as lit rather than glowing.",
  },
  {
    slug: "v2",
    label: "V2 · Halo",
    file: "icon-v2-halo.png",
    caption:
      "A calm, symmetrical halo behind the whole stack, larger and brighter than today's wash so it still holds its own at launcher size.",
  },
  {
    slug: "v3",
    label: "V3 · Ember",
    file: "icon-v3-ember.png",
    caption:
      "The gradient bar reads as the stack's ember, with a barely-there violet rim catching the underside of each slate bar and the faintest lift in the background near the bar.",
  },
];

// ── Launcher simulation ─────────────────────────────────────────────────

function Wallpaper({
  kind,
  children,
}: {
  kind: "dark" | "light";
  children: React.ReactNode;
}) {
  const style =
    kind === "dark"
      ? { background: "linear-gradient(160deg, #05070d 0%, #0c1120 60%, #131a2c 100%)" }
      : { background: "linear-gradient(135deg, #fde8d0 0%, #fbd0e0 45%, #cfe3fb 100%)" };
  return (
    <div
      className="flex items-center justify-center gap-6 rounded-xl px-5 py-5"
      style={style}
    >
      {children}
    </div>
  );
}

function LauncherCircle({ src, size, alt }: { src: string; size: number; alt: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="overflow-hidden rounded-full shadow-lg"
        style={{ width: size, height: size, boxShadow: "0 2px 10px rgba(0,0,0,0.35)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={size} height={size} className="block h-full w-full" />
      </div>
      <span className="text-[10px] font-mono text-white/60">{size}px</span>
    </div>
  );
}

function LauncherSimRow({ src, name }: { src: string; name: string }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2.5">
      <Wallpaper kind="dark">
        <LauncherCircle src={src} size={72} alt={`${name} at 72px, dark wallpaper`} />
        <LauncherCircle src={src} size={48} alt={`${name} at 48px, dark wallpaper`} />
      </Wallpaper>
      <Wallpaper kind="light">
        <LauncherCircle src={src} size={72} alt={`${name} at 72px, light wallpaper`} />
        <LauncherCircle src={src} size={48} alt={`${name} at 48px, light wallpaper`} />
      </Wallpaper>
    </div>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────

function IconCard({
  label,
  caption,
  src,
  badge,
}: {
  label: string;
  caption: string;
  src: string;
  badge?: string;
}) {
  return (
    <div className="mt-4 glass-card-flat rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {label}
        </p>
        {badge ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {badge}
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">{caption}</p>

      <div className="mt-3.5 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`${label} full 1024 render`}
          width={320}
          height={320}
          className="rounded-[28%] shadow-md"
        />
      </div>

      <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Launcher simulation
      </p>
      <LauncherSimRow src={src} name={label} />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function AppIconClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "light" ? "light" : "dark";

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
            /design/app-icon — temporary preview
          </p>

          <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">
            App icon glow
          </h1>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            Refining the launcher icon&apos;s glow to feel like light with a source (the
            gradient bar), not a decorative wash, and to survive being masked to a circle and
            downscaled to launcher size.
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

          {/* Current — for direct comparison against reality */}
          <IconCard
            label="Current"
            badge="live"
            caption="The faint radial wash shipping today. It reads on the full 1024 render but thins out almost to nothing once masked to a circle and shrunk to launcher size."
            src={`${ASSET_BASE}/icon-current.png`}
          />

          {VARIANTS.map((v) => (
            <IconCard key={v.slug} label={v.label} caption={v.caption} src={`${ASSET_BASE}/${v.file}`} />
          ))}

          <p className="mt-8 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-center">
            Temporary preview — delete after design review. Nothing here touches the live
            launcher assets.
          </p>
        </div>
      </div>
    </div>
  );
}
