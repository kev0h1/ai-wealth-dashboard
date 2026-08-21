import { Figtree, DM_Sans, JetBrains_Mono } from "next/font/google";

// Static design preview — typeface comparison for the Home hero.
// Fully self-contained: hardcoded mock content only, no API calls, no auth.
// Not linked from app nav — deep-linked from /design (see page.tsx there).
// Preview only: does NOT change the app's global font (see globals.css body
// rule, which still ships the raw system stack). Safe to delete once Kevin
// has picked a direction.
//
// next/font/google self-hosts these three at build time (woff2 bundled into
// the static output), so the page stays offline-safe with no runtime request
// to Google. Scoped to this route only — each font's `.className` is applied
// to its own section wrapper, not the root layout.

const figtree = Figtree({ subsets: ["latin"] });
const dmSans = DM_Sans({ subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"] });

// ── Shared replica content (identical across sections — only type differs) ─

type NumProps = { mono?: boolean; children: React.ReactNode };

/** Wraps a figure in JetBrains Mono when `mono` is set (Section D only);
 *  otherwise it just inherits whatever font the section wrapper applies. */
function Num({ mono, children }: NumProps) {
  return (
    <span className={mono ? jetbrainsMono.className : undefined}>
      {children}
    </span>
  );
}

function HeroReplica({
  label,
  fontClassName,
  monoFigures,
}: {
  label: string;
  fontClassName: string;
  monoFigures?: boolean;
}) {
  return (
    <section className={fontClassName}>
      <div className="mb-4 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-400">
        {label}
      </div>

      <h1 className="text-3xl font-bold text-white">Good evening, Kevin</h1>

      <p className="mt-2 max-w-prose text-pretty text-[15px] leading-relaxed text-slate-200">
        Nothing needs you today. Cash is tight for the rest of this pay
        period, but the bills are mapped. I&apos;ll flag anything that needs
        you.
      </p>

      {/* Safe to Spend card replica — mirrors SafeToSpendCard's dark glass-hero
          styling (rounded-3xl, #1c2537 fill, hairline border, soft shadow). */}
      <div className="mt-4 rounded-3xl border border-[rgba(255,255,255,0.08)] bg-[#1c2537] p-5 shadow-[0_4px_14px_rgba(0,0,0,0.40)]">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Safe to Spend
        </p>

        <h2 className="mb-3 text-pretty text-[19px] font-semibold leading-snug text-slate-100">
          Tight until period end. <Num mono={monoFigures}>£240</Num> cash in
          hand, <Num mono={monoFigures}>£147</Num> ahead once credit cards are
          counted.
        </h2>

        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-start gap-0.5 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#212b40] px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Now
            </span>
            <span
              className="text-[22px] font-semibold text-slate-100 whitespace-nowrap"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <Num mono={monoFigures}>£466</Num>
            </span>
          </div>
          <div className="flex flex-col items-start gap-0.5 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#212b40] px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Bills
            </span>
            <span
              className="text-[22px] font-semibold text-slate-100 whitespace-nowrap"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <Num mono={monoFigures}>−£226</Num>
            </span>
          </div>
          <div className="flex flex-col items-start gap-0.5 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#212b40] px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Free
            </span>
            <span
              className="text-[22px] font-semibold text-slate-100 whitespace-nowrap"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <Num mono={monoFigures}>£240</Num>
            </span>
          </div>
        </div>

        <p className="mt-3 text-[13px] text-slate-400">
          <Num mono={monoFigures}>£23.98</Num>/day until Fri 28 Aug{" "}
          &middot; ~<Num mono={monoFigures}>£4,800</Num> expected
        </p>
      </div>

      <p className="mt-3 text-[13px] text-slate-400">
        19 bills over the next 2 weeks &middot; total out{" "}
        <Num mono={monoFigures}>£719</Num>
      </p>
    </section>
  );
}

export default function TypePreviewPage() {
  return (
    <div className="min-h-screen bg-[#0f172a]">
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-white">Type preview</h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
          Home hero, four type treatments. Newest first.
        </p>

        <div className="mt-8 flex flex-col gap-10">
          <HeroReplica
            label="A &middot; System (today)"
            fontClassName=""
          />
          <HeroReplica label="B &middot; Figtree" fontClassName={figtree.className} />
          <HeroReplica label="C &middot; DM Sans" fontClassName={dmSans.className} />
          <HeroReplica
            label="D &middot; Figtree + JetBrains Mono figures"
            fontClassName={figtree.className}
            monoFigures
          />
        </div>

        <p className="mt-10 text-[13px] text-slate-500">
          Google Sans itself is proprietary to Google. Figtree and DM Sans are
          its closest open relatives. Tap winners: reply with a letter.
        </p>
      </div>
    </div>
  );
}
