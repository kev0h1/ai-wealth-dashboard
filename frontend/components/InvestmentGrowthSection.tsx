"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { type GrowthRange, type InvestmentGrowth } from "@/lib/investmentGrowth";
import PortfolioGrowthCard from "./PortfolioGrowthCard";
import PortfolioGrowthDetail from "./PortfolioGrowthDetail";
import { SheetFrame } from "./SheetFrame";
import AnchorSheet from "./portfolio-growth/AnchorSheet";

/** Growth under one investment account's holdings (G271, variant C approved
 *  2026-10-15; G278). Owns the fetch (api.getInvestmentGrowth), the range and
 *  the Anchor from your provider sheet; the card and the drill-in sheet only
 *  take props. The card shows whenever the account has a value, leading with
 *  Value and then the lifetime figure from the anchor, or the entry point to
 *  set one. */
export default function InvestmentGrowthSection({ accountId, hidden, onShownChange }: { accountId: string; hidden: boolean; onShownChange?: (shown: boolean) => void }) {
  const [range, setRange] = useState<GrowthRange>("all");
  const [growth, setGrowth] = useState<InvestmentGrowth | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [valueKnown, setValueKnown] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [anchoring, setAnchoring] = useState(false);
  const seq = useRef(0);

  const load = useCallback((r: GrowthRange) => {
    const mine = ++seq.current;
    setStatus("loading");
    api.getInvestmentGrowth(accountId, r)
      .then((g) => {
        if (mine !== seq.current) return;
        setGrowth(g);
        setValueKnown(g.value !== null);
        setStatus("ready");
      })
      .catch(() => { if (mine === seq.current) setStatus("error"); });
  }, [accountId]);

  useEffect(() => { load(range); }, [load, range]);

  // The card carries the end-of-day risk line, so the host can drop its own copy.
  const shownCb = useRef(onShownChange);
  shownCb.current = onShownChange;
  useEffect(() => {
    shownCb.current?.(valueKnown === true);
  }, [valueKnown]);
  useEffect(() => () => shownCb.current?.(false), []);

  const toggleProviderValue = (on: boolean) => {
    api.setInvestmentAnchorOverride(accountId, on).then(() => load(range)).catch(() => {});
  };
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

  return (
    <div className="px-4 pb-4 pt-1">
      <PortfolioGrowthCard
        title="Value"
        growth={growth}
        range={range}
        onRangeChange={setRange}
        status={growth && status === "loading" ? "ready" : status}
        onRetry={() => load(range)}
        onOpen={growth ? () => setOpen(true) : undefined}
        onAnchor={() => setAnchoring(true)}
        onOverride={toggleProviderValue}
        hidden={hidden}
      />
      {open && growth ? (
        <SheetFrame title="Growth and holdings" onClose={() => setOpen(false)}>
          <PortfolioGrowthDetail title="Value" growth={growth} range={range} onRangeChange={setRange} hidden={hidden} bare onAnchor={() => setAnchoring(true)} onOverride={toggleProviderValue} />
        </SheetFrame>
      ) : null}
      {anchoring ? (
        <AnchorSheet
          accountId={accountId}
          provider={growth?.provider}
          anchor={growth?.anchor ?? null}
          todayIso={todayIso}
          hidden={hidden}
          onClose={() => setAnchoring(false)}
          onSaved={() => { setAnchoring(false); load(range); }}
        />
      ) : null}
    </div>
  );
}
