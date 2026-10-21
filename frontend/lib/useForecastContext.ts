"use client";

import { useEffect, useState } from "react";
import type { SafeToSpend } from "./api";

/** Optional status context is tied to the exact displayed cashflow snapshot.
 * A rejected read is settled unknown data, not an endless pending state. */
export function useForecastContext<T>(forecast: T | null, load: () => Promise<SafeToSpend>) {
  const [snapshot, setSnapshot] = useState<{ forecast: T; data: SafeToSpend | null } | null>(null);
  useEffect(() => {
    if (forecast === null) return;
    let cancelled = false;
    load().then(data => {
      if (!cancelled) setSnapshot({ forecast, data });
    }).catch(() => {
      if (!cancelled) setSnapshot({ forecast, data: null });
    });
    return () => { cancelled = true; };
  }, [forecast, load]);
  const current = snapshot?.forecast === forecast ? snapshot : null;
  return { data: current?.data ?? null, pending: forecast !== null && current === null };
}
