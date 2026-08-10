# Android Push Notifications (FCM) Setup

The iOS build gets push via APNs, wired directly into `capacitor-spike/ios`
project files that are committed to the repo. Android is different:
`capacitor-spike/android/` is **gitignored** — it's regenerated every time
someone runs `npx cap add android` — so the FCM/Firebase wiring can't live
as direct edits to that directory. Instead it's captured as a **script**,
`capacitor-spike/scripts/setup-android-push.sh`, committed to the repo, that
patches a freshly-generated Android project into working order. This doc is
the full flow, start to finish.

`scripts/apply-icons.sh` also brands iOS app icons under `capacitor-spike/ios/App/App/Assets.xcassets/AppIcon.appiconset/` when `ios/` exists (wired into the Codemagic iOS workflow via `codemagic.yaml`); it prints a skip message and exits cleanly when `ios/` is absent.

There is currently **no Android CI** (Codemagic only builds iOS). Android
APKs are built locally using the steps below.

## One-time Firebase project setup

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   create (or reuse) a Firebase project for this app.
2. Add an **Android app** to that project:
   - Package name: `co.uk.auriqltd.wealth` (must match exactly —
     `capacitor-spike/capacitor.config.json` `appId`).
3. Download the generated **`google-services.json`**. This is the
   app-side credential — it goes in the Android build, not in git.
4. In the same Firebase project, go to **Project settings → Service
   accounts → Generate new private key**. This produces a service-account
   JSON — this is the **backend**'s credential (used to call the FCM HTTP
   v1 API to actually send pushes). Hand it to the backend as:
   - `FCM_PROJECT_ID` — the Firebase project ID, and
   - `FCM_SERVICE_ACCOUNT_JSON` (or `FCM_SERVICE_ACCOUNT_PATH`) — the
     service-account key JSON contents (or a path to it) — mirroring
     however `APNS_*` secrets are configured today.
   Neither file should ever be committed.

These are the **two runtime prerequisites** — without both, FCM push does
not work end-to-end:

| Prerequisite | Used by | Where it lives |
|---|---|---|
| `google-services.json` | Android app build | `capacitor-spike/android/app/google-services.json` (gitignored, local only) |
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
cp -r out/* ../capacitor-spike/www/
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
atomic: if the JSON is missing, only the harmless steps (classpath,
manifest permission) apply, the plugin is never touched, and the script
exits non-zero.

1. **`android/build.gradle`** (project-level `buildscript`) — adds the
   `classpath 'com.google.gms:google-services:4.4.4'` line if no
   `com.google.gms:google-services` classpath is already present. Harmless
   with or without `google-services.json`.
2. **`android/app/src/main/AndroidManifest.xml`** — adds
   `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`
   if missing (required at runtime on Android 13+ for notifications to
   show at all). Also harmless without `google-services.json`.
3. **`android/app/google-services.json`** — checked, not created. If it's
   missing, the script prints the Firebase setup steps above and exits
   non-zero **before** touching `app/build.gradle`'s plugin block. This is
   a deliberate hard stop: nothing about FCM will work without this file,
   and the script will never fabricate one.
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
