"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { hasKnownCost, NO_COST_LINE, type GrowthRange, type InvestmentGrowth } from "@/lib/investmentGrowth";
import PortfolioGrowthCard from "./PortfolioGrowthCard";
import PortfolioGrowthDetail from "./PortfolioGrowthDetail";
import { SheetFrame } from "./SheetFrame";

/** Growth under one investment account's holdings (G271, variant C approved
 *  2026-10-15). Owns the fetch (api.getInvestmentGrowth) and the range; the
 *  card and the drill-in sheet only take props. G277: the card shows at once
 *  when any holding has a known cost (value minus cost needs no history); the
 *  chart inside it waits for two points. With no known cost one quiet line
 *  stands in. */
export default function InvestmentGrowthSection({ accountId, hidden, onShownChange }: { accountId: string; hidden: boolean; onShownChange?: (shown: boolean) => void }) {
  const [range, setRange] = useState<GrowthRange>("all");
  const [growth, setGrowth] = useState<InvestmentGrowth | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [costKnown, setCostKnown] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  const load = useCallback((r: GrowthRange) => {
    const mine = ++seq.current;
    setStatus("loading");
    api.getInvestmentGrowth(accountId, r)
      .then((g) => {
        if (mine !== seq.current) return;
        setGrowth(g);
        // Cost is a property of the holdings, not of the range.
        setCostKnown(hasKnownCost(g));
        setStatus("ready");
      })
      .catch(() => { if (mine === seq.current) setStatus("error"); });
  }, [accountId]);

  useEffect(() => { load(range); }, [load, range]);

  // The card carries the end-of-day risk line, so the host can drop its own copy.
  const shownCb = useRef(onShownChange);
  shownCb.current = onShownChange;
  useEffect(() => {
    shownCb.current?.(costKnown === true);
  }, [costKnown]);
  useEffect(() => () => shownCb.current?.(false), []);

  if (costKnown === false) {
    return (
      <p className="px-4 pb-3 pt-1 text-[12px] text-slate-600 dark:text-slate-400">
        {NO_COST_LINE}
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
