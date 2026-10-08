// A133: the pending-login record and the shared token poller behind
// nativeGoogleLogin / resumePendingLogin (lib/nativeAuth.ts). No Capacitor
// imports on purpose, so it runs under node in
// scripts/mobile-login-loop.test.mjs.
//
// The poll_secret (128 bits, crypto.getRandomValues) is what lets the server
// release the session token: the server only ever sees sha256(poll_secret)
// (the `challenge`, safe to put in a URL) until the poll, and the poll sends
// the secret in a POST BODY. It must never appear in a URL, a log line or an
// error report.
//
// Persistence: before the browser opens, {state, pollSecret, startedAt} is
// written to sessionStorage AND localStorage (sessionStorage survives a
// WebView reload, localStorage also survives the OS killing the app while the
// Custom Tab / Safari sheet is up). 5-minute TTL, same as the server's pending
// entry; removed on success, failure and expiry. The secret is short-lived
// and single-purpose: without the matching state it releases nothing, and
// once redeemed or expired the server holds nothing for it. It is NOT the
// session token, which never touches web storage on native (lib/auth.ts).

import type { PollResult } from "./mobileLoginLoop";

export interface PendingLogin {
  state: string;
  pollSecret: string;
  startedAt: number;
}

export const PENDING_LOGIN_KEY = "wd_pending_login";
export const PENDING_LOGIN_TTL_MS = 5 * 60 * 1000;

type StoreLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStores(): StoreLike[] {
  const out: StoreLike[] = [];
  try { if (typeof sessionStorage !== "undefined") out.push(sessionStorage); } catch { /* blocked */ }
  try { if (typeof localStorage !== "undefined") out.push(localStorage); } catch { /* blocked */ }
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newPendingLogin(now = Date.now()): PendingLogin {
  const s = new Uint8Array(16);
  crypto.getRandomValues(s);
  const p = new Uint8Array(16);
  crypto.getRandomValues(p);
  return { state: "m" + hex(s), pollSecret: hex(p), startedAt: now };
}

export function savePendingLogin(p: PendingLogin, stores: StoreLike[] = defaultStores()): void {
  const json = JSON.stringify(p);
  for (const s of stores) {
    try { s.setItem(PENDING_LOGIN_KEY, json); } catch { /* try the next store */ }
  }
}

export function clearPendingLogin(stores: StoreLike[] = defaultStores()): void {
  for (const s of stores) {
    try { s.removeItem(PENDING_LOGIN_KEY); } catch { /* ignore */ }
  }
}

export function loadPendingLogin(now = Date.now(), stores: StoreLike[] = defaultStores()): PendingLogin | null {
  for (const s of stores) {
    let raw: string | null = null;
    try { raw = s.getItem(PENDING_LOGIN_KEY); } catch { /* ignore */ }
    if (!raw) continue;
    try {
      const p = JSON.parse(raw) as Partial<PendingLogin>;
      if (
        typeof p.state === "string" && /^m[0-9a-f]{32}$/.test(p.state) &&
        typeof p.pollSecret === "string" && /^[0-9a-f]{32}$/.test(p.pollSecret) &&
        typeof p.startedAt === "number" && now - p.startedAt >= 0 && now - p.startedAt < PENDING_LOGIN_TTL_MS
      ) {
        return { state: p.state, pollSecret: p.pollSecret, startedAt: p.startedAt };
      }
    } catch { /* malformed: fall through to clear */ }
    clearPendingLogin(stores); // malformed or expired
    return null;
  }
  return null;
}

// Pure-JS SHA-256 (hex of the UTF-8 / ASCII input). crypto.subtle is only
// exposed in secure contexts and a WebView custom scheme is not guaranteed to
// be one, so the challenge must not depend on it.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

export interface PollReply {
  status?: string;
  token?: string;
  error?: string;
}

export interface SharedPollerDeps {
  // POST /auth/mobile/poll with {state, poll_secret}. Null = network/HTTP failure.
  post: (p: PendingLogin) => Promise<PollReply | null>;
  // Puts the token in memory first and never rejects (lib/auth.ts setTokenAsync).
  applyToken: (token: string) => Promise<unknown>;
  clear?: () => void;
}

// One poller per process. Two callers asking about the same state (the live
// nativeGoogleLogin loop and a resumed one after a reload that kept the JS
// context, or an overlapping interval/appUrlOpen trigger) share ONE in-flight
// request, and a token already applied for a state is never applied again.
export function createSharedPoller(deps: SharedPollerDeps) {
  const inflight = new Map<string, Promise<PollResult>>();
  const applied = new Set<string>();
  const clear = deps.clear ?? (() => clearPendingLogin());

  async function run(p: PendingLogin): Promise<PollResult> {
    if (applied.has(p.state)) return "ok";
    const d = await deps.post(p);
    if (!d) return "pending";
    if (d.status === "token" && d.token) {
      if (applied.has(p.state)) return "ok";
      applied.add(p.state); // claim before the await so nothing else can apply
      await deps.applyToken(d.token);
      clear();
      return "ok";
    }
    if (d.status === "error") {
      clear();
      return d.error === "invite_only" ? "invite_only" : "err";
    }
    return "pending";
  }

  return function pollOnce(p: PendingLogin): Promise<PollResult> {
    const existing = inflight.get(p.state);
    if (existing) return existing;
    const promise = run(p).catch(() => "pending" as PollResult).finally(() => { inflight.delete(p.state); });
    inflight.set(p.state, promise);
    return promise;
  };
}
