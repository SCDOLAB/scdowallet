// SCDO Wallet auto-update (main process module; 1.1.6, 2.0.0: U1-U4 + M2 hardening, rename)
//  - checks https://scdoscan.io/downloads/wallet/latest.json
//  - Ed25519-verifies the manifest (signature protocol: sign all fields except "signature",
//    recursive key sort + compact JSON + UTF-8; public key: 32-byte raw Ed25519, base64)
//  - downloads the installer to <userData>\updates\ with range-based resume
//  - verifies size + SHA-256 (+ Authenticode when present) before install
//  - installs with /S silent overwrite via a detached installer process, then quits the wallet
//  - every step is logged to <userData>\logs\updater.log
'use strict'
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
// electron is unavailable in plain-node tests; injection points below cover it
let electron = null
try { electron = require('electron') } catch (e) {}

// ---- update channel (build-time constants; 1.1.6 review: nothing here can be changed at run time) ----
// BEGIN-UPDATE-CHANNEL
const UPDATER_URL = 'https://scdoscan.io/downloads/wallet/latest.json'
const ALLOWED_ORIGINS = ['https://scdoscan.io'] // manifest + installer must be https on exactly this host (default port)
// END-UPDATE-CHANNEL
const MAX_INSTALLER_SIZE = 512 * 1024 * 1024
// PRODUCTION PUBLIC KEY (provided by A-side, 2026-09-30): 32-byte raw Ed25519 public key, base64.
// Private key is held offline by A-side. The wallet refuses any manifest not signed by this key.
// BEGIN-UPDATE-PUBKEY
const PUBKEY_B64 = '4qt9g0KOI32agOxfEU+/W28zA8iRjt8pYSkcj/VTW5k='
// END-UPDATE-PUBKEY
const CHECK_DELAY_MS = 60 * 1000          // first check: 1 minute after launch
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // then every 6 hours
const HTTP_TIMEOUT_MS = 30 * 1000
const DOWNLOAD_TIMEOUT_MS = 120 * 1000

function httpGet (url, headers, timeoutMs) {
  const mod = url.startsWith('https:') ? https : http // only reached for allow-listed origins (see Updater)
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: headers || {} }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => { try { resolve({ body: Buffer.concat(chunks), res }) } catch (e) { reject(e) } })
    })
    req.setTimeout(timeoutMs || HTTP_TIMEOUT_MS, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}
function httpGetStream (url, headers, timeoutMs, onResponse) {
  const mod = url.startsWith('https:') ? https : http
  const req = mod.get(url, { headers: headers || {} }, res => onResponse(res, req))
  req.setTimeout(timeoutMs || HTTP_TIMEOUT_MS, () => req.destroy(new Error('timeout')))
  return req
}

// ---------- canonical manifest signing (must match sign-latest.js) ----------
function sortKeys (v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v !== null && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k])
    return out
  }
  return v
}
function canonicalManifest (obj) {
  const payload = Object.assign({}, obj)
  delete payload.signature
  return JSON.stringify(sortKeys(payload))
}
function verifyManifest (manifest, pubkeyB64) {
  const pk = pubkeyB64 || PUBKEY_B64
  if (!manifest || typeof manifest !== 'object') return { ok: false, error: 'manifest not an object' }
  if (typeof manifest.signature !== 'string' || !manifest.signature) return { ok: false, error: 'manifest has no signature' }
  if (typeof manifest.version !== 'string' || typeof manifest.url !== 'string') return { ok: false, error: 'manifest missing version/url' }
  const raw = Buffer.from(pk, 'base64')
  if (raw.length !== 32) return { ok: false, error: 'invalid embedded public key' }
  let pub
  try {
    pub = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
  } catch (e) { return { ok: false, error: 'bad public key: ' + e.message } }
  const ok = crypto.verify(null, Buffer.from(canonicalManifest(manifest), 'utf8'), pub, Buffer.from(manifest.signature, 'base64'))
  return ok ? { ok: true } : { ok: false, error: 'signature mismatch' }
}

