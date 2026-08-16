// Design preview index — links to the three accounts-redesign explorations.
// Standalone, auth-exempt (/design/* — see components/AuthProvider.tsx), no
// live data. Server component: just static links, no interactivity needed.

import Link from "next/link";

const PAGES = [
  {
    href: "/design/accounts-rows",
    title: "Variant A: Ledger rows",
    desc: "Dense single-panel list with hairline dividers",
  },
  {
    href: "/design/accounts-tiles",
    title: "Variant B: Rich tiles",
    desc: "2-col grid, sparklines + utilisation bars",
  },
  {
    href: "/design/account-detail",
    title: "Redesigned account detail",
    desc: "Mini-statement header, no dead space",
  },
];

export default function AccountsPreviewIndex() {
  return (
    <div className="dark mx-auto w-full max-w-[430px] min-h-screen overflow-x-hidden bg-[#0f172a] px-4 pt-6 pb-10">
      <h1 className="text-2xl font-bold text-slate-100 mb-1">Accounts redesign</h1>
      <p className="text-sm text-slate-400 mb-6">Pick one — tap through on your phone.</p>

      <div className="space-y-3">
        {PAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="glass-card rounded-2xl p-4 block active:scale-[0.98] transition-transform min-h-[44px]"
          >
            <p className="text-sm font-semibold text-slate-100">{p.title}</p>
            <p className="text-[13px] text-slate-400 mt-0.5">{p.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
