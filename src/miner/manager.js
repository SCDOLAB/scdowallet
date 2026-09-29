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
const net = require('net')
const dgram = require('dgram')
const { spawn, execFile } = require('child_process')
const { EventEmitter } = require('events')

const RIGEL = {
  version: '1.23.2',
  win32: { file: 'rigel-1.23.2-win.zip', sha256: '0a35d37504e2595f2cd9bb25ae69eae39625be6f0ebbdbaf7427d4c381a7fd79', dir: 'rigel-1.23.2-win', exe: 'rigel.exe' },
  linux: { file: 'rigel-1.23.2-linux.tar.gz', sha256: 'eae492ffb64aeb4ab4ba7e66631567984a31d5adb1ef547bda6601aee1793f0d', dir: 'rigel-1.23.2-linux', exe: 'rigel' }
}
const BOOTNODE = 'enode://1d2c370db7c419349e2313f20023f6b379f946990042b9b42df45cb56e4c3487df0d36c52cd81308fcdf312450f758a6213fcac21213e94a71af4a3c9392601f@82.223.19.88:30368'
const REF_RPC = 'https://scdoscan.io/rpc/0'
const BASE_PORTS = { http: 18545, auth: 18551, p2p: 30368, stratum: 3333, rigelApi: 5055 }
const PORTS = Object.assign({}, BASE_PORTS) // ports actually in use (shifted when the defaults are taken)
// test hook: shift all local ports (e.g. to run next to another node on the same machine)
const ENV_OFFSET = parseInt(process.env.SCDO_MINER_PORT_OFFSET || '0', 10) || 0
const SHARD0_CHAIN_ID = 5680

// ---------- port helpers ----------
function tcpFree (port, host) {
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, host)
  })
}
function udpFree (port) {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4')
    s.once('error', () => { try { s.close() } catch (e) {} resolve(false) })
    s.bind(port, () => s.close(() => resolve(true)))
  })
}
async function portsFree (p) {
  const checks = await Promise.all([
    tcpFree(p.http, '127.0.0.1'), tcpFree(p.auth, '127.0.0.1'), tcpFree(p.stratum, '127.0.0.1'), tcpFree(p.rigelApi, '127.0.0.1'),
    tcpFree(p.p2p), udpFree(p.p2p)])
  return checks.every(Boolean)
}

// ---------- GPU detection (B1: never start the CUDA miner on a PC without an NVIDIA GPU) ----------
function detectGpu (platform) {
  platform = platform || process.platform
  return new Promise(resolve => {
    const done = (names, nvidiaDriver) => {
      names = (names || []).map(x => String(x).trim()).filter(Boolean)
      const nv = names.filter(n => /nvidia|geforce|quadro|tesla|rtx|gtx/i.test(n))
      const drv = nvidiaDriver !== false
      resolve({ names, nvidia: nv.length > 0 && drv, nvidiaNames: nv, driver: drv, nvidiaNoDriver: nv.length > 0 && !drv })
    }
    if (platform === 'win32') {
      const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
      const hasCuda = fs.existsSync(path.join(sys, 'nvcuda.dll'))
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }'], { windowsHide: true, timeout: 20000 }, (err, out) => {
        const names = err ? [] : String(out).split(/\r?\n/)
        if (err && hasCuda) return done(['NVIDIA (nvcuda.dll)'], true)
        done(names, hasCuda)
      })
    } else if (platform === 'linux') {
      execFile('nvidia-smi', ['-L'], { timeout: 10000 }, (err, out) => {
        if (!err && /GPU \d+:/.test(out)) return done(String(out).split(/\r?\n/).map(l => l.replace(/^GPU \d+:\s*/, '').replace(/\s*\(UUID.*$/, '')), true)
        done([], false)
      })
    } else done([], false)
  })
}

