// E6: Sentry scrubbing for the web and the Capacitor apps (spec:
// docs/ops/OBSERVABILITY.md). This module has NO Sentry import, so it can be
// unit tested in plain Node (scripts/observability-scrub.test.mjs). The
// backend twin is backend/app/core/observability.py and the rules are the
// same: nothing personal or financial leaves the device.
//
//  * request bodies, cookies, query strings and every header but a short
//    allowlist are dropped; fetch/xhr bodies are never kept;
//  * the user is replaced by the server-computed hashed id (`uid_hash` from
//    /auth/session/validate), and only if it looks like one;
//  * any key that names personal or financial data has its value replaced;
//  * every remaining string is pattern-scrubbed (emails, tokens, card and
//    account numbers, IBANs, sort codes, currency amounts);
//  * URLs lose their query string and fragment;
//  * console and DOM-input breadcrumbs are dropped.

export const FILTERED = "[Filtered]";
const MAX_DEPTH = 12;
const MAX_STRING = 400;
export const MAX_TRACES_SAMPLE_RATE = 0.1;

type Json = unknown;
type Dict = Record<string, Json>;

const PATTERNS: Array<[RegExp, string]> = [
  [/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1"],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [Filtered]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, FILTERED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, FILTERED],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "[email]"],
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, "[iban]"],
  [/(?<![\w.])\d{2}[- ]\d{2}[- ]\d{2}(?![\w.])/g, "[sort code]"],
  [/(?<![\w.])(?:\d[ -]?){13,19}(?![\w.])/g, "[card number]"],
  [/(?<![\w.])\d{8}(?![\w.])/g, "[account number]"],
  [/(?:[-−+]\s?)?(?:[£$€]|\bGBP\s?|\bUSD\s?|\bEUR\s?)\s?\d[\d,]*(?:\.\d+)?/gi, "[amount]"],
  [/\b\d[\d,]*(?:\.\d+)?\s?(?:GBP|pounds)\b/gi, "[amount]"],
  [/(?<![\w.])\d[\d,]*\.\d{2}(?![\d.\w])/g, "[amount]"],
  // 43+ so a 40-char git SHA and 32-char trace ids are untouched.
  [/(?<![\w-])[A-Za-z0-9_+/=-]{43,}(?![\w-])/g, FILTERED],
];

const SENSITIVE_EXACT = new Set([
  "name", "first_name", "last_name", "full_name", "display_name", "username",
  "email", "merchant", "payee", "payer", "description", "reference", "memo",
  "address", "phone", "ip", "ip_address", "pin", "passcode", "otp",
]);
const SENSITIVE_FRAGMENTS = [
  "password", "passwd", "secret", "token", "authorization", "cookie", "api_key",
  "apikey", "api-key", "amount", "balance", "iban", "sort_code", "sortcode",
  "account_number", "card", "session", "csrf", "dsn", "credential", "signature",
  "merchant", "email", "bearer",
];
const SAFE_KEYS = new Set([
  "release", "event_id", "trace_id", "span_id", "parent_span_id", "environment",
  "platform", "timestamp", "start_timestamp", "level", "type", "sdk", "op",
  "status", "filename", "module", "function", "lineno", "colno", "in_app",
  "transaction", "version", "origin", "sampled", "fingerprint", "mechanism",
  "handled", "package", "status_code", "method",
]);
const ALLOWED_HEADERS = new Set(["content-type", "content-length", "accept", "accept-language", "host"]);
const DROP_CRUMB_CATEGORIES = new Set(["console", "ui.input", "query", "db", "sql"]);
const DROP_CRUMB_DATA_KEYS = new Set([
  "body", "request_body", "response_body", "http.request.body", "query", "http.query", "http.fragment",
]);
const URL_KEYS = new Set(["url", "from", "to", "href", "referrer", "referer"]);
const HASH_RE = /^[0-9a-f]{16}$/;

function isSensitiveKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (SAFE_KEYS.has(k)) return false;
  if (SENSITIVE_EXACT.has(k)) return true;
  return SENSITIVE_FRAGMENTS.some((f) => k.includes(f));
}

