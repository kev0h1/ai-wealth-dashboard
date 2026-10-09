"use client";

// G201 preview sections. Production pieces imported as-is: Toggle,
// ConfirmDialog, SheetFrame, PayPeriodSettingsSheet, YourPlanCard,
// CoverPlanSourcesCard and the real TUTORIAL_FLOWS list. Everything that is
// inline JSX inside SettingsPage.tsx today (notification rows, sign-in rows,
// profile and financial forms, biometric row, data rows, delete screen) is a
// HAND-AUTHORED STAND-IN that copies the production behaviour and copy
// (new labels flagged in the preview note), not an import.
// Static fixtures, no fetches, nothing here saves anything.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Bell, BellOff, LogOut, RotateCcw, ShieldCheck } from "lucide-react";
import Toggle from "@/components/Toggle";
import ConfirmDialog from "@/components/ConfirmDialog";
import PennyMark from "@/components/PennyMark";
import YourPlanCard from "@/components/YourPlanCard";
import CoverPlanSourcesCard from "@/components/CoverPlanSourcesCard";
import { TUTORIAL_FLOWS } from "@/components/TutorialContext";
import type { Account, SubscriptionInfo } from "@/lib/api";
import { CARD, ExternalRow, Group, INK, List, NavRow, SOFT, usePreview } from "./ui";

const FIELD =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";
const BTN_PRIMARY =
  "min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-transform hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-slate-800";
const BTN_QUIET =
  "min-h-11 rounded-xl px-3 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-900/10";
const SEP = "border-t border-slate-100 first:border-t-0 dark:border-slate-700";

function SwitchRow({ label, helper, checked, onChange, lead }: { label: string; helper?: string; checked: boolean; onChange: () => void; lead?: ReactNode }) {
  return (
    <div className={`flex min-h-[52px] items-center gap-3 px-4 py-2 ${SEP}`}>
      {lead}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${INK}`}>{label}</p>
        {helper && <p className={`mt-0.5 text-xs leading-snug ${SOFT}`}>{helper}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function Dot({ children }: { children: ReactNode }) {
  return (
    <p className={`flex items-start gap-1.5 text-xs font-medium ${INK}`} role="status">
      <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
      <span>{children}</span>
    </p>
  );
}

/* ── Display and tips (G189 adds the Tips switch) ── */
export function DisplayBlock() {
  const { mode } = usePreview();
  const [dark, setDark] = useState(mode === "dark");
  const [tips, setTips] = useState(true);
  return (
    <List>
      <SwitchRow label="Dark mode" helper="Easier on the eyes at night." checked={dark} onChange={() => setDark(!dark)} />
      <SwitchRow label="Saving tips" helper="Show saving tips on Spend, Transactions and Home." checked={tips} onChange={() => setTips(!tips)} />
    </List>
  );
}

/* ── Penny setting-things-up consent ── */
export function PennyBlock({ asSwitch = false }: { asSwitch?: boolean }) {
  const [on, setOn] = useState(true);
  const [ask, setAsk] = useState(false);
  const chip = (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
      <PennyMark size={16} />
    </span>
  );
  return (
    <>
      <List>
        {asSwitch ? (
          <SwitchRow lead={chip} label="Penny: setting things up" helper="Penny can set up envelopes and goals. You confirm every change." checked={on} onChange={() => setAsk(true)} />
        ) : (
          <div className="flex items-start gap-3 px-4 py-3.5">
            {chip}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${INK}`}>{on ? "Setting things up is on" : "Setting things up is off"}</p>
              <p className={`mt-0.5 text-xs leading-snug ${SOFT}`}>
                {on
                  ? "Penny can create envelopes, goals and one-off payments when you ask her to. You will always see exactly what would change and confirm before anything happens."
                  : "Penny can only answer questions right now. Ask her to set something up, like an envelope or a goal, and she will offer to turn this on."}
              </p>
            </div>
            {on && (
              <button type="button" onClick={() => setAsk(true)} className={BTN_QUIET}>Turn off</button>
            )}
          </div>
        )}
      </List>
      <ConfirmDialog
        open={ask}
        title={on ? "Turn off setting things up?" : "Turn on setting things up?"}
        message={on
          ? "Penny will stop proposing changes and any proposals you have not confirmed will be cancelled. You can turn it back on from chat at any time."
          : "Penny will be able to propose envelopes, goals and one-off payments. Nothing changes until you confirm it."}
        confirmLabel={on ? "Turn off" : "Turn on"}
        onConfirm={() => { setOn(!on); setAsk(false); }}
        onCancel={() => setAsk(false)}
      />
    </>
  );
}

