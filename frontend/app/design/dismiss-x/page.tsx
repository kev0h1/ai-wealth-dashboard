import { X, PiggyBank } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import SettleMark from "@/components/SettleMark";

// Static design preview — three dismiss-"x" treatments compared side by
// side, in both a light block and a dark block (explicit wrapper classes,
// not the OS theme — see the .dark blocks below, which lean on globals.css
// `@custom-variant dark (&:is(.dark, .dark *))`). Fully self-contained:
// no data fetching, no client state, no auth (see components/AuthProvider.tsx
// — /design/* is exempt). Deep-linkable at /design/dismiss-x.
//
// Kevin flagged the Home dismiss "x" as inconsistent: HomeBrief.tsx uses a
// bare ghost x with no resting surface (5 sites, ~lines 375/445/503/580/847
// plus a 6th ~1560); HomeInsightSpotlight.tsx uses an opaque 28px disc with
// a snapping hover (~lines 104-112). This page proposes one unified answer
// as three variants against replicas of BOTH card families. Do NOT touch
// the real components until Kevin picks — see the three snippet functions
// below (DismissV1/V2/V3), each a self-contained copy target.

// ── V1 — Whisper ghost ──────────────────────────────────────────────────
// One unified ghost x: no resting surface at all. A soft translucent wash
// fades in behind it on hover/press, sized to ~28px so it doesn't balloon
// to the full 44px hit target. Hover is gated to hover-capable pointers
// (`[@media(hover:hover)]`) so phones don't get sticky hover.
function DismissV1({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 group"
    >
      <span
        className="w-7 h-7 flex items-center justify-center rounded-full bg-transparent [@media(hover:hover)]:group-hover:bg-slate-500/10 dark:[@media(hover:hover)]:group-hover:bg-white/10 group-active:scale-95 group-active:bg-slate-500/10 dark:group-active:bg-white/10 transition-[background-color,transform] duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
      >
        <X size={16} aria-hidden="true" />
      </span>
    </button>
  );
}

// ── V2 — Glass chip ───────────────────────────────────────────────────────
// The x sits in a translucent micro-tile that belongs to the glass system
// (fill-only, no backdrop-filter — glass-tile tier per globals.css) rather
// than an opaque disc borrowed from nowhere.
function DismissV2({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 transition-transform duration-150"
    >
      <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
        <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
      </span>
    </button>
  );
}

// ── V3 — Anchored puck, refined ──────────────────────────────────────────
// The current spotlight disc, corrected: hairline border added, hover
// transitions instead of snapping, x optically centred with a touch more
// stroke weight for a crisper glyph at 14px.
function DismissV3({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 transition-transform duration-150"
    >
      <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700/80 border border-slate-200/60 dark:border-white/[0.06] [@media(hover:hover)]:hover:bg-slate-200 dark:[@media(hover:hover)]:hover:bg-slate-600 transition-colors duration-150">
        <X size={14} strokeWidth={2.25} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
      </span>
    </button>
  );
}

const VARIANTS: { key: string; name: string; caption: string; Dismiss: (p: { label: string }) => React.JSX.Element }[] = [
  {
    key: "v1",
    name: "V1 · Whisper ghost",
    caption: "No resting surface at all; a soft wash appears only on hover or press.",
    Dismiss: DismissV1,
  },
  {
    key: "v2",
    name: "V2 · Glass chip",
    caption: "A translucent micro-tile from the glass system, not an opaque sticker.",
    Dismiss: DismissV2,
  },
  {
    key: "v3",
    name: "V3 · Anchored puck, refined",
    caption: "Today's opaque disc kept for affordance, given a hairline and an eased hover.",
    Dismiss: DismissV3,
  },
];

// ── Card replicas ─────────────────────────────────────────────────────────
// Mirrors HomeBrief.tsx's plain fact-card body (icon, headline, one line of
// body copy) with the dismiss slot swapped per variant.
function BriefCardReplica({ Dismiss, label }: { Dismiss: (p: { label: string }) => React.JSX.Element; label: string }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 flex items-center justify-center w-4 h-6">
          <SettleMark size={16} className="text-emerald-500" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white leading-6">
            Rent covered for September
          </p>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
            Moved 3 days early, no chasing needed.
          </p>
        </div>
        <Dismiss label={label} />
      </div>
    </div>
  );
}

// Mirrors HomeInsightSpotlight.tsx's card (topic chip, "New" badge, body
// copy) with the dismiss slot swapped per variant. The real component
// positions its x absolutely top-right with a p-3 -m-3 hit area; here it
// sits inline top-right of the header row, which reads the same visually.
function SpotlightCardReplica({ Dismiss, label }: { Dismiss: (p: { label: string }) => React.JSX.Element; label: string }) {
  return (
    <div className="relative rounded-2xl glass-card overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
              <PiggyBank size={15} className="text-indigo-500 dark:text-indigo-400" />
            </span>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Savings</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex items-center gap-1">
              <PennyMark size={10} /> New
            </span>
          </div>
          <Dismiss label={label} />
        </div>
        <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-snug text-pretty">
          Your easy-access pot has beaten inflation for 4 months straight.
        </p>
      </div>
    </div>
  );
}

function VariantColumn({
  variant,
}: {
  variant: (typeof VARIANTS)[number];
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{variant.name}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 text-pretty">{variant.caption}</p>
      </div>
      <BriefCardReplica Dismiss={variant.Dismiss} label={`${variant.name} — dismiss example`} />
      <SpotlightCardReplica Dismiss={variant.Dismiss} label={`${variant.name} — dismiss example`} />
    </div>
  );
}

function ThemeBlock({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : undefined}>
      <div
        className="rounded-3xl bg-[#f0f2f7] dark:bg-[#0f172a] p-4"
        style={{ colorScheme: dark ? "dark" : "light" }}
      >
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          {dark ? "Dark block" : "Light block"}
        </p>
        <div className="flex flex-col gap-6">
          {VARIANTS.map((v) => (
            <VariantColumn key={v.key} variant={v} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DismissXPreviewPage() {
  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Dismiss &times; comparison</h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Home brief card and insight-spotlight card, three treatments, light and dark.
        </p>

        <div className="mt-6 flex flex-col gap-8">
          <ThemeBlock dark={false} />
          <ThemeBlock dark={true} />
        </div>

        <p className="mt-8 text-[11px] text-slate-500 dark:text-slate-400 text-pretty">
          All three keep the aria-label, a 44px outer hit target, a
          focus-visible indigo ring, and active:scale-95 press feedback. The
          glyph itself never changes colour to red or indigo; dismissal
          stays a quiet action.
        </p>
      </div>
    </div>
  );
}
