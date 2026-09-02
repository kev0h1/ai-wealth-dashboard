"use client";

// TEMPORARY PREVIEW — delete after design review.
// /design/planning-create: three coded variants consolidating Planning's
// three separate creation affordances ("+ Plan a big expense", "+
// Allocation", "+ Plan a one-off") into fewer doors, per the owner's brief:
// "perhaps we can consolidate adding a big expense, an allocation, and a
// one off, perhaps we can use taste skill, impeccable to refine this."
//
// Deep-linkable, same pattern as /design/planning and /design/dismissed:
//   /design/planning-create?variant=a|b|c&mode=light|dark

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";

const VARIANTS = ["a", "b", "c"] as const;
type Variant = (typeof VARIANTS)[number];

const VARIANT_LABEL: Record<Variant, string> = {
  a: "A · one door",
  b: "B · derived",
  c: "C · two doors",
};

function ControlBar({ variant, mode }: { variant: Variant; mode: "light" | "dark" }) {
  const hrefFor = (v: Variant, m: "light" | "dark") => `?variant=${v}&mode=${m}`;
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex flex-col items-center gap-1.5 rounded-2xl border border-white/15 bg-slate-900/90 p-2 shadow-xl max-w-[92vw]">
        <div className="flex gap-1">
          {VARIANTS.map((v) => (
            <Link
              key={v}
              href={hrefFor(v, mode)}
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
          <Link
            href={hrefFor(variant, mode === "dark" ? "light" : "dark")}
            scroll={false}
            className="flex min-h-[32px] items-center justify-center rounded-full px-2.5 text-[10px] font-medium text-slate-300 active:scale-95 transition-colors"
          >
            {mode === "dark" ? "light" : "dark"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as readonly string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";
  const mode: "light" | "dark" = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      {variant === "a" && <VariantA />}
      {variant === "b" && <VariantB />}
      {variant === "c" && <VariantC />}
      <ControlBar variant={variant} mode={mode} />
    </div>
  );
}

export default function PlanningCreateClient() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
