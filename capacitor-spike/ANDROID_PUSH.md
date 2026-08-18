# Android Push Notifications (FCM) Setup

The iOS build gets push via APNs. Like Android, `capacitor-spike/ios/` is
**gitignored** and does not exist in the repo: `codemagic.yaml` regenerates
it with `npx cap add ios` on every CI build. The push entitlement
(`aps-environment`, wired into `App.entitlements` and `CODE_SIGN_ENTITLEMENTS`)
is applied to that freshly-generated project by a `codemagic.yaml` build
step, gated behind the `IOS_PUSH_ENABLED` environment variable (default
false, so today's TestFlight builds ship without push until the Apple
Developer portal prerequisites in that file's header comment are done).
Android is handled differently because there's no Android CI: instead of a
build-step, the FCM/Firebase wiring is captured as a **script**,
`capacitor-spike/scripts/setup-android-push.sh`, committed to the repo, that
patches a freshly-generated Android project into working order. This doc is
the full flow, start to finish.

`scripts/apply-icons.sh` also brands iOS app icons under `capacitor-spike/ios/App/App/Assets.xcassets/AppIcon.appiconset/` when `ios/` exists (wired into the Codemagic iOS workflow via `codemagic.yaml`); it prints a skip message and exits cleanly when `ios/` is absent.

There is currently **no Android CI** (Codemagic only builds iOS). Android
APKs are built locally using the steps below.

## One-time Firebase project setup

The Firebase project and Android app registration are **already done**:
project `auriq-wealth` (project number `106155458816`) has an Android app
registered under package name `co.uk.auriqltd.wealth`, matching
`capacitor-spike/capacitor.config.json` `appId` exactly. The resulting
**`google-services.json`** (the app-side credential) is committed at
`capacitor-spike/google-services.json`. This file is not a secret: it ships
inside every APK built from this config and is trivially extractable from
any installed app, so committing it is safe and follows the precedent
already set by the identical copy at `mobile/google-services.json` (from
the retired Expo app).

The only outstanding step is generating the backend's credential:

1. In the Firebase console, open the `auriq-wealth` project, then go to
   **Project settings → Service accounts → Generate new private key**.
   This produces a service-account JSON, the **backend**'s credential
   (used to call the FCM HTTP v1 API to actually send pushes). Hand it to
   the backend as:
   - `FCM_PROJECT_ID`, the Firebase project ID (`auriq-wealth`), and
   - `FCM_SERVICE_ACCOUNT_JSON` (or `FCM_SERVICE_ACCOUNT_PATH`), the
     service-account key JSON contents (or a path to it), mirroring
     however `APNS_*` secrets are configured today.
   This key **must never be committed**. Do not confuse it with
   `google-services.json` above: the service-account key can mint
   credentials to send pushes on the project's behalf, `google-services.json`
   cannot.

These are the **two runtime prerequisites**. Without both, FCM push does
not work end-to-end:

| Prerequisite | Used by | Where it lives |
|---|---|---|
| `google-services.json` | Android app build | `capacitor-spike/google-services.json` (committed, canonical) and `capacitor-spike/android/app/google-services.json` (gitignored working copy, restored from the canonical file by `setup-android-push.sh`) |
| Service-account key (`FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT_JSON`/`_PATH`) | Backend, to send pushes via FCM | Backend env/secrets (not in git) |

## Build flow

Run from `capacitor-spike/` unless noted:

```bash
# 1. Generate the Android project (wipes and recreates capacitor-spike/android/)
npx cap add android

# 2. Patch it for FCM (idempotent — safe to re-run)
bash scripts/setup-android-push.sh

# 2b. Restore the brand launcher icons (cap add android regenerates stock icons — this restores the brand set)
bash scripts/apply-icons.sh

# 3. Build the frontend static export
cd ../frontend
npm run build:mobile

# 4. Copy the export into the Capacitor shell
# Prune stale content-hashed chunks from prior builds (they persist across copies and can ship old bugs)
rm -rf ../capacitor-spike/www/* && cp -r out/* ../capacitor-spike/www/
cd ../capacitor-spike

# 5. Sync the web assets + native deps into the Android project
npx cap sync android

# 6. Build the APK
cd android
./gradlew assembleDebug
```

The APK lands at
`capacitor-spike/android/app/build/outputs/apk/debug/app-debug.apk`.

## What `setup-android-push.sh` patches

Run it any time after `npx cap add android` (including after the very
first time, and after every subsequent `cap add android` since that
wipes and regenerates the directory). Every patch is grep-guarded, so
re-running it on an already-patched project is a no-op for that step.

The `google-services.json` presence check (step 3) deliberately runs
**before** the plugin is ever applied to `app/build.gradle` (step 4).
Applying the `com.google.gms.google-services` Gradle plugin without the
JSON file present is a hard config-time error on every subsequent Gradle
run, and because plugin application is grep-guarded, that broken state
would otherwise persist across re-runs. Checking first keeps the script
atomic: if neither copy of the JSON exists, only the harmless steps
(classpath, manifest permission) apply, the plugin is never touched, and
the script exits non-zero.

1. **`android/build.gradle`** (project-level `buildscript`) — adds the
   `classpath 'com.google.gms:google-services:4.4.4'` line if no
   `com.google.gms:google-services` classpath is already present. Harmless
   with or without `google-services.json`.
2. **`android/app/src/main/AndroidManifest.xml`** — adds
   `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`
   if missing (required at runtime on Android 13+ for notifications to
   show at all). Also harmless without `google-services.json`.
3. **`android/app/google-services.json`**, checked first, and restored if
   missing. `android/` is gitignored and wiped by every `npx cap add
   android`, so this working copy never survives regeneration. If it's
   absent but the canonical, committed `capacitor-spike/google-services.json`
   exists, the script copies it into place and proceeds. Only if **neither**
   copy exists does the script print the Firebase setup steps above and
   exit non-zero **before** touching `app/build.gradle`'s plugin block,
   since nothing about FCM can work without the file and the script will
   never fabricate one.
4. **`android/app/build.gradle`** — applies the
   `com.google.gms.google-services` plugin, only once step 3 has confirmed
   the JSON exists. Detects whether the file uses a modern `plugins { }`
   block or the legacy `apply plugin:` style and patches accordingly. The
   `@capacitor/push-notifications` plugin already pulls in
   `firebase-messaging` transitively, so the script does **not** add a
   duplicate `firebase-messaging` dependency — it only checks and logs
   whether one is already present.

## Verifying the patch worked

```bash
grep "com.google.gms:google-services" android/build.gradle
grep "com.google.gms.google-services" android/app/build.gradle
grep "POST_NOTIFICATIONS" android/app/src/main/AndroidManifest.xml
ls android/app/google-services.json
```
