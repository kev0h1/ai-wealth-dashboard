# Security & Incident Response Policy — AURIQ LTD (Auriq Wealth)

**Owner:** Kevin Maingi, Founder / Information Security Manager
**Applies to:** the Auriq Wealth product (web app, iOS/Android apps) and all supporting infrastructure operated by AURIQ LTD.
**Status:** Version 1.6 — last reviewed 2026-09-06. Reviewed at least annually and after any material incident or architecture change.

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
| Webhooks | Signature/secret verification on inbound provider webhooks. |
| Monitoring | Platform logs (Vercel/Railway/Atlas) and optional application error monitoring (Sentry). |

Detailed operational security notes live in `CLAUDE.md`, `DEPLOY.md`, and `ADR.md`.

### Dependency audit log

| Date | Surface | Tool | Result | Action |
|------|---------|------|--------|--------|
| 2026-09-06 | Frontend (`frontend/`) | `npm audit` | 8 advisories total across all dependencies (1 low, 7 high, 0 critical); 4 high in production dependencies only (`npm audit --omit=dev`: nanoid, next, postcss, sharp), the remaining 1 low and 3 high are dev-only tooling (`@babel/core`, `brace-expansion`, `browserslist`, `js-yaml`). | Recorded, not upgraded this pass. The next/postcss/sharp fixes require a Next.js major/minor jump (16.2.4 to 16.3.4) and were left for a dedicated upgrade item so the release isn't blocked. |
| 2026-09-06 | Backend (`backend/`, via a throwaway venv, not the shared `backend/.venv`) | `pip-audit` | 57 known advisories (44 unique, pip-audit reports some IDs twice) across 8 packages: `aiohttp` 3.13.5, `click` 8.3.2, `cryptography` 46.0.7, `idna` 3.11, `pillow` 12.2.0, `pyasn1` 0.6.3, `python-multipart` 0.0.29, `starlette` 1.0.0. `pip-audit`'s OSV backend does not assign severity ratings; every advisory has a fix version available. | Recorded, not upgraded this pass. Follow-up item needed to review and upgrade these packages, `backend/.venv` is shared with the live UAT service so upgrades are done deliberately with a restart and verification, not as part of this audit-recording task. |

Dependency audits are re-run before each production release.

## 3. Incident classification

| Severity | Definition | Examples |
|----------|------------|----------|
| **Critical (P1)** | Confirmed or likely unauthorised access to customer bank/personal data, or loss of the token-encryption key. | Database exfiltration, leaked `TOKEN_ENCRYPTION_KEY`, account takeover. |
| **High (P2)** | Security control failure with potential for data exposure. | Auth bypass, exposed secret, exploited vulnerability without confirmed data loss. |
| **Medium (P3)** | Contained issue, no data exposure. | Blocked intrusion attempt, dependency vulnerability, misconfiguration caught before exploitation. |
| **Low (P4)** | Minor/no risk. | Isolated failed logins, spam. |

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

- **Internal (ISM):** Kevin Maingi — kevin.maingi@auriqltd.co.uk / 07398773162.
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
