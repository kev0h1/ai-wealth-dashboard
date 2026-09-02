"use client";

// TEMPORARY PREVIEW — Planning-page entry point round for "Set aside"
// (/planning/dismissed). Owner's brief, verbatim: "maybe the set aside can
// be a bin at the top but with a good design, have taste skill and
// impeccable look at this."
//
// Three coded variants, each against a faithful replica of Planning's top
// area: the same eyebrow/title header block and the same red shortfall
// banner markup as PlanningPage.tsx (~lines 1797-1919), plus a section
// header row and two mock bill rows so the entry sits among real content,
// not a blank canvas. Static only, no navigation wired, PlanningPage.tsx
// itself is untouched.
//
//   A — the literal ask, done well: a bare bin glyph, restrained, in the
//       header, icon only.
//   B — same position, recovery-first: an icon + quiet label lockup
//       ("Set aside") instead of a bare glyph, so it reads as navigation
//       on sight rather than as a delete control.
//   C — a distinct third direction: a count-carrying chip on the list's
//       own section header row, next to "+ Plan a one-off", that only
//       exists once something has actually been set aside.
//
// Deep-linkable via /design/dismissed?view=entry&entry=a|b|c&count=0|3&
// banner=1|0&mode=light|dark (wired in DismissedClient.tsx).

import { Trash2, ArchiveRestore, Inbox, AlertTriangle, ChevronRight } from "lucide-react";

export type EntryVariant = "a" | "b" | "c";

// ── Shared fragments, each a 1:1 class-for-class copy of the real
// PlanningPage.tsx markup it stands in for. ──────────────────────────────

function EyebrowTitle() {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
        PLANNING
      </p>
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">What&apos;s coming</h1>
    </div>
  );
}

function ShortfallBanner() {
  return (
    <div className="mt-3 w-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl px-4 py-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
            Your Barclays account is short before payday
          </p>
          <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
            <span className="font-mono tabular-nums">£142.00</span> short for bills due before payday. Move money
            in, or change a payment date.
          </p>
        </div>
        <button className="flex-shrink-0 self-center px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold min-h-[44px] flex items-center active:scale-95 transition-transform">
          Review
        </button>
      </div>
    </div>
  );
}

function MockBillRow({ name, sub, amount }: { name: string; sub: string; amount: string }) {
  return (
    <div className="glass-card rounded-2xl px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
        {name.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{sub}</p>
      </div>
      <span className="money text-sm font-semibold text-slate-800 dark:text-slate-100 shrink-0">{amount}</span>
    </div>
  );
}

// ── The count treatment shared by A and B: a neutral slate numeral, never
// red or amber. "3 set aside" is not a caution, the money is fine, it is
// deliberately excluded, so it never earns a warning colour. ────────────
function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-[3px] rounded-full bg-slate-200 dark:bg-slate-600 text-[9px] font-semibold text-slate-600 dark:text-slate-200 flex items-center justify-center"
    >
      {count}
    </span>
  );
}

// ── Variant A: literal bin, icon only, header right. Always present, just
// quieter at zero, so the page furniture never moves. ────────────────────
function HeaderA({ count }: { count: number }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <EyebrowTitle />
      <button
        type="button"
        aria-label={count > 0 ? `Set aside, ${count} payments excluded` : "Set aside, nothing excluded yet"}
        className="relative shrink-0 w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Trash2
          size={20}
          strokeWidth={1.75}
          className={count > 0 ? "text-slate-500 dark:text-slate-400" : "text-slate-300 dark:text-slate-600"}
        />
        <CountBadge count={count} />
      </button>
    </div>
  );
}

