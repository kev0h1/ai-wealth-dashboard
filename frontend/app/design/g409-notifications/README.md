# G409 notification permission design round

Two temporary proposals extend the Calm Cockpit system with the `impeccable`
skill. They use existing Figtree typography, slate surfaces, indigo actions,
neutral permission states, 44px minimum targets and the shared `SheetFrame`.
No new design tokens or lasting system decisions are proposed.

- A, Quiet introduction: a short explanation on the canvas, followed on Home
  by one fully tappable permission row.
- B, Example first: a single fictional bill notification demonstrates the
  purpose. The Home reminder has a separate explanatory line and action.

Open `/design/g409-notifications?variant=a` or `?variant=b`. The examples
and display disclosure selects the platform, permission state and theme.
`clean=1` hides preview controls for screenshots. `tips=1` shows the optional
tips notification topic and its proposed copy, “New tips about your spending”.
The default preview hides tips so it does not presume that feature is enabled.

These pages are proposals. All permission requests, settings hand-offs,
registration results and preference changes are local simulations. No native
permission API, browser permission API, real preference save, device
registration, bank connection or push test is called. The Home hero, greeting
and reconnect strip use existing components with fictional fixtures; the
transfer check and notification surfaces are hand-authored proposals.
The page intercepts product navigation to keep a reviewer in the preview.

## Behaviour represented

1. After sign-in, an unasked iOS, Android 13+ or supported-browser user sees
   the introduction. The browser request follows a direct user gesture.
   Continue leads to a clearly labelled simulated system request. Allow goes
   to Home; denial leaves the persistent Home reminder below reconnect and
   the payments check. There is no dismiss control for that reminder.
2. Blocked native permission leads to the simulated app settings hand-off.
   Returning unchanged keeps the reminder. Returning with permission on
   represents a fresh permission check and successful device registration.
3. Permission and registration are distinct. A granted permission with
   incomplete registration offers a setup retry rather than another OS
   request. A browser permission recheck similarly leaves setup incomplete
   until the explicit setup action succeeds.
4. Browser denial offers manual site-permission instructions, with no promise
   that a webpage can open browser settings. The iPhone Safari example
   explains the Home Screen installation requirement. Unsupported browsers
   and old native builds show an unavailable state, never a false denial.
5. Android 12 has no runtime request screen. Its off-permission example
   assumes the future native enabled-status check described below.
6. Every user-facing topic starts on for a fresh user. “Existing choices kept”
   retains explicit off choices for transactions and bill alerts. Toggles
   remain usable when permission is off. Settings contains no test push.
7. Permission-read and settings-opening errors have neutral copy with retry.
   The checking example does not offer an active settings action before the
   read has completed. Both themes, keyboard focus and shared sheet dismissal
   are part of the proposals.

## Production follow-up after the selected design

The production components, preference defaults, native binaries and build
workflows are unchanged in this round. Implement these together at fold-in:

- Mount a shared permission controller after authentication and unlock,
  before first-run tutorials or account connection. It must not run on the
  anonymous design, legal or authentication routes, or the separate Board app.
  Keep user/session cancellation and account switches safe. Persist a
  device-local, per-user “asked” marker before the request; denial must not cause an
  automatic repeat prompt on another launch. Read OS permission as the
  authority rather than treating the marker as a grant.
- Keep background `resyncCapacitorPush()` prompt-free. Coordinate first-run
  registration with that existing resync so double taps and concurrent
  components cannot request permission or register twice.
- Add an available-capability-checked native settings bridge. Android opens
  `Settings.ACTION_APP_NOTIFICATION_SETTINGS` with the package extra. iOS
  opens `UIApplication.openSettingsURLString`; the copy must still tell the
  user to choose Notifications. Check Android app-wide notification enabled
  status, including Android 12 and earlier, rather than equating Capacitor’s
  runtime grant with notifications being enabled. Account for the app’s
  `money_updates` channel being disabled too.
- Read permission again on native resume and web visibility/focus return.
  Re-register only when permitted, and preserve the difference between
  permission allowed and a token/subscription successfully registered.
  Bridge failure and older binaries are unavailable, not denied. Give a
  manual settings fallback if a hand-off cannot be opened.
- Follow the canonical generated native project setup: checked-in plugin
  sources and an idempotent Android setup script, plus the iOS Codemagic
  source-copy and plugin-registration path. Build and check both actual
  binaries; an anonymous browser preview does not verify a native hand-off.
- For web, call `Notification.requestPermission()` directly from a user
  gesture, then complete the existing VAPID/subscription flow. Read denied
  permission without repeatedly prompting. Do not request on page load or
  claim a browser setting changed before rechecking it. Preserve the user's
  existing deliberate browser subscription opt-out.
- Change only the absent-key `transactions` default in
  `backend/app/services/notifications.py` from false to true. Preserve every
  explicit saved preference through the existing merge. Other catalogue
  defaults already start on, including hidden operational and offer keys;
  this task needs no change to their access or audience rules.
- Remove Settings' test button and its dedicated handlers/state. Keep the
  `/push/test` endpoint under its current authentication and rate limit;
  it is currently an authenticated user endpoint, not an owner-only route.
  Keep operational diagnostic helpers used elsewhere. Remove “test” from
  Settings search keywords. Use the neutral tips copy only when the tips
  feature flag permits that topic; G455 owns the broader feature gating.
- Audit Home placement against financial-risk priorities and keep existing
  layout, money figures, privacy masks and reconnect/transfer actions.
  Independently review the production diff against `DESIGN.md`, then remove
  this temporary directory and its index entry when the choice is folded in.

## Official platform references

- [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications):
  runtime permission and token registration are separate. Its Android
  permission read does not establish display permission on Android 12 and
  earlier.
- [Apple notification permission](https://developer.apple.com/documentation/UserNotifications/asking-permission-to-use-notifications):
  the first authorisation request presents the prompt; later requests do not
  present it again. Settings must be re-read when the user changes them.
- [Android notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission):
  Android 13 adds the runtime request; Android 12 and earlier need no such
  request.
- [WebKit Home Screen web push](https://webkit.org/blog/13878/): iPhone web
  push needs a Home Screen app and a permission request initiated by the user.

Screenshot and interaction evidence is kept locally under
`.impeccable/review/g409-final/`. It validates these synthetic proposals only.
