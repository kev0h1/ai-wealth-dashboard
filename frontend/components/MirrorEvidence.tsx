"use client";

import { useEffect, useId, useState } from "react";
import { DisclosureChevron } from "@/components/Disclosure";
import { api, type AimEvidence, type MirrorPaymentRecords, type MirrorTrait } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { mirrorDate, mirrorMoney, mirrorText, periodLabel } from "@/lib/mirrorFeedback";

const quiet = "text-[13px] leading-relaxed text-slate-600 dark:text-slate-300";
const action = "inline-flex min-h-11 items-center gap-2 rounded-lg text-[13px] font-semibold text-indigo-700 hover:text-indigo-800 active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 dark:text-indigo-300 dark:hover:text-indigo-200 motion-reduce:transition-none";
const row = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-t border-slate-200 py-3 text-[13px] dark:border-slate-700";

function RecordRows({ records, masked }: { records: { id: string; name: string; date: string; amount: number }[]; masked: boolean }) {
  return <dl>{records.map(record => <div className={row} key={record.id}>
    <dt className="min-w-0 break-words"><span className={quiet}>{mirrorDate(record.date)}</span><br /><MoneyText text={mirrorText(record.name, masked)} /></dt>
    <dd className="whitespace-nowrap font-medium"><MoneyText text={mirrorMoney(record.amount, masked)} /></dd>
  </div>)}</dl>;
}

