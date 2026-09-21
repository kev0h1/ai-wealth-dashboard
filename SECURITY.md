# Security & Incident Response Policy — AURIQ LTD (Auriq Wealth)

**Owner:** Kevin Maingi, Founder / Information Security Manager
**Applies to:** the Auriq Wealth product (web app, iOS/Android apps) and all supporting infrastructure operated by AURIQ LTD.
**Status:** Version 1.11, last reviewed 2026-09-21. Reviewed at least annually and after any material incident or architecture change.

This document is the company's primary security policy. It exists to satisfy our obligations as a registered agent of Finexer LTD for Account Information Services (AIS) and under UK GDPR / the Data Protection Act 2018. It covers our security controls, our incident-response process, and our data-breach procedures.

---

## 1. Scope & responsibilities

AURIQ LTD processes UK consumers' bank account and transaction data, obtained with the customer's explicit consent through Finexer's (and other providers') open-banking APIs, to deliver a personal financial-management dashboard (AIS only — we never initiate payments or move customer money).

- **Information Security Manager (ISM):** Kevin Maingi — accountable for security, incident response, and regulator/partner notification.
- All personnel (currently founder-operated; future staff and contractors) must follow this policy and report suspected incidents immediately to the ISM.

## 2. Security controls (summary)

| Area | Control |
|------|---------|
| Bank token storage | Access/refresh tokens encrypted at rest with Fernet (AES); encryption key held only in environment/secret files, never in source control. |
| Secrets | All secrets injected via environment or git-ignored key files. `.env`, session/token/webhook/VAPID/APNs keys are git-ignored and never committed. |
| Authentication | Signed, time-limited session tokens (7-day expiry) verified on every request; sign-in only via Google or Apple verified identities; registration is restricted to an email allow list until public launch (OPEN_SIGNUP flag). |
| Transport security | TLS in transit; HTTPS terminated by managed platforms (Vercel/Railway) and MongoDB Atlas. |
| Network | Managed-platform firewalls, application-level rate limiting on auth/webhook routes, restricted CORS, and IP allow-listing of production API keys where supported (incl. Finexer). |
| Data store | MongoDB Atlas, access-controlled, hosted in a UK/EU region. |
| Backups | Encrypted nightly database backups to Cloudflare R2 with 30-day retention. |
| Webhooks | Signature/secret verification on inbound provider webhooks (TrueLayer: URL-embedded secret over HTTPS, no per-request signature — see `docs/security/pentest-scope-2026-09.md`; Finexer: URL-embedded secret plus HMAC-SHA256 request signing once the signing secret is configured; Stripe: SDK-verified signature). Covered by automated tests for all three (`backend/tests/test_truelayer_webhook.py`, `test_finexer_webhook.py`, `test_billing.py`). |
| Monitoring | Platform logs (Vercel/Railway/Atlas) and optional application error monitoring (Sentry). |
| Dependency & container scanning | Automated in CI (`.github/workflows/security-scan.yml`, added 2026-09): `npm audit`/`pip-audit` on every push/PR plus weekly, and a Trivy image scan of the backend container. Replaces the one-off manual audit below as the standing control; the audit log is kept as history. |
| Responsible disclosure | Public `security.txt` per RFC 9116 at `/.well-known/security.txt` on both UAT and production, pointing to `info@auriqltd.co.uk`. |

Detailed operational security notes live in `CLAUDE.md`, `DEPLOY.md`, and `ADR.md`.

### Dependency audit log

