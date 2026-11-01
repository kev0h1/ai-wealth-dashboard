"use client";

// E12: the owner's People page. Gated like /ops/go-live: the normal
// AuthProvider plus a server-side owner-session check on every /ops/people
// route in backend/app/routers/ops_people.py (403 for anyone else, including
// bot credentials and scoped tokens). It joins the allow list with who has
// signed up and what they hold; invite, revoke, restore and remove all write
// an audit entry shown at the bottom. No money is shown, so Hide balances
// does not apply. Red is used once: the destructive button of the remove
// confirmation. Errors are ink text with an amber dot.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError, type OpsAuditEntry, type OpsPerson } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useSheetA11y } from "@/lib/useSheetA11y";
import SubscriptionSection from "./SubscriptionSection";
import {
  ACTION_LABELS,
  accessAction,
  backfillBanner,
  backfillConfirmed,
  backfillMessage,
  FILTERS,
  WORDING,
  counts,
  emailMatches,
  filterPeople,
  formatDate,
  formatDateTime,
  planLabel,
  removeMessage,
  revokeMessage,
  sortPeople,
  sourceLabel,
  statusLabel,
  type PeopleFilter,
} from "./people";

const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const INPUT =
  "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100";
const QUIET_BTN =
  "min-h-11 shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:text-slate-200 dark:hover:bg-slate-700";

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-start gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
      <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
      <span>{text}</span>
    </p>
  );
}

