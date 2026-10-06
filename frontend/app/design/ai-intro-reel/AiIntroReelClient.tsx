"use client";

// G224 AI intro/outro previews. Two stories around the same untouched G223 reel:
// "Café" (round 1, AI intro only) and "Night out" (round 2, AI intro and outro).
// Muted autoplay with playsInline by default; controls let Kevin unmute. The
// video box is sized by width at 9:16 and capped by height, so there are no
// black bars at 390px.

import { useState } from "react";

const STORIES = [
  {
    id: "cafe",
    label: "Café",
    src: "/design-media/g224/sorted-ai-intro.mp4",
    poster: "/design-media/g224/sorted-ai-intro-poster.jpg",
    caption: "AI-generated intro (Veo 3.1 Fast) joined to the G223 reel. The person is AI-generated.",
  },
  {
    id: "night-out",
    label: "Night out",
    src: "/design-media/g224/sorted-night-out.mp4",
    poster: "/design-media/g224/sorted-night-out-poster.jpg",
    caption: "AI-generated intro and outro (Veo 3.1 Fast) around the G223 reel. The people are AI-generated.",
  },
] as const;

export default function AiIntroReelClient() {
  const [active, setActive] = useState<(typeof STORIES)[number]["id"]>("cafe");
  const story = STORIES.find((s) => s.id === active) ?? STORIES[0];
  return (
    <main
      className="flex min-h-dvh flex-col items-center gap-3 overflow-hidden bg-slate-950 px-3 py-3"
      style={{ colorScheme: "dark" }}
    >
      <div role="tablist" aria-label="Story" className="flex gap-2">
        {STORIES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === active}
            onClick={() => setActive(s.id)}
            className={`min-h-11 rounded-full px-5 text-sm font-semibold ${
              s.id === active ? "bg-slate-100 text-slate-950" : "bg-slate-800 text-slate-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div
        className="w-full"
        style={{ maxWidth: "min(100%, calc((100dvh - 9.5rem) * 9 / 16))", aspectRatio: "9 / 16" }}
      >
        <video
          key={story.id}
          src={story.src}
          poster={story.poster}
          autoPlay
          playsInline
          muted
          loop
          controls
          preload="metadata"
          className="block h-full w-full rounded-2xl bg-black object-cover"
        />
      </div>
      <p className="max-w-[22rem] text-center text-xs leading-snug text-slate-300">
        {story.caption}
      </p>
    </main>
  );
}
