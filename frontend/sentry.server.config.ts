// E6: Sentry for the Next.js server runtime. Only imported by instrumentation.ts
// when NEXT_PUBLIC_SENTRY_DSN is set. Same scrubbing and sampling as the
// browser (lib/observability.ts).
import * as Sentry from "@sentry/nextjs";
import { clampTracesSampleRate, resolveEnvironment, scrubBreadcrumb, scrubEvent } from "./lib/observability";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: resolveEnvironment(process.env.NEXT_PUBLIC_APP_ENV),
  release: process.env.NEXT_PUBLIC_RELEASE_SHA || undefined,
  sendDefaultPii: false,
  tracesSampleRate: clampTracesSampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
  maxBreadcrumbs: 50,
  beforeSend: scrubEvent as never,
  beforeSendTransaction: scrubEvent as never,
  beforeBreadcrumb: scrubBreadcrumb as never,
});