// ── Variant B: same slot, recovery-first icon + quiet label lockup. The
// label alone answers "what is this", so it never needs to be guessed
// from a glyph. ────────────────────────────────────────────────────────
function HeaderB({ count }: { count: number }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <EyebrowTitle />
      <button
        type="button"
        aria-label={count > 0 ? `Set aside, ${count} payments excluded` : "Set aside, nothing excluded yet"}
        className="shrink-0 min-h-[44px] flex items-center gap-1.5 pl-2.5 pr-3 rounded-full active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <ArchiveRestore size={16} strokeWidth={1.75} className="text-slate-400 dark:text-slate-500" />
        <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">Set aside</span>
        {count > 0 && (
          <span className="ml-0.5 min-w-[16px] h-[16px] px-[3px] rounded-full bg-slate-200 dark:bg-slate-600 text-[9px] font-semibold text-slate-600 dark:text-slate-200 flex items-center justify-center">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

// ── Variant C: no header entry at all. Section header row instead, a
// count chip beside "+ Plan a one-off", only rendered once count > 0. ───
function ChipC({ count }: { count: number }) {
  return (
    <button
      type="button"
      aria-label={`Set aside, ${count} payments excluded`}
      className="min-h-[44px] -my-2.5 flex items-center gap-1 pl-2 pr-2.5 rounded-full bg-slate-100 dark:bg-slate-700/60 active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Inbox size={13} strokeWidth={1.75} className="text-slate-400 dark:text-slate-500" />
      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{count}</span>
    </button>
  );
}

function SectionRow({ chip }: { chip?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Today</p>
      <div className="flex items-center gap-1.5">
        {chip}
        <button
          type="button"
          className="min-h-[44px] -my-2.5 flex items-center px-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          + Plan a one-off
        </button>
      </div>
    </div>
  );
}

// ── The foot link every variant is judged against. A and B remove it (one
// destination, one door). C keeps it, but only while the chip has nothing
// to show, and drops it the moment the chip does. ────────────────────────
function FootLink({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <button
      type="button"
      className="mt-6 w-full min-h-[44px] flex items-center justify-center gap-1 text-xs font-medium text-slate-400 dark:text-slate-500 active:opacity-60 transition-opacity"
    >
      Set aside
      <ChevronRight size={13} />
    </button>
  );
}

const ANNOTATIONS: Record<EntryVariant, { position: string; zero: string; foot: string }> = {
  a: {
    position:
      "Header, right-aligned, vertically centred against the eyebrow + title block. A bin glyph, restrained, icon only, 44px hit area.",
    zero:
      "Always visible. Recedes to a quieter slate at zero rather than disappearing, page furniture rather than a data widget, so it sits exactly where a user reaching for it after an accidental dismissal already expects to find it.",
    foot: "Removed. One destination, one door: a second, quieter link at the foot only raises the question of whether it goes somewhere different.",
  },
  b: {
    position:
      "Same header slot as A, but an icon + quiet label lockup rather than a bare glyph, so it reads as navigation on sight, not as a delete control, directly answering the misread risk a bin carries on a page full of bills.",
    zero:
      "Always visible, same reasoning as A. The label alone carries the meaning even before anything has been set aside, so the zero state still reads as intentional rather than broken or empty.",
    foot: "Removed, same reasoning as A.",
  },
  c: {
    position:
      "No header entry at all. A small count chip on the list's own section header, beside \"+ Plan a one-off\", the moment something is actually excluded.",
    zero:
      "Hidden at zero. A chip reading \"0\" communicates nothing; its first appearance coincides exactly with the moment something is set aside, so there is no gap, the app's own 6-second undo toast already covers the instant right after a dismissal.",
    foot:
      "Kept, but only while nothing is set aside, a quiet fallback seed for discovery before the chip has anything to show. Once the chip appears, the foot link is redundant and drops.",
  },
};

function Annotation({ variant }: { variant: EntryVariant }) {
  const c = ANNOTATIONS[variant];
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
        Design note, variant {variant.toUpperCase()}
      </p>
      <dl className="space-y-1.5 text-[12px] leading-snug">
        <div>
          <dt className="inline font-semibold text-slate-600 dark:text-slate-300">Position. </dt>
          <dd className="inline text-slate-500 dark:text-slate-400">{c.position}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-600 dark:text-slate-300">At zero. </dt>
          <dd className="inline text-slate-500 dark:text-slate-400">{c.zero}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-600 dark:text-slate-300">Foot link. </dt>
          <dd className="inline text-slate-500 dark:text-slate-400">{c.foot}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function EntryPointVariants({
  entry,
  count,
  banner,
}: {
  entry: EntryVariant;
  count: number;
  banner: boolean;
}) {
  const showFoot = entry === "c" && count === 0;
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-24">
      <div className="mx-auto w-full max-w-[390px] px-4 pt-6">
        <div className="mb-4">
          {entry === "a" && <HeaderA count={count} />}
          {entry === "b" && <HeaderB count={count} />}
          {entry === "c" && <EyebrowTitle />}
        </div>

        {banner && <ShortfallBanner />}

        <div className={banner ? "mt-4" : "mt-1"}>
          <SectionRow chip={entry === "c" && count > 0 ? <ChipC count={count} /> : undefined} />
          <div className="space-y-2">
            <MockBillRow name="Council tax" sub="Due today · Barclays" amount="£142" />
            <MockBillRow name="Netflix" sub="Due today · Monzo" amount="£15.99" />
          </div>
        </div>

        <FootLink show={showFoot} />

        <Annotation variant={entry} />
      </div>
    </div>
  );
}
