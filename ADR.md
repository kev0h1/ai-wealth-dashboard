# Architecture Decision Records

## ADR-001: Modular Monolith over Microservices

**Status:** Accepted  
**Date:** 2026-06-15

### Context
The application started as a single `backend/main.py` file (~5200 lines). The team considered splitting into separate microservices (auth service, sync service, AI service, etc.).

### Decision
Adopt a modular monolith: one FastAPI process with domain-split `APIRouter` modules under `backend/app/`. Workers run as separate processes but share the same codebase.

### Consequences
- **+** Single deployment unit; no inter-service networking or serialisation overhead.
- **+** All domain code shares the same Python imports — no duplication of models or DB clients.
- **+** Easier local development and debugging.
- **−** A single runaway request can affect all endpoints (mitigated by uvicorn's async concurrency).
- **−** Cannot independently scale individual domains (acceptable at current traffic).

---

## ADR-002: Motor (async MongoDB) as the sole data store

**Status:** Accepted  
**Date:** 2026-06-15

### Context
The app needs to store heterogeneous financial data (transactions, accounts, preferences, chat history) across multiple providers with varying schemas.

### Decision
Use MongoDB via Motor (async driver) for all persistence. All collections are module-level singletons in `backend/app/db/collections.py`.

### Consequences
- **+** Schema-free documents accommodate different provider payloads without migrations.
- **+** Motor's async interface integrates naturally with FastAPI/asyncio.
- **+** Single DB technology reduces operational complexity.
- **−** No referential integrity; application code must enforce consistency.
- **−** Aggregation pipelines are more verbose than SQL for reporting queries.

---

## ADR-003: arq (Redis-backed) for background workers

**Status:** Accepted  
**Date:** 2026-06-15

### Context
Bank syncs and AI categorisation are slow (5–60 s each). Running them inline blocks API responses and risks client timeouts.

### Decision
Use `arq` (async Redis queue) with two separate worker processes: `sync_worker` (bank data fetching) and `ai_worker` (LLM categorisation). Both share the same `backend/app/` package.

### Consequences
- **+** Long-running tasks don't block HTTP responses.
- **+** Workers can be scaled independently of the API.
- **+** arq is asyncio-native — no threading complexity.
- **−** Adds Redis as a required dependency.
- **−** Job results are ephemeral; failures must be surfaced via logging rather than HTTP responses.

---

## ADR-004: OpenRouter as LLM gateway

**Status:** Accepted  
**Date:** 2026-06-15

### Context
The app uses LLMs for transaction categorisation, rule parsing, PDF statement extraction, and savings insights. Running a dedicated LLM is impractical.

### Decision
Route all LLM calls through OpenRouter (`openrouter.ai/api/v1/chat/completions`). Default model is `anthropic/claude-haiku-4-5` for speed/cost; `google/gemini-2.5-flash` for PDF parsing.

### Consequences
- **+** Single API key and endpoint regardless of underlying model.
- **+** Easy to swap models without code changes.
- **+** Pay-per-token pricing with no infrastructure.
- **−** External dependency; outage halts AI features (graceful degradation to "Other" category applied).
- **−** Sensitive transaction descriptions are sent to a third-party — mitigated by OpenRouter's data policies and the fact that no PII beyond merchant names is transmitted.

---

## ADR-005: TrueLayer + Yapily + Mono as open-banking providers

**Status:** Accepted  
**Date:** 2026-06-15

### Context
UK bank connection (TrueLayer/Yapily) and Kenyan bank connection (Mono) are required. No single provider covers both regions.

### Decision
Support three providers simultaneously, selectable per user via the `region` preference field. Each provider has its own sync service module and dedicated MongoDB collections (prefixed `yapily_`, `mono_`).

### Consequences
- **+** UK and Kenya users share the same codebase and UI.
- **+** Provider-specific bugs are isolated to their service module.
- **−** Three separate OAuth/webhook flows to maintain.
- **−** KPI and transaction queries must union results from multiple collections (handled by `get_user_region` routing in each endpoint).

---

## ADR-006: Session tokens via `itsdangerous` (no JWT library)

**Status:** Accepted  
**Date:** 2026-06-15

### Context
The app needs stateless auth tokens without a full JWT stack. Google OAuth and PIN login both need to issue tokens that expire.

### Decision
Use `itsdangerous.URLSafeTimedSerializer` to sign session payloads with the `SESSION_SECRET` env var. Tokens are validated server-side on every request in `auth_middleware`.

### Consequences
- **+** No extra JWT dependency; `itsdangerous` is already a FastAPI/Starlette transitive dependency.
- **+** Revocation is implicit — changing `SESSION_SECRET` invalidates all tokens.
- **−** No standard JWT format; cannot be validated by third-party tooling.
- **−** Token payload is base64url-encoded (not encrypted) — don't put secrets in it.

---

## ADR-007: Multi-stage Docker builds with nginx reverse proxy

**Status:** Accepted  
**Date:** 2026-06-15

### Context
Production deployment needs a minimal container image, SSL termination, and a way to serve both the Next.js frontend and FastAPI backend under one domain.

### Decision
- **Backend**: multi-stage Python build (`python:3.12-slim`); `poppler-utils` installed for PDF text extraction.
- **Frontend**: multi-stage Node build with `output: "standalone"` in `next.config.ts` to produce a self-contained `server.js`.
- **nginx**: alpine image as TLS terminator and reverse proxy; `/api/*` → FastAPI, `/*` → Next.js. SSL cert placeholders in `nginx/ssl/` (populated at deploy time via Certbot or manual copy).
- **docker-compose**: orchestrates api, sync_worker, ai_worker, frontend, nginx, redis as named services.

### Consequences
- **+** Single `docker-compose up` starts the full stack.
- **+** Standalone Next.js output removes `node_modules` from the runtime image.
- **+** nginx handles SSL offloading; both services speak plain HTTP internally.
- **−** `nginx/ssl/` must be populated before HTTPS works (HTTP-only mode provided as fallback).
- **−** All services share one Docker network; a compromised container can reach others (acceptable for a personal finance app on a private VPS).
