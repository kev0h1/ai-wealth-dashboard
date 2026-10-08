// C20: exactly one Sorted APK may be published under frontend/public, and its
// versionCode must be greater than the previous one recorded next to it in
// sorted-apk.json. Two differently signed APKs with the same applicationId
// and versionCode (a debug-signed and a release-signed build) made phones
// refuse the install with a generic "something went wrong".
//
// Checks: exactly one *.apk under public/ (recursive); it is the file named in
// sorted-apk.json; its SHA-256 matches the recorded one; versionCode >
// previousVersionCode; and, when aapt is available, the APK's own embedded
// versionCode equals the recorded one.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')
const metaPath = join(publicDir, 'sorted-apk.json')
const fails = []

function findApks(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...findApks(p))
    else if (/\.apk$/i.test(name)) out.push(p)
  }
  return out
}

const apks = findApks(publicDir)
if (apks.length !== 1) {
  fails.push(`expected exactly one APK under frontend/public, found ${apks.length}: ${apks.map((a) => relative(root, a)).join(', ') || 'none'}`)
}

if (!existsSync(metaPath)) {
  fails.push('frontend/public/sorted-apk.json is missing')
} else {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const { file, versionCode, previousVersionCode, sha256 } = meta
  if (!Number.isInteger(versionCode) || !Number.isInteger(previousVersionCode)) {
    fails.push('sorted-apk.json needs integer versionCode and previousVersionCode')
  } else if (versionCode <= previousVersionCode) {
    fails.push(`versionCode ${versionCode} must be greater than the previous recorded ${previousVersionCode}`)
  }
  if (apks.length === 1) {
    const apk = apks[0]
    if (relative(publicDir, apk) !== file) fails.push(`sorted-apk.json names ${file} but the APK is ${relative(publicDir, apk)}`)
    const actual = createHash('sha256').update(readFileSync(apk)).digest('hex')
    if (actual !== sha256) fails.push(`SHA-256 of ${relative(publicDir, apk)} is ${actual}, sorted-apk.json records ${sha256}`)
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || resolve(root, '..', '.android-sdk')
    const btDir = join(sdk, 'build-tools')
    if (existsSync(btDir)) {
      const vers = readdirSync(btDir).sort()
      const aapt = vers.length ? join(btDir, vers[vers.length - 1], 'aapt') : null
      if (aapt && existsSync(aapt)) {
        const badging = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8' })
        const m = badging.match(/versionCode='(\d+)'/)
        if (!m || Number(m[1]) !== versionCode) fails.push(`APK embeds versionCode ${m ? m[1] : 'unknown'}, sorted-apk.json records ${versionCode}`)
      } else console.log('check:apk-single: aapt not found, skipped the embedded versionCode check')
    } else console.log('check:apk-single: Android build-tools not found, skipped the embedded versionCode check')
  }
}

if (fails.length) {
  console.error('check:apk-single FAILED')
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`check:apk-single ok (${relative(publicDir, apks[0])}, versionCode ${JSON.parse(readFileSync(metaPath, 'utf8')).versionCode})`)