export function stripQuery(url: string): string {
  return url.replace(/[?#].*$/, "");
}

export function scrubString(value: string): string {
  let out = value;
  for (const [re, repl] of PATTERNS) out = out.replace(re, repl);
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}...` : out;
}

export function scrubValue(value: Json, key = "", depth = 0): Json {
  if (key && isSensitiveKey(key)) return FILTERED;
  if (depth > MAX_DEPTH) return FILTERED;
  if (typeof value === "string") {
    if (key === "transaction") return scrubString(stripQuery(value));
    if (SAFE_KEYS.has(key)) return value;
    const v = URL_KEYS.has(key.toLowerCase()) ? stripQuery(value) : value;
    return scrubString(v);
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, key, depth + 1));
  if (value && typeof value === "object") {
    const out: Dict = {};
    for (const [k, v] of Object.entries(value as Dict)) out[k] = scrubValue(v, k, depth + 1);
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  return FILTERED;
}

function scrubUser(user: Json): Dict | null {
  if (!user || typeof user !== "object") return null;
  const id = (user as Dict).id;
  return typeof id === "string" && HASH_RE.test(id) ? { id } : null;
}

function scrubRequest(request: Json): Dict {
  if (!request || typeof request !== "object") return {};
  const r = request as Dict;
  const out: Dict = {};
  if (typeof r.method === "string") out.method = r.method.slice(0, 10);
  if (typeof r.url === "string") out.url = scrubString(stripQuery(r.url));
  if (r.headers && typeof r.headers === "object") {
    const headers: Dict = {};
    for (const [k, v] of Object.entries(r.headers as Dict)) {
      if (ALLOWED_HEADERS.has(k.toLowerCase())) headers[k] = scrubString(String(v));
    }
    out.headers = headers;
  }
  // data, cookies, query_string and env are dropped outright.
  return out;
}

function scrubException(block: Json): Json {
  if (!block || typeof block !== "object") return block;
  const b = block as Dict;
  const values = Array.isArray(b.values) ? (b.values as Dict[]) : [];
  return {
    ...b,
    values: values.map((entry) => {
      const e: Dict = { ...entry };
      if (typeof e.value === "string") e.value = scrubString(e.value);
      const st = e.stacktrace as Dict | undefined;
      if (st && Array.isArray(st.frames)) {
        e.stacktrace = {
          ...st,
          frames: (st.frames as Dict[]).map((fr) => {
            const f: Dict = { ...fr };
            delete f.vars;
            delete f.pre_context;
            delete f.context_line;
            delete f.post_context;
            if (typeof f.abs_path === "string") f.abs_path = scrubString(stripQuery(f.abs_path));
            return f;
          }),
        };
      }
      return e;
    }),
  };
}

export function scrubBreadcrumb(crumb: Json): Dict | null {
  if (!crumb || typeof crumb !== "object") return null;
  const c = crumb as Dict;
  if (typeof c.category === "string" && DROP_CRUMB_CATEGORIES.has(c.category.toLowerCase())) return null;
  const out: Dict = {};
  for (const k of ["type", "category", "level", "timestamp"]) if (k in c) out[k] = c[k];
  if (typeof c.message === "string") out.message = scrubString(c.message);
  if (c.data && typeof c.data === "object") {
    const data: Dict = {};
    for (const [k, v] of Object.entries(c.data as Dict)) {
      if (DROP_CRUMB_DATA_KEYS.has(k.toLowerCase())) continue;
      data[k] = scrubValue(v, k, 1);
    }
    out.data = data;
  }
  return out;
}

// Expected failures that are not bugs: network blips and a cancelled fetch are
// the normal state of a phone on a train, and a 4xx is the API working.
const EXPECTED_MESSAGES = [
  /^Load failed$/i, /^Failed to fetch$/i, /^NetworkError/i, /^The operation was aborted/i,
  /^AbortError/i, /^cancelled$/i, /ResizeObserver loop/i,
];

function isExpected(event: Dict, hint?: Dict): boolean {
  const original = hint?.originalException as { message?: unknown; name?: unknown; status?: unknown } | undefined;
  if (original && typeof original === "object") {
    if (typeof original.status === "number" && original.status >= 400 && original.status < 500) return true;
    if (original.name === "AbortError") return true;
    if (typeof original.message === "string" && EXPECTED_MESSAGES.some((re) => re.test(original.message as string))) return true;
  }
  const values = ((event.exception as Dict | undefined)?.values as Dict[] | undefined) ?? [];
  return values.some((v) => typeof v.value === "string" && EXPECTED_MESSAGES.some((re) => re.test(v.value as string)));
}

export function scrubEvent(event: Json, hint?: Dict): Dict | null {
  if (!event || typeof event !== "object") return null;
  const ev = event as Dict;
  if (isExpected(ev, hint)) return null;
  const out: Dict = {};
  for (const [key, value] of Object.entries(ev)) {
    if (["request", "user", "exception", "breadcrumbs", "server_name", "modules", "spans"].includes(key)) continue;
    out[key] = scrubValue(value, key, 1);
  }
  if ("request" in ev) out.request = scrubRequest(ev.request);
  const user = scrubUser(ev.user);
  if (user) out.user = user;
  if ("exception" in ev) out.exception = scrubException(ev.exception);
  const crumbs = ev.breadcrumbs;
  if (Array.isArray(crumbs)) {
    out.breadcrumbs = crumbs.map(scrubBreadcrumb).filter(Boolean);
  } else if (crumbs && typeof crumbs === "object") {
    const values = Array.isArray((crumbs as Dict).values) ? ((crumbs as Dict).values as Json[]) : [];
    out.breadcrumbs = { ...(crumbs as Dict), values: values.map(scrubBreadcrumb).filter(Boolean) };
  }
  if (Array.isArray(ev.spans)) {
    out.spans = (ev.spans as Dict[]).map((s) => {
      const { description: _d, data: _data, tags: _t, ...rest } = s;
      void _d; void _data; void _t;
      return rest;
    });
  }
  return out;
}

// ── Configuration shared by the web and the Capacitor init ──────────────────

export function resolveEnvironment(raw: string | undefined): "uat" | "production" {
  return (raw || "").trim().toLowerCase() === "production" ? "production" : "uat";
}

export function clampTracesSampleRate(raw: string | undefined): number {
  const n = raw === undefined || raw === "" ? MAX_TRACES_SAMPLE_RATE : Number(raw);
  if (!Number.isFinite(n)) return MAX_TRACES_SAMPLE_RATE;
  return Math.max(0, Math.min(n, MAX_TRACES_SAMPLE_RATE));
}

export function isHashedUserId(id: unknown): id is string {
  return typeof id === "string" && HASH_RE.test(id);
}
