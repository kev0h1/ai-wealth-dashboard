import Link from "next/link";
import { Landmark, UserRound } from "lucide-react";

/**
 * G411: the one Home header row (avatar, greeting, Accounts button). Both the
 * live HomeBrief and the first-paint HomeSkeleton render this exact element,
 * so nothing changes size, position or weight when data lands.
 */
export default function HomeGreetingHeader({ greeting, avatarInitials }: { greeting: string; avatarInitials: string | null }) {
  return (
    <div className="flex items-center gap-2 mb-3" data-home-greeting-header>
      {/* Avatar: the primary mobile entry point to /settings. Visible circle is
          36px, the tap target is padded out to the 44px HIG minimum. */}
      <Link
        href="/settings"
        aria-label="Account and settings"
        className="lg:hidden shrink-0 -ml-1 w-11 h-11 flex items-center justify-center rounded-full active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="w-9 h-9 flex items-center justify-center rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-[13px] font-semibold">
          {avatarInitials ?? <UserRound size={16} aria-hidden="true" />}
        </span>
      </Link>
      <h1 className="flex-1 min-w-0 break-words text-[20px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight sm:text-[28px]">{greeting}</h1>
      <Link
        href="/accounts"
        className="shrink-0 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-95 transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <Landmark size={16} aria-hidden="true" />
        Accounts
      </Link>
    </div>
  );
}
