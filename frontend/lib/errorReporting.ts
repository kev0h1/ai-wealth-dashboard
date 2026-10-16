// E6: the app's two touch points with Sentry besides its init
// (instrumentation-client.ts): report a caught render error from an error
// boundary, and tag the signed-in user with the server's hashed id. Both are
// fire-and-forget and swallow every failure, so reporting can never break a
// screen. Without a DSN the SDK is never loaded.
import { isHashedUserId } from "./observability";

const enabled = () => !!process.env.NEXT_PUBLIC_SENTRY_DSN;

// The thrown error is never shown to the user (it can carry upstream text),
// but it is sent to Sentry after scrubbing. `digest` links a server render
// error to its server-side event.
export function reportBoundaryError(error: unknown, boundary: string): void {
  if (!enabled()) return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(error, { tags: { boundary } });
    })
    .catch(() => {});
}

export function identifyForErrorReporting(uidHash: unknown): void {
  if (!enabled()) return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.setUser(isHashedUserId(uidHash) ? { id: uidHash } : null);
    })
    .catch(() => {});
}
