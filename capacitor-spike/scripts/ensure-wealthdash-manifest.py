#!/usr/bin/env python3
"""
ensure-wealthdash-manifest.py -- idempotent, order-independent placement of
the wealthdash:// deep-link intent-filter (H66 review finding P1/FIX1,
2026-09-17 round 2).

Google sign-in opens the OAuth flow in a Chrome Custom Tab; the backend's
/auth/google/mobile-callback answers with an HTML page that navigates to
wealthdash://auth-done to hand control back to the app (see
backend/app/routers/auth.py). Without an app registered for that scheme,
the Custom Tab is left on a dead page.

Once the "board" flavour exists (productFlavors in app/build.gradle,
added by apply-board-flavor.sh), this intent-filter must live ONLY in the
sorted-flavour manifest overlay (src/sorted/AndroidManifest.xml) -- if it
stayed in src/main, the board flavour would inherit it too, and two
installed apps registering the same scheme can strand Sorted's own Custom
Tab (there is no App Links verification here, so it is a disambiguation
chooser, or whichever app was defaulted).

Before the flavour exists, src/main is correct -- that is this project's
literal pre-H66 shape, and the only shape available before
apply-board-flavor.sh has ever run.

Called from BOTH setup-android-push.sh (its own "step 7") and
apply-board-flavor.sh, specifically so the outcome is correct regardless
of which script last ran, or how many times either has run: every call
re-derives "does the board flavour exist right now" from app/build.gradle
itself, rather than trusting a fixed call order.

An earlier version of this migration lived only in setup-android-push.sh,
unconditionally moving the filter into src/sorted BEFORE confirming
productFlavors existed there -- correct on a from-scratch worktree
project (where the two scripts always happened to run in the "right"
order for that test) and silently fatal to Sorted's Google sign-in on the
shared tree's real project, where the flavour did not exist yet the first
time it ran (review finding P1/FIX1, 2026-09-17 round 2). Simply gating
the strip on flavour-exists and leaving the rest of the logic split
across two scripts was considered and rejected: re-running
setup-android-push.sh alone, after the flavour already exists and the
filter has already been migrated to the overlay, would find nothing in
src/main and blindly re-insert it there -- recreating the exact bug in
the opposite direction. Centralising the decision here, called from both
scripts, converges to the same correct placement no matter which one
runs, in which order, or how many times -- flavour-forward (once the
board flavour has ever existed, the filter lives in the overlay, and
stays there through any number of later calls). Rolling the flavour back
off also cleans up a stale overlay, but only when it is exactly our own
known template (review finding P3/FIX3, 2026-09-17 round 3): a
non-matching overlay is left in place, inert, with a note printed, on
the same "never silently destroy an unrecognised file" principle this
script applies everywhere else.
"""
import sys
from pathlib import Path

WEALTHDASH_BLOCK = (
    "\n"
    "            <intent-filter>\n"
    '                <action android:name="android.intent.action.VIEW" />\n'
    '                <category android:name="android.intent.category.DEFAULT" />\n'
    '                <category android:name="android.intent.category.BROWSABLE" />\n'
    '                <data android:scheme="wealthdash" />\n'
    "            </intent-filter>\n"
)

MAIN_LAUNCHER_MARKER = (
    '            <intent-filter>\n'
    '                <action android:name="android.intent.action.MAIN" />\n'
    '                <category android:name="android.intent.category.LAUNCHER" />\n'
    '            </intent-filter>\n'
)

SORTED_OVERLAY_TEMPLATE = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n'
    "    <!--\n"
    "      H66: sorted-flavour-only overlay. The manifest merger unions this\n"
    "      <activity>'s children into src/main's same-named activity (matched\n"
    "      by android:name) rather than replacing it, so MainActivity keeps its\n"
    "      MAIN/LAUNCHER intent-filter from src/main and gains this one only\n"
    '      for "sorted" variants. See ensure-wealthdash-manifest.py for why\n'
    "      this must not live in src/main (the board flavour would inherit it\n"
    "      too).\n"
    "    -->\n"
    "    <application>\n"
    '        <activity android:name=".MainActivity">\n'
    "{block}"
    "        </activity>\n"
    "    </application>\n"
    "</manifest>\n"
)


def has_wealthdash(text):
    return 'android:scheme="wealthdash"' in text


def strip_wealthdash(text, manifest_path):
    if WEALTHDASH_BLOCK not in text:
        print(
            f"ERROR: android:scheme=\"wealthdash\" found in {manifest_path} but not in "
            "the exact previously-written shape; remove it by hand before re-running.",
            file=sys.stderr,
        )
        sys.exit(1)
    return text.replace(WEALTHDASH_BLOCK, "", 1)