function AccessChip({ person }: { person: OpsPerson }) {
  const tone =
    person.access === "allowed" || person.access === "owner"
      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200"
      : "border border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300";
  return (
    <span data-access={person.access} className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      {statusLabel(person)}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className={LABEL}>{label}</p>
      <p className="mt-0.5 truncate text-sm text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}

function RemoveSheet({
  person,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  person: OpsPerson;
  busy: boolean;
  error: string | null;
  onConfirm: (typed: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const panelRef = useSheetA11y<HTMLDivElement>(onCancel);
  const ok = emailMatches(typed, person.email);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 px-0 dark:bg-black/60 sm:items-center sm:px-6"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={WORDING.removeTitle}
        className="w-full max-w-md rounded-t-3xl border border-slate-100 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{WORDING.removeTitle}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{removeMessage(person.email)}</p>
        <label className={`${LABEL} mt-4 block`} htmlFor="remove-confirm-email">
          {WORDING.removeTypeLabel}
        </label>
        <input
          id="remove-confirm-email"
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={person.email}
          className={`${INPUT} mt-1`}
        />
        {error && (
          <div className="mt-2">
            <ErrorLine text={error} />
          </div>
        )}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok || busy}
            onClick={() => onConfirm(typed)}
            className="min-h-11 flex-1 rounded-xl bg-red-500 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
          >
            {busy ? "Removing…" : WORDING.removeConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}

function BackfillSheet({
  count,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  count: number;
  busy: boolean;
  error: string | null;
  onConfirm: (typed: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const panelRef = useSheetA11y<HTMLDivElement>(onCancel);
  const ok = backfillConfirmed(typed);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 px-0 dark:bg-black/60 sm:items-center sm:px-6"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={WORDING.backfillTitle}
        className="w-full max-w-md rounded-t-3xl border border-slate-100 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{WORDING.backfillTitle}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{backfillMessage(count)}</p>
        <label className={`${LABEL} mt-4 block`} htmlFor="backfill-confirm">
          {WORDING.backfillTypeLabel}
        </label>
        <input
          id="backfill-confirm"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className={`${INPUT} mt-1`}
        />
        {error && (
          <div className="mt-2">
            <ErrorLine text={error} />
          </div>
        )}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            data-backfill-confirm
            disabled={!ok || busy}
            onClick={() => onConfirm(typed)}
            className="min-h-11 flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? "Allowing…" : WORDING.backfillConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonActions({
  person,
  busy,
  onAllow,
  onRevoke,
  onRestore,
  onRemove,
}: {
  person: OpsPerson;
  busy: boolean;
  onAllow: () => void;
  onRevoke: () => void;
  onRestore: () => void;
  onRemove: () => void;
}) {
  const action = accessAction(person);
  return (
    <>
      {action === "allow" && (
        <button type="button" disabled={busy} onClick={onAllow} className={QUIET_BTN}>
          {WORDING.allowButton}
        </button>
      )}
      {action === "revoke" && (
        <button type="button" disabled={busy} onClick={onRevoke} className={QUIET_BTN}>
          {WORDING.revokeConfirm}
        </button>
      )}
      {action === "restore" && (
        <button type="button" disabled={busy} onClick={onRestore} className={QUIET_BTN}>
          {WORDING.restoreButton}
        </button>
      )}
      <button type="button" disabled={busy} onClick={onRemove} className={QUIET_BTN}>
        {WORDING.removeConfirm}
      </button>
    </>
  );
}

function PersonCard({
  person,
  busy,
  onAllow,
  onRevoke,
  onRestore,
  onRemove,
}: {
  person: OpsPerson;
  busy: boolean;
  onAllow: () => void;
  onRevoke: () => void;
  onRestore: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="glass-card rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{person.email}</p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            <AccessChip person={person} /> {sourceLabel(person)}
            {person.invited_at ? ` · invited ${formatDate(person.invited_at)}` : ""}
          </p>
        </div>
        {!person.owner && (
          <div className="flex shrink-0 gap-2">
            <PersonActions
              person={person}
              busy={busy}
              onAllow={onAllow}
              onRevoke={onRevoke}
              onRestore={onRestore}
              onRemove={onRemove}
            />
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact label="Signed up" value={person.signed_up ? "Yes" : "Not yet"} />
        <Fact label="Signed up on" value={formatDate(person.signed_up_at)} />
        <Fact label="Last active" value={person.signed_up ? formatDateTime(person.last_active_at) : "Not yet"} />
        <Fact label="Sign-in method" value={person.sign_in_method ?? WORDING.notRecorded} />
        <Fact label="Plan" value={planLabel(person)} />
        <Fact
          label="Banks and accounts"
          value={person.banks_connected === null ? "None" : `${person.banks_connected} banks, ${person.accounts ?? 0} accounts`}
        />
        <Fact label="Last sync" value={person.last_sync ? formatDateTime(person.last_sync) : "None"} />
        <Fact
          label="Penny this month"
          value={person.penny_messages_this_month === null ? "None" : `${person.penny_messages_this_month} messages`}
        />
      </div>
      {person.signed_up && <SubscriptionSection personId={person.id} />}
    </li>
  );
}

function PeopleTable({
  people,
  busyKey,
  onAllow,
  onRevoke,
  onRestore,
  onRemove,
}: {
  people: OpsPerson[];
  busyKey: string | null;
  onAllow: (p: OpsPerson) => void;
  onRevoke: (p: OpsPerson) => void;
  onRestore: (p: OpsPerson) => void;
  onRemove: (p: OpsPerson) => void;
}) {
  const th = `${LABEL} px-3 py-2 text-left font-semibold`;
  const td = "px-3 py-3 align-top text-sm text-slate-800 dark:text-slate-100";
  return (
    <div className="glass-card overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[960px] border-collapse">
        <thead>
          <tr className="border-b border-slate-200 dark:border-white/10">
            <th className={th}>Email</th>
            <th className={th}>Status</th>
            <th className={th}>Signed up</th>
            <th className={th}>Last active</th>
            <th className={th}>Plan</th>
            <th className={th}>Banks</th>
            <th className={th}>Last sync</th>
            <th className={th}>Penny</th>
            <th className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            return (
              <Fragment key={p.id}>
              <tr className="border-b border-slate-100 last:border-0 dark:border-white/5">
                <td className={`${td} max-w-[240px] truncate font-semibold`}>{p.email}</td>
                <td className={td}>
                  <AccessChip person={p} />
                  <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{sourceLabel(p)}</span>
                </td>
                <td className={td}>
                  {p.signed_up ? "Yes" : "Not yet"}
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    {p.sign_in_method ?? WORDING.notRecorded}
                  </span>
                </td>
                <td className={td}>{p.signed_up ? formatDateTime(p.last_active_at) : "Not yet"}</td>
                <td className={td}>{planLabel(p)}</td>
                <td className={`${td} num`}>
                  {p.banks_connected === null ? "None" : `${p.banks_connected} / ${p.accounts ?? 0}`}
                </td>
                <td className={td}>{p.last_sync ? formatDateTime(p.last_sync) : "None"}</td>
                <td className={`${td} num`}>{p.penny_messages_this_month ?? "None"}</td>
                <td className={td}>
                  {!p.owner && (
                    <div className="flex justify-end gap-2">
                      <PersonActions
                        person={p}
                        busy={busyKey === p.id}
                        onAllow={() => onAllow(p)}
                        onRevoke={() => onRevoke(p)}
                        onRestore={() => onRestore(p)}
                        onRemove={() => onRemove(p)}
                      />
                    </div>
                  )}
                </td>
              </tr>
              {p.signed_up && (
                <tr className="border-b border-slate-100 last:border-0 dark:border-white/5">
                  <td colSpan={9} className="px-3 pb-3">
                    <SubscriptionSection personId={p.id} />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PeoplePage() {
  const [people, setPeople] = useState<OpsPerson[]>([]);
  const [audit, setAudit] = useState<OpsAuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PeopleFilter | null>(null);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<OpsPerson | null>(null);
  const [removing, setRemoving] = useState<OpsPerson | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [openSignup, setOpenSignup] = useState(false);
  const [backfillCount, setBackfillCount] = useState(0);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getOpsPeople();
      setPeople(res.people);
      setAudit(res.audit);
      setOpenSignup(res.open_signup === true);
      setCursor(res.next_cursor);
      setLoadError(false);
      try {
        setBackfillCount((await api.getOpsBackfillPreview()).count);
      } catch {
        setBackfillCount(0);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    try {
      const res = await api.getOpsPeople(cursor);
      setPeople((prev) => [...prev, ...res.people]);
      setCursor(res.next_cursor);
    } catch {
      setActionError(WORDING.loadFailed);
    }
  }

  async function run(person: OpsPerson, fn: () => Promise<unknown>, failure: string): Promise<boolean> {
    setBusyKey(person.id);
    setActionError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setActionError(e instanceof Error && e.message ? e.message : failure);
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    setInviteError(null);
    try {
      await api.inviteOpsPerson(trimmed);
      setEmail("");
      await load();
    } catch (err) {
      setInviteError(err instanceof Error && err.message ? err.message : "Couldn't send the invite, try again.");
    } finally {
      setInviting(false);
    }
  }

  const visible = useMemo(() => sortPeople(filterPeople(people, filter, query)), [people, filter, query]);
  const tally = useMemo(() => counts(people), [people]);

  if (loading) {
    return (
      <main className="min-h-dvh bg-[#f0f2f7] px-6 py-10 dark:bg-[#0f172a]">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="h-7 w-40 rounded-lg bg-slate-200 dark:bg-slate-700" />
          <div className="h-40 rounded-3xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </main>
    );
  }

  if (forbidden) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f0f2f7] px-6 dark:bg-[#0f172a]">
        <p className="text-sm text-slate-500 dark:text-slate-400">{WORDING.forbidden}</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f0f2f7] px-4 py-10 dark:bg-[#0f172a] sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <Link href="/ops/go-live" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            Back to go-live board
          </Link>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{WORDING.title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{WORDING.intro}</p>
        </div>

        {loadError && (
          <div className="glass-card rounded-2xl p-4">
            <ErrorLine text={WORDING.loadFailed} />
          </div>
        )}

        {backfillCount > 0 && (
          <section aria-label="Accounts with no access row" className="glass-card rounded-2xl p-4">
            <p className="text-sm text-slate-800 dark:text-slate-100">{backfillBanner(backfillCount)}</p>
            <button
              type="button"
              onClick={() => {
                setBackfillError(null);
                setBackfilling(true);
              }}
              className={`${QUIET_BTN} mt-3`}
            >
              {WORDING.backfillButton}
            </button>
          </section>
        )}

        <form onSubmit={handleInvite} className="glass-card rounded-2xl p-4">
          <label htmlFor="invite-email" className={LABEL}>
            Invite by email
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={WORDING.invitePlaceholder}
              required
              className={INPUT}
            />
            <button
              type="submit"
              disabled={inviting || !email.trim()}
              className="min-h-11 shrink-0 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {inviting ? "Inviting…" : WORDING.inviteButton}
            </button>
          </div>
          {inviteError && (
            <div className="mt-2">
              <ErrorLine text={inviteError} />
            </div>
          )}
        </form>

        <section aria-label="People list" className="space-y-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={WORDING.searchPlaceholder}
            aria-label={WORDING.searchPlaceholder}
            className={INPUT}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter people">
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(on ? null : f.key)}
                  className={`min-h-11 rounded-full px-4 text-xs font-semibold ${
                    on
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200"
                      : "border border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300"
                  }`}
                >
                  {f.label} <span className="num">{tally[f.key]}</span>
                </button>
              );
            })}
          </div>

          {openSignup && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{WORDING.openSignupHint}</p>
          )}

          {actionError && <ErrorLine text={actionError} />}

          {visible.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{WORDING.empty}</p>
          ) : (
            <>
              <ul className="space-y-2 min-[480px]:hidden">
                {visible.map((p) => (
                  <PersonCard
                    key={p.id}
                    person={p}
                    busy={busyKey === p.id}
                    onAllow={() => run(p, () => api.allowOpsPerson(p.id), "Couldn't allow, try again.")}
                    onRevoke={() => setRevoking(p)}
                    onRestore={() => run(p, () => api.restoreOpsPerson(p.id), "Couldn't restore, try again.")}
                    onRemove={() => {
                      setRemoveError(null);
                      setRemoving(p);
                    }}
                  />
                ))}
              </ul>
              <div className="hidden min-[480px]:block">
                <PeopleTable
                  people={visible}
                  busyKey={busyKey}
                  onAllow={(p) => run(p, () => api.allowOpsPerson(p.id), "Couldn't allow, try again.")}
                  onRevoke={setRevoking}
                  onRestore={(p) => run(p, () => api.restoreOpsPerson(p.id), "Couldn't restore, try again.")}
                  onRemove={(p) => {
                    setRemoveError(null);
                    setRemoving(p);
                  }}
                />
              </div>
            </>
          )}
          {cursor && (
            <button type="button" onClick={loadMore} className={QUIET_BTN}>
              {WORDING.loadMore}
            </button>
          )}
        </section>

        <section aria-label={WORDING.auditTitle}>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
            {WORDING.auditTitle}
          </h2>
          {audit.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{WORDING.auditEmpty}</p>
          ) : (
            <ul className="glass-card divide-y divide-slate-100 rounded-2xl dark:divide-white/5">
              {audit.map((a, i) => (
                <li key={`${a.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3">
                  <p className="min-w-0 text-sm text-slate-800 dark:text-slate-100">
                    <span className="font-semibold">{ACTION_LABELS[a.action] ?? a.action}</span>
                    {a.target ? <span className="break-all"> {a.target}</span> : null}
                    {a.detail ? <span className="text-slate-500 dark:text-slate-400">, {a.detail}</span> : null}
                  </p>
                  <p className="num text-[11px] text-slate-500 dark:text-slate-400">
                    {formatDateTime(a.at)}
                    {a.actor ? ` by ${a.actor}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={revoking !== null}
        title={WORDING.revokeTitle}
        message={revoking ? revokeMessage(revoking.email) : ""}
        confirmLabel={WORDING.revokeConfirm}
        confirmDisabled={busyKey !== null}
        onConfirm={async () => {
          const target = revoking;
          if (!target) return;
          await run(target, () => api.revokeOpsPerson(target.id), "Couldn't revoke, try again.");
          setRevoking(null);
        }}
        onCancel={() => setRevoking(null)}
      />

      {backfilling && (
        <BackfillSheet
          count={backfillCount}
          busy={backfillBusy}
          error={backfillError}
          onCancel={() => setBackfilling(false)}
          onConfirm={async (typed) => {
            setBackfillBusy(true);
            setBackfillError(null);
            try {
              await api.applyOpsBackfill(typed);
              setBackfilling(false);
              await load();
            } catch (e) {
              setBackfillError(e instanceof Error && e.message ? e.message : WORDING.backfillFailed);
            } finally {
              setBackfillBusy(false);
            }
          }}
        />
      )}

      {removing && (
        <RemoveSheet
          person={removing}
          busy={busyKey === removing.id}
          error={removeError}
          onCancel={() => setRemoving(null)}
          onConfirm={async (typed) => {
            const target = removing;
            setRemoveError(null);
            setBusyKey(target.id);
            try {
              await api.eraseOpsPerson(target.id, typed);
              setRemoving(null);
              await load();
            } catch (e) {
              setRemoveError(e instanceof Error && e.message ? e.message : "Couldn't remove, try again.");
            } finally {
              setBusyKey(null);
            }
          }}
        />
      )}
    </main>
  );
}