export default function MirrorEvidence({ trait, checkpointId, masked, computedAt }: {
  trait: MirrorTrait;
  checkpointId: string | null;
  masked: boolean;
  computedAt: string;
}) {
  const [evidence, setEvidence] = useState<AimEvidence | null>(null);
  const [loading, setLoading] = useState(!!checkpointId);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [weeksOpen, setWeeksOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [payments, setPayments] = useState<MirrorPaymentRecords | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState(false);
  const [paymentsRevision, setPaymentsRevision] = useState(0);
  const weeksId = useId();
  const recordsId = useId();

  useEffect(() => {
    let cancelled = false;
    if (checkpointId) api.checkpointEvidence(checkpointId)
      .then(data => { if (!cancelled) setEvidence(data); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [checkpointId, revision]);

  useEffect(() => {
    if (!recordsOpen) return;
    let cancelled = false;
    api.mirrorPaymentRecords()
      .then(data => { if (!cancelled) setPayments(data); })
      .catch(() => { if (!cancelled) setPaymentsError(true); })
      .finally(() => { if (!cancelled) setPaymentsLoading(false); });
    return () => { cancelled = true; };
  }, [recordsOpen, paymentsRevision]);

  return <section className="min-w-0 space-y-4" aria-label="Transaction evidence">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">The evidence behind it</h2>
      {loading ? <p role="status" className={`${quiet} mt-3`}>Loading the transactions for this check…</p> : error ? <div className="mt-3">
        <p role="alert" className={quiet}>The transactions could not be loaded. No result has been estimated.</p>
        <button type="button" className={`${action} mt-1`} onClick={() => { setLoading(true); setError(false); setRevision(n => n + 1); }}>Try loading the evidence again</button>
      </div> : evidence ? <>
        <p className="mt-4 break-words text-sm font-semibold"><MoneyText text={mirrorText(evidence.ref, masked)} /></p>
        <p className={quiet}>{periodLabel(evidence.period_start, evidence.period_end)}</p>
        <p className={`${quiet} mt-2`}>Spending less refunds. The named records and grouped remainder add up to the total shown.</p>
        {evidence.changed_since_result && <p className={`${quiet} mt-3`} role="status">
          Transactions have changed since the completed check. Its recorded result is <MoneyText text={mirrorMoney(evidence.recorded_result ?? 0, masked)} />; the records below show the total now. The original result has not been rewritten.
        </p>}
        <dl className="mt-3">
          {evidence.transactions.map(record => <div className={row} key={record.id}>
            <dt className="min-w-0 break-words"><span className={quiet}>{mirrorDate(record.date)}{record.amount < 0 ? " · Refund" : ""}</span><br /><MoneyText text={mirrorText(record.name, masked)} /></dt>
            <dd className="whitespace-nowrap font-medium"><MoneyText text={mirrorMoney(record.amount, masked)} /></dd>
          </div>)}
          {(evidence.remainder_count > 0 || evidence.remainder_amount !== 0) && <div className={row}><dt>{evidence.remainder_count > 0 ? `Other ${evidence.remainder_count} ${evidence.remainder_count === 1 ? "record" : "records"}` : "Rounding adjustment"}</dt><dd className="whitespace-nowrap"><MoneyText text={mirrorMoney(evidence.remainder_amount, masked)} /></dd></div>}
          <div className={`${row} font-semibold`}><dt>Total shown</dt><dd className="whitespace-nowrap"><MoneyText text={mirrorMoney(evidence.total, masked)} /></dd></div>
        </dl>
        {!evidence.transactions.length && evidence.remainder_count === 0 && <p className={quiet}>No spending or refunds are recorded in this category for this period.</p>}
        <p className={quiet}>Checked {mirrorDate(evidence.checked_at)}. New or corrected bank records can change the total.</p>
        {evidence.weekly_counts.length > 0 && <div className="mt-4 border-t border-slate-200 pt-1 dark:border-slate-700">
          <button type="button" className={`${action} w-full justify-between text-left`} aria-expanded={weeksOpen} aria-controls={weeksId} onClick={() => setWeeksOpen(open => !open)}>
            Recent payment counts<DisclosureChevron open={weeksOpen} />
          </button>
          <div id={weeksId} hidden={!weeksOpen}>
            <p className={quiet}>Four completed seven-day windows, separate from the pay-period total. Counts show spending records, not why a pattern changed.</p>
            <dl className="mt-2">{evidence.weekly_counts.map(week => <div className={row} key={week.period_start}><dt>{periodLabel(week.period_start, week.period_end)}</dt><dd className="whitespace-nowrap tabular-nums">{week.count} {week.count === 1 ? "payment" : "payments"}</dd></div>)}</dl>
          </div>
        </div>}
      </> : <div className="mt-3 space-y-2">
        <p className={quiet}>Portrait checked {mirrorDate(computedAt)}. These are the recorded observations, not a completed aim result.</p>
        {trait.evidence.map((text, index) => <p key={index} className={quiet}><MoneyText text={mirrorText(text, masked)} /></p>)}
      </div>}
      {trait.id === "hygiene" && <div className="mt-4 border-t border-slate-200 pt-1 dark:border-slate-700">
        <button type="button" className={`${action} w-full justify-between text-left`} aria-expanded={recordsOpen} aria-controls={recordsId} onClick={() => { if (!recordsOpen) { setPaymentsLoading(true); setPaymentsError(false); } setRecordsOpen(open => !open); }}>
          Payment-related records<DisclosureChevron open={recordsOpen} />
        </button>
        <div id={recordsId} hidden={!recordsOpen}>
          <p className={quiet}>Recent connected-bank descriptions containing words such as “returned”, “unpaid” or “late fee”. A matching description alone does not prove a missed payment. These records are separate from the portrait observation above.</p>
          {paymentsLoading ? <p role="status" className={`${quiet} mt-3`}>Loading payment-related records…</p> : paymentsError ? <>
            <p role="alert" className={`${quiet} mt-3`}>The records could not be loaded. No missed payment has been inferred.</p>
            <button type="button" className={action} onClick={() => { setPaymentsLoading(true); setPaymentsError(false); setPaymentsRevision(n => n + 1); }}>Try loading these records again</button>
          </> : payments && <>
            <p className={`${quiet} mt-3`}>{periodLabel(payments.window_start, payments.window_end)}. Up to six latest matching records; not a full payment history.</p>
            {payments.records.length ? <RecordRows records={payments.records} masked={masked} /> : <p className={`${quiet} mt-3`}>No matching descriptions were found in this window. That does not confirm every payment was made.</p>}
          </>}
        </div>
      </div>}
    </section>
  </section>;
}
