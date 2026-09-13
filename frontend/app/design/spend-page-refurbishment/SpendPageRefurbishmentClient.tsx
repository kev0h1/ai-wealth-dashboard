"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import type { PreviewMode, PreviewVariant } from "./shared";

const variants: readonly { key: PreviewVariant; label: string; rolled?: boolean }[] = [
  { key: "a", label: "A · Journey", rolled: true },
  { key: "b", label: "B · Next decision" },
  { key: "c", label: "C · Category field" },
];

function PreviewControls({ variant, mode }: { variant: PreviewVariant; mode: PreviewMode }) {
  return (
    <nav
      aria-label="G57 Spend revamp variants"
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-white/10 bg-slate-950/95 px-3 py-2 text-white shadow-xl"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="mx-auto flex w-full max-w-5xl items-center gap-1 overflow-x-auto">
        {variants.map((item) => (
          <a
            key={item.key}
            href={`?variant=${item.key}&mode=${mode}`}
            aria-current={variant === item.key ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[12px] font-semibold transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${variant === item.key ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}
          >
            {item.label}
            {item.rolled && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${variant === item.key ? "bg-indigo-100 text-indigo-700" : "bg-white/10 text-slate-300"}`}>The roll</span>}
          </a>
        ))}
        <a
          href={`?variant=${variant}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="ml-auto flex min-h-11 shrink-0 items-center rounded-xl px-3 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function SpendPageRefurbishmentClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: PreviewVariant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const mode: PreviewMode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] text-slate-950 dark:bg-[#0f172a] dark:text-slate-100">
        <p className="sr-only">Illustrative figures, not real balances. G57 Spend revamp, variant {variant.toUpperCase()}.</p>
        {variant === "a" && <VariantA />}
        {variant === "b" && <VariantB />}
        {variant === "c" && <VariantC />}
      </div>
      <PreviewControls variant={variant} mode={mode} />
    </div>
  );
}