def insert_into_main(text, manifest_path):
    idx = text.find(MAIN_LAUNCHER_MARKER)
    if idx == -1:
        print(
            f"ERROR: could not find MAIN/LAUNCHER intent-filter in {manifest_path} to anchor insertion",
            file=sys.stderr,
        )
        sys.exit(1)
    insert_at = idx + len(MAIN_LAUNCHER_MARKER)
    return text[:insert_at] + WEALTHDASH_BLOCK + text[insert_at:]


def main():
    if len(sys.argv) != 2:
        print("usage: ensure-wealthdash-manifest.py <android-dir>", file=sys.stderr)
        sys.exit(2)

    android_dir = Path(sys.argv[1])
    app_gradle = android_dir / "app" / "build.gradle"
    main_manifest = android_dir / "app" / "src" / "main" / "AndroidManifest.xml"
    sorted_manifest = android_dir / "app" / "src" / "sorted" / "AndroidManifest.xml"

    if not app_gradle.exists():
        print(f"ERROR: {app_gradle} not found.", file=sys.stderr)
        sys.exit(1)
    if not main_manifest.exists():
        print(f"ERROR: {main_manifest} not found.", file=sys.stderr)
        sys.exit(1)

    # productFlavors is added by apply-board-flavor.sh; its presence is
    # exactly "does the sorted-flavour source set actually get honoured by
    # the manifest merger right now", re-checked fresh on every call.
    flavour_exists = "productFlavors" in app_gradle.read_text()
    main_text = main_manifest.read_text()

    if flavour_exists:
        changed = False
        if has_wealthdash(main_text):
            main_text = strip_wealthdash(main_text, main_manifest)
            main_manifest.write_text(main_text)
            print(
                f"removed wealthdash:// intent-filter from {main_manifest} "
                "(board flavour exists -- it now lives in the sorted overlay only)"
            )
            changed = True
        else:
            print(f"{main_manifest}: no wealthdash:// intent-filter present -- skipping.")

        if sorted_manifest.exists():
            if has_wealthdash(sorted_manifest.read_text()):
                print(f"{sorted_manifest}: wealthdash:// deep-link intent-filter already present -- skipping.")
            else:
                # Refuse rather than silently rewrite (review finding
                # P3/FIX2, 2026-09-17 round 3, same wording/reasoning as
                # apply-board-flavor.sh's strings.xml refusal): this file
                # already exists but lacks the expected scheme, which could
                # mean a hand edit (e.g. an extra meta-data entry) rather
                # than a file safe to regenerate wholesale.
                print(
                    f"ERROR: {sorted_manifest} already exists but does not contain the "
                    'expected android:scheme="wealthdash" intent-filter. Refusing to '
                    "overwrite a file that may carry a hand edit -- add the intent-filter "
                    "to it yourself (or remove the file) and re-run.",
                    file=sys.stderr,
                )
                sys.exit(1)
        else:
            sorted_manifest.parent.mkdir(parents=True, exist_ok=True)
            sorted_manifest.write_text(SORTED_OVERLAY_TEMPLATE.format(block=WEALTHDASH_BLOCK))
            print(f"wrote {sorted_manifest} (wealthdash:// deep-link intent-filter overlay, sorted flavour only)")
            changed = True
        if not changed:
            print("(no changes needed)")
    else:
        # Flavour doesn't exist yet: src/main is the only honoured source
        # set, exactly matching this project's pre-H66 shape.
        if has_wealthdash(main_text):
            print(f"{main_manifest}: wealthdash:// deep-link intent-filter already present -- skipping.")
        else:
            main_text = insert_into_main(main_text, main_manifest)
            main_manifest.write_text(main_text)
            print(f"added wealthdash:// deep-link intent-filter to {main_manifest} (board flavour not configured yet)")

        # Clean up a stale overlay left over from a rollback off flavours
        # (review finding P3/FIX3, 2026-09-17 round 3): src/sorted/ is not
        # an honoured source set at all once productFlavors is gone, so
        # any file there is inert -- but only remove it when it is
        # EXACTLY our own known template (never guess at a hand edit, same
        # rule as everywhere else in this script). If it exists in some
        # other shape, leave it alone and say so, rather than silently
        # deleting something that might not be ours.
        if sorted_manifest.exists():
            expected = SORTED_OVERLAY_TEMPLATE.format(block=WEALTHDASH_BLOCK)
            if sorted_manifest.read_text() == expected:
                sorted_manifest.unlink()
                print(f"removed stale {sorted_manifest} (board flavour no longer configured, and it exactly matched our own template)")
            else:
                print(
                    f"NOTE: {sorted_manifest} exists but the board flavour is not configured, "
                    "so it is inert; leaving it in place since its content does not exactly "
                    "match our own template (it may carry a hand edit) -- remove it by hand if "
                    "it is no longer wanted."
                )


if __name__ == "__main__":
    main()
