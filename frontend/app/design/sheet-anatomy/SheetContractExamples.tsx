"use client";

import { useMemo, useRef, useState } from "react";
import { SheetFrame } from "@/components/SheetFrame";
import UpcomingFlowSheet, { UpcomingFlowFooter, useFlowSubmission } from "@/components/UpcomingFlowSheet";
import PayPeriodSettingsSheet from "@/components/PayPeriodSettingsSheet";
import type { PayPeriodConfig } from "@/lib/payPeriod";
import { stampAccountDetailState } from "@/lib/accountSheetHistory";
import { useAccountDetailHistory } from "@/lib/useAccountDetailHistory";
import CommitmentSheet, { type CommitmentSheetOperations } from "@/components/CommitmentSheet";
import type { Account, Commitment, CommitmentPreview } from "@/lib/api";

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

/** A no-network account-detail harness that uses the production popstate
 * hook and the real SheetFrame nesting contract. */
function AccountHistoryContract({ onResult }: { onResult: (message: string) => void }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  useAccountDetailHistory(setAccountId, () => setEditorOpen(false));
  const openAccount = () => {
    history.pushState(stampAccountDetailState(history.state, "fixture-account"), "");
    setAccountId("fixture-account");
  };
  return <>
    <button type="button" className={action} onClick={openAccount}>Open account-history example</button>
    {accountId && <div className="rounded-xl border border-slate-300 p-3 dark:border-slate-600">
      <p className="text-sm">Account detail stays open when its editor closes.</p>
      <button type="button" className={`${action} mt-3`} onClick={() => setEditorOpen(true)}>Open account editor</button>
      {editorOpen && <SheetFrame title="Account editor" onClose={() => { setEditorOpen(false); onResult("Account editor closed; account detail remained open."); }}>
        <p className="text-sm">Close this editor with the cross, Escape or browser Back.</p>
      </SheetFrame>}
    </div>}
  </>;
}

const FIXTURE_ACCOUNT: Account = {
  id: "fixture-saver", provider: "Example Bank", name: "Fixture saver", balance: 300,
  account_type: "SAVINGS", subtype: "SAVINGS", manual: false,
};
const CONSENT_PREVIEW: CommitmentPreview = {
  per_period_slice: 50, periods_left: 6, feasibility: "stretch",
  feasibility_note: "This leaves your card plan short this period.", feasibility_tone: "caution",
  pots_detail: [],
  consent: {
    required: true, title: "This may squeeze your card plan",
    lines: ["Your planned card payment comes first. You can still save this goal if that is your choice."],
    actions: { anyway: "Save despite card plan", later_date: "Choose a later date", debt_first: "Review card plan" },
  },
};

function nextFixtureMonth() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function ConsentContract({ onResult }: { onResult: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const attempts = useRef(0);
  const operations = useMemo<CommitmentSheetOperations>(() => ({
    accounts: async () => [FIXTURE_ACCOUNT],
    previewCommitment: async () => CONSENT_PREVIEW,
    createCommitment: async body => {
      attempts.current += 1;
      if (attempts.current === 1) throw new Error("Fixture first-save failure");
      const saved: Commitment = {
        id: "fixture-commitment", name: body.name, amount: body.amount, target_date: body.target_date,
        funding_pots: body.funding_pots, funding_account_id: null, funding_account_name: null,
        source: body.source, status: "active", progress: 0, remaining: body.amount,
        periods_left: 6, per_period_slice: 50, on_track: false, shared_pot_goals: [],
      };
      return saved;
    },
    updateCommitment: async () => { throw new Error("Fixture only opens create consent"); },
    cancelCommitment: async () => {},
  }), []);
  return <>
    <button type="button" className={action} onClick={() => { attempts.current = 0; setOpen(true); }}>Open consent regression</button>
    {open && <CommitmentSheet accounts={[FIXTURE_ACCOUNT]} prefill={{ name: "Fixture holiday", amount: 300, target_date: nextFixtureMonth() }}
      operations={operations} onClose={() => { setOpen(false); onResult("Consent sheet closed with its draft preserved until dismissal."); }}
      onSaved={() => onResult("Consent fixture saved after the first failure.")} />}
  </>;
}

/** Additional auth-free contract checks, exposed only by ?state=contract.
 * They exercise the real frame and flow controller without account writes. */
export default function SheetContractExamples() {
  const [open, setOpen] = useState<"nested" | "replacement" | "flow" | "footer-flow" | "period" | null>(null);
  const [inner, setInner] = useState(false);
  const [period, setPeriod] = useState<PayPeriodConfig>({ type: "calendar_month" });
  const [result, setResult] = useState("");
  return <section className="mt-6 space-y-3">
    <h2 className="text-base font-bold">Shared sheet checks</h2>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={action} onClick={() => setOpen("nested")}>Open nested example</button>
      <button type="button" className={action} onClick={() => setOpen("flow")}>Open details flow</button>
      <button type="button" className={action} onClick={() => setOpen("footer-flow")}>Open footer lifecycle</button>
      <button type="button" className={action} onClick={() => setOpen("period")}>Open pay period</button>
    </div>
    <AccountHistoryContract onResult={setResult} />
    <ConsentContract onResult={setResult} />
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
    {open === "footer-flow" && <UpcomingFlowSheet initialView={"detail" as "detail" | "edit"} onClose={() => setOpen(null)} renderView={(view, navigation) => view === "detail" ? {
      title: "Footerless details", body: <button type="button" className={action} onClick={() => navigation.goTo("edit")}>Edit with footer actions</button>,
    } : { title: "Editor with footer actions", body: <LocalEditor done={() => { setResult("Footer lifecycle editor saved"); navigation.back(); }} /> }} />}
  </section>;
}