// ---------- 1.1.6 review: strict field validation, only AFTER the signature is verified ----------
function urlAllowed (u, origins) {
  let x; try { x = new URL(u) } catch (e) { return false }
  if (x.username || x.password) return false
  return (origins || ALLOWED_ORIGINS).includes(x.protocol + '//' + x.host)
}
const SAFE_VER_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/ // 2.0.0 (U6)
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/
function validateManifest (m, origins) {
  if (!VER_RE.test(m.version)) return 'bad version'
  if (m.minVersion != null && !VER_RE.test(m.minVersion)) return 'bad minVersion'
  if (typeof m.url !== 'string' || !urlAllowed(m.url, origins)) return 'installer url not allowed: ' + String(m.url).slice(0, 120)
  if (!/\.exe$/i.test(new URL(m.url).pathname)) return 'installer url is not an .exe'
  if (!Number.isInteger(m.size) || m.size <= 0 || m.size > MAX_INSTALLER_SIZE) return 'bad size'
  if (typeof m.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(m.sha256)) return 'bad sha256'
  if (m.changelog != null && (typeof m.changelog !== 'object' || Object.values(m.changelog).some(v => typeof v !== 'string'))) return 'bad changelog'
  return null
}
// signature first, then fields; returns { ok, error }
function checkManifest (m, pubkeyB64, origins) {
  const v = verifyManifest(m, pubkeyB64)
  if (!v.ok) return v
  const bad = validateManifest(m, origins)
  return bad ? { ok: false, error: bad } : { ok: true }
}
const clean = s => String(s == null ? '' : s).replace(/[^\x20-\x7e]/g, '?').slice(0, 80)

// ---------- semver-ish compare ("1.1.5" / "1.1.6-beta.1"). returns 1 if a>b, -1 if a<b, 0 equal ----------
function parseVer (s) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.]+))?$/.exec(String(s || '').trim())
  if (!m) return null
  return { major: +m[1], minor: m[2] ? +m[2] : 0, patch: m[3] ? +m[3] : 0, pre: m[4] || '' }
}
function compareVersions (a, b) {
  const pa = parseVer(a); const pb = parseVer(b)
  if (!pa || !pb) return 0
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1   // release > pre-release
  if (!pb.pre) return -1
  return pa.pre < pb.pre ? -1 : 1
}

// ---------- helpers ----------
function sha256File (file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fs.createReadStream(file)
    s.on('data', d => h.update(d))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}
function httpsGetJSON (url, timeoutMs) {
  return httpGet(url, { 'User-Agent': 'SCDO-Wallet/' + (electron ? electron.app.getVersion() : 'test'), Accept: 'application/json' }, timeoutMs)
    .then(r => { try { return JSON.parse(r.body.toString('utf8')) } catch (e) { throw new Error('invalid JSON: ' + e.message) } })
}

class Updater {
  constructor (opts) {
    opts = opts || {}
    this.currentVersion = opts.currentVersion || (electron ? electron.app.getVersion() : '0.0.0')
    this.url = opts.url || UPDATER_URL
    this.urlProvider = opts.urlProvider || null // 2.0.7: () => [manifest URLs] for the chosen channel (main.js: updateChannel.manifestUrls)
    this.lastManifest = null
    this.pubkeyB64 = opts.pubkeyB64 || null
    this.origins = opts.allowedOrigins || ALLOWED_ORIGINS // tests only; main.js never passes url/pubkey/origins
    this.verified = null // last manifest that passed signature + field checks
    this.windowProvider = opts.windowProvider || (() => null)
    this.getUserData = opts.getUserData || (() => (electron ? electron.app.getPath('userData') : process.cwd()))
    this.quit = opts.quit || (() => { if (electron) electron.app.quit() })
    this.logFn = opts.logFn || null
    this.state = { skipVersion: null, downloading: false, installPending: null }
    this._loadState()
  }
  userData () { return this.getUserData() }
  updatesDir () { return path.join(this.userData(), 'updates') }
  // 2.0.0: local installer name follows the 2.0 installer file name (SCDOWallet-<ver>-win-x64-setup.exe)
  // 2.0.0 (U6): path.basename() - the version can never move the file out of <userData>\updates
  installerPath (version) { return path.join(this.updatesDir(), 'SCDOWallet-' + path.basename(String(version)) + '-win-x64-setup.exe') }
  statePath () { return path.join(this.userData(), 'update-state.json') }
  pendingPath () { return path.join(this.userData(), 'update-pending.json') }
  logPath () { return path.join(this.userData(), 'logs', 'updater.log') }
  log (msg) {
    const line = new Date().toISOString() + ' ' + msg
    try {
      fs.mkdirSync(path.dirname(this.logPath()), { recursive: true })
      fs.appendFileSync(this.logPath(), line + '\n')
    } catch (e) {}
    if (this.logFn) this.logFn(line)
    console.log('[updater]', msg)
  }
  _loadState () {
    try { this.state = Object.assign({ skipVersion: null, downloading: false, installPending: null }, JSON.parse(fs.readFileSync(this.statePath(), 'utf8'))) } catch (e) {}
  }
  _saveState () {
    try { fs.mkdirSync(path.dirname(this.statePath()), { recursive: true }); fs.writeFileSync(this.statePath(), JSON.stringify(this.state, null, 2)) } catch (e) {}
  }
  send (channel, payload) {
    const w = this.windowProvider()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }

