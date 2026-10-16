// E6: browser and Capacitor error capture. Next 16 (Turbopack) loads this file
// on the client before hydration; it replaces the older sentry.client.config.ts.
//
// No DSN (NEXT_PUBLIC_SENTRY_DSN unset: local, CI, tests, every build until
// Kevin sets it) means nothing is initialised and nothing is sent. Session
// replay is not imported at all. Traces are sampled at 0.1 at most. No
// tunnel: events go straight to Sentry's ingest host (EU region) over the
// SDK's own non-blocking transport. Every event and breadcrumb is scrubbed in
// lib/observability.ts first.
import { Capacitor } from "@capacitor/core";
import {
  clampTracesSampleRate,
  resolveEnvironment,
  scrubBreadcrumb,
  scrubEvent,
} from "./lib/observability";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const common = {
    dsn,
    environment: resolveEnvironment(process.env.NEXT_PUBLIC_APP_ENV),
    release: process.env.NEXT_PUBLIC_RELEASE_SHA || undefined,
    sendDefaultPii: false,
    tracesSampleRate: clampTracesSampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
    maxBreadcrumbs: 50,
    // Typed loosely on purpose: the scrubbers are SDK-agnostic.
    beforeSend: scrubEvent as never,
    beforeSendTransaction: scrubEvent as never,
    beforeBreadcrumb: scrubBreadcrumb as never,
  };

  let native = false;
  try {
    native = Capacitor.isNativePlatform();
  } catch {
    native = false;
  }

  if (native) {
    // The Capacitor SDK wraps @sentry/react and adds the native crash layer.
    // `npx cap sync` links the native half; see docs/ops/OBSERVABILITY.md.
    void Promise.all([import("@sentry/capacitor"), import("@sentry/react")])
      .then(([SentryCapacitor, SentryReact]) => {
        SentryCapacitor.init(
          {
            ...common,
            // Native layer (E6, docs/ops/OBSERVABILITY.md): crash handling stays
            // on, everything that would widen what the native SDKs collect or
            // sync is off. Native crash reports do NOT pass through the JS
            // beforeSend, so these options are what bounds them.
            enableNative: true,
            enableNativeCrashHandling: true,
            enableNdkScopeSync: false, // do not copy JS scope (breadcrumbs, tags) into native crash reports
            enableAutoSessionTracking: false,
            enableCaptureFailedRequests: false, // no failed-request events with URLs
            enableAutoPerformanceTracing: false,
            enableAppHangTracking: false,
            attachThreads: false,
            attachScreenshot: false,
          } as never,
          SentryReact.init,
        );
      })
      .catch(() => {
        /* error reporting must never break the app */
      });
  } else {
    void import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.init(common);
      })
      .catch(() => {
        /* error reporting must never break the page */
      });
  }
}
