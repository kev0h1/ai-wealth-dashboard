"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Which extra cards (e.g. "fuel", "groceries") the user pinned to Home.
export function useHomePinnedCards() {
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    api.getPreferences().then(p => setPinned(p.home_pinned_cards ?? [])).catch(() => {});
  }, []);
  function toggle(id: string) {
    setPinned(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      api.updatePreferences({ home_pinned_cards: next }).catch(() => {});
      return next;
    });
  }
  return { pinned, toggle };
}
