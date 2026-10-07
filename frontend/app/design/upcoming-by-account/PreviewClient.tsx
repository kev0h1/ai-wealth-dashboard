"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Moon, Sun } from "lucide-react";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import { FIXTURES, fixtureFor, PERIOD, type FixtureId } from "./fixtures";

const focus = "touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const muted = "text-slate-600 dark:text-slate-400";

function Preview({ fixtureId, mode }: { fixtureId: FixtureId; mode: "light" | "dark" }) {
  const fixture = useMemo(() => fixtureFor(fixtureId), [fixtureId]);
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const prior = root.style.colorScheme;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
    return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = prior; };
  }, [mode]);
  const query = (change: { fixture?: FixtureId; mode?: "light" | "dark" }) => `?fixture=${change.fixture ?? fixtureId}&mode=${change.mode ?? mode}`;
  return (
    <div className="min-h-dvh bg-[#f0f2f7] text-slate-950 dark:bg-slate-900 dark:text-slate-50">
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto max-w-xl px-3 py-3 min-[360px]:px-4">
          <div className="flex items-center justify-between gap-4">
            <Link href="/design" className={`flex min-h-11 items-center gap-2 rounded-lg text-sm ${muted} ${focus}`}><ArrowLeft size={16} aria-hidden="true" />Design rounds</Link>
            <Link href={query({ mode: mode === "dark" ? "light" : "dark" })} aria-label={`Use ${mode === "dark" ? "light" : "dark"} theme`} className={`flex size-11 items-center justify-center rounded-xl ${focus}`}>{mode === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</Link>
          </div>
          <h1 className="mt-1 text-balance text-xl font-bold">G229 · By account, attention first</h1>
          <p className={`mt-2 text-sm leading-6 ${muted}`}>The production card, with invented accounts. Accounts that need attention lead; the rest fold behind one row. Tap the row to expand.</p>
          <nav aria-label="Fixtures" className="mt-3 grid grid-cols-2 gap-2">
            {FIXTURES.map((item) => <Link key={item.id} href={query({ fixture: item.id })} aria-current={fixtureId === item.id ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-lg border px-2 py-2 text-center text-xs ${focus} ${fixtureId === item.id ? "border-indigo-500 text-indigo-700 dark:text-indigo-300" : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}>{item.label}</Link>)}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-3 py-6 pb-28 min-[360px]:px-4">
        <UpcomingAccountsCard accounts={fixture.accounts} plans={fixture.plans} plansStatus={fixture.plansStatus} periodLabel={PERIOD} onOpen={(account) => setOpened(account.id)} />
        <p role="status" className={`mt-4 min-h-6 text-xs ${muted}`}>{opened ? "Tapping a row opens the account working on the real page. Nothing opens in this preview." : ""}</p>
      </main>
    </div>
  );
}

export default function PreviewClient() {
  const params = useSearchParams();
  const fixtureId = (FIXTURES.find((item) => item.id === params.get("fixture"))?.id ?? "long") as FixtureId;
  const mode = params.get("mode") === "light" ? "light" : "dark";
  return <Preview fixtureId={fixtureId} mode={mode} />;
}
