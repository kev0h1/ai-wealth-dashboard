// G199 design round: the mobile sign-in hand-off page. Every frame below is the
// real shared template (shared/signin-handoff/template.html) rendered by
// @wealth/shared, the same markup backend/app/core/signin_handoff.py serves, in
// a sandboxed iframe so the page's own document CSS applies untouched.
// Auto-return is off here and scripts never run (sandbox="" ), so the 3 second
// hint is shown as its own state. Fixture copy only, no API calls.
import type { Metadata } from "next";
import Link from "next/link";
import {
  signinHandoffHtml,
  SIGNIN_HANDOFF_SUCCESS_HINT,
  type SigninHandoffScheme,
  type SigninHandoffVariant,
} from "@wealth/shared";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const VARIANTS: { value: SigninHandoffVariant; name: string; note: string }[] = [
  { value: "a", name: "A · Soft landing", note: "One rounded card on the canvas, the mark in a soft indigo disc, return button inside the card." },
  { value: "b", name: "B · Open cockpit", note: "No card. A large verdict heading leads, the mark sits quietly beside it, the return action is anchored low." },
  { value: "c", name: "C · Quiet receipt", note: "A ruled receipt panel with a one-row status ledger (Google account: Signed in), button underneath." },
];
const STATES = [
  { value: "ok", label: "Signed in" },
  { value: "hint", label: "Signed in, after 3 seconds" },
  { value: "error", label: "Did not complete" },
] as const;
type StateValue = (typeof STATES)[number]["value"];

function pick<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return allowed.find((a) => a === v);
}

export default async function SigninHandoffPreview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const variant = pick(sp.variant, ["a", "b", "c"] as const);
  const state = pick<StateValue>(sp.state, ["ok", "hint", "error"]);
  const mode: SigninHandoffScheme = pick(sp.mode, ["light", "dark", "auto"] as const) ?? "auto";
  const variants = VARIANTS.filter((v) => !variant || v.value === variant);
  const states = STATES.filter((s) => !state || s.value === state);
  const link = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const next = { variant, state, mode: mode === "auto" ? undefined : mode, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    const s = q.toString();
    return `/design/signin-handoff${s ? `?${s}` : ""}`;
  };
  const chip = (active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border px-4 text-[13px] font-semibold ${
      active
        ? "border-indigo-600 bg-indigo-600 text-white"
        : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
    }`;

  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]">
      <div className="mx-auto max-w-[1180px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-slate-100">Sign-in hand-off page</h1>
        <p className="mt-1 max-w-[560px] text-[14px] text-slate-600 dark:text-slate-400">
          G199, skill: impeccable, designs drafted by openai/gpt-6-astra via OpenRouter and fitted to DESIGN.md. The page a
          user sees in the in-app browser after Google sign-in, before Sorted takes over. Pick one of A, B or C.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className={chip(!variant)} href={link({ variant: undefined })}>All variants</Link>
          {VARIANTS.map((v) => (
            <Link key={v.value} className={chip(variant === v.value)} href={link({ variant: v.value })}>{v.name.slice(0, 1)}</Link>
          ))}
          <span className="w-2" />
          {(["auto", "light", "dark"] as const).map((m) => (
            <Link key={m} className={chip(mode === m)} href={link({ mode: m === "auto" ? undefined : m })}>
              {m === "auto" ? "Device theme" : m === "light" ? "Light" : "Dark"}
            </Link>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">
          ?variant=a|b|c&amp;state=ok|hint|error&amp;mode=light|dark
        </p>

        {variants.map((v) => (
          <section key={v.value} className="mt-8">
            <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">{v.name}</h2>
            <p className="mt-1 max-w-[560px] text-[14px] text-slate-600 dark:text-slate-400">{v.note}</p>
            <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
              {states.map((s) => (
                <figure key={s.value} className="m-0 shrink-0">
                  <figcaption className="mb-1 text-[12px] font-semibold text-slate-600 dark:text-slate-400">{s.label}</figcaption>
                  <iframe
                    title={`${v.name}, ${s.label}`}
                    sandbox=""
                    width={360}
                    height={640}
                    className="block rounded-2xl border border-slate-200 dark:border-slate-700"
                    srcDoc={signinHandoffHtml(s.value !== "error", v.value, {
                      scheme: mode,
                      autoReturn: false,
                      message: s.value === "hint" ? SIGNIN_HANDOFF_SUCCESS_HINT : undefined,
                    })}
                  />
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
