"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { resyncCapacitorPush } from "@/lib/capacitorPush";
import { hydrateToken } from "@/lib/auth";
import { resyncWebPush } from "@/lib/notificationPermissions";

// Self-heals native push registration drift on app launch: an FCM/APNs
// token that rotated silently, or a token whose registration POST failed
// the first time. No-op on web and no-op unless OS permission is already
// granted and a session exists (see resyncCapacitorPush in lib/capacitorPush.ts
// for the full guard chain). Renders nothing.
// A120: /auth/logout deletes the server-side web-push row but the browser's
// own PushSubscription survives, so Settings still reads "on". Re-POST the
// existing subscription on sign-in (never prompts, never subscribes anew) so
// a web user who logs out and back in keeps getting pushes.
export default function NativePushResync() {
  // A120: keyed on the signed-in user so a device that logs out and back in
  // (no app relaunch) registers for push again.
  const { user } = useAuth();
  const email = user?.email ?? null;
  useEffect(() => {
    if (!email) return;
    // A123: on native the token is hydrated from Keychain/Keystore before
    // AuthProvider renders its children, so on ordinary routes this is
    // already done. On AuthProvider's exempt routes (/design, /terms,
    // /privacy, /oauth/consent) children mount before hydration, so wait on
    // the shared, idempotent promise rather than let resyncCapacitorPush's
    // getToken() guard skip registration on a cold start.
    hydrateToken().then(() => resyncCapacitorPush()).catch(() => {});
    if (email) resyncWebPush(email).catch(() => {});
  }, [email]);
  return null;
}
