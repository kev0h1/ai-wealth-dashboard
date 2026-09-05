# Repository workflow

## Review and delivery

- The root agent owns product intent, architecture, acceptance criteria, integration, final review, and all shared-state actions.
- Use a frontier model for planning, financial-product logic, UX judgment, security review, and final synthesis.
- Delegate only bounded, independent workstreams with explicit file scope and acceptance criteria. Use balanced coding models for normal implementation and efficient models for narrow tests, documentation, or mechanical edits.
- Preferred routing in the current Codex model family: `gpt-5.6-sol` at high/xhigh for orchestration and high-stakes review, `gpt-5.6-terra` at medium/high for implementation, and `gpt-5.6-luna` at low/medium for narrow mechanical work. Use at most the independent workstreams the task actually needs.
- Do not delegate deterministic shell work. The root agent runs searches, file inspection, builds, tests, Git operations, and service commands directly.
- After verified code changes, use the repository/deployment-supported restart path for every affected running service, then check service status and relevant health endpoints. Do not restart unrelated services. If restart requires elevated access, request it explicitly.
- On this host the supported running services are `wealth-api.service`, `wealth-frontend.service`, and `wealth-worker.service`. Restart only affected units with `systemctl restart`; verify them with `systemctl is-active`, API `GET http://127.0.0.1:8000/health`, and an HTTP 200 from the affected frontend route on `http://127.0.0.1:3030`. Backend API/service changes affect `wealth-api`; frontend production-build changes affect `wealth-frontend`; do not restart the worker unless worker-consumed code changed.
- Avoid parallel edits to the same files. Review delegated work before integration.
- For review, diagnosis, and planning, inspect and report without unrelated edits. For an explicitly requested fix or build, implement in-scope changes and verify them.

## Product-quality review

- Review UX and accessibility together with frontend and backend correctness, security, and performance.
- Financial figures must visibly reconcile. Never hide a meaningful sign, and distinguish balances, cash flows, forecasts, buffers, commitments, allocations, and card reserves.
- Prefer plain-language labels and progressive disclosure over compressed financial equations.
- Check mobile and desktop layouts, light and dark themes, loading/empty/stale/error states, keyboard behavior, screen-reader semantics, colour contrast, and tap targets.
- Keep security and performance findings tied to the feature path under review unless the user explicitly requests an application-wide audit.

## Screenshot workflow

- User-provided review images are stored in `/root/codex-images` (`~/codex-images`).
- Inspect images at original detail and compare them with the implementation.
- After completing the review, delete only the image files that were reviewed, then verify the folder state and tell the user what was removed.
