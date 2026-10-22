"use client";

// E10: owner-only runtime settings block on /ops/health. Presentational and
// prop-driven so scripts/e10-runtime-settings.test.mjs can render it from raw
// rows. The backend (GET/PUT/DELETE /ops/settings) builds the list from its
// registry, so a security key can never appear here. Values are non-secret
// operational numbers and switches.
import { useState } from "react";
import type { OpsSetting } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";

export const RUNTIME_SETTINGS_TITLE = "Runtime settings";
export const RUNTIME_SETTINGS_WORDING = {
  intro: "Changes apply to the API and the worker within about a minute, without a redeploy. Every change is logged.",
  empty: "No settings available.",
  save: "Save",
  turnOn: "Turn on",
  turnOff: "Turn off",
  useDefault: "Use env or default",
  confirmTitle: "Turn this on?",
  confirmBody: "This switch lets real purchases through. Only turn it on once the store products and credentials are ready.",
  confirmLabel: "Turn on",
  saved: "Saved.",
  failed: "Couldn't save that setting.",
} as const;

const CARD = "glass-card rounded-3xl p-5";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const MUTED = "text-xs text-slate-500 dark:text-slate-400";
const BTN = "min-h-11 rounded-2xl border border-slate-300 px-4 text-sm font-semibold text-slate-800 disabled:opacity-60 dark:border-slate-600 dark:text-slate-100";
const INPUT = "min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-transparent px-3 text-sm text-slate-900 dark:border-slate-600 dark:text-slate-100";

const SOURCE_LABEL: Record<OpsSetting["source"], string> = { database: "Database", env: "Env", default: "Default" };

export function formatSettingValue(row: OpsSetting): string {
  const v = row.value;
  if (v === null || v === undefined || v === "") return row.type === "str" ? "Off" : "Not set";
  if (typeof v === "boolean") return v ? "On" : "Off";
  return String(v);
}

function Row({ row, busy, onSave, onClear }: {
  row: OpsSetting;
  busy: boolean;
  onSave: (key: string, value: boolean | number | string, confirm: boolean) => void;
  onClear: (key: string) => void;
}) {
  const [draft, setDraft] = useState<string>(row.value === null || row.value === undefined ? "" : String(row.value));
  const [confirming, setConfirming] = useState(false);
  const bounds = row.min !== null || row.max !== null
    ? `Allowed ${row.min !== null ? row.min : "any"} to ${row.max !== null ? row.max : "any"}`
    : null;

  const submitDraft = () => {
    if (row.type === "str") return onSave(row.key, draft.trim(), false);
    const n = Number(draft);
    if (draft.trim() === "" || Number.isNaN(n)) return;
    onSave(row.key, n, false);
  };

  return (
    <li className="py-3" data-setting={row.key}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold text-slate-900 dark:text-slate-100">{row.label}</p>
        <span
          className={`shrink-0 rounded-full border border-slate-300 px-2 py-0.5 text-[11px] dark:border-slate-600 ${
            row.source === "database" ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
          }`}
          data-source={row.source}
        >
          {SOURCE_LABEL[row.source]}
        </span>
      </div>
      <p className="money mt-0.5 break-all text-xs text-slate-500 dark:text-slate-400">{row.key}</p>
      {row.help && <p className={`${MUTED} mt-1`}>{row.help}</p>}
      <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">
        Now: <span className="font-semibold">{formatSettingValue(row)}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {row.type === "bool" ? (
          <button
            type="button"
            disabled={busy}
            className={BTN}
            onClick={() => (row.value === true ? onSave(row.key, false, false) : row.confirm_on ? setConfirming(true) : onSave(row.key, true, false))}
          >
            {row.value === true ? RUNTIME_SETTINGS_WORDING.turnOff : RUNTIME_SETTINGS_WORDING.turnOn}
          </button>
        ) : (
          <>
            <input
              aria-label={row.label}
              className={`${INPUT} sm:max-w-[12rem]`}
              inputMode={row.type === "str" ? "text" : "decimal"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="button" disabled={busy} className={BTN} onClick={submitDraft}>
              {RUNTIME_SETTINGS_WORDING.save}
            </button>
          </>
        )}
        {row.source === "database" && (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 px-2 text-xs font-semibold text-slate-600 disabled:opacity-60 dark:text-slate-300"
            onClick={() => onClear(row.key)}
          >
            {RUNTIME_SETTINGS_WORDING.useDefault}
          </button>
        )}
      </div>
      {bounds && <p className={`${MUTED} mt-1`}>{bounds}</p>}
      <ConfirmDialog
        open={confirming}
        title={RUNTIME_SETTINGS_WORDING.confirmTitle}
        message={`${row.label}. ${RUNTIME_SETTINGS_WORDING.confirmBody}`}
        confirmLabel={RUNTIME_SETTINGS_WORDING.confirmLabel}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onSave(row.key, true, true);
        }}
      />
    </li>
  );
}

export default function RuntimeSettings({ rows, busyKey = null, message = null, onSave, onClear }: {
  rows: OpsSetting[];
  busyKey?: string | null;
  message?: string | null;
  onSave: (key: string, value: boolean | number | string, confirm: boolean) => void;
  onClear: (key: string) => void;
}) {
  const groups: string[] = [];
  for (const r of rows) if (!groups.includes(r.group)) groups.push(r.group);
  return (
    <div className={CARD} data-runtime-settings>
      <p className={`${MUTED} mb-2`}>{RUNTIME_SETTINGS_WORDING.intro}</p>
      {rows.length === 0 && <p className={MUTED}>{RUNTIME_SETTINGS_WORDING.empty}</p>}
      {groups.map((g) => (
        <section key={g} className="mt-3">
          <p className={LABEL}>{g}</p>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {rows.filter((r) => r.group === g).map((r) => (
              <Row key={r.key} row={r} busy={busyKey === r.key} onSave={onSave} onClear={onClear} />
            ))}
          </ul>
        </section>
      ))}
      {message && <p role="status" className="mt-3 text-sm text-slate-600 dark:text-slate-300">{message}</p>}
    </div>
  );
}
