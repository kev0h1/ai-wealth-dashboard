// G425: one shared loader for GET /transactions/miscategorised-count. Home's
// transfers check and Spend's banner both read it; before this each mount
// fired its own request (two per screen in the prod log). Concurrent callers
// for the same offset share one promise, and results are cached briefly per
// offset. Money-free (counts and ids only), memory only.
//
// Both screens call it with the same offset (Home always 0, Spend the viewed
// period). Server-side the response is cached per offset
// (miscategorised_count:<offset>) and only offset 0 is warmed (services/
// warmup.py), so a Spend visit restored to an earlier period is the cold call.
import { api } from "@/lib/api";
import type { MiscategorisedCount } from "@/lib/api";

export const MISCATEGORISED_COUNT_TTL_MS = 30_000;

type Entry = { data: MiscategorisedCount; at: number };
const cache = new Map<number, Entry>();
const inflight = new Map<number, Promise<MiscategorisedCount>>();
let generation = 0;
let now: () => number = () => Date.now();

export function __setMiscategorisedClock(fn: (() => number) | null): void { now = fn ?? (() => Date.now()); }

export function loadMiscategorisedCount(offset = 0, force = false): Promise<MiscategorisedCount> {
  const hit = cache.get(offset);
  if (!force && hit && now() - hit.at < MISCATEGORISED_COUNT_TTL_MS) return Promise.resolve(hit.data);
  const existing = inflight.get(offset);
  if (existing && !force) return existing;
  const startedAt = generation;
  const p = api.getMiscategorisedCount(offset)
    .then((data) => {
      if (startedAt === generation) cache.set(offset, { data, at: now() });
      return data;
    })
    .finally(() => { if (inflight.get(offset) === p) inflight.delete(offset); });
  inflight.set(offset, p);
  return p;
}

export function invalidateMiscategorisedCount(): void {
  generation++;
  cache.clear();
  inflight.clear();
}

/** Subscribe `target` events (transactions changed, transfer review done) to invalidation. */
export function bindMiscategorisedInvalidation(target: EventTarget, events: string[]): () => void {
  const handler = () => invalidateMiscategorisedCount();
  for (const e of events) target.addEventListener(e, handler);
  return () => { for (const e of events) target.removeEventListener(e, handler); };
}
