// G224 AI-generated live-action intro joined to the G223 reel. Preview only:
// plays the pre-rendered MP4 (frontend/public/design-media/g224/), muted and
// looping with controls, fitted to the viewport so nothing overflows at 390px.
// The intro person is AI generated and must be labelled as AI when published.

export default function Page() {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-3 overflow-hidden bg-slate-950 px-3 py-3"
      style={{ colorScheme: "dark" }}
    >
      <video
        src="/design-media/g224/sorted-ai-intro.mp4"
        poster="/design-media/g224/sorted-ai-intro-poster.jpg"
        playsInline
        muted
        loop
        controls
        preload="metadata"
        className="block max-w-full rounded-2xl bg-black"
        style={{ aspectRatio: "9 / 16", height: "calc(100dvh - 5.5rem)" }}
      />
      <p className="max-w-[22rem] text-center text-xs leading-snug text-slate-300">
        AI-generated intro (Veo 3.1 Fast) joined to the G223 reel. The person is AI-generated.
      </p>
    </main>
  );
}
