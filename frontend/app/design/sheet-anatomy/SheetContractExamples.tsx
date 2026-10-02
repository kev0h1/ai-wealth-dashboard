"use client";

import { useState } from "react";
import { SheetFrame } from "@/components/SheetFrame";
import UpcomingFlowSheet, { UpcomingFlowFooter, useFlowSubmission } from "@/components/UpcomingFlowSheet";
import PayPeriodSettingsSheet from "@/components/PayPeriodSettingsSheet";
import type { PayPeriodConfig } from "@/lib/payPeriod";

const action = "min-h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white active:scale-95";

function LocalEditor({ done }: { done: () => void }) {
  const setSubmission = useFlowSubmission();
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setSubmission(true);
    await new Promise(resolve => setTimeout(resolve, 700));
    setSubmission(false); setBusy(false); done();
  }
  return <>
    <label className="block text-sm">Example name<input name="example_name" className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 p-3 dark:border-slate-600" defaultValue="Local example" /></label>
    <p className="mt-4 text-sm">This example never sends a request.</p>
    <UpcomingFlowFooter><button type="button" disabled={busy} className={`${action} w-full disabled:opacity-50`} onClick={save}>{busy ? "Saving…" : "Save example"}</button></UpcomingFlowFooter>
  </>;
}

/** Additional auth-free contract checks, exposed only by ?state=contract.
 * They exercise the real frame and flow controller without account writes. */
export default function SheetContractExamples() {
  const [open, setOpen] = useState<"nested" | "replacement" | "flow" | "period" | null>(null);
  const [inner, setInner] = useState(false);
  const [period, setPeriod] = useState<PayPeriodConfig>({ type: "calendar_month" });
  const [result, setResult] = useState("");
  return <section className="mt-6 space-y-3">
    <h2 className="text-base font-bold">Shared sheet checks</h2>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={action} onClick={() => setOpen("nested")}>Open nested example</button>
      <button type="button" className={action} onClick={() => setOpen("flow")}>Open details flow</button>
      <button type="button" className={action} onClick={() => setOpen("period")}>Open pay period</button>
    </div>
    <p role="status">{result}</p>
    {open === "nested" && <SheetFrame title="Outer example" onClose={() => setOpen(null)} footer={({ close, closeThen }) => <div className="flex gap-2"><button type="button" className={action} onClick={close}>Done outer</button><button type="button" className={action} onClick={() => closeThen(() => setOpen("replacement"))}>Replace example</button></div>}>
      <button type="button" className={action} onClick={() => setInner(true)}>Open inner example</button>
      {Array.from({ length: 24 }, (_, index) => <p key={index} className="py-3 text-sm">Example row {index + 1}</p>)}
      {inner && <SheetFrame title="Inner example" onClose={() => setInner(false)} footer={({ close }) => <button type="button" className={action} onClick={close}>Done inner</button>}><p className="text-sm">Back or Escape closes just this sheet.</p></SheetFrame>}
    </SheetFrame>}
    {open === "replacement" && <SheetFrame title="Replacement example" onClose={() => setOpen(null)}><p className="text-sm">The previous sheet has closed.</p></SheetFrame>}
    {open === "period" && <PayPeriodSettingsSheet current={period} onClose={() => setOpen(null)} onSave={value => { setPeriod(value); setResult(`Example period saved: ${value.type}`); setOpen(null); }} />}
    {open === "flow" && <UpcomingFlowSheet initialView={"detail" as "detail" | "edit"} onClose={() => setOpen(null)} renderView={(view, navigation) => view === "detail" ? {
      title: "Example details", body: <p className="text-sm">Your place in this sheet is kept when returning from edit.</p>,
      footer: <button type="button" className={`${action} w-full`} onClick={() => navigation.goTo("edit")}>Edit example</button>,
    } : { title: "Edit example", body: <LocalEditor done={() => { setResult("Example saved"); navigation.back(); }} /> }} />}
  </section>;
}