| Date | Surface | Tool | Result | Action |
|------|---------|------|--------|--------|
| 2026-09-06 | Frontend (`frontend/`) | `npm audit` | 8 advisories total across all dependencies (1 low, 7 high, 0 critical); 4 high in production dependencies only (`npm audit --omit=dev`: nanoid, next, postcss, sharp), the remaining 1 low and 3 high are dev-only tooling (`@babel/core`, `brace-expansion`, `browserslist`, `js-yaml`). | Recorded, not upgraded this pass. The next/postcss/sharp fixes require a Next.js major/minor jump (16.2.4 to 16.3.4) and were left for a dedicated upgrade item so the release isn't blocked. |
| 2026-09-06 | Backend (`backend/`, via a throwaway venv, not the shared `backend/.venv`) | `pip-audit` | 57 known advisories (44 unique, pip-audit reports some IDs twice) across 8 packages: `aiohttp` 3.13.5, `click` 8.3.2, `cryptography` 46.0.7, `idna` 3.11, `pillow` 12.2.0, `pyasn1` 0.6.3, `python-multipart` 0.0.29, `starlette` 1.0.0. `pip-audit`'s OSV backend does not assign severity ratings; every advisory has a fix version available. | Recorded, not upgraded this pass. Follow-up item needed to review and upgrade these packages, `backend/.venv` is shared with the live UAT service so upgrades are done deliberately with a restart and verification, not as part of this audit-recording task. |
| 2026-09-06 | Frontend, after upgrade (`frontend/`) | `npm audit --omit=dev` and `npm audit` | 0 vulnerabilities in production dependencies (down from 4 high: `nanoid`, `next`, `postcss`, `sharp`). Full `npm audit` (incl. dev deps) still shows 4 (1 low, 3 high) in dev-only tooling (`@babel/core`, `brace-expansion`, `browserslist`, `js-yaml`), unchanged and out of scope for this item. | Upgraded: `next` 16.2.4 to 16.3.4, `eslint-config-next` 16.2.4 to 16.3.4. Verified with `tsc --noEmit` and `next build --webpack` (both clean) before merge. |
| 2026-09-06 | Backend, after upgrade (`backend/`, via a throwaway venv, then applied to the shared `backend/.venv`) | `pip-audit` | 0 known advisories (down from 57). | Upgraded: `aiohttp` 3.13.5 to 3.14.3, `click` 8.3.2 to 8.3.3, `cryptography` 46.0.7 to 50.0.0, `idna` 3.11 to 3.15, `pillow` 12.2.0 to 12.3.0, `pyasn1` 0.6.3 to 0.6.4, `python-multipart` 0.0.29 to 0.0.31, `starlette` 1.0.0 to 1.3.1. `pyOpenSSL` 26.0.0 to 26.4.0 also bumped, required to resolve with the new `cryptography` pin; `fastapi` stayed at 0.136.0, its `starlette` requirement (`>=0.46.0`) did not need a bump to accept the new `starlette`. Full backend test suite (1301 tests) passed against both the throwaway venv and the shared `backend/.venv`. |
| 2026-09-10 | Backend (`backend/`, `pip-audit` run in a throwaway venv against a `pip freeze` of the live shared `backend/.venv`, 81 packages) | `pip-audit` 2.10.1 | 0 known advisories. | Re-run ahead of the production deploy tagged `release-20260910-1137`; no drift since the 2026-09-06 upgrade. Not upgraded, nothing to upgrade. |
| 2026-09-10 | Frontend (`frontend/`) | `npm audit --omit=dev` and `npm audit` | Production dependencies: 1 new moderate advisory, `baseline-browser-mapping` (process termination / denial of service on invalid input, GHSA-w5vr-8v7q-w6rv), pulled in transitively via `next`'s `browserslist` dependency; fix available via `npm audit fix`. Full `npm audit` (incl. dev deps): 5 advisories (1 low, 1 moderate, 3 high); the 3 high remain the same dev-only tooling as 2026-09-06 (`brace-expansion`, `browserslist`, `js-yaml`), unchanged. | Recorded, not upgraded this pass. The new moderate is a fresh advisory (published after 2026-09-06) in a package that ships as part of `next`; follow-up item needed to run `npm audit fix` and verify the build. No Critical or High in production dependencies. |

Dependency audits are re-run before each production release.

## 3. Incident classification

| Severity | Definition | Examples |
|----------|------------|----------|
| **Critical (P1)** | Confirmed or likely unauthorised access to customer bank/personal data, or loss of the token-encryption key. | Database exfiltration, leaked `TOKEN_ENCRYPTION_KEY`, account takeover. |
| **High (P2)** | Security control failure with potential for data exposure. | Auth bypass, exposed secret, exploited vulnerability without confirmed data loss. |
| **Medium (P3)** | Contained issue, no data exposure. | Blocked intrusion attempt, dependency vulnerability, misconfiguration caught before exploitation. |
| **Low (P4)** | Minor/no risk. | Isolated failed logins, spam. |

## 3a. Remediation SLA (A26, 2026-09)

