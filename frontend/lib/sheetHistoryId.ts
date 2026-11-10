// Browser history survives a reload while module counters restart. A fresh
// session prefix keeps newly opened sheets distinct from stale history entries.
const session = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
let sequence = 0;

export function createSheetHistoryId(): string {
  return `sheet-${session}-${++sequence}`;
}
