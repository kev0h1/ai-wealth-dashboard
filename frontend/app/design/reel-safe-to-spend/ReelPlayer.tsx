"use client";

import { useEffect, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { SortedReel } from "@/remotion/SortedReel";
import { DURATION, FPS, HEIGHT, WIDTH } from "@/remotion/constants";

const inputProps = { iconSrc: "/icons/icon-192.png" };

export default function ReelPlayer({ frozenFrame }: { frozenFrame: number | null }) {
  const player = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);

  // Mirror the playhead on the wrapper so a headless check can read it.
  useEffect(() => {
    const p = player.current;
    const el = box.current;
    if (!p || !el) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      el.dataset.frame = String(e.detail.frame);
    };
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center overflow-hidden bg-slate-950"
      style={{ colorScheme: "dark" }}
    >
      <div
        ref={box}
        data-reel
        data-frame={frozenFrame ?? 0}
        style={{ width: "min(100vw, calc(100dvh * 9 / 16))", aspectRatio: "9 / 16", maxHeight: "100dvh" }}
      >
        <Player
          ref={player}
          component={SortedReel}
          inputProps={inputProps}
          durationInFrames={DURATION}
          fps={FPS}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          style={{ width: "100%", height: "100%" }}
          controls
          autoPlay={frozenFrame === null}
          initialFrame={frozenFrame ?? 0}
          loop
          initiallyMuted
          showVolumeControls={false}
          clickToPlay
          acknowledgeRemotionLicense
        />
      </div>
    </div>
  );
}