  // one manifest URL: fetch + signature/field check. returns { ok, manifest } or { ok:false, state:'error', error, errorKind }
  async _fetchVerified (url, manual) {
    let manifest
    const tag = (manual ? ' [manual]' : ' (silent)') + (url !== UPDATER_URL ? ' ' + url : '')
    if (!urlAllowed(url, this.origins)) { this.log('check FAIL: manifest url not allowed'); return { ok: false, state: 'error', error: 'manifest url not allowed', errorKind: 'verify' } }
    try {
      manifest = await httpsGetJSON(url)
    } catch (e) {
      this.log('check FAIL (fetch): ' + e.message + tag)
      // 2.0.6: 'network' = the server could not be reached / read; 'verify' = the update file failed its checks
      return { ok: false, state: 'error', error: e.message, errorKind: /^invalid JSON/.test(e.message) ? 'verify' : 'network' }
    }
    const v = checkManifest(manifest, this.pubkeyB64, this.origins)
    this.log('check: manifest fetched, signature/fields ' + (v.ok ? 'OK' : 'FAIL: ' + v.error) + (v.ok ? ', version ' + manifest.version : '') + tag)
    // never prompt / download on an invalid signature – log only
    if (!v.ok) return { ok: false, state: 'error', error: v.error, errorKind: 'verify' }
    return { ok: true, manifest }
  }

  // ---------- 1. check ----------
  // returns { ok, state: 'none'|'available'|'required'|'error', manifest?, error? }
  // 2.0.5: a check (manual or silent) only fetches + verifies; it never stops mining or writes miner-intent.json / settings
  async check (manual) {
    // 2.0.7 (P3): the channel decides which built-in manifest URLs are read (stable: latest.json; beta: beta/latest.json,
    // then latest.json). Each one must pass the same signature + field checks; the newest verified manifest wins.
    const urls = (this.urlProvider ? this.urlProvider() : null) || [this.url]
    let manifest = null; let firstErr = null
    for (const url of urls) {
      const r = await this._fetchVerified(url, manual)
      if (!r.ok) { if (!firstErr) firstErr = r; continue }
      if (!manifest || compareVersions(r.manifest.version, manifest.version) > 0) manifest = r.manifest
    }
    if (!manifest) return firstErr
    this.lastManifest = manifest // 2.0.7: About shows the signed SHA-256 when this manifest describes the running version
    const cmp = compareVersions(manifest.version, this.currentVersion)
    if (cmp <= 0) { this.log('check: no update (current ' + this.currentVersion + ', manifest ' + manifest.version + (cmp < 0 ? ' - older, downgrade refused' : '') + ')'); return { ok: true, state: 'none' } }
    // 2.0.0 (U3): a required update (current < minVersion) is never hidden by "skip this version"
    const required = compareVersions(this.currentVersion, manifest.minVersion || '0.0.0') < 0
    if (this.state.skipVersion === manifest.version && !required) {
      this.log('check: version ' + manifest.version + ' skipped by user')
      return { ok: true, state: 'none' }
    }
    this.log('check: update available ' + this.currentVersion + ' -> ' + manifest.version + (required ? ' (required)' : ''))
    this.verified = manifest
    return { ok: true, state: required ? 'required' : 'available', manifest }
  }