/* ── Variant C: quick controls in one card on the hub ── */
export function QuickControls() {
  const { mode, model } = usePreview();
  const [dark, setDark] = useState(mode === "dark");
  const [tips, setTips] = useState(true);
  const [penny, setPenny] = useState(true);
  const [ask, setAsk] = useState(false);
  return (
    <>
      <List>
        <SwitchRow label="Dark mode" checked={dark} onChange={() => setDark(!dark)} />
        <SwitchRow label="Saving tips" helper="Show saving tips on Spend, Transactions and Home." checked={tips} onChange={() => setTips(!tips)} />
        <SwitchRow
          lead={<span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"><PennyMark size={16} /></span>}
          label="Penny: setting things up"
          helper="Changes need your confirmation."
          checked={penny}
          onChange={() => setAsk(true)}
        />
        <NavRow page="notifications" label="Notifications" value={model.notifBlocked ? "Blocked" : "On · 5 topics"} dot={model.notifBlocked} />
      </List>
      <ConfirmDialog
        open={ask}
        title={penny ? "Turn off setting things up?" : "Turn on setting things up?"}
        message={penny
          ? "Penny will stop proposing changes and any proposals you have not confirmed will be cancelled. You can turn it back on from chat at any time."
          : "Penny will be able to propose envelopes, goals and one-off payments. Nothing changes until you confirm it."}
        confirmLabel={penny ? "Turn off" : "Turn on"}
        onConfirm={() => { setPenny(!penny); setAsk(false); }}
        onCancel={() => setAsk(false)}
      />
    </>
  );
}

/* ── Notifications ── */
const TOPICS: { key: string; title: string; desc: string; on: boolean }[] = [
  { key: "insights", title: "Tip alerts", desc: "A nudge when we spot a way to save money", on: true },
  { key: "category_pace", title: "Category running hot", desc: "When a category is well above your usual pace", on: true },
  { key: "classification_attention", title: "Payments needing a look", desc: "Unplaced or possibly miscategorised payments", on: true },
  { key: "bill_alerts", title: "Bill alerts", desc: "When an upcoming bill may not clear", on: true },
  { key: "goal_milestones", title: "Goal milestones", desc: "When you reach a savings goal", on: true },
  { key: "period_digest", title: "Pay-period digest", desc: "A fresh-start goals summary each new pay period", on: false },
  { key: "transactions", title: "New transactions", desc: "Each time new transactions arrive", on: false },
];

export function NotificationsBlock() {
  const { model } = usePreview();
  const [topics, setTopics] = useState(Object.fromEntries(TOPICS.map((t) => [t.key, t.on])));
  const [master, setMaster] = useState(true);
  return (
    <>
      <List>
        {model.notifBlocked ? (
          <div className="flex items-start gap-3 px-4 py-3.5">
            <BellOff size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className={`text-sm font-semibold ${INK}`}>Push notifications</p>
              <Dot>Notifications are blocked on this device.</Dot>
              <p className={`text-xs leading-snug ${SOFT}`}>Allow notifications for Sorted in your phone&apos;s Settings app.</p>
            </div>
          </div>
        ) : (
          <>
            <SwitchRow lead={<Bell size={16} aria-hidden="true" className="shrink-0 text-indigo-500" />} label="Push notifications" helper="Allow alerts on this device." checked={master} onChange={() => setMaster(!master)} />
            {model.native && master && (
              <div className={`px-4 py-2 ${SEP}`}>
                <button type="button" className={BTN_QUIET}>Send a test notification</button>
              </div>
            )}
          </>
        )}
      </List>
      <h2 className={`mt-6 text-base font-bold ${INK}`}>Notify me about</h2>
      <p className={`mt-1 text-[13px] leading-5 ${SOFT}`}>
        {model.notifBlocked ? "Your choices are saved and apply once notifications are allowed." : "These choices apply while notifications are on."}
      </p>
      <div className="mt-3">
        <List>
          {TOPICS.map((t) => (
            <SwitchRow key={t.key} label={t.title} helper={t.desc} checked={topics[t.key]} onChange={() => setTopics({ ...topics, [t.key]: !topics[t.key] })} />
          ))}
        </List>
      </div>
    </>
  );
}

/* ── Sign-in methods (D6, D10) ── */
export function SignInBlock() {
  const { model } = usePreview();
  const [unlink, setUnlink] = useState(false);
  const google = model.providers.find((p) => p.id === "google");
  const apple = model.providers.find((p) => p.id === "apple");
  const both = !!google && !!apple;
  return (
    <>
      <List>
        <div className={`flex items-center gap-3 px-4 py-3 ${SEP}`}>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${INK}`}>Google</p>
            <p className={`mt-0.5 truncate text-xs ${SOFT}`}>{google ? google.detail : "Not linked. Linking Google is coming soon."}</p>
          </div>
          {google?.primary && <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">Primary</span>}
        </div>
        <div className={`flex items-center gap-3 px-4 py-3 ${SEP}`}>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${INK}`}>Apple</p>
            <p className={`mt-0.5 text-xs ${SOFT}`}>
              {apple ? apple.detail : "Link Apple from the iPhone app."}
            </p>
            {model.state === "relay" && (
              <p className={`mt-1 text-xs leading-snug ${SOFT}`}>This account was created with Hide My Email. If you already use Sorted with Google, sign in with Google and link your Apple ID there to keep one account.</p>
            )}
          </div>
          {apple?.primary && <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">Primary</span>}
          {both && !apple?.primary && <button type="button" onClick={() => setUnlink(true)} className={BTN_QUIET}>Unlink</button>}
        </div>
      </List>
      <ConfirmDialog
        open={unlink}
        title="Unlink Apple ID?"
        message="You will not be able to sign in with Apple until you link it again."
        confirmLabel="Unlink"
        destructive
        onConfirm={() => setUnlink(false)}
        onCancel={() => setUnlink(false)}
      />
    </>
  );
}

/* ── Profile ── */
export function ProfileBlock() {
  const { model } = usePreview();
  const [name, setName] = useState(model.name);
  const [pc, setPc] = useState(model.state === "empty" ? "" : "B91 2AB");
  const dirty = name !== model.name;
  return (
    <div className={`${CARD} space-y-3 p-4`}>
      <div>
        <label htmlFor="so-name" className={`mb-1 block text-xs font-medium ${SOFT}`}>Full name</label>
        <input id="so-name" className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" autoComplete="name" />
        <p className={`mt-1 text-xs ${SOFT}`}>Used to recognise transfers between your own accounts.</p>
      </div>
      <div>
        <label htmlFor="so-pc" className={`mb-1 block text-xs font-medium ${SOFT}`}>Home postcode</label>
        <input id="so-pc" className={FIELD} value={pc} onChange={(e) => setPc(e.target.value)} placeholder="e.g. B91 2AB" autoComplete="postal-code" />
        <p className={`mt-1 text-xs ${SOFT}`}>Used for local fuel prices.</p>
      </div>
      <button type="button" disabled={!dirty} className={`${BTN_PRIMARY} w-full`}>Save profile</button>
    </div>
  );
}

/* ── Financial profile ── */
export function FinancialBlock({ bare = false }: { bare?: boolean }) {
  const { model } = usePreview();
  const [income, setIncome] = useState(model.hasIncome ? "110000" : "");
  const [pension, setPension] = useState("4000");
  const [cb, setCb] = useState(false);
  const high = Number(income) >= 100000;
  const body = (
    <div className="space-y-4 p-4">
      <div>
        <label htmlFor="so-income" className={`block text-sm font-semibold ${INK}`}>Approximate income (£ a year)</label>
        <p className={`mb-2 mt-0.5 text-xs ${SOFT}`}>Before tax. Used to personalise your tax breakdown.</p>
        <div className="relative w-44">
          <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">£</span>
          <input id="so-income" inputMode="numeric" className={`${FIELD} pl-7 font-mono tabular-nums`} value={income} onChange={(e) => setIncome(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 110000" />
        </div>
      </div>
      {high && (
        <>
          <div>
            <label htmlFor="so-pension" className={`block text-sm font-semibold ${INK}`}>Pension contributions this year (£ a year)</label>
            <p className={`mb-2 mt-0.5 text-xs ${SOFT}`}>Used to work out your adjusted net income.</p>
            <div className="relative w-44">
              <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">£</span>
              <input id="so-pension" inputMode="numeric" className={`${FIELD} pl-7 font-mono tabular-nums`} value={pension} onChange={(e) => setPension(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <div className="-mx-4 border-t border-slate-100 dark:border-slate-700">
            <SwitchRow label="Receiving Child Benefit" helper="The high income charge applies over £60k." checked={cb} onChange={() => setCb(!cb)} />
          </div>
        </>
      )}
      {model.hasIncome && (
        <Link href="/tax" className="-mx-1 flex min-h-11 items-center rounded-xl px-1 text-sm font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">
          View tax breakdown
        </Link>
      )}
    </div>
  );
  return bare ? body : <div className={CARD}>{body}</div>;
}

/* ── Security (native only) ── */
export function SecurityBlock() {
  const [on, setOn] = useState(true);
  return (
    <List>
      <SwitchRow
        lead={<ShieldCheck size={16} aria-hidden="true" className="shrink-0 text-emerald-600 dark:text-emerald-400" />}
        label="Biometric unlock"
        helper="Use Face ID to unlock Sorted."
        checked={on}
        onChange={() => setOn(!on)}
      />
    </List>
  );
}

/* ── Data ── */
export function DataBlock() {
  const { model } = usePreview();
  const [syncing, setSyncing] = useState(false);
  return (
    <List>
      <div className={`px-4 py-3.5 ${SEP}`}>
        <p className={`text-sm font-semibold ${INK}`}>Sync all history</p>
        <p className={`mb-3 mt-0.5 text-xs ${SOFT}`}>
          {model.accounts === 0 ? "Connect an account before syncing history." : "Re-fetch the last 90 days from all connected banks."}
        </p>
        {model.accounts === 0 ? (
          <Link href="/accounts" className={`${BTN_PRIMARY} inline-flex items-center`}>View accounts</Link>
        ) : (
          <button type="button" onClick={() => setSyncing(!syncing)} className={`${BTN_PRIMARY} inline-flex items-center gap-2`}>
            <RotateCcw size={14} aria-hidden="true" className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync history (90 days)"}
          </button>
        )}
      </div>
      <ExternalRow to="/upcoming/dismissed" label="Set aside" helper="Payments and bills excluded from your projections" />
    </List>
  );
}

/* ── Your plan: the production YourPlanCard against a fixture ── */
const PLAN: SubscriptionInfo = {
  tier: "standard",
  status: "active",
  prices_gbp: { statements: 0, lite: 2.99, standard: 5.99, connect: 9.99, max: 14.99 },
  topup: { messages: 100, price_gbp: 2.99 },
  topups: [
    { id: "small", messages: 20, price_gbp: 0.99, badge: null },
    { id: "medium", messages: 100, price_gbp: 2.99, badge: "Most popular" },
  ],
  limits: { open_banking: true, max_banks: null, max_accounts: null, refresh: "daily", penny_messages_per_month: 150, mcp_tool_calls_per_month: null, history_days: null, statement_uploads_per_month: null },
  usage: { year_month: "2026-10", penny_messages: 37, cost_usd: 0, penny_limit: 150, penny_remaining: 113, penny_resets_on: "2026-11-01", penny_topup_messages: 0, penny_topup_expires_soonest: null, penny_packs_bought_this_month: 0 },
} as unknown as SubscriptionInfo;

export function PlanBlock() {
  return <YourPlanCard info={PLAN} />;
}

/* ── Connected assistants: flag-gated (MCP_CONNECTOR), off in production ── */
export function AssistantsBlock() {
  return (
    <>
      <List>
        <div className={`px-4 py-3.5 ${SEP}`}>
          <p className={`text-sm font-semibold ${INK}`}>No assistants connected</p>
          <p className={`mt-0.5 text-xs leading-snug ${SOFT}`}>Assistants you allow to read your Sorted data appear here, with their monthly allowance.</p>
        </div>
        <ExternalRow to="/mcp-activity" label="Assistant activity" helper="See what connected assistants have looked at" />
      </List>
      <p className={`mt-2 text-xs ${SOFT}`}>Shown only when the MCP connector flag is on. It is off in production today, so this row is absent for most users.</p>
    </>
  );
}

/* ── Tours and help ── */
export function ToursBlock() {
  return (
    <List>
      {TUTORIAL_FLOWS.map((f) => (
        <div key={f.id} className={SEP}>
          <button type="button" className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-semibold ${INK}`}>{f.label}</span>
              <span className={`mt-0.5 block text-xs ${SOFT}`}>{f.blurb}</span>
            </span>
          </button>
        </div>
      ))}
    </List>
  );
}

export function LegalBlock() {
  return (
    <List>
      <ExternalRow to="/terms" label="Terms & Conditions" />
      <ExternalRow to="/privacy" label="Privacy Policy" />
    </List>
  );
}

/* ── Cover plan safeguards: placeholder plus the production card for reference ── */
const SEED: [string, string, string, number][] = [
  ["everyday", "Everyday current", "Barclays", 610],
  ["monzo", "Monzo current", "Monzo", 260],
  ["rainy", "Rainy day", "NatWest", 2390],
  ["emergency", "Emergency fund", "Chase", 3400],
  ["holiday", "Holiday pot", "Monzo", 0],
];
const COVER_ACCOUNTS: Account[] = SEED.map(([id, name, provider, balance], i) => ({
  id, name, type: "bank", subtype: i < 2 ? "TRANSACTION" : "SAVINGS", balance, currency: "GBP", provider, status: "connected",
})) as unknown as Account[];

export function CoverPlanBlock() {
  const { model } = usePreview();
  const [excluded, setExcluded] = useState<Set<string>>(new Set(["emergency"]));
  if (model.accounts === 0) {
    return (
      <div className={`${CARD} p-4`}>
        <p className={`text-sm ${INK}`}>Connect an eligible account to manage your safeguards.</p>
        <Link href="/accounts" className={`${BTN_PRIMARY} mt-3 inline-flex items-center`}>View accounts</Link>
      </div>
    );
  }
  return (
    <>
      <div className="rounded-2xl border border-dashed border-slate-400 p-4 dark:border-slate-500">
        <p className={`text-sm font-semibold ${INK}`}>Design round placeholder</p>
        <p className={`mt-1 text-xs leading-5 ${SOFT}`}>
          This page is reserved for the safeguards card that G200 is redesigning. The hub row, back control and page frame are what this round decides. See G200&apos;s own preview for the card itself.
        </p>
        <p className={`mt-2 flex flex-wrap items-center gap-x-2 text-sm ${INK}`}>
          <Link href="/design/cover-plan-safeguards" className="inline-flex min-h-11 items-center font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
            Open the G200 preview
          </Link>
          <span className={`text-xs ${SOFT}`}>(available once G200&apos;s round is on UAT)</span>
          <Link href="/design/cover-plan-sources-scale" className="inline-flex min-h-11 items-center text-xs font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
            or the earlier cover plan preview
          </Link>
        </p>
      </div>
      <p className={`mt-6 text-xs font-semibold uppercase tracking-wide ${SOFT}`}>For reference: the card as it ships today</p>
      <div className="mt-2">
        <CoverPlanSourcesCard
          accounts={COVER_ACCOUNTS}
          excludedIds={excluded}
          onToggle={(id) => { const n = new Set(excluded); if (n.has(id)) n.delete(id); else n.add(id); setExcluded(n); }}
        />
      </div>
    </>
  );
}

/* ── Exits: sign out, then delete on its own screen ── */
export function Exits() {
  const { href } = usePreview();
  return (
    <div className="mt-10 border-t border-slate-300/80 pt-2 dark:border-slate-700">
      <button type="button" className="flex min-h-12 w-full items-center gap-3 rounded-xl px-1 text-left text-sm font-semibold text-slate-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100">
        <LogOut size={16} aria-hidden="true" />
        Sign out
      </button>
      <div className="mt-6 border-t border-slate-200 pt-2 dark:border-slate-700">
        <Link href={href("delete")} className="flex min-h-12 w-full items-center rounded-xl px-1 text-sm font-medium text-slate-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300">
          Delete account and all data
        </Link>
      </div>
    </div>
  );
}

/* ── Delete screen: its own page. Red is allowed here, on the one real button. ── */
export function DeleteScreen() {
  const [typed, setTyped] = useState("");
  return (
    <>
      <Group title="What this erases" intro="This is permanent and cannot be undone.">
        <ul className={`list-disc space-y-1 pl-5 text-sm ${INK}`}>
          <li>Bank connections and all transactions</li>
          <li>Budgets, plans and goals</li>
          <li>Insights and chat history with Penny</li>
        </ul>
      </Group>
      <Group title="Confirm" intro="Type DELETE to confirm.">
        <label htmlFor="so-delete" className="sr-only">Type DELETE to confirm</label>
        <input id="so-delete" className={FIELD} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoCapitalize="characters" />
        <button
          type="button"
          disabled={typed !== "DELETE"}
          className="mt-3 min-h-11 w-full rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-40 dark:focus-visible:ring-offset-slate-900"
        >
          Delete my account
        </button>
      </Group>
    </>
  );
}
