"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { GrowthRange, InvestmentGrowth } from "@/lib/investmentGrowth";
import PortfolioGrowthCard from "./PortfolioGrowthCard";
import PortfolioGrowthDetail from "./PortfolioGrowthDetail";
import { SheetFrame } from "./SheetFrame";

/** Growth under one investment account's holdings (G271, variant C approved
 *  2026-10-15). Owns the fetch (api.getInvestmentGrowth) and the range; the
 *  card and the drill-in sheet only take props. With fewer than two valuation
 *  points there is nothing to chart, so one quiet line stands in. */
export default function InvestmentGrowthSection({ accountId, hidden }: { accountId: string; hidden: boolean }) {
  const [range, setRange] = useState<GrowthRange>("all");
  const [growth, setGrowth] = useState<InvestmentGrowth | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [hasHistory, setHasHistory] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  const load = useCallback((r: GrowthRange) => {
    const mine = ++seq.current;
    setStatus("loading");
    api.getInvestmentGrowth(accountId, r)
      .then((g) => {
        if (mine !== seq.current) return;
        setGrowth(g);
        // The gate is read from the whole history, so a short range with a
        // single point never swaps the card for the quiet line.
        if (r === "all") setHasHistory(g.points.length >= 2);
        setStatus("ready");
      })
      .catch(() => { if (mine === seq.current) setStatus("error"); });
  }, [accountId]);

  useEffect(() => { load(range); }, [load, range]);

  if (hasHistory === false) {
    return (
      <p className="px-4 pb-3 pt-1 text-[12px] text-slate-600 dark:text-slate-400">
        Growth appears after a day or two of prices.
      </p>
    );
  }

  return (
    <div className="px-4 pb-4 pt-1">
      <PortfolioGrowthCard
        title="Growth"
        growth={growth}
        range={range}
        onRangeChange={setRange}
        status={growth && status === "loading" ? "ready" : status}
        onRetry={() => load(range)}
        onOpen={growth ? () => setOpen(true) : undefined}
        hidden={hidden}
      />
      {open && growth ? (
        <SheetFrame title="Growth and holdings" onClose={() => setOpen(false)}>
          <PortfolioGrowthDetail title="Growth" growth={growth} range={range} onRangeChange={setRange} hidden={hidden} bare />
        </SheetFrame>
      ) : null}
    </div>
  );
}
