// ScdoWallet built-in shard0 GPU miner: runs (all local, no .bat files)
//   core-geth node (--miner.etherbase = wallet address)  ->  scdo-stratum proxy (-autostart)  ->  Rigel (NVIDIA)
// Lives in the Electron MAIN process; the renderer talks to it over IPC ('miner:*').
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { spawn, execFile } = require('child_process')
const { EventEmitter } = require('events')

const RIGEL = {
  version: '1.23.2',
  win32: { file: 'rigel-1.23.2-win.zip', sha256: '0a35d37504e2595f2cd9bb25ae69eae39625be6f0ebbdbaf7427d4c381a7fd79', dir: 'rigel-1.23.2-win', exe: 'rigel.exe' },
  linux: { file: 'rigel-1.23.2-linux.tar.gz', sha256: 'eae492ffb64aeb4ab4ba7e66631567984a31d5adb1ef547bda6601aee1793f0d', dir: 'rigel-1.23.2-linux', exe: 'rigel' }
}
const BOOTNODE = 'enode://1d2c370db7c419349e2313f20023f6b379f946990042b9b42df45cb56e4c3487df0d36c52cd81308fcdf312450f758a6213fcac21213e94a71af4a3c9392601f@82.223.19.88:30368'
const REF_RPC = 'https://scdoscan.io/rpc/0'
const PORTS = { http: 18545, auth: 18551, p2p: 30368, stratum: 3333, rigelApi: 5055 }
// test hook: shift all local ports (e.g. to run next to another node on the same machine)
if (process.env.SCDO_MINER_PORT_OFFSET) { const o = parseInt(process.env.SCDO_MINER_PORT_OFFSET, 10) || 0; for (const k of Object.keys(PORTS)) PORTS[k] += o }

function rpc (url, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] })
    const u = new URL(url)
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(u, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: timeoutMs || 5000 }, res => {
      let d = ''; res.on('data', c => { d += c }); res.on('end', () => {
        try { const j = JSON.parse(d); j.error ? reject(new Error(j.error.message)) : resolve(j.result) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(body)
  })
}

function httpGetJson (url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs || 3000 }, res => {
      let d = ''; res.on('data', c => { d += c }); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
    })
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject)
  })
}

function download (url, dest, onProgress, redirects) {
  redirects = redirects || 0
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'ScdoWallet' }, timeout: 30000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 8) {
        res.resume(); return resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress, redirects + 1))
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)) }
      const total = parseInt(res.headers['content-length'] || '0', 10); let got = 0
      const out = fs.createWriteStream(dest + '.part')
      res.on('data', c => { got += c.length; if (onProgress) onProgress(got, total) })
      res.pipe(out)
      out.on('finish', () => out.close(() => { fs.renameSync(dest + '.part', dest); resolve(dest) }))
      out.on('error', reject); res.on('error', reject)
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('download timeout')) })
  })
}

function sha256File (p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

function run (cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, Object.assign({ windowsHide: true, maxBuffer: 16 << 20 }, opts || {}), (err, stdout, stderr) => {
      if (err) { err.message += '\n' + stdout + stderr; reject(err) } else resolve(stdout + stderr)
    })
  })
}

// pure-JS zip extraction (no dependency on tar.exe / PowerShell), with path-traversal guard
function extractZip (zipPath, destDir) {
  const yauzl = require('yauzl')
  const root = path.resolve(destDir)
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      zip.on('error', reject); zip.on('end', resolve)
      zip.readEntry()
      zip.on('entry', entry => {
        const target = path.resolve(root, entry.fileName)
        if (target !== root && !target.startsWith(root + path.sep)) return reject(new Error('bad zip entry ' + entry.fileName))
        if (/\/$/.test(entry.fileName)) { fs.mkdirSync(target, { recursive: true }); return zip.readEntry() }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        zip.openReadStream(entry, (e2, rs) => {
          if (e2) return reject(e2)
          const ws = fs.createWriteStream(target)
          rs.pipe(ws); ws.on('finish', () => zip.readEntry()); ws.on('error', reject)
        })
      })
    })
  })
}

// keep log files bounded: a miner runs for weeks and geth/proxy/wallet logs grow ~100 MB/day otherwise
const LOG_MAX = 20 * 1024 * 1024
function rotateIfBig (file, max) {
  try { if (fs.statSync(file).size > (max || LOG_MAX)) { try { fs.unlinkSync(file + '.1') } catch (e) {} fs.renameSync(file, file + '.1'); return true } } catch (e) {}
  return false
}

