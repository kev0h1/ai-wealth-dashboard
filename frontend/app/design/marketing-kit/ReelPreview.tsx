"use client";

import { filmDefinitions, type MarketingFilmId, type MarketingTheme } from "@/remotion/marketing-kit/constants";

// The caller owns lazy-loading this browser-only component with next/dynamic.
// It intentionally does not autoplay: marketing motion is optional, and a
// reduced-motion preference receives a still first frame until play is chosen.
export default function ReelPreview({ film, theme }: { film: MarketingFilmId; theme: MarketingTheme }) {
  const definition = filmDefinitions[film];
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="mx-auto w-full max-w-[430px] overflow-hidden rounded-[24px] border border-slate-200 bg-slate-950 shadow-sm dark:border-slate-700" style={{ aspectRatio: `${definition.width} / ${definition.height}` }}>
      <video
        key={`${film}-${theme}`}
        src={`/design-media/c22/${film}-${theme}.mp4`}
        style={{ width: "100%", height: "100%" }}
        controls
        autoPlay={false}
        loop={false}
        muted
        playsInline
        preload="metadata"
        aria-label={`${definition.label} preview, ${theme} theme`}
      >Your browser cannot play this preview. Use the film download below.</video>
      {reducedMotion ? <span className="sr-only">Reduced motion is enabled. Press play to view the film.</span> : null}
    </div>
  );
}
