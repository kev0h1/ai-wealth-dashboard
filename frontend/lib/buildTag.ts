// Rendered as a tiny whisper on the login screen and the biometric lock
// screen so Kevin can visually confirm, from a screenshot or just eyeballing
// the phone, which build is actually running — critical after the
// biometric-lock-loop incident, where re-publishing an APK under the same
// filename made it impossible to tell whether a stuck phone was running the
// old broken build or a stale download of it.
//
// No longer hand-edited: `frontend/next.config.ts` (web/Vercel/UAT builds)
// and `frontend/scripts/build-mobile.sh` (Capacitor/mobile builds, which
// build from a rsync'd scratch dir with no .git) both compute this at build
// time from the git short SHA (or CI commit var) plus the UTC build date,
// and inline it as NEXT_PUBLIC_BUILD_TAG. Set NEXT_PUBLIC_BUILD_TAG
// explicitly to override either derivation.
export const BUILD_TAG = process.env.NEXT_PUBLIC_BUILD_TAG || "build dev";