class MinerManager extends EventEmitter {
  // opts: { binDir, genesis, dataRoot, platform, rigelExe (override, tests), refRpc }
  constructor (opts) {
    super()
    this.o = Object.assign({ platform: process.platform, refRpc: REF_RPC }, opts)
    this.exe = this.o.platform === 'win32' ? '.exe' : ''
    this.dataDir = path.join(this.o.dataRoot, 'data')
    this.logDir = path.join(this.o.dataRoot, 'logs')
    this.minerDir = path.join(this.o.dataRoot, 'miner')
    this.procs = {}
    this.logStreams = {}
    this.logLines = 0
    this.restarts = {}
    this.wantRunning = false
    this.state = this.freshState()
  }

  freshState () {
    return {
      phase: 'idle', message: '', wallet: null, worker: os.hostname().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'scdo',
      localBlock: null, networkBlock: null, peers: null, nodeMining: false, paused: false,
      hashrate: null, hashrateSource: null, sharesAccepted: 0, sharesRejected: 0, blocksFound: 0, blocksFoundHeights: [],
      rigelRestarts: 0, balanceWei: null, startedAt: null, download: null, lastError: null, logTail: []
    }
  }

  status () { return Object.assign({}, this.state, { running: this.wantRunning, procs: Object.keys(this.procs).filter(k => this.procs[k]) }) }

  set (patch) { Object.assign(this.state, patch); this.emit('status', this.status()) }

  log (src, line) {
    line = String(line).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd()
    if (!line) return
    const l = new Date().toTimeString().slice(0, 8) + ' [' + src + '] ' + line
    this.state.logTail.push(l); if (this.state.logTail.length > 200) this.state.logTail.shift()
    const wf = path.join(this.logDir, 'wallet-miner.log')
    if (++this.logLines % 500 === 0) rotateIfBig(wf)
    try { fs.appendFileSync(wf, l + '\n') } catch (e) {}
    this.parseLine(src, line)
    this.emit('log', l)
  }

  parseLine (src, line) {
    if (src === 'proxy') {
      if (/share accepted/.test(line)) this.state.sharesAccepted++
      else if (/share rejected/.test(line)) this.state.sharesRejected++
      let m = line.match(/BLOCK FOUND: height (\d+)/)
      if (m) { this.state.blocksFound++; this.state.blocksFoundHeights.push(parseInt(m[1], 10)); this.emit('block', parseInt(m[1], 10)) }
      m = line.match(/est\. ([\d.]+) MH\/s/)
      if (m && !(this.state.hashrateSource === 'rigel')) { this.state.hashrate = parseFloat(m[1]) * 1e6; this.state.hashrateSource = 'proxy' }
      // periodic stats line (scdostratum >= 1.0.1) carries authoritative totals
      m = line.match(/shares (\d+) ok \/ (\d+) bad/)
      if (m) { this.state.sharesAccepted = Math.max(this.state.sharesAccepted, +m[1]); this.state.sharesRejected = Math.max(this.state.sharesRejected, +m[2]) }
      if (/PAUSED:/.test(line)) this.state.paused = true
      if (/resumed:|miner_start OK/.test(line)) this.state.paused = false
    }
  }

  // ---------- setup ----------
  bin (name) {
    const p = path.join(this.o.binDir, name + this.exe)
    if (!fs.existsSync(p)) throw new Error('missing ' + p)
    return p
  }

  rigelPath () {
    if (this.o.rigelExe) return this.o.rigelExe
    const r = RIGEL[this.o.platform === 'win32' ? 'win32' : 'linux']
    return path.join(this.minerDir, r.dir, r.exe)
  }

