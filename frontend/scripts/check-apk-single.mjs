// C20: exactly one Sorted APK may be published under frontend/public, and its
// versionCode must be greater than the previous one recorded next to it in
// sorted-apk.json. Two differently signed APKs with the same applicationId
// and versionCode (a debug-signed and a release-signed build) made phones
// refuse the install with a generic "something went wrong".
//
// Checks: exactly one *.apk under public/ (recursive); it is the file named in
// sorted-apk.json; its SHA-256 matches the recorded one; versionCode >
// previousVersionCode; and, the APK's own embedded
// versionCode (via aapt, required) equals the recorded one; and the bundled JS
// contains the production API base and not the UAT one (unzips the APK).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')
const metaPath = join(publicDir, 'sorted-apk.json')
const fails = []
const PROD_API = 'https://wealth.auriqltd.co.uk/api'
const UAT_API = 'uat.wealth.auriqltd.co.uk/api'

function findAapt() {
  const dirs = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, '/root/ai-wealth-dashboard/.android-sdk']
  for (const d of dirs) {
    if (!d) continue
    const bt = join(d, 'build-tools')
    if (!existsSync(bt)) continue
    for (const v of readdirSync(bt).sort().reverse()) {
      const p = join(bt, v, 'aapt')
      if (existsSync(p)) return p
    }
  }
  try {
    return execFileSync('which', ['aapt'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

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
    // aapt: ANDROID_HOME, then the repo's .android-sdk, then PATH. Never silently skipped.
    const aapt = findAapt()
    if (!aapt) {
      fails.push('aapt not found via ANDROID_HOME, /root/ai-wealth-dashboard/.android-sdk or PATH, so the embedded versionCode cannot be checked')
    } else {
      const badging = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8' })
      const m = badging.match(/versionCode='(\d+)'/)
      if (!m || Number(m[1]) !== versionCode) fails.push(`APK embeds versionCode ${m ? m[1] : 'unknown'}, sorted-apk.json records ${versionCode}`)
    }
    // The published APK is the real app: it must talk to production, never UAT.
    const apiBase = meta.api_base
    if (apiBase !== PROD_API) fails.push(`sorted-apk.json api_base must be ${PROD_API}, found ${apiBase}`)
    let bundle = ''
    try {
      bundle = execFileSync('unzip', ['-p', apk, 'assets/public/_next/*'], { encoding: 'latin1', maxBuffer: 512 * 1024 * 1024 })
    } catch (e) {
      fails.push('could not unzip the bundled web assets from the APK: ' + e.message)
    }
    if (bundle) {
      if (!bundle.includes(PROD_API)) fails.push(`bundled JS does not contain the production API base ${PROD_API}`)
      if (bundle.includes(UAT_API)) fails.push(`bundled JS contains the UAT API base ${UAT_API}`)
    }
  }
}

if (fails.length) {
  console.error('check:apk-single FAILED')
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`check:apk-single ok (${relative(publicDir, apks[0])}, versionCode ${JSON.parse(readFileSync(metaPath, 'utf8')).versionCode})`)
