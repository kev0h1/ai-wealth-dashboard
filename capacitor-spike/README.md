Release convention: after `./gradlew assembleSortedDebug`, copy the APK to /var/www/wealth-downloads/wealth.apk — served at https://uat.wealth.auriqltd.co.uk/downloads/wealth.apk

Debug/test APKs: publish ONLY to /var/www/wealth-downloads/. Never place them in frontend/public/ (the static export would bundle them into the next APK). The one exception is the single published release APK below; `build-mobile.sh` excludes `public/*.apk` from the mobile export so it cannot nest.

## Board (H66, 2026-09-17)

This project also builds a second, separate Android app, **Board**
(`co.uk.auriqltd.sorted.board`), a Gradle product flavour alongside
**Sorted** (`co.uk.auriqltd.sorted`, unchanged). Board opens the
`/ops/go-live` backlog board directly instead of Home, has its own launcher
icon (a distinct amber/orange colourway of the same settle mark, see
`assets/masters/settle-glyph-board-*`), and has no Firebase/FCM
registration at all — by design, no push notifications in the Board app.
Sorted's own release signing, FCM push and build process are all untouched;
see `ANDROID_PUSH.md`'s "Build flow" for the full step-by-step including
Board's extra steps (`apply-board-flavor.sh`, `apply-board-icons.sh`,
`build-board-web-assets.sh`), and `scripts/apply-board-flavor.sh`'s header
comment for why the google-services.json split is needed (the Google
Services Gradle plugin fails the board variant's build if it finds
`google-services.json` but no client entry for `co.uk.auriqltd.sorted.board`
inside it — a strategy setting doesn't help there, only "the file isn't
found at all for this variant" does).

Build Board's debug APK and publish it alongside Sorted's, under a clearly
distinct filename — never overwrite `wealth.apk`:

```bash
# from capacitor-spike/ — refreshes src/board/assets/ from www/;
# app/build.gradle's verifyBoardWebAssets task fails the build if this
# step is skipped or the copy is stale relative to www/
bash scripts/build-board-web-assets.sh
cd android
./gradlew assembleBoardDebug
cp app/build/outputs/apk/board/debug/app-board-debug.apk /var/www/wealth-downloads/board.apk
```

`capacitor-spike/android/` is regenerated from scratch by `npx cap add
android` (see ANDROID_PUSH.md), which wipes the whole flavour setup along
with everything else patched into that gitignored project; re-run
`apply-board-flavor.sh` (and the icon/web-asset scripts) after any such
regeneration, same as `setup-android-push.sh` and `apply-icons.sh`.

## App-switcher privacy (A122)

- Android: `scripts/setup-android-push.sh` now calls `setup-android-privacy.sh`
  as its last step, so the normal regeneration flow covers it (run it alone
  with `bash scripts/setup-android-privacy.sh` if needed). If H73 commits
  `android/`, the plugin and its registration become committed source and this
  script is replaced. It installs `android-privacy/PrivacyScreenPlugin.java` and registers it in
  `MainActivity`. The web layer then sets `FLAG_SECURE` while the biometric
  lock preference is on, which blanks the recents thumbnail and also blocks
  user screenshots and screen recording during that time.
- Android backup (A129): `scripts/setup-android-push.sh` also calls
  `setup-android-backup.sh` (run alone with `bash scripts/setup-android-backup.sh`
  on an existing `android/` project). It sets `android:allowBackup="false"` and installs
  `android-backup/*.xml` as `fullBackupContent` and `dataExtractionRules`, so
  `adb backup` and cloud or device-transfer backups capture nothing.
- iOS: `codemagic.yaml` step "Patch AppDelegate for app-switcher privacy"
  merges `ios-privacy/AppDelegate.privacy.swift.txt` into `AppDelegate.swift`.
- Both sit behind a web-layer cover in `frontend/components/BiometricLock.tsx`.

## Dependency audit (H110, 2026-10-08)

`@capacitor/android`, `@capacitor/ios`, `@capacitor/core` and `@capacitor/cli`
are on 8.5.3 (8.5.0 is in the advisory range for the internal HTTP proxy
remote-content issue; 8.5.1 or later is the fix). `npm audit --omit=dev
--audit-level=high` is clean here. Three moderate findings remain
(`uuid` via `xcode` via `@capacitor/cli`); they are build-time tooling, and
npm's only offered fix downgrades `@capacitor/cli` to 8.4.3 into the
vulnerable Capacitor range, so it is deliberately not applied. Re-check with
`npm audit --omit=dev` after every Capacitor bump. The iOS shell is rebuilt
by Codemagic on every push (`codemagic.yaml` runs `npx cap add ios`), so it
picks up the lockfile versions automatically.

## Published APK (C20, 2026-10-08)

Exactly one Sorted APK is published: `frontend/public/sorted.apk`, served at
`/sorted.apk` on the web host (UAT: https://uat.wealth.auriqltd.co.uk/sorted.apk). It is
the `sorted` release flavour signed with the AURIQ LTD key, and it replaced
the debug-signed `app-debug.apk`. Two differently signed APKs with the same
applicationId and versionCode made phones refuse the install with a generic
"something went wrong" (signature conflict). `frontend/public/sorted-apk.json`
records the file name, `versionCode`, `previousVersionCode`, SHA-256 and signer
fingerprint, and `npm run check:apk-single` (in `frontend/`) fails unless
exactly one APK exists under `frontend/public` and its versionCode is greater
than the previous one.

Current build: versionCode 2 (v2 was never published before this rebuild), SHA-256
`a541718c80c0441d191e59542300ec427b5cf4b565e2b8edb067902c0f4f3fa0`, signer
certificate SHA-256 `72c3196e4d4d7640162fb64b5423e68544e6e1e1109f52ccd8152b43e2e2d78e`
(CN=AURIQ LTD, O=AURIQ LTD, L=London, C=GB). Built on Capacitor 8.5.3.

API base: PRODUCTION, `https://wealth.auriqltd.co.uk/api`. The published APK is
the real app, so it is exported with `npm run build:mobile:prod`, never the
default UAT `build:mobile`. `check:apk-single` unzips the APK and fails unless
the bundled JS contains the production API base and not `uat.wealth.auriqltd.co.uk/api`
(the string `uat.wealth.auriqltd.co.uk` still appears once in design-preview fixture
links inside the bundle; that is not an API base). The same file is served from
both the UAT and production web hosts, since `frontend/public` ships to both.

To publish a new build: bump `versionCode` (and set `previousVersionCode` to the
old value) in `sorted-apk.json`, build the web export with `npm run build:mobile:prod`
in `frontend/`, copy it to `capacitor-spike/www`, `npx cap sync android`, run
`bash scripts/set-android-version.sh`, build with `./gradlew assembleSortedRelease`,
copy `android/app/build/outputs/apk/sorted/release/app-sorted-release.apk` to
`frontend/public/sorted.apk`, update `sha256` in the JSON, run
`apksigner verify --print-certs`, and `check:apk-single`. Every build given to
Kevin must be this release build: never hand over a debug-signed build for the
same applicationId.

Phone step (once): uninstall the existing debug-signed Sorted (this clears its
local app data), then install `sorted.apk`. Later updates install over it
because the signer and applicationId match and versionCode only goes up.

Trade-off for Kevin to decide: the APK is tracked in git on purpose
(`!frontend/public/sorted.apk` in `.gitignore`), so it reaches every checkout
and both hosts through the normal merge, and the check can run anywhere. Cost:
about 13 MB of git history per release. Alternative: keep it untracked (as
`app-debug.apk` was) and loosen the check to tolerate a missing file, at the
cost of integrate no longer delivering it.