  async ensureRigel () {
    const exe = this.rigelPath()
    if (fs.existsSync(exe)) return exe
    const r = RIGEL[this.o.platform === 'win32' ? 'win32' : 'linux']
    fs.mkdirSync(this.minerDir, { recursive: true })
    const archive = path.join(this.minerDir, r.file)
    if (!(fs.existsSync(archive) && await sha256File(archive) === r.sha256)) {
      const url = 'https://github.com/rigelminer/rigel/releases/download/' + RIGEL.version + '/' + r.file
      this.set({ phase: 'downloading', message: 'Downloading Rigel ' + RIGEL.version + ' (NVIDIA miner, ~56 MB) from github.com/rigelminer ...' })
      let last = 0
      await download(url, archive, (got, total) => {
        const now = Date.now(); if (now - last > 500) { last = now; this.set({ download: { got, total } }) }
      })
    }
    const h = await sha256File(archive)
    if (h !== r.sha256) { fs.unlinkSync(archive); throw new Error('Rigel SHA256 mismatch (got ' + h + '), file deleted – try again') }
    this.set({ phase: 'extracting', message: 'SHA256 OK, extracting Rigel ...', download: null })
    if (/\.zip$/.test(archive)) await extractZip(archive, this.minerDir)
    else await run('tar', ['-xzf', archive, '-C', this.minerDir])
    await new Promise(resolve => setTimeout(resolve, 2000)) // give Defender a moment to act
    if (!fs.existsSync(exe)) {
      const err = new Error('DEFENDER: rigel.exe disappeared after extraction – Windows Defender most likely quarantined it (all GPU miners are flagged as "potentially unwanted"). Click "Allow miner in Windows Defender" and start again.')
      err.code = 'DEFENDER'; throw err
    }
    return exe
  }

  async ensureChain () {
    if (fs.existsSync(path.join(this.dataDir, 'geth', 'chaindata'))) return
    this.set({ phase: 'init', message: 'Creating the SCDO shard0 chain database ...' })
    fs.mkdirSync(this.dataDir, { recursive: true })
    const out = await run(this.bin('geth'), ['--datadir', this.dataDir, 'init', this.o.genesis])
    fs.writeFileSync(path.join(this.logDir, 'geth-init.log'), out)
  }

