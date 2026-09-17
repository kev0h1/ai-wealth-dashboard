Release convention: after `./gradlew assembleSortedDebug`, copy the APK to /var/www/wealth-downloads/wealth.apk — served at https://uat.wealth.auriqltd.co.uk/downloads/wealth.apk

NEVER place APKs in frontend/public/ — the static export bundles them into the next APK (recursive bloat). Publish ONLY to /var/www/wealth-downloads/.

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
cd android
./gradlew assembleBoardDebug
cp app/build/outputs/apk/board/debug/app-board-debug.apk /var/www/wealth-downloads/board.apk
```

`capacitor-spike/android/` is regenerated from scratch by `npx cap add
android` (see ANDROID_PUSH.md), which wipes the whole flavour setup along
with everything else patched into that gitignored project; re-run
`apply-board-flavor.sh` (and the icon/web-asset scripts) after any such
regeneration, same as `setup-android-push.sh` and `apply-icons.sh`.
