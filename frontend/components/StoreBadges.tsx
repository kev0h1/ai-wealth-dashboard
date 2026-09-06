import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/webProduct";

// Hand-drawn glyphs, not brand assets — see the comment on Badge below for
// why, and what must replace them.
function AppleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16.2 12.7c0-2.2 1.8-3.3 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8-.7 0-1.8-.8-2.9-.8-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.7 2.3 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.2.6-.9.9-1.4 1.4-2.4-3.6-1.4-2-3.9-2-3.9Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M13.9 5.9c.6-.7 1-1.7 1-2.7-.9.1-2 .6-2.6 1.4-.6.6-1.1 1.6-1 2.6 1 .1 2-.5 2.6-1.3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 4.2c0-.9.9-1.4 1.6-1l12.3 7.8c.7.4.7 1.4 0 1.9L7.6 20.8c-.7.4-1.6-.1-1.6-1V4.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Badge({
  href,
  eyebrow,
  name,
  glyph,
}: {
  href: string;
  eyebrow: string;
  name: string;
  glyph: React.ReactNode;
}) {
  const pillClasses =
    "flex items-center gap-2.5 min-h-[44px] rounded-xl bg-slate-950 px-4 py-2 text-white active:scale-95 transition-transform motion-reduce:transition-none";

  // TODO: swap for the official Apple ("Download on the App Store") and
  // Google Play ("Get it on Google Play") badge artwork, and follow each
  // platform's usage guidelines, once the store listings exist (backlog
  // A9 for Play; the App Store listing is a separate follow-up). These are
  // hand-built placeholders, not brand assets.
  if (!href) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div aria-disabled="true" className={`${pillClasses} opacity-40`}>
          {glyph}
          <span className="flex flex-col items-start leading-none">
            <span className="text-[11px] font-semibold tracking-wide">{eyebrow}</span>
            <span className="text-[14px] font-semibold">{name}</span>
          </span>
          <span className="sr-only">Coming soon</span>
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500">Coming soon</span>
      </div>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={pillClasses}>
      {glyph}
      <span className="flex flex-col items-start leading-none">
        <span className="text-[11px] font-semibold tracking-wide">{eyebrow}</span>
        <span className="text-[14px] font-semibold">{name}</span>
      </span>
    </a>
  );
}

export default function StoreBadges() {
  return (
    <div className="flex flex-wrap items-start justify-center gap-3">
      <Badge href={APP_STORE_URL} eyebrow="Download on the" name="App Store" glyph={<AppleGlyph />} />
      <Badge href={PLAY_STORE_URL} eyebrow="GET IT ON" name="Google Play" glyph={<PlayGlyph />} />
    </div>
  );
}
