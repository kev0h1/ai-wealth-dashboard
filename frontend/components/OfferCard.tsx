"use client";

// B20: the in-app-card half of an admin-sent offer broadcast. Fetches the
// current user's unread offers (GET /offers) and shows the most recent
// one, with the same 44px glass-chip dismiss control as HomeBrief.tsx's
// DismissChip (see that file's own comment on why this is THE dismiss
// treatment app-wide). Renders nothing while loading or when there's
// nothing to show — no skeleton, no load-in animation (content visible by
// default, DESIGN.md "Don't gate content behind a load animation").

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { api, type OfferCardData } from "@/lib/api";

export default function OfferCard() {
  const router = useRouter();
  const [offer, setOffer] = useState<OfferCardData | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listOffers()
      .then((res) => {
        if (!cancelled) setOffer(res.offers[0] ?? null);
      })
      .catch(() => {
        /* no offer today is not an error state */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!offer) return null;

  async function dismiss(e: React.MouseEvent) {
    e.stopPropagation();
    if (!offer) return;
    const dismissed = offer;
    setOffer(null);
    try {
      await api.dismissOffer(dismissed.id);
    } catch {
      // Best-effort — the card stays dismissed locally either way; the
      // receipt is TTL'd server-side regardless (see app/db/collections.py).
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(offer.url)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(offer.url);
      }}
      className="glass-card flex items-start justify-between gap-2 rounded-2xl p-4 cursor-pointer"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          For you
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{offer.title}</p>
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{offer.body}</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 transition-transform duration-150"
      >
        <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
          <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
        </span>
      </button>
    </div>
  );
}
