import Link from "next/link";
import { PHOSPHOR_HOME_HEADER_ICONS } from "@/lib/navigation/phosphorHomeHeaderIcons";

function HeaderIcon({ name, size }: { name: keyof typeof PHOSPHOR_HOME_HEADER_ICONS; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false" data-phosphor-icon={name} data-phosphor-weight="regular">
    {PHOSPHOR_HOME_HEADER_ICONS[name].map((path, index) => <path key={index} d={path.d} />)}
  </svg>;
}

const shortcutClass = "group flex min-h-16 w-14 shrink-0 touch-manipulation flex-col items-center gap-1 rounded-xl text-xs font-semibold text-slate-900 transition-opacity active:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f2f7] dark:text-slate-100 dark:focus-visible:ring-indigo-300 dark:focus-visible:ring-offset-slate-900";
const faceClass = "flex size-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white group-hover:bg-slate-200 dark:border-slate-500 dark:bg-slate-800 dark:group-hover:bg-slate-700";

/**
 * G491 A: the shared live/skeleton header keeps the greeting first and pairs
 * two labelled, equally weighted shortcuts. G488 still owns greeting content
 * and readiness; splitting its comma only controls the approved line break.
 */
export default function HomeGreetingHeader({ greeting, avatarInitials, namePending = false }: { greeting: string; avatarInitials: string | null; namePending?: boolean }) {
  const separator = greeting.indexOf(",");
  const prefix = separator < 0 ? greeting : greeting.slice(0, separator + 1);
  const name = separator < 0 ? "" : greeting.slice(separator + 1).trimStart();

  return (
    <div className="mb-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3" data-home-greeting-header>
      <h1 className="min-w-0 text-[20px] font-bold leading-[26px] tracking-[-0.025em] text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100 lg:text-[28px] lg:leading-9">
        <span className="block min-h-[26px] lg:inline">{prefix}</span>
        {namePending ? <>
          <span aria-hidden="true" data-greeting-name-pending className="mt-1.5 block h-5 w-24 rounded-md bg-slate-300 lg:ml-2 lg:mt-0 lg:inline-block lg:align-middle dark:bg-slate-500" />
          <span className="sr-only">Name loading</span>
        </> : name ? <> <span className="block lg:inline">{name}</span></> : null}
      </h1>
      <nav aria-label="Home shortcuts" className="flex gap-2">
        <Link href="/settings" aria-label="Account and settings" className={shortcutClass}>
          <span className={faceClass} data-home-shortcut-face>
            <span aria-hidden="true" data-home-header-identity className="relative -top-px flex size-[30px] items-center justify-center text-[13px] font-bold leading-none">
              {avatarInitials ? <span>{avatarInitials}</span> : <HeaderIcon name="user-circle" size={24} />}
              <span className="absolute -bottom-0.5 -right-[3px] flex size-4 items-center justify-center rounded-full bg-white text-slate-600 group-hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-700">
                <HeaderIcon name="gear-six" size={12} />
              </span>
            </span>
          </span>
          <span className="leading-4">Settings</span>
        </Link>
        <Link href="/accounts" aria-label="Your accounts" className={shortcutClass}>
          <span className={faceClass} data-home-shortcut-face><HeaderIcon name="bank" size={24} /></span>
          <span className="leading-4">Accounts</span>
        </Link>
      </nav>
    </div>
  );
}
