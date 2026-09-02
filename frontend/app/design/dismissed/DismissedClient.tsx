"use client";

// TEMPORARY PREVIEW — delete after design review.
// /design/dismissed: three art-direction variants for a "Set aside" page
// that surfaces both user dismissals (dismissed_recurring) and engine
// vetoes (engine_vetoed_recurring), with a restore affordance for each.
// Built after the owner accidentally, silently, permanently dismissed his
// £400/month Vanguard standing order and had no surface to find or undo it.
//
// Deep-linkable, following the same pattern as the other /design/*
// previews (see month-story/MonthStoryClient.tsx, spend-verdict-a):
//   /design/dismissed?variant=a|b|c&state=mixed|single|empty&mode=light|dark

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { STATE_ROWS, type StateKey } from "./fixtures";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import EntryPointVariants, { type EntryVariant } from "./EntryPointVariants";

const VARIANTS = ["a", "b", "c"] as const;
type Variant = (typeof VARIANTS)[number];
const STATES: StateKey[] = ["mixed", "single", "empty"];

const VARIANT_LABEL: Record<Variant, string> = {
  a: "A · ledger",
  b: "B · sections",
  c: "C · undo log",
};
const STATE_LABEL: Record<StateKey, string> = {
  mixed: "Mixed",
  single: "Single",
  empty: "Empty",
};

const VIEWS = ["list", "entry"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { list: "List", entry: "Entry point" };

const ENTRY_VARIANTS: EntryVariant[] = ["a", "b", "c"];
const ENTRY_VARIANT_LABEL: Record<EntryVariant, string> = {
  a: "A · bin",
  b: "B · lockup",
  c: "C · chip",
};

function ControlBar({
  view,
  variant,
  state,
  entryVariant,
  count,
  banner,
  mode,
}: {
  view: View;
  variant: Variant;
  state: StateKey;
  entryVariant: EntryVariant;
  count: number;
  banner: boolean;
  mode: "light" | "dark";
}) {
  const hrefForList = (v: Variant, s: StateKey, m: "light" | "dark") =>
    `?view=list&variant=${v}&state=${s}&mode=${m}`;
  const hrefForEntry = (ev: EntryVariant, c: number, b: boolean, m: "light" | "dark") =>
    `?view=entry&entry=${ev}&count=${c}&banner=${b ? 1 : 0}&mode=${m}`;
  const hrefForView = (v: View) =>
    v === "list" ? hrefForList(variant, state, mode) : hrefForEntry(entryVariant, count, banner, mode);

  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex flex-col items-center gap-1.5 rounded-2xl border border-white/15 bg-slate-900/90 p-2 shadow-xl max-w-[92vw]">
        <div className="flex gap-1">
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={hrefForView(v)}
              scroll={false}
              className={`flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-semibold transition-colors active:scale-95 ${
                v === view ? "bg-emerald-600 text-white" : "text-slate-300"
              }`}
            >
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </div>

        {view === "list" ? (
          <>
            <div className="flex gap-1">
              {VARIANTS.map((v) => (
                <Link
                  key={v}
                  href={hrefForList(v, state, mode)}
                  scroll={false}
                  className={`flex min-h-[36px] items-center justify-center rounded-full px-2.5 text-[11px] font-semibold transition-colors active:scale-95 ${
                    v === variant ? "bg-indigo-600 text-white" : "text-slate-300"
                  }`}
                >
                  {VARIANT_LABEL[v]}
                </Link>
              ))}
            </div>
            <div className="flex gap-1">
              {STATES.map((s) => (
                <Link
                  key={s}
                  href={hrefForList(variant, s, mode)}
                  scroll={false}
                  className={`flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-medium transition-colors active:scale-95 ${
                    s === state ? "bg-slate-700 text-white" : "text-slate-300"
                  }`}
                >
                  {STATE_LABEL[s]}
                </Link>
              ))}
              <Link
                href={hrefForList(variant, state, mode === "dark" ? "light" : "dark")}
                scroll={false}
                className="flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-medium text-slate-300 active:scale-95 transition-colors"
              >
                {mode === "dark" ? "light" : "dark"}
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-1">
              {ENTRY_VARIANTS.map((ev) => (
                <Link
                  key={ev}
                  href={hrefForEntry(ev, count, banner, mode)}
                  scroll={false}
                  className={`flex min-h-[36px] items-center justify-center rounded-full px-2.5 text-[11px] font-semibold transition-colors active:scale-95 ${
                    ev === entryVariant ? "bg-indigo-600 text-white" : "text-slate-300"
                  }`}
                >
                  {ENTRY_VARIANT_LABEL[ev]}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-1">
              <Link
                href={hrefForEntry(entryVariant, 0, banner, mode)}
                scroll={false}
                className={`flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-medium transition-colors active:scale-95 ${
                  count === 0 ? "bg-slate-700 text-white" : "text-slate-300"
                }`}
              >
                Zero
              </Link>
              <Link
                href={hrefForEntry(entryVariant, 3, banner, mode)}
                scroll={false}
                className={`flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-medium transition-colors active:scale-95 ${
                  count > 0 ? "bg-slate-700 text-white" : "text-slate-300"
                }`}
              >
                3 set aside
              </Link>
              <Link
                href={hrefForEntry(entryVariant, count, !banner, mode)}
                scroll={false}
                className={`flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-medium transition-colors active:scale-95 ${
                  banner ? "bg-rose-700 text-white" : "text-slate-300"
                }`}
              >
                Banner
              </Link>
              <Link
                href={hrefForEntry(entryVariant, count, banner, mode === "dark" ? "light" : "dark")}
                scroll={false}
                className="flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-medium text-slate-300 active:scale-95 transition-colors"
              >
                {mode === "dark" ? "light" : "dark"}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();
  const view: View = params.get("view") === "entry" ? "entry" : "list";

  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as readonly string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";
  const rawState = params.get("state");
  const state: StateKey = (STATES as readonly string[]).includes(rawState ?? "") ? (rawState as StateKey) : "mixed";

  const rawEntry = params.get("entry");
  const entryVariant: EntryVariant = (ENTRY_VARIANTS as readonly string[]).includes(rawEntry ?? "")
    ? (rawEntry as EntryVariant)
    : "a";
  const count = params.get("count") === "0" ? 0 : 3;
  const banner = params.get("banner") === "1";

  const mode: "light" | "dark" = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  const rows = STATE_ROWS[state];

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      {view === "list" ? (
        <>
          {variant === "a" && <VariantA rows={rows} />}
          {variant === "b" && <VariantB rows={rows} />}
          {variant === "c" && <VariantC rows={rows} />}
        </>
      ) : (
        <EntryPointVariants entry={entryVariant} count={count} banner={banner} />
      )}
      <ControlBar
        view={view}
        variant={variant}
        state={state}
        entryVariant={entryVariant}
        count={count}
        banner={banner}
        mode={mode}
      />
    </div>
  );
}

export default function DismissedClient() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
