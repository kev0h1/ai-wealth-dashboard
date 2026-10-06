"use client";

// G223 first Sorted reel. A 15 second, 1080x1920 vertical video for TikTok,
// Reels and Stories, built in Remotion (frontend/remotion/) from the G222
// Safe-to-Spend ad. Demo (fictional) data only. The phone imagery is the
// production components/SafeToSpendCard through its real props.
//
// Plays here with @remotion/player: autoplay, muted (there is no audio),
// looping, with controls, scaled to fit the viewport so it opens whole at 390px
// wide. The Player is client-only (dynamic import, ssr: false) so it adds
// nothing to any other route. The MP4 is rendered with `npm run reel:render`.
//
// /design/reel-safe-to-spend            plays
// /design/reel-safe-to-spend?frame=240  freezes on frame 240 (0 to 449), for stills

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

const ReelPlayer = dynamic(() => import("./ReelPlayer"), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-[100000] bg-slate-950" aria-hidden="true" />,
});

export default function ReelSafeToSpendClient() {
  const params = useSearchParams();
  const raw = params.get("frame");
  const parsed = raw === null ? NaN : Number(raw);
  const frame = Number.isFinite(parsed) ? Math.max(0, Math.min(449, Math.round(parsed))) : null;
  return <ReelPlayer frozenFrame={frame} />;
}
