// Synthetic transaction fixtures — the fallback path for this preview when
// nobody is signed in, and the deterministic path for the loading/empty/
// long-list review states (?state=…). Every row here is invented, no real
// user data is ever committed to this file or this repo.
import type { Transaction } from "@/lib/api";

// Deterministic PRNG (mulberry32) so the fixtures are identical on server
// and client render (no hydration mismatch) and identical across runs (so a
// screenshot taken today matches one taken tomorrow).
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MerchantSpec {
  name: string;
  category: string;
  kind: "debit" | "credit";
  min: number;
  max: number;
}

// A deliberate mix of ordinary discretionary/commitment spend AND a couple
// of movement-kind rows (Transfer, both directions) so the detail panel's
// movement fork (ENGINE.md Destination Rule) gets exercised by the fixture
// path too, not just by real data.
const MERCHANTS: MerchantSpec[] = [
  { name: "Tesco", category: "Groceries", kind: "debit", min: 8, max: 62 },
  { name: "Sainsbury's", category: "Groceries", kind: "debit", min: 6, max: 55 },
  { name: "Pret A Manger", category: "Eating Out", kind: "debit", min: 3, max: 12 },
  { name: "Deliveroo", category: "Eating Out", kind: "debit", min: 12, max: 34 },
  { name: "TfL Travel", category: "Transport", kind: "debit", min: 2, max: 9 },
  { name: "Shell", category: "Transport", kind: "debit", min: 30, max: 70 },
  { name: "Netflix", category: "Subscriptions", kind: "debit", min: 8, max: 16 },
  { name: "Spotify", category: "Subscriptions", kind: "debit", min: 5, max: 12 },
  { name: "Octopus Energy", category: "Bills", kind: "debit", min: 60, max: 140 },
  { name: "Thames Water", category: "Bills", kind: "debit", min: 25, max: 45 },
  { name: "Amazon", category: "Shopping", kind: "debit", min: 9, max: 89 },
  { name: "ASOS", category: "Shopping", kind: "debit", min: 18, max: 76 },
  { name: "PureGym", category: "Bills", kind: "debit", min: 24, max: 24 },
  { name: "Odeon", category: "Entertainment", kind: "debit", min: 10, max: 28 },
  { name: "To savings pot", category: "Transfer", kind: "debit", min: 50, max: 400 },
  { name: "From ISA", category: "Transfer", kind: "credit", min: 100, max: 500 },
  { name: "Employer Ltd", category: "Income", kind: "credit", min: 1800, max: 3200 },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Naive local-date-only ISO strings, matching the shape the real API sends
// (see grouping.ts's comment on why grouping goes through dateToUTCDay
// rather than trusting `new Date(iso)` directly).
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T00:00:00`;
}

function buildFixture(seed: number, spanDays: number, perDayMax: number): Transaction[] {
  const rand = mulberry32(seed);
  const out: Transaction[] = [];
  let counter = 0;
  for (let dayOffset = 0; dayOffset < spanDays; dayOffset++) {
    // Not every day has activity — quiet days included, same as real spend.
    const skip = rand() < 0.15;
    const rowsToday = skip ? 0 : 1 + Math.floor(rand() * perDayMax);
    for (let i = 0; i < rowsToday; i++) {
      const m = MERCHANTS[Math.floor(rand() * MERCHANTS.length)];
      const amount = Math.round((m.min + rand() * (m.max - m.min)) * 100) / 100;
      counter += 1;
      out.push({
        id: `fixture-${seed}-${counter}`,
        account_id: "fixture-account-1",
        date: isoDaysAgo(dayOffset),
        amount,
        currency: "GBP",
        description: `${m.name.toUpperCase()} REF${1000 + counter}`,
        merchant_name: m.name,
        category: m.category,
        transaction_type: m.kind,
      });
    }
  }
  // date desc — matches the backend's own sort ("date", -1).
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

// A handful of days, a dozen or so rows — what an unauthenticated fixture
// fallback shows by default, and the shape G92's old fixture was stuck at.
export const FIXTURE_POPULATED = buildFixture(7, 6, 3);

// ~70 days, several rows most days — deep enough to exercise pagination at
// PAGE_SIZE=20 (multiple pages/loads), long scroll and day-group merging
// across appends without needing Kevin's real 1,990-row account.
export const FIXTURE_LONG = buildFixture(19, 70, 4);

export const FIXTURE_EMPTY: Transaction[] = [];