// Windows: send Ctrl+C to a console child (geth/proxy/rigel run with a hidden console). Same technique as
// tools/stop-node.ps1 of the miner package: attach to the child's console and raise CTRL_C_EVENT there.
const CTRL_C_PS1 = [
  'param([int]$ProcessId)',
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  'using System; using System.Runtime.InteropServices;',
  'public static class ScdoCtrlC {',
  '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);',
  '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();',
  '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool add);',
  '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);',
  '}',
  "'@",
  '[void][ScdoCtrlC]::FreeConsole()',
  'if (-not [ScdoCtrlC]::AttachConsole([uint32]$ProcessId)) { Write-Output ("attach failed " + [Runtime.InteropServices.Marshal]::GetLastWin32Error()); exit 2 }',
  '[void][ScdoCtrlC]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)',
  'if (-not [ScdoCtrlC]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }',
  'Start-Sleep -Milliseconds 300',
  '[void][ScdoCtrlC]::FreeConsole()',
  'exit 0'
].join('\r\n')

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
      phase: 'idle', code: 'IDLE', mode: null, message: '', wallet: null, external: false, ports: null, worker: os.hostname().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'scdo',
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
    if (src === 'rigel' && !this.noGpuHandled && !(this.state.hashrate > 0) &&
        /CUDA error|failed to load CUDA|no (compatible |CUDA |NVIDIA )?(devices|GPUs?) (found|detected|available)/i.test(line)) {
      // B1: Rigel's own watchdog restarts it every 5 s, so the process never exits and the wallet showed a
      // fake "Mining" at 0 H/s. Treat any CUDA load/device error as fatal: stop and tell the user plainly.
      this.noGpuHandled = true
      this.set({ phase: 'error', code: 'NO_NVIDIA', lastError: 'NO_NVIDIA', message: 'No usable NVIDIA GPU / CUDA driver: ' + line })
      setImmediate(() => this.stop({ keepError: true }))
      return
    }
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
      this.set({ phase: 'downloading', code: 'DOWNLOADING', message: 'Downloading Rigel ' + RIGEL.version + ' (NVIDIA miner, ~56 MB) from github.com/rigelminer ...' })
      let last = 0
      await download(url, archive, (got, total) => {
        const now = Date.now(); if (now - last > 500) { last = now; this.set({ download: { got, total } }) }
      })
    }
    const h = await sha256File(archive)
    if (h !== r.sha256) { fs.unlinkSync(archive); throw new Error('Rigel SHA256 mismatch (got ' + h + '), file deleted – try again') }
    this.set({ phase: 'extracting', code: 'EXTRACTING', message: 'SHA256 OK, extracting Rigel ...', download: null })
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
    this.set({ phase: 'init', code: 'INIT', message: 'Creating the SCDO shard0 chain database ...' })
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
      this.set({ phase: 'error', code: 'CRASHING', lastError: name + ' keeps exiting (6 times in 10 min) – see logs', message: name + ' keeps crashing – stopped. See the log below.' })
      this.stop({ keepError: true }); return
    }
    const delay = name === 'rigel' ? 10000 : 5000
    this.log('wallet', name + ' exited with code ' + code + ' – restarting in ' + delay / 1000 + ' s')
    setTimeout(() => {
      if (!this.wantRunning || this.procs[name]) return
      try {
        if (name === 'geth') this.startGeth()
        else if (name === 'proxy') this.startProxy()
        else if (name === 'rigel') {
          if (!fs.existsSync(this.rigelPath())) { this.set({ phase: 'error', code: 'DEFENDER', lastError: 'DEFENDER', message: 'rigel.exe is missing – Windows Defender probably quarantined it.' }); return }
          this.startRigel()
        }
      } catch (e) { this.set({ phase: 'error', lastError: e.message, message: e.message }) }
    }, delay)
  }

  startGeth () {
    const w = this.state.wallet
    const nodeOnly = this.state.mode === 'node'
    if (nodeOnly) {
      // B2: node only – no miner API, no etherbase, no proxy, no Rigel
      return this.spawnChild('geth', this.bin('geth'), [
        '--datadir', this.dataDir, '--networkid', '5680', '--syncmode', 'full', '--gcmode', 'archive', '--port', String(PORTS.p2p),
        '--bootnodes', BOOTNODE,
        '--http', '--http.addr', '127.0.0.1', '--http.port', String(PORTS.http), '--http.api', 'eth,net,web3',
        '--authrpc.addr', '127.0.0.1', '--authrpc.port', String(PORTS.auth), '--ipcdisable', '--cache', '512',
        '--verbosity', '3'
      ])
    }
    return this.spawnChild('geth', this.bin('geth'), [
      // --gcmode archive: write the state of every block to disk at once. On Windows we can only hard-kill geth
      // (taskkill /F), and in the default "full" mode the in-memory state is then lost: the node rewinds to
      // block 0 ("Head state missing") and can only recover via snap sync from a peer that is AHEAD of it,
      // i.e. a lone/main miner restarting would deadlock the chain. SCDO blocks are tiny, so archive is cheap.
      '--datadir', this.dataDir, '--networkid', '5680', '--syncmode', 'full', '--gcmode', 'archive', '--port', String(PORTS.p2p),
      '--bootnodes', BOOTNODE,
      '--http', '--http.addr', '127.0.0.1', '--http.port', String(PORTS.http), '--http.api', 'eth,net,web3,miner',
      '--authrpc.addr', '127.0.0.1', '--authrpc.port', String(PORTS.auth), '--ipcdisable',
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
  // Is an SCDO shard0 node (chainId 5680) already answering on 127.0.0.1:<port>? (e.g. the T14s' permanent node)
  async externalNodeAt (port) {
    try { const id = await rpc('http://127.0.0.1:' + port, 'eth_chainId', [], 2000); return parseInt(id, 16) === SHARD0_CHAIN_ID } catch (e) { return false }
  }

  // pick a free port set: defaults first, then +100, +200, ... (another node / miner may already use the defaults)
  async choosePorts () {
    for (let i = 0; i < 8; i++) {
      const off = ENV_OFFSET + i * 100
      const p = {}; for (const k of Object.keys(BASE_PORTS)) p[k] = BASE_PORTS[k] + off
      if (await portsFree(p)) { Object.assign(PORTS, p); return p }
    }
    throw Object.assign(new Error('no free local ports for the SCDO node (18545+ are all in use)'), { code: 'PORTS' })
  }

  async gpu () {
    if (!this.gpuInfo || Date.now() - this.gpuInfo.at > 10 * 60 * 1000) this.gpuInfo = Object.assign(await detectGpu(this.o.platform), { at: Date.now() })
    return this.gpuInfo
  }

  // mode 'mine' (default): geth + stratum proxy + Rigel.  mode 'node': geth only (B2).
  async start (wallet, opts) {
    opts = opts || {}
    const mode = opts.mode === 'node' || opts.noRigel === 'node' ? 'node' : 'mine'
    if (this.wantRunning) throw new Error('already running')
    if (mode === 'mine' && (!/^0x[0-9a-fA-F]{40}$/.test(wallet || '') || /^0x0{40}$/.test(wallet))) throw new Error('invalid reward address ' + wallet)
    if (mode === 'mine' && !opts.noRigel && !this.o.rigelExe) {
      const g = await this.gpu()
      if (!g.nvidia) { const e = new Error('No NVIDIA GPU found on this PC – GPU mining is not possible. Use "Run node only".'); e.code = 'NO_NVIDIA'; throw e }
    }
    fs.mkdirSync(this.logDir, { recursive: true })
    this.noGpuHandled = false
    this.state = Object.assign(this.freshState(), { wallet: mode === 'mine' ? wallet : null, mode, startedAt: Date.now() })
    this.opts = opts
    // node only + an SCDO node already running on this PC (default port): nothing to start, just show its status
    if (mode === 'node' && await this.externalNodeAt(BASE_PORTS.http + ENV_OFFSET)) {
      this.external = { url: 'http://127.0.0.1:' + (BASE_PORTS.http + ENV_OFFSET) }
      this.wantRunning = true; this.restarts = {}
      this.set({ phase: 'external', code: 'EXTERNAL_NODE', external: true, ports: { http: BASE_PORTS.http + ENV_OFFSET }, message: 'An SCDO shard0 node is already running on this PC (' + this.external.url + ') – not starting a second one.' })
      this.poller = setInterval(() => this.poll().catch(() => {}), 5000)
      this.poll().catch(() => {})
      return
    }
    this.external = null
    this.wantRunning = true; this.restarts = {}
    this.emit('status', this.status())
    try {
      if (mode === 'mine' && !opts.noRigel) await this.ensureRigel()
      if (!this.wantRunning) return
      const ports = await this.choosePorts()
      this.state.ports = Object.assign({}, ports)
      if (ports.http !== BASE_PORTS.http) this.log('wallet', 'default ports busy (another SCDO node/miner?) – using ' + JSON.stringify(ports))
      await this.ensureChain()
      if (!this.wantRunning) return
      this.set({ phase: 'starting', code: 'STARTING', message: mode === 'node' ? 'Starting the local SCDO node ...' : 'Starting the local SCDO node and stratum proxy ...' })
      this.startGeth()
      await new Promise(resolve => setTimeout(resolve, 3000))
      if (!this.wantRunning) return
      if (mode === 'mine') this.startProxy()
      this.set({ phase: 'syncing', code: 'SYNCING', message: 'Syncing with the SCDO network (first start: 1-5 minutes) ...' })
      this.poller = setInterval(() => this.poll().catch(() => {}), 3000)
    } catch (e) {
      this.set({ phase: 'error', code: e.code || 'ERROR', lastError: e.code || e.message, message: e.message })
      this.stop({ keepError: true })
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
    const L = this.external ? this.external.url : 'http://127.0.0.1:' + PORTS.http
    const nodeOnly = this.state.mode === 'node'
    let bn, peers, mining, syncing
    try {
      [bn, peers, mining, syncing] = await Promise.all([rpc(L, 'eth_blockNumber'), rpc(L, 'net_peerCount'),
        nodeOnly ? Promise.resolve(false) : rpc(L, 'eth_mining'), rpc(L, 'eth_syncing').catch(() => false)])
    } catch (e) {
      if (this.external) this.set({ code: 'EXTERNAL_DOWN', message: 'The other SCDO node on this PC is not answering.' })
      else this.set({ message: this.state.phase === 'syncing' ? 'Node starting ...' : this.state.message })
      return
    }
    const patch = { localBlock: parseInt(bn, 16), peers: parseInt(peers, 16), nodeMining: !!mining }
    if (!this.lastRef || Date.now() - this.lastRef > 15000) {
      this.lastRef = Date.now()
      rpc(this.o.refRpc, 'eth_blockNumber', [], 8000).then(r => this.set({ networkBlock: parseInt(r, 16) })).catch(() => {})
    }
    if (this.external) { patch.code = 'EXTERNAL_NODE'; this.set(patch); return }
    if (nodeOnly) {
      // B3: node-only mode never claims to be mining
      const nb = this.state.networkBlock
      const synced = !syncing && patch.peers > 0 && (nb == null || patch.localBlock >= nb - 3)
      patch.phase = synced ? 'node' : 'syncing'
      patch.code = synced ? 'NODE_RUNNING' : (patch.peers > 0 ? 'SYNCING' : 'NO_PEERS')
      patch.message = synced ? 'Node running (no mining) – synced, block ' + patch.localBlock : 'Syncing: local block ' + patch.localBlock + ' / network ' + (nb == null ? '?' : nb) + ', peers ' + patch.peers
      this.set(patch); return
    }
    try { patch.balanceWei = BigInt(await rpc(L, 'eth_getBalance', [this.state.wallet, 'latest'])).toString() } catch (e) {}
    if (this.state.phase === 'syncing') {
      patch.code = patch.peers > 0 ? 'SYNCING' : 'NO_PEERS'
      patch.message = 'Syncing: local block ' + patch.localBlock + ' / network ' + (this.state.networkBlock == null ? '?' : this.state.networkBlock) + ', peers ' + patch.peers
      if (mining) {
        if (this.opts && this.opts.noRigel) { patch.phase = 'ready'; patch.code = 'WORK_READY'; patch.message = 'Node synced, work ready (no GPU miner started – test mode)' } else {
          this.startRigel(); patch.phase = 'mining'; patch.code = 'MINING_STARTING'; patch.message = 'Node synced, starting the GPU miner (Rigel) ...'
        }
      }
    } else if (this.state.phase === 'ready') {
      patch.code = 'WORK_READY'; patch.message = 'Node synced, work ready (no GPU miner started – test mode)'
    } else if (this.state.phase === 'mining') {
      let hr = null
      try {
        const j = await httpGetJson('http://127.0.0.1:' + PORTS.rigelApi + '/')
        hr = MinerManager.rigelHashrate(j)
        if (hr != null) { patch.hashrate = hr; patch.hashrateSource = 'rigel' }
        const sh = MinerManager.rigelShares(j)
        if (sh) patch.rigelShares = sh
      } catch (e) {}
      // B3: only say "mining" when the GPU really produces hashes
      if (this.state.paused) { patch.code = 'PAUSED'; patch.message = 'Paused by the proxy (node lost peers or out of sync) – resumes automatically' } else if (hr != null && hr > 0) { patch.code = 'MINING'; patch.message = 'Mining – rewards go to ' + this.state.wallet } else { patch.code = 'MINING_STARTING'; patch.message = 'GPU miner starting (building the DAG) ...' }
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

  ctrlCScript () {
    const f = path.join(this.o.dataRoot, 'tools', 'send-ctrl-c.ps1')
    try { if (fs.readFileSync(f, 'utf8') === CTRL_C_PS1) return f } catch (e) {}
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, CTRL_C_PS1); return f
  }

  // Graceful: Ctrl+C (Windows, via the child's hidden console) / SIGINT (Linux, macOS), wait, force only after the timeout.
  // geth needs this to flush its state (1.1.1 used taskkill /F right away).
  stopChild (n, p, timeoutMs) {
    return new Promise(resolve => {
      if (p.exitCode != null || p.signalCode != null) return resolve('gone')
      let finished = false
      const finish = (how) => { if (finished) return; finished = true; clearTimeout(t); this.log('wallet', n + ' stopped (' + how + ')'); resolve(how) }
      const force = () => {
        this.log('wallet', n + ' did not exit within ' + Math.round(timeoutMs / 1000) + ' s – forcing')
        if (this.o.platform === 'win32') execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {})
        else { try { p.kill('SIGKILL') } catch (e) {} }
        setTimeout(() => finish('forced'), 3000)
      }
      const t = setTimeout(force, timeoutMs)
      p.once('exit', () => finish('graceful'))
      try {
        if (this.o.platform === 'win32') {
          execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.ctrlCScript(), '-ProcessId', String(p.pid)],
            { windowsHide: true, timeout: 30000 }, (err, out) => {
              if (err) { this.log('wallet', 'Ctrl+C to ' + n + ' failed (' + String(out || err.message).trim().split(/\r?\n/)[0] + ') – forcing'); clearTimeout(t); force() } else this.log('wallet', 'sent Ctrl+C to ' + n + ' (pid ' + p.pid + '), waiting up to ' + Math.round(timeoutMs / 1000) + ' s')
            })
        } else p.kill('SIGINT')
      } catch (e) { clearTimeout(t); force() }
    })
  }

  async stop (opts) {
    opts = opts || {}
    this.wantRunning = false
    this.external = null
    if (this.poller) { clearInterval(this.poller); this.poller = null }
    if (this.stopping) return this.stopping
    this.set({ code: this.state.phase === 'error' ? this.state.code : 'STOPPING', message: this.state.phase === 'error' ? this.state.message : 'Stopping (saving the chain data) ...' })
    this.stopping = (async () => {
      const order = ['rigel', 'proxy', 'geth']
      for (const n of order) {
        const p = this.procs[n]
        if (!p) continue
        await this.stopChild(n, p, n === 'geth' ? 60000 : 8000)
        this.procs[n] = null
      }
      if (this.state.phase !== 'error') this.set({ phase: 'stopped', code: 'STOPPED', message: 'Stopped.' })
      else this.emit('status', this.status())
    })()
    try { await this.stopping } finally { this.stopping = null }
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

module.exports = { MinerManager, RIGEL, PORTS, BASE_PORTS, BOOTNODE, extractZip, download, sha256File, detectGpu, portsFree }
