"use client";

// G272 design round: the Upload Investment Statement sheet with a step graphic
// and a file privacy note. Renders the PRODUCTION components/InvestmentUpload
// through its `explainer` prop, with components/InvestmentFlow as the graphic.
// No requests are made until a file is chosen and Import is tapped.
// /design/statement-flow?variant=a|b&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import InvestmentUpload from "@/components/InvestmentUpload";
import InvestmentFlow from "@/components/InvestmentFlow";

const noop = () => {};

export default function StatementFlowClient() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const dark = params.get("mode") === "dark";

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (root.classList.contains("dark") !== dark) root.classList.toggle("dark", dark);
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
    return () => obs.disconnect();
  }, [dark]);

  return (
    <main className="min-h-screen bg-white dark:bg-slate-900">
      <InvestmentUpload
        onSuccess={noop}
        onClose={noop}
        explainer={<InvestmentFlow variant={variant === "a" ? "list" : "strip"} />}
      />
    </main>
  );
}