  // ---------- processes ----------
  spawnChild (name, cmd, args) {
    const p = spawn(cmd, args, { cwd: this.o.dataRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    this.procs[name] = p
    const lf = path.join(this.logDir, name + '.log')
    rotateIfBig(lf)
    const logf = this.logStreams[name] = fs.createWriteStream(lf, { flags: 'a' })
    let buf = { out: '', err: '' }
    const onData = (k) => (d) => {
      const ls = this.logStreams[name]; if (ls) ls.write(d); buf[k] += d.toString()
      const lines = buf[k].split(/\r?\n/); buf[k] = lines.pop()
      lines.forEach(l => this.log(name, l))
    }
    p.stdout.on('data', onData('out')); p.stderr.on('data', onData('err'))
    p.on('error', e => this.log(name, 'spawn error: ' + e.message))
    p.on('exit', (code, sig) => {
      if (this.procs[name] === p) { const ls = this.logStreams[name]; if (ls) ls.end(); this.logStreams[name] = null; this.procs[name] = null } else logf.end()
      this.log(name, 'exited (code ' + code + (sig ? ', ' + sig : '') + ')')
      if (this.wantRunning) this.scheduleRestart(name, code)
    })
    return p
  }

  scheduleRestart (name, code) {
    const now = Date.now()
    const r = this.restarts[name] = (this.restarts[name] || []).filter(t => now - t < 10 * 60 * 1000)
    r.push(now)
    if (name === 'rigel') this.state.rigelRestarts++
    if (r.length > 6) {
      this.set({ phase: 'error', lastError: name + ' keeps exiting (6 times in 10 min) – see logs', message: name + ' keeps crashing – stopped. See the log below.' })
      this.stop(); return
    }
    const delay = name === 'rigel' ? 10000 : 5000
    this.log('wallet', name + ' exited with code ' + code + ' – restarting in ' + delay / 1000 + ' s')
    setTimeout(() => {
      if (!this.wantRunning || this.procs[name]) return
      try {
        if (name === 'geth') this.startGeth()
        else if (name === 'proxy') this.startProxy()
        else if (name === 'rigel') {
          if (!fs.existsSync(this.rigelPath())) { this.set({ phase: 'error', lastError: 'DEFENDER', message: 'rigel.exe is missing – Windows Defender probably quarantined it.' }); return }
          this.startRigel()
        }
      } catch (e) { this.set({ phase: 'error', lastError: e.message, message: e.message }) }
    }, delay)
  }

  startGeth () {
    const w = this.state.wallet
    return this.spawnChild('geth', this.bin('geth'), [
      // --gcmode archive: write the state of every block to disk at once. On Windows we can only hard-kill geth
      // (taskkill /F), and in the default "full" mode the in-memory state is then lost: the node rewinds to
      // block 0 ("Head state missing") and can only recover via snap sync from a peer that is AHEAD of it,
      // i.e. a lone/main miner restarting would deadlock the chain. SCDO blocks are tiny, so archive is cheap.
      '--datadir', this.dataDir, '--networkid', '5680', '--syncmode', 'full', '--gcmode', 'archive', '--port', String(PORTS.p2p),
      '--bootnodes', BOOTNODE,
      '--http', '--http.addr', '127.0.0.1', '--http.port', String(PORTS.http), '--http.api', 'eth,net,web3,miner',
      '--authrpc.port', String(PORTS.auth), '--ipcdisable',
      '--miner.etherbase', w, '--miner.gaslimit', '30000000', '--miner.gasprice', '1000000', '--txpool.pricelimit', '1000000',
      '--ethash.dagdir', path.join(this.dataDir, 'ethash-dag'), '--ethash.cachedir', path.join(this.dataDir, 'ethash-cache'),
      '--verbosity', '3'
    ])
  }

  startProxy () {
    return this.spawnChild('proxy', this.bin('scdo-stratum'), [
      '-rpc', 'http://127.0.0.1:' + PORTS.http, '-listen', '127.0.0.1:' + PORTS.stratum,
      '-autostart', '-ref-rpc', this.o.refRpc
    ]) // stdout/stderr are captured into logs/proxy.log by spawnChild (passing -log too wrote every line twice)
  }

  startRigel () {
    return this.spawnChild('rigel', this.rigelPath(), [
      '-a', 'ethash', '-o', 'ethproxy+tcp://127.0.0.1:' + PORTS.stratum, '-u', this.state.wallet, '-w', this.state.worker,
      '--api-bind', '127.0.0.1:' + PORTS.rigelApi, '--no-tui', '--no-colour', '--log-file', path.join(this.logDir, 'rigel-own.log')
    ])
  }

  // ---------- lifecycle ----------
  async start (wallet, opts) {
    opts = opts || {}
    if (this.wantRunning) throw new Error('already running')
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet || '') || /^0x0{40}$/.test(wallet)) throw new Error('invalid reward address ' + wallet)
    fs.mkdirSync(this.logDir, { recursive: true })
    this.state = Object.assign(this.freshState(), { wallet, startedAt: Date.now() })
    this.wantRunning = true; this.restarts = {}
    this.emit('status', this.status())
    try {
      if (!opts.noRigel) await this.ensureRigel()
      if (!this.wantRunning) return
      await this.ensureChain()
      if (!this.wantRunning) return
      this.set({ phase: 'starting', message: 'Starting the local SCDO node and stratum proxy ...' })
      this.startGeth()
      await new Promise(resolve => setTimeout(resolve, 3000))
      if (!this.wantRunning) return
      this.startProxy()
      this.set({ phase: 'syncing', message: 'Syncing with the SCDO network (first start: 1-5 minutes) ...' })
      this.poller = setInterval(() => this.poll().catch(() => {}), 3000)
      this.opts = opts
    } catch (e) {
      this.set({ phase: 'error', lastError: e.code || e.message, message: e.message })
      this.stop()
      throw e
    }
  }

  rotateChildLogs () {
    for (const name of Object.keys(this.logStreams)) {
      const ls = this.logStreams[name]; if (!ls) continue
      const lf = path.join(this.logDir, name + '.log')
      try { if (fs.statSync(lf).size <= LOG_MAX) continue } catch (e) { continue }
      ls.end(); rotateIfBig(lf); this.logStreams[name] = fs.createWriteStream(lf, { flags: 'a' })
    }
  }

