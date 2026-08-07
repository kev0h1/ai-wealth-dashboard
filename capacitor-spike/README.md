Release convention: after `./gradlew assembleDebug`, copy the APK to /var/www/wealth-downloads/wealth.apk — served at https://uat.wealth.auriqltd.co.uk/downloads/wealth.apk

NEVER place APKs in frontend/public/ — the static export bundles them into the next APK (recursive bloat). Publish ONLY to /var/www/wealth-downloads/.