These targets apply to a confirmed vulnerability or control failure found by
internal review, a dependency/container scan, or an external tester
(including the CREST engagement A7 is booking) — distinct from the incident
*response* timings in §4, which govern an active incident already under
way. A finding here may or may not also be an incident; if it is, both
apply (§4's containment/notification clock starts immediately regardless of
severity, remediation is tracked separately per the table below).

| Severity | Acknowledge | Remediate or mitigate | Notes |
|----------|-------------|------------------------|-------|
| **Critical (P1)** | Within 24 hours | Within 72 hours | A temporary mitigation (revoke a token, disable a route, roll back a deploy) that removes the exposure counts as meeting this target even if the full fix lands later; the exposure must stop within 72 hours, not just get a fix merged. |
| **High (P2)** | Within 3 business days | Within 14 days | |
| **Medium (P3)** | Within 5 business days | Within 30 days, or the next scheduled dependency/release cycle if sooner | Matches the existing dependency-audit cadence (§2's audit log; now also CI-automated, see below) — a Medium dependency finding is expected to be swept up by the next audit pass, not left open indefinitely. |
| **Low (P4)** | Best effort | Best effort, tracked on the product backlog (`TODO.md`) | Not a fixed deadline; still recorded, not silently dropped. |

The ISM (Kevin Maingi) owns triage and severity classification, using §3's
definitions. Today, as a founder-operated company, the ISM is also the only
person who can implement most fixes — these targets are a commitment on
effort and priority, not a guarantee that every fix ships within the
window regardless of complexity; a Critical finding that needs a genuine
architectural change (not a config flip or a revoke) still gets a mitigation
within 72 hours and the ISM communicates a realistic timeline for the full
fix.

This SLA is the answer this document backs for the Finexer compliance
questionnaire's Q11 ("Security and incident controls, testing"); see
`docs/compliance/finexer-agent-controls-2026-09.md` for the questionnaire
answer itself (not edited by this pass) and
`docs/security/pentest-scope-2026-09.md` /
`docs/security/oauth-threat-model.md` for the pentest-readiness evidence
Q11 can also cite.

## 3b. Internal security testing, 2026-09-19/20 (A45)

**What this was.** AURIQ LTD performed an internal security assessment of
Sorted, executed by this project's own AI agents (Claude and Codex working
sessions), under a signed rules-of-engagement record
(`docs/security/pentest-runs/roe-record.md`, authorised by Kevin,
2026-09-20). Test identities are referred to only by pseudonym (PT-A, PT-B,
PT-C); real identifiers live only in a gitignored, non-committed file. This
was internal testing and was not an independent third-party or CREST
engagement. The separate, future external engagement (board item A7, a
CREST-accredited penetration test) remains open and is booked ahead of
public launch; this round is its internal precursor, not a substitute for
it.

**What was executed.** Seven work packages ran on 2026-09-19 and
2026-09-20, each recording its own sanitised evidence under
`docs/security/pentest-runs/<run-id>/`:

| Work package | Scope | Board item |
|---|---|---|
| WP1 | Web shell and `/design` preview routes | A48 |
| WP3 | API tenant and object authorisation, including account deletion | A50 |
| WP4 | API input handling, uploads, business-logic ordering | A51 |
| WP5 | OAuth 2.1 authorisation server | A52 |
| WP7a | Android app shell, static analysis only | A54 |
| WP9 | Finexer and TrueLayer boundary | A57 |
| WP11 | OpenRouter and Penny trust boundary | A59 |

WP0 (A47) built the evidence and rules-of-engagement harness ahead of these
seven. Findings raised during execution were triaged against a
single-reviewer (same-model) pass; WP12, the cross-model review where a
Codex session checks every Claude-run package and vice versa (board item
A60), has not yet started, so no finding below has had its severity or
validity checked by the other model yet. Final severities remain the ISM's
to confirm per section 3a.

**Not yet executed**, and not reflected in the findings below because no
test has been run: WP2 (general API rate-limiting, CORS and error-handling
hardening, A49), WP6 (the MCP connector, A53), WP7b (Android dynamic
testing on a device, A55) and WP10 (the Stripe fail-closed boundary, A58).
WP8 (iOS, A56) has had only a static, repository-level review; dynamic iOS
testing has not run. All four sit open on the internal backlog with no
recorded test run; none of the four surfaces they cover should be read as
cleared by this round.