  async poll () {
    if (!this.wantRunning) return
    if (!this.lastRotate || Date.now() - this.lastRotate > 300000) { this.lastRotate = Date.now(); this.rotateChildLogs() }
    const L = 'http://127.0.0.1:' + PORTS.http
    let bn, peers, mining
    try {
      [bn, peers, mining] = await Promise.all([rpc(L, 'eth_blockNumber'), rpc(L, 'net_peerCount'), rpc(L, 'eth_mining')])
    } catch (e) { this.set({ message: this.state.phase === 'syncing' ? 'Node starting ...' : this.state.message }); return }
    const patch = { localBlock: parseInt(bn, 16), peers: parseInt(peers, 16), nodeMining: !!mining }
    if (!this.lastRef || Date.now() - this.lastRef > 15000) {
      this.lastRef = Date.now()
      rpc(this.o.refRpc, 'eth_blockNumber', [], 8000).then(r => this.set({ networkBlock: parseInt(r, 16) })).catch(() => {})
    }
    try { patch.balanceWei = BigInt(await rpc(L, 'eth_getBalance', [this.state.wallet, 'latest'])).toString() } catch (e) {}
    if (this.state.phase === 'syncing') {
      patch.message = 'Syncing: local block ' + patch.localBlock + ' / network ' + (this.state.networkBlock == null ? '?' : this.state.networkBlock) + ', peers ' + patch.peers
      if (mining) {
        if (this.opts && this.opts.noRigel) { patch.phase = 'mining'; patch.message = 'Node synced, work ready (no GPU miner started – test mode)' } else {
          this.startRigel(); patch.phase = 'mining'; patch.message = 'Mining: node synced, Rigel started. Rewards (2 SCDO/block) go to ' + this.state.wallet
        }
      }
    } else if (this.state.phase === 'mining') {
      if (this.state.paused) patch.message = 'Paused by the proxy (node lost peers or out of sync) – resumes automatically'
      else patch.message = 'Mining – rewards go to ' + this.state.wallet
      try {
        const j = await httpGetJson('http://127.0.0.1:' + PORTS.rigelApi + '/')
        const hr = MinerManager.rigelHashrate(j)
        if (hr != null) { patch.hashrate = hr; patch.hashrateSource = 'rigel' }
        const sh = MinerManager.rigelShares(j)
        if (sh) patch.rigelShares = sh
      } catch (e) {}
    }
    this.set(patch)
  }

  static rigelHashrate (j) {
    // defensive: Rigel's API has {hashrate:{ethash:<H/s>}} (or a number); fall back to summing devices
    if (!j) return null
    if (typeof j.hashrate === 'number') return j.hashrate
    if (j.hashrate && typeof j.hashrate === 'object') {
      const v = Object.values(j.hashrate).filter(x => typeof x === 'number'); if (v.length) return v.reduce((a, b) => a + b, 0)
    }
    if (Array.isArray(j.devices)) {
      let s = 0; let any = false
      j.devices.forEach(d => { const h = d && d.hashrate; if (typeof h === 'number') { s += h; any = true } else if (h && typeof h === 'object') Object.values(h).forEach(x => { if (typeof x === 'number') { s += x; any = true } }) })
      if (any) return s
    }
    return null
  }

  static rigelShares (j) {
    const st = j && (j.solution_stat || j.shares)
    if (!st || typeof st !== 'object') return null
    const v = st.ethash || Object.values(st)[0]
    if (v && typeof v === 'object') return { accepted: v.accepted || 0, rejected: v.rejected || 0, invalid: v.invalid || 0 }
    return null
  }

  async stop () {
    this.wantRunning = false
    if (this.poller) { clearInterval(this.poller); this.poller = null }
    const order = ['rigel', 'proxy', 'geth']
    for (const n of order) {
      const p = this.procs[n]
      if (!p) continue
      await new Promise(resolve => {
        const t = setTimeout(() => { try { p.kill('SIGKILL') } catch (e) {} resolve() }, n === 'geth' ? 15000 : 5000)
        p.once('exit', () => { clearTimeout(t); resolve() })
        try {
          if (this.o.platform === 'win32') {
            // no console to send Ctrl+C to: taskkill /T /F (also covers Rigel's child processes); geth recovers on next start
            execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {})
          } else p.kill('SIGINT')
        } catch (e) { resolve() }
      })
      this.procs[n] = null
    }
    if (this.state.phase !== 'error') this.set({ phase: 'stopped', message: 'Stopped.' })
    else this.emit('status', this.status())
  }

  // Opt-in, user-clicked: add a Windows Defender exclusion for the miner folder (UAC prompt).
  defenderExclusion () {
    if (this.o.platform !== 'win32') return Promise.resolve('not windows')
    fs.mkdirSync(this.minerDir, { recursive: true })
    const inner = "Add-MpPreference -ExclusionPath '" + this.minerDir.replace(/'/g, "''") + "'"
    const b64 = Buffer.from(inner, 'utf16le').toString('base64')
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','" + b64 + "'"])
  }
}

module.exports = { MinerManager, RIGEL, PORTS, BOOTNODE, extractZip, download, sha256File }
