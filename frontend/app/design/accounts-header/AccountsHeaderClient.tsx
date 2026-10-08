"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import AccountsHeaderPreview, { VARIANTS, type Variant } from "./AccountsHeaderPreview";
import { COUNTS, type AccountsCount } from "./fixtures";

type Mode = "light" | "dark";

export default function AccountsHeaderClient() {
  const params = useSearchParams();
  const raw = params.get("variant");
  const variant: Variant = raw === "a" || raw === "b" || raw === "c" ? raw : "today";
  const count: AccountsCount = (params.get("accounts") ?? params.get("state")) === "20" ? "20" : "6";
  const hidden = params.get("balances") === "hidden";
  const menuOpen = params.get("menu") === "open";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, [mode]);

  const q = (n: Partial<{ variant: Variant; accounts: AccountsCount; balances: string; mode: Mode }>) =>
    `?variant=${n.variant ?? variant}&accounts=${n.accounts ?? count}&balances=${n.balances ?? (hidden ? "hidden" : "shown")}&mode=${n.mode ?? mode}`;
  const chip = (on: boolean) => `inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 ${on ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`;
  const sep = <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />;

  const chrome = (
    <nav aria-label="G236 preview controls" className="border-b border-white/10 bg-slate-950 px-2 py-1 text-white">
      <div className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-x-1">
        {VARIANTS.map((v) => (
          <a key={v.id} href={q({ variant: v.id })} aria-current={v.id === variant ? "page" : undefined} className={chip(v.id === variant)}>{v.label}</a>
        ))}
        {sep}
        {COUNTS.map((c) => (
          <a key={c.id} href={q({ accounts: c.id })} aria-label={c.label} aria-current={c.id === count ? "page" : undefined} className={chip(c.id === count)}>{c.id}</a>
        ))}
        {sep}
        <a href={q({ balances: hidden ? "shown" : "hidden" })} className={chip(false)}>{hidden ? "Shown" : "Hidden"}</a>
        <a href={q({ mode: mode === "dark" ? "light" : "dark" })} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
      </div>
    </nav>
  );

  // key remounts the preview when the URL state changes so local state reseeds.
  return <AccountsHeaderPreview key={`${variant}-${count}-${hidden}-${menuOpen}`} variant={variant} count={count} hidden={hidden} menuOpen={menuOpen} chrome={chrome} />;
}