**Findings.** Every finding below is currently open; none has been
remediated (Kevin's deliberate choice was to report first and fix after,
see each item's own board note). Severities use section 3's bands and are
provisional pending the ISM's sign-off and the still-owed cross-model
review above.

*High (P2): three findings, one root cause. The account-deletion path
does not disconnect a customer's bank connection before erasing local
data.*

| Item | Finding | Status |
|---|---|---|
| A82 | Account deletion never revokes the Finexer consent first, orphaning it at the provider | Open |
| A83 | `GET /connections` does not list live Finexer connections, hiding the very connection A82's disconnect-first step needs | Open |
| A84 | A deleted account's session token is not invalidated and remains usable for up to 7 days; it has been shown able to write persistent data that reattaches if the account is later recreated with the same email | Open |

*Medium (P3)*

| Item | Finding | Status |
|---|---|---|
| A73 | OAuth consent page under-emphasises the true redirect host relative to the connector's self-reported name | Open |
| A74 | Refresh-token rotation does not cascade-revoke the sibling access token from the same grant (pre-documented gap) | Open |
| A79 | Bank narrative text is sent to OpenRouter for categorisation and Penny read tools, unredacted (pre-documented design concern) | Open |
| A88 | Finexer consent callback accepts a missing `state` parameter (defence-in-depth gap only; no cross-account path exists because binding is fixed at session-gated consent creation) | Open |
| A89 | Webhook path-secret comparison is not constant-time (no practical timing exploit identified; the secret also functions as a long random URL segment) | Open |

*Low (P4)*

| Item | Finding | Status |
|---|---|---|
| A76 | `/design/*` preview routes are publicly indexable (no `robots.txt`/`X-Robots-Tag`) | Open |
| A77 | The native-purchase `X-Client-Platform` header check can be bypassed by omitting it (billing is not live; pre-documented) | Open |
| A80 | No global/service-wide OpenRouter spend ceiling exists, only a per-user monthly allowance | Open |
| A81 | The per-user LLM allowance check fails open, not closed, on an internal lookup error (documented, deliberate trade-off) | Open |
| A85 | `PATCH /preferences` has no optimistic-concurrency check and accepts an unadvertised field (mass assignment) | Open |
| A86 | The commitment state machine allows out-of-order transitions and has no create-time idempotency check | Open |

A75 (a frontend-only distribution flag with no backend equivalent) is a
product-intent question for Kevin, not a severity-rated security finding.

**Headline.** No Critical findings. Three High findings, all one
deletion-lifecycle workstream (A82/A83/A84), none yet remediated.
Everything else found is Medium or Low. All findings above remain open.

**Scope caveats, stated plainly.** This round has real, acknowledged gaps
that a reader of the findings list above should not have to infer:

- The cross-model (Codex) review of every Claude-run package, and the
  Claude review of every Codex-run package (WP12, A60), has not started.
- Two Finexer/TrueLayer cases could not be completed: `FIN-06` (webhook
  payload retention) and the accepted-delivery live halves of `FIN-01` and
  `TL-02`, because this testing session has no production database read
  path and no provider-approved sandbox consent exists.
- iOS dynamic testing (WP8) has not run. The methodology's default is to
  defer it to the external A7 engagement; Kevin has since confirmed he has
  a TestFlight build and a device and could run it himself instead, but
  that decision and the run itself remain open.
- A temporary `OPEN_SIGNUP` window on production (opened and closed on
  2026-09-19, board item A63, to create test identities) was not audited
  for unexpected registrations during the roughly 36-minute window it was
  open.
- WP2, WP6, WP7b and WP10 (see "Not yet executed" above) have not been
  executed at all; their surfaces (general API hardening, the MCP
  connector, Android dynamic behaviour, and the Stripe billing boundary)
  carry no internal test coverage from this round.

This section is the evidence Q11 ("Security and incident controls,
testing") cites for the internal testing programme; see
`docs/compliance/finexer-agent-controls-2026-09.md` for the questionnaire
answer and `docs/security/pentest-runs/` for the sanitised per-run records.

## 4. Incident response process

Every incident follows this lifecycle. The ISM leads; timings below are targets.

1. **Detect & record** — Identify via monitoring, provider (Finexer) notification, user report, or internal discovery. Open an incident record with timestamp, reporter, and initial description.
2. **Contain** — Stop the bleeding. As applicable: revoke affected bank access tokens; revoke affected Finexer consents (`DELETE /consents/{id}`); disable affected accounts/allowlist access; rotate compromised secrets (`SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, webhook secrets, provider API keys); block malicious IPs; take affected services offline if necessary.
3. **Assess scope** — Determine what data, which customers, and which systems are affected, and whether personal data was accessed, altered, or lost. Classify severity (§3).
4. **Notify** —
   - **Finexer:** report any breach of our systems, non-compliance, money-laundering attempt, or other incident **as soon as practicable and within 24 hours** of becoming aware, per our agency agreement.
   - **ICO:** report a personal-data breach **within 72 hours** of becoming aware where it poses a risk to individuals' rights and freedoms.
   - **Affected individuals:** notify without undue delay where the breach is likely to result in a **high risk** to their rights and freedoms.
   - Maintain an internal record of the incident regardless of whether external notification is required.
5. **Remediate** — Eradicate the root cause, restore from clean backups if needed, apply patches/config fixes, and verify the fix.
6. **Post-incident review** — Within 5 working days of closure, document root cause, timeline, impact, actions taken, and preventative measures. Feed lessons back into controls and this policy.

## 5. Data-breach procedures

A **personal data breach** is any breach of security leading to accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to customer personal or financial data.

- Any suspected breach is treated as an incident (§4) and, if it involves personal data, triggers the ICO 72-hour assessment and the Finexer 24-hour notification.
- The ISM maintains a breach register recording: date/time of discovery, nature of the breach, categories and approximate number of individuals and records affected, likely consequences, and measures taken.
- Where notification thresholds are met, notifications include the nature of the breach, contact point, likely consequences, and mitigating measures.

## 6. Data retention

AURIQ LTD retains customer data only for as long as necessary to provide the service and to meet legal obligations, in line with the UK GDPR storage-limitation principle. This section defines our retention periods and deletion mechanisms.

*Status: DRAFT. Periods marked `[CONFIRM]` are provisional defaults pending founder sign-off. The automated purge jobs below now enforce the account/transaction retention limits, running nightly at 03:30 UTC as an arq cron job (`task_retention_sweep`), in addition to the user-initiated mechanisms.*

| Data category | Retention period | Mechanism |
|---------------|------------------|-----------|
| Bank account & transaction data | Retained while the customer's account is open and the open-banking consent is active. Deleted within `[CONFIRM: 30]` days of account closure, consent withdrawal or expiry, or after `[CONFIRM: 12]` months of account inactivity. | User-initiated (account deletion / bank disconnect) plus a nightly automated sweep: a bank connection is auto-purged 30 days after its consent expires or is withdrawn if the customer never disconnected it themselves, and a whole account is auto-purged after 12 months with no sign-in. |
| Open-banking consent records (status, timestamps) | Life of the connection plus `[CONFIRM: 12]` months for audit, then deleted. | Consent records. |
| Encrypted bank access tokens | Deleted immediately on bank disconnect or account deletion; overwritten on consent renewal. | Cascade on disconnect + remote consent revoke. |
| AI chat sessions | 7 days. | Automatic TTL. |
| Savings-insight caches | 30 days. | Automatic TTL. |
| Webhook event logs | 30 days. | Automatic TTL. |
| Database backups | 30-day rolling window (nightly encrypted backups to Cloudflare R2). | Automatic prune. |
| Records required by law or regulator (if any) | Statutory minimum, then deleted. | Manual review. |

**Deletion mechanisms:**
- **Right to erasure:** a customer can delete their entire account, removing their records across all data stores; deletions cascade to their accounts and transactions.
- **Bank disconnect:** removes that connection's accounts and transactions and revokes the provider (e.g. Finexer) consent.
- **Backups:** data belonging to deleted customers ages out of encrypted backups within the 30-day backup window.

Retention periods are reviewed at least annually.

## 7. GDPR compliance

Personal information is processed in line with the seven UK GDPR principles:

- **Lawfulness, fairness & transparency** — bank data is accessed only on the customer's explicit open-banking consent, captured on the provider's (Finexer) and bank's hosted consent pages before any data is retrieved.
- **Purpose limitation** — data is used solely to provide the account-information dashboard and insights the customer signed up for; it is never sold and never used for marketing.
- **Data minimisation** — only the data needed is retrieved (typically the last ~90 days of transactions) and the minimum is shared with sub-processors (e.g. only merchant name/description for categorisation).
- **Accuracy** — transaction data is sourced directly from the customer's bank via open banking, and customers can view and re-categorise their own data in-app.
- **Storage limitation** — data is retained only as long as necessary under our Data Retention Policy (§6) and deleted on account closure or request.
- **Integrity & confidentiality** — bank tokens are encrypted at rest (AES/Fernet), data is encrypted in transit (TLS), and access is restricted and access-controlled.
- **Accountability** — our security, incident-response and retention practices are documented in this policy.

*ICO registration is complete (registration number ZC214737). Open item to address (draft): publish the customer-facing privacy notice to fully satisfy the transparency principle.*

### Privacy notice & consent withdrawal

We will publish a customer-facing privacy notice (accessible in-app and on the website) covering: who we are and how to contact us; the personal and financial data we process; the lawful basis (explicit consent) and purposes; the sub-processors we share data with; retention periods (see §6); customers' rights (access, rectification, erasure, portability, objection, and withdrawal of consent); and how to complain to the ICO.

Customers can withdraw consent and have their data removed at any time, using mechanisms already built into the app:

- **Disconnect a bank** — revokes the open-banking consent with the provider (e.g. Finexer) and deletes that connection's accounts and transactions.
- **Delete account** — full erasure of the customer's data across all data stores.

*Open item (draft): the privacy notice described above is documented here but is NOT yet published as a customer-facing page. Until it is published and linked (login screen, bank-connect step, and settings), the app does not yet fully satisfy the transparency requirement. Action: publish a `/privacy` page and link it.*

## 8. Contacts

- **Internal (ISM):** Kevin Maingi — info@auriqltd.co.uk / 07398773162.
- **Finexer:** TBC.
- **ICO:** report at ico.org.uk or the ICO breach helpline within 72 hours.

## 9. Review

This policy is reviewed at least annually, and after any material incident, change of provider, or significant change to the system architecture. Version history is tracked below.

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-08-09 | Initial policy. |
| 1.1 | 2026-08-09 | Added Data retention section (draft). |
| 1.2 | 2026-08-09 | Added GDPR compliance section (draft). |
| 1.3 | 2026-08-09 | Documented privacy notice & consent-withdrawal process (draft; page not yet published). |
| 1.4 | 2026-08-14 | Recorded ICO registration; drafted Privacy Policy and Terms & Conditions. |
| 1.5 | 2026-09-06 | Removed legacy PIN login; masked reconnect state; first recorded dependency audit. |
| 1.6 | 2026-09-06 | Automated retention sweeps (connections 30 days after consent ends, dormant accounts after 12 months). |
| 1.7 | 2026-09-06 | Dependency upgrades from the audit (Next 16.3.4; aiohttp, pillow, cryptography, starlette, pyasn1, python-multipart, idna, click). |
| 1.8 | 2026-09-08 | Contact address changed to info@auriqltd.co.uk. |
| 1.9 | 2026-09-10 | Fresh dependency audit ahead of the production deploy (release-20260910-1137); recorded below. |
| 1.10 | 2026-09-14 | A26 pentest-readiness pass: added the remediation SLA (§3a); dependency/container scanning moved from a one-off manual audit to CI (`.github/workflows/security-scan.yml`); added public `security.txt` (RFC 9116); OAuth 2.1 authorisation server threat-modelled for the first time (`docs/security/oauth-threat-model.md`) and a concurrent-redemption race in the authorization-code and refresh-token exchange fixed; added webhook replay/forgery tests for TrueLayer (previously untested) alongside the existing Finexer/Stripe coverage; confirmed bank tokens are Fernet-encrypted at rest for TrueLayer connections (read-only check against live UAT data) and found Yapily's dormant consent-token storage is not (flagged, not fixed — see `docs/security/pentest-scope-2026-09.md`); added a CI guard against `/design` preview routes reaching real data, and found six existing preview files already do (flagged, not fixed, same document). |
| 1.11 | 2026-09-21 | A45 draft: added §3b recording the internal security testing round of 2026-09-19/20 (seven work packages, findings by severity, all currently open) and its scope caveats, folded into Q11 as a proposed answer pending Kevin's sign-off. |
