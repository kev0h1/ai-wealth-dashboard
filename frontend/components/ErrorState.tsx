import type { ReactNode } from "react";
import { Undo2 } from "lucide-react";

// G215: the one designed error surface for Next's not-found and error boundaries.
// Same anatomy as the sign-in hand-off page (shared/signin-handoff/template.html):
// brand line, verdict-led heading, one sentence, action anchored low. No red (an
// error page is not financial risk), no gradient (that is Penny's), nothing from
// the thrown error is shown. Presentational and hook-free so the app routes and
// the /design/error-states preview render the same markup.
export default function ErrorState({
  heading,
  message,
  actions,
}: {
  heading: string;
  message: string;
  actions: ReactNode;
}) {
  return (
    <main
      aria-labelledby="error-state-heading"
      className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-7"
    >
      <p className="border-b border-slate-200 pb-5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <strong className="text-base font-semibold text-slate-900 dark:text-slate-100">Sorted</strong> by Auriq
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_24px] content-start gap-x-4 pb-12 pt-[clamp(40px,12svh,112px)]">
        <h1
          id="error-state-heading"
          className="col-start-1 row-start-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-900 [text-wrap:balance] dark:text-slate-100"
        >
          {heading}
        </h1>
        <span className="col-start-2 row-start-1 grid h-9 place-items-center text-slate-500 dark:text-slate-400" aria-hidden="true">
          <Undo2 size={24} strokeWidth={1.75} />
        </span>
        <p className="col-span-2 mt-4 max-w-[280px] text-sm leading-6 text-slate-600 [text-wrap:pretty] dark:text-slate-400">{message}</p>
      </div>
      <div className="mt-auto flex flex-col gap-2 border-t border-slate-200 pt-6 dark:border-slate-700">{actions}</div>
    </main>
  );
}

export const ERROR_PRIMARY_ACTION =
  "flex min-h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";
export const ERROR_SECONDARY_ACTION =
  "flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";
