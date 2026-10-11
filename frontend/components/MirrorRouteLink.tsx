"use client";

// The quiet route from Spend to the Mirror (G242, approved C): a small pill
// under the page title, "How your money behaves". Informational, so no Penny
// gradient. `from=spend` lets the Mirror offer "Back to Spend".
import Link from "next/link";
import PennyMark from "@/components/PennyMark";

export default function MirrorRouteLink({ href = "/mirror?from=spend" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-slate-700 transition-[opacity,background-color] hover:bg-slate-100 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <PennyMark size={13} className="text-slate-500 dark:text-slate-400" />
      How your money behaves
    </Link>
  );
}