  // ---------- 2. download with range resume + verify ----------
  // onProgress({ received, total, percent }) is called from the main process
  download (manifest, onProgress) {
    // 2.0.0 (U6): the version goes into a file name -> only [A-Za-z0-9.+-], starting alphanumeric (checked before anything else;
    // checkManifest's VER_RE below is stricter still)
    if (!manifest || !SAFE_VER_RE.test(String(manifest.version || ''))) { this.log('download REFUSED: unsafe version string'); return Promise.resolve({ ok: false, error: 'unsafe version string' }) }
    // 1.1.6 review: the manifest comes back from the renderer -> verify signature + fields again, refuse downgrades
    const v = checkManifest(manifest, this.pubkeyB64, this.origins)
    if (!v.ok) { this.log('download REFUSED: ' + v.error); return Promise.resolve({ ok: false, error: v.error }) }
    if (compareVersions(manifest.version, this.currentVersion) <= 0) { this.log('download REFUSED: ' + clean(manifest.version) + ' is not newer than ' + this.currentVersion); return Promise.resolve({ ok: false, error: 'not newer' }) }
    if (this.state.downloading) return Promise.resolve({ ok: false, error: 'already downloading' })
    this.state.downloading = true
    fs.mkdirSync(this.updatesDir(), { recursive: true })
    const finalFile = this.installerPath(manifest.version)
    const partFile = finalFile + '.part'
    return new Promise((resolve) => {
      let done = false
      const finish = (r) => { if (!done) { done = true; this.state.downloading = false; this._saveState(); resolve(r) } }
      let restarts = 0 // 2.0.0 (U1): at most one restart after HTTP 416, then fail (no endless loop)
      const start = () => {
        let existing = 0
        try { existing = fs.statSync(partFile).size } catch (e) {}
        if (existing > 0) this.log('download: resuming from byte ' + existing)
        const req = httpGetStream(manifest.url, { 'User-Agent': 'SCDO-Wallet/' + this.currentVersion, Range: 'bytes=' + existing + '-' }, DOWNLOAD_TIMEOUT_MS, res => {
          if (res.statusCode === 416) {
            res.resume()
            if (restarts >= 1) { this.log('download FAIL: HTTP 416 again after a restart'); try { fs.unlinkSync(partFile) } catch (e) {}; return finish({ ok: false, error: 'HTTP 416' }) }
            restarts++
            this.log('download: server says range unsatisfiable, restarting'); try { fs.unlinkSync(partFile) } catch (e) {}; return start()
          }
          if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); this.log('download FAIL: HTTP ' + res.statusCode); return finish({ ok: false, error: 'HTTP ' + res.statusCode }) }
          const total = existing + Number(res.headers['content-length'] || 0)
          const out = fs.createWriteStream(partFile, { flags: 'a' })
          let received = existing
          res.on('data', d => {
            received += d.length
            if (received > manifest.size) { this.log('download FAIL: more than ' + manifest.size + ' bytes'); req.destroy(); out.destroy(); try { fs.unlinkSync(partFile) } catch (e) {}; return finish({ ok: false, error: 'size mismatch' }) }
            if (onProgress) onProgress({ received, total: manifest.size || total, percent: manifest.size ? Math.min(100, Math.round(received * 100 / manifest.size)) : 0 })
          })
          res.pipe(out)
          // 2.0.0 (U2): a response stream error (connection dropped mid-transfer) fails the download instead of crashing
          res.on('error', e => { this.log('download FAIL (response stream): ' + e.message); out.destroy(); try { fs.unlinkSync(partFile) } catch (e2) {}; finish({ ok: false, error: e.message }) })
          res.on('aborted', () => { this.log('download FAIL (response aborted)'); out.destroy(); try { fs.unlinkSync(partFile) } catch (e2) {}; finish({ ok: false, error: 'aborted' }) })
          out.on('finish', async () => {
            try {
              if (done) return // 2.0.0: already failed (stream error / abort / over-size)
              const size = fs.statSync(partFile).size
              // 2.0.0 (U4): defence in depth - checkManifest already refuses a non-integer size before downloading
              if (!Number.isInteger(manifest.size) || manifest.size <= 0) { this.log('download FAIL: invalid manifest size'); try { fs.unlinkSync(partFile) } catch (e) {}; return finish({ ok: false, error: 'invalid manifest size' }) }
              if (size !== manifest.size) {
                this.log('download FAIL: size ' + size + ' != ' + manifest.size)
                try { fs.unlinkSync(partFile) } catch (e) {}
                return finish({ ok: false, error: 'size mismatch' })
              }
              const hash = await sha256File(partFile)
              if (hash.toLowerCase() !== manifest.sha256.toLowerCase()) {
                this.log('download FAIL: sha256 ' + hash + ' != ' + manifest.sha256)
                try { fs.unlinkSync(partFile) } catch (e) {}
                return finish({ ok: false, error: 'sha256 mismatch' })
              }
              this.log('download: size + sha256 OK')
              if (process.platform === 'win32') {
                const ac = await this.authenticode(partFile)
                this.log('download: Authenticode ' + ac.status + (ac.detail ? ' (' + ac.detail + ')' : ''))
                if (ac.status === 'FAIL') { try { fs.unlinkSync(partFile) } catch (e) {}; return finish({ ok: false, error: 'Authenticode ' + ac.detail }) }
              }
              fs.renameSync(partFile, finalFile)
              this.log('download: verified + installed package ready: ' + finalFile)
              finish({ ok: true, file: finalFile })
            } catch (e) {
              this.log('download FAIL: ' + e.message)
              try { fs.unlinkSync(partFile) } catch (e2) {}
              finish({ ok: false, error: e.message })
            }
          })
          out.on('error', e => { this.log('download FAIL (stream): ' + e.message); try { fs.unlinkSync(partFile) } catch (e2) {}; finish({ ok: false, error: e.message }) })
        })
        req.on('error', e => { this.log('download FAIL (net): ' + e.message); finish({ ok: false, error: e.message }) })
      }
      start()
    })
  }

  // Authenticode: Valid -> pass; NotSigned -> skipped (conditional per spec); anything else -> fail
  authenticode (file) {
    return new Promise((resolve) => {
      const ps = 'powershell.exe'
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        "(Get-AuthenticodeSignature -FilePath '" + file.replace(/'/g, "''") + "').Status"]
      execFile(ps, args, { windowsHide: true, timeout: 20000 }, (err, stdout) => {
        const status = String(stdout || '').trim()
        if (err || !status) return resolve({ status: 'UNKNOWN', detail: (err && err.message) || 'no output' })
        if (status === 'Valid') return resolve({ status: 'VALID' })
        if (status === 'NotSigned') return resolve({ status: 'SKIP', detail: 'not signed' })
        return resolve({ status: 'FAIL', detail: status })
      })
    })
  }

  // ---------- 3. install ----------
  // Stops the miner (keeping the auto-resume intent), writes an update-pending marker,
  // launches the installer /S detached, then quits the wallet.
  async install (file, manifest, { miner, stopMinerVisibly } = {}) {
    if (!manifest || !SAFE_VER_RE.test(String(manifest.version || ''))) { this.log('install REFUSED: unsafe version string'); return { ok: false, error: 'unsafe version string' } }
    const v = checkManifest(manifest, this.pubkeyB64, this.origins)
    if (!v.ok || compareVersions(manifest.version, this.currentVersion) <= 0) { this.log('install REFUSED: ' + (v.error || 'not newer')); return { ok: false, error: v.error || 'not newer' } }
    // 1.1.6 review: re-check the file right before it is executed (only our verified file in <userData>\updates)
    const expect = this.installerPath(manifest.version)
    if (path.resolve(file) !== path.resolve(expect)) { this.log('install REFUSED: unexpected file ' + file); return { ok: false, error: 'unexpected file' } }
    let st = null; try { st = fs.statSync(file) } catch (e) {}
    const h = st ? await sha256File(file) : ''
    if (!st || st.size !== manifest.size || h.toLowerCase() !== manifest.sha256.toLowerCase()) { this.log('install REFUSED: installer changed after verification'); try { fs.unlinkSync(file) } catch (e) {}; return { ok: false, error: 'installer changed after verification' } }
    const wasMining = !!(miner && minerActive(miner))
    if (wasMining) {
      this.log('install: miner active – safe stop (Ctrl+C, force after timeout)')
      try { await stopMinerVisibly(this.windowProvider()) } catch (e) { this.log('install: stop miner error ' + e.message) }
      // intent.autoResume stays true -> next launch resumes mining automatically
    }
    const pending = { version: manifest.version, wasMining, mode: wasMining && miner.state && miner.state.mode === 'node' ? 'node' : 'mine', ts: new Date().toISOString() }
    try { fs.writeFileSync(this.pendingPath(), JSON.stringify(pending, null, 2)) } catch (e) { this.log('install: cannot write pending marker ' + e.message) }
    const installer = file
    // /S silent overwrite; --force-run: the installer starts the wallet again when it is done (then mining resumes)
    const child = require('child_process').spawn(installer, ['/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', e => this.log('install: installer failed to start: ' + e.message))
    // 2.0.0 (M2): best effort - the wallet quits ~0.4 s later, so a later exit is recorded by the resume path instead
    child.on('exit', (code, sig) => this.log('install: installer exited code=' + code + (sig ? ' sig=' + sig : '')))
    child.unref()
    this.log('install: launched detached installer /S --force-run (' + path.basename(installer) + '), quitting wallet')
    this.send('update:installing', pending)
    setTimeout(() => this.quit(), 400)
    return { ok: true }
  }

  // ---------- 4. resume after a completed update (called on every launch) ----------
  // If update-pending.json exists and its version matches the running version, the update applied:
  // log success, clear the marker, and restore mining when it was mining before.
  // 2.0.6: returns { applied, version, wasMining } so the main window can say "updated" in its title
  resumeAfterUpdate () {
    let pending = null
    let result = { applied: false }
    try { pending = JSON.parse(fs.readFileSync(this.pendingPath(), 'utf8')) } catch (e) { return result }
    try {
      if (pending && pending.version === this.currentVersion) {
        result = { applied: true, version: pending.version, wasMining: !!pending.wasMining }
        this.log('resume: update applied ' + pending.version + ' (wasMining=' + pending.wasMining + ')')
        if (pending.wasMining) {
          const intentPath = path.join(this.userData(), 'miner-intent.json')
          try {
            let it = {}
            try { it = JSON.parse(fs.readFileSync(intentPath, 'utf8')) || {} } catch (e) {}
            it.autoResume = true
            it.resumeOnce = true // 2.0.5: resume this one launch even when "Keep mining" is off (the update stopped it, not the user)
            if (pending.mode === 'node' || pending.mode === 'mine') it.mode = pending.mode
            fs.mkdirSync(path.dirname(intentPath), { recursive: true })
            fs.writeFileSync(intentPath, JSON.stringify(it, null, 2))
            this.log('resume: miner intent restored (autoResume=true, resumeOnce, mode ' + it.mode + ')')
          } catch (e) { this.log('resume: intent restore failed ' + e.message) }
        }
      } else if (pending) {
        this.log('resume: update did NOT apply (running ' + this.currentVersion + ', expected ' + pending.version + ')')
      }
    } catch (e) {
      this.log('resume: error ' + e.message)
    }
    try { fs.unlinkSync(this.pendingPath()) } catch (e) {}
    return result
  }
}

function minerActive (miner) {
  if (!miner) return false
  return !!(miner.wantRunning || miner.stopping || miner.cleaning || Object.values(miner.procs || {}).some(Boolean))
}

// 2.0.6: classify a download/install error for the user ('network' vs 'verify')
function errorKind (msg) { return /timeout|HTTP \d|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|socket|aborted|network/i.test(String(msg || '')) ? 'network' : 'verify' }
module.exports = { Updater, errorKind, verifyManifest, checkManifest, validateManifest, urlAllowed, compareVersions, canonicalManifest, UPDATER_URL, ALLOWED_ORIGINS, PUBKEY_B64, CHECK_DELAY_MS, CHECK_INTERVAL_MS }
