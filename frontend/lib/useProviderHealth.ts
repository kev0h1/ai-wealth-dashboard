"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** A183: bank id to health_status from the cached provider list. Fetched only
 *  when `enabled`, and a failed fetch simply shows no notice. */
export function useProviderHealth(enabled: boolean): Record<string, string> {
  const [health, setHealth] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.finexerProviders()
      .then(list => {
        if (!active) return;
        const next: Record<string, string> = {};
        for (const p of list) if (p.health_status) next[p.id] = p.health_status;
        setHealth(next);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [enabled]);
  return health;
}
