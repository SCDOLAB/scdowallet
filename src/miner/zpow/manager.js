// Classic shard 1–4 mining.
// CPU: one zminer to the pool. Shard 1 is 82.223.19.88:3341. Shards 2–4 use 3342–3344.
// GPU default: one zminer-gpu process per selected shard, all on device 0.
// GPU solo: the Classic node (node.exe) only when solo was saved and that node is synced.
// An unsynced node, including a solo choice saved by an older wallet, starts zminer-gpu instead.
'use strict'
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const os = require('os')
const { EventEmitter } = require('events')
const { parseClassicAddress, normalizeMiningInput } = require('./address')
const { poolForShard, poolsFromEnv, minerStatsUrl, defaultCpuThreads } = require('./pools')
const { parseStatusLine, cudaInitFailed, blockRatePerHour, parsePoolMiner, workerFigure, sessionDelta, peerTargetOf, mergeSyncView, classicGpuPhase, BEHIND_BLOCKS } = require('./status')
const { writeNodeConfig, SHARD_PORTS } = require('./nodeConfig')

// Last stderr/stdout lines, not a bare "exit 0". go-scdo exits 0 after a bad data path.
function formatExitMessage (code, logTail) {
  const lines = []
  for (const raw of logTail || []) {
    const line = String(raw).replace(/^\d\d:\d\d:\d\d \[zpow\] /, '').trim()
    if (!line || /^exited \(code /.test(line)) continue
    lines.push(line)
  }
  const head = 'node exited (' + (code == null ? 'signal' : String(code)) + ')'
  if (!lines.length) return head
  let msg = head + ': ' + lines.slice(-5).join(' | ')
  if (msg.length > 500) msg = msg.slice(0, 497) + '...'
  return msg
}
const { firstExisting, zminerCandidates, zminerGpuCandidates, gpuPackReady, classicNodeCandidates, findCudart, assertSha256, sumsBeside } = require('./bins')
const { renderArgs, externalProfile, ZMINER_ARGS, ZMINER_GPU_ARGS, CLASSIC_NODE_ARGS, spawnMiner, stopMiner, pidAlive } = require('./launch')
const { rotateFile } = require('../guardPlan')

function httpGetJson (url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.get(u, { agent: false, timeout: timeoutMs || 8000 }, res => {
      let d = ''
      res.on('data', c => { d += c })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode))
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

function rpcCall (url, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] })
    const u = new URL(url)
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(u, {
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), connection: 'close' },
      timeout: timeoutMs || 5000
    }, res => {
      let d = ''
      res.on('data', c => { d += c })
      res.on('end', () => {
        try {
          const j = JSON.parse(d)
          if (j.error) reject(new Error(j.error.message || 'rpc error'))
          else resolve(j.result)
        } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(body)
  })
}

class ZpowManager extends EventEmitter {
  constructor (opts) {
    super()
    this.o = Object.assign({ platform: process.platform, root: path.join(__dirname, '..', '..', '..') }, opts || {})
    this.wantRunning = false
    this.proc = null
    this.poller = null
    this.buf = ''
    this.restarts = []
    this.restartTimer = null
    this.launchSpec = null
    this.restartBaseMs = (opts && opts.restartBaseMs) || 2000
    this.syncTimer = null
    this.syncSamples = []
    this.etaHold = null
    this.etaHoldAt = 0
    this.earnBase = null
    this.state = this.fresh()
  }

  fresh () {
    return {
      chain: 'classic', phase: 'idle', code: 'IDLE', mode: null, backend: null, message: '',
      wallet: null, shard: null, pool: null, connected: null,
      hashrate: null, hashrateSource: null, rateSeen: false, sharesSeen: false,
      sharesAccepted: 0, sharesRejected: 0, sessionEarn: null, worker: null,
      blocksFound: 0, blocksFoundHeights: [], blockRatePerHour: null,
      poolStats: null, poolError: null, startedAt: null, logTail: [], lastError: null,
      gpuActive: false, paused: false, nodeSeen: false,
      localBlock: null, networkBlock: null, syncEtaSec: null
    }
  }

  status () {
    const now = Date.now()
    const rate = this.state.mode === 'gpu' ? blockRatePerHour(this.state.blocksFound, this.state.startedAt, now) : null
    return Object.assign({}, this.state, {
      running: this.wantRunning,
      blockRatePerHour: rate,
      procs: this.childAlive() ? [this.state.backend || 'zpow'] : []
    })
  }

  set (patch) { Object.assign(this.state, patch); this.emit('status', this.status()) }

  log (line) {
    line = String(line).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd()
    if (!line) return
    const shown = new Date().toTimeString().slice(0, 8) + ' [zpow] ' + line
    this.state.logTail.push(shown)
    if (this.state.logTail.length > 200) this.state.logTail.shift()
    if (this.state.mode === 'gpu' && this.state.backend === 'classic-node') this.state.nodeSeen = true
    if (this.state.backend === 'zminer-gpu' && cudaInitFailed(line)) {
      this.wantRunning = false
      const proc = this.proc
      this.proc = null
      this.set({ phase: 'error', code: 'NO_NVIDIA', cudaFailed: true, lastError: line, message: line })
      if (proc) stopMiner(proc, { platform: this.o.platform, graceMs: 1500, stdinStop: true }).catch(() => {})
    } else this.applyLine(line)
    this.refreshClassicGpu()
    try {
      const dir = path.join(this.o.dataRoot, 'logs')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'zpow.log')
      rotateFile(file, fs)
      fs.appendFileSync(file, shown + '\n')
    } catch (e) {}
    this.emit('log', shown)
  }

  sumsFor (binary, envExpected) {
    if (envExpected) return { expected: String(envExpected).trim().toLowerCase(), sumsFile: null }
    const beside = sumsBeside(binary)
    if (fs.existsSync(beside)) return { sumsFile: beside }
    const repo = path.join(this.o.root, 'miner-zpow', 'SHA256SUMS')
    if (fs.existsSync(repo)) return { sumsFile: repo }
    return { sumsFile: beside }
  }

  applyLine (line) {
    const ev = parseStatusLine(line)
    if (!ev) return
    if (ev.kind === 'status') {
      const patch = {}
      if (ev.hashrate != null) { patch.hashrate = ev.hashrate; patch.hashrateSource = 'status'; patch.rateSeen = true }
      if (ev.accepted != null) { patch.sharesAccepted = ev.accepted; patch.sharesSeen = true }
      if (ev.rejected != null) patch.sharesRejected = ev.rejected
      if (ev.connected != null) patch.connected = ev.connected
      if (ev.blocks != null) patch.blocksFound = Math.max(this.state.blocksFound, ev.blocks)
      if (this.state.backend === 'zminer-gpu') {
        const accepted = ev.accepted != null ? ev.accepted : this.state.sharesAccepted
        patch.code = accepted > 0 ? 'CLASSIC_MINING' : 'POOL_CONNECTING'
        patch.phase = accepted > 0 ? 'mining' : 'starting'
        patch.message = ''
      } else if (this.state.mode === 'cpu' || this.state.backend === 'pool' || this.state.backend === 'external') {
        patch.code = ev.connected ? 'CLASSIC_MINING' : 'POOL_CONNECTING'
        patch.phase = ev.connected ? 'mining' : 'starting'
        patch.message = ev.connected ? '' : 'connecting'
      }
      this.set(patch)
      return
    }
    if (ev.kind === 'gpu-active') {
      if (this.state.backend === 'classic-node') {
        this.state.gpuActive = true
        this.state.paused = false
      } else this.set({ gpuActive: true, paused: false, phase: 'mining', code: 'CLASSIC_GPU', message: '' })
    } else if (ev.kind === 'block-found') {
      const heights = this.state.blocksFoundHeights.slice()
      if (!heights.includes(ev.height)) heights.push(ev.height)
      this.set({ blocksFound: heights.length, blocksFoundHeights: heights })
    } else if (ev.kind === 'gpu-paused') {
      this.state.paused = true
      this.state.gpuActive = false
      if (this.state.backend !== 'classic-node') this.set({ paused: true, gpuActive: false, phase: 'syncing', code: 'CLASSIC_PAUSED', message: '' })
    } else if (ev.kind === 'gpu-resumed' && this.state.paused) {
      this.state.paused = false
      if (this.state.backend !== 'classic-node') this.set({ paused: false, phase: 'starting', code: 'CLASSIC_SYNCING', message: '' })
    }
    else if (ev.kind === 'chain-height' || ev.kind === 'sync-target') this.noteHeight(ev.local, ev.network)
    else if (ev.kind === 'login-failed') {
      this.set({ phase: 'error', code: 'LOGIN', lastError: ev.message, message: ev.message })
      this.wantRunning = false
    }
  }

  capabilities (env) {
    env = env || process.env
    const platform = this.o.platform
    const zminer = firstExisting(zminerCandidates({ binDir: this.o.binDir, root: this.o.root, platform, env }))
    const gpuExe = firstExisting(zminerGpuCandidates({ gpuDir: this.o.gpuDir, root: this.o.root, env }))
    const gpuReady = gpuPackReady(gpuExe)
    const node = firstExisting(classicNodeCandidates({ binDir: this.o.binDir, root: this.o.root, platform, env }))
    const cudart = node ? findCudart(node, platform, env) : null
    let external = null
    try { external = externalProfile(env) } catch (e) { external = { error: e.message, code: e.code } }
    const pools = {}
    try {
      const over = poolsFromEnv(env)
      for (const s of [1, 2, 3, 4]) pools[s] = poolForShard(s, over)
    } catch (e) { pools.error = e.message }
    return {
      cpu: { available: !!zminer, path: zminer },
      gpu: { available: gpuReady, path: gpuExe, solo: !!(node && cudart), node, cudart, reason: gpuReady ? null : 'NO_BINARY' },
      external: external && external.binary ? { available: fs.existsSync(external.binary), path: external.binary, solo: !!external.solo, id: external.id } : null,
      pools,
      cpuCount: Math.max(1, (os.cpus() || []).length || 1),
      threadsDefault: this.threadsDefault(defaultCpuThreads((os.cpus() || []).length || 1))
    }
  }

  threadsDefault (fallback) {
    if (typeof this.o.threadsDefault === 'function') {
      try {
        const n = Number(this.o.threadsDefault())
        if (Number.isFinite(n) && n >= 1) return Math.floor(n)
      } catch (e) {}
    }
    return fallback
  }

  childAlive () {
    const proc = this.proc
    if (!proc || proc.exitCode != null || proc.signalCode != null) return false
    return pidAlive(proc.pid)
  }

  childPids () {
    return this.childAlive() ? [this.proc.pid] : []
  }

  pushSyncSample (h, now) {
    if (h == null || !Number.isFinite(Number(h))) return
    const t = now != null ? now : Date.now()
    const height = Number(h)
    const last = this.syncSamples[this.syncSamples.length - 1]
    if (last && t - last.t < 2000 && last.h === height) return
    this.syncSamples.push({ t, h: height })
    const cutoff = t - 4 * 60 * 1000
    while (this.syncSamples.length > 2 && this.syncSamples[0].t < cutoff) this.syncSamples.shift()
  }

  // Displayed ETA changes at most every 30s. Caught up (0) updates immediately.
  // now=0 is a real timestamp (tests); only null/undefined means "use the clock".
  holdEta (etaSec, now) {
    const t = now != null ? now : Date.now()
    if (etaSec == null || !Number.isFinite(Number(etaSec))) return this.etaHold
    const next = Number(etaSec)
    if (next === 0) {
      this.etaHold = 0
      this.etaHoldAt = t
      return 0
    }
    if (this.etaHold != null && t - this.etaHoldAt < 30000) return this.etaHold
    this.etaHold = next
    this.etaHoldAt = t
    return next
  }

  refreshClassicGpu () {
    if (this.state.mode !== 'gpu' || this.state.backend !== 'classic-node') return
    if (this.state.phase === 'error' || this.state.phase === 'stopped') return
    if (['LOGIN', 'SELFTEST', 'CRASHING', 'RESTARTING'].includes(this.state.code)) return
    const next = classicGpuPhase(this.state)
    if (this.state.code === next.code && this.state.phase === next.phase) return
    this.set({ code: next.code, phase: next.phase, message: '' })
  }

  noteHeight (local, network) {
    const now = Date.now()
    const patch = {}
    if (local != null && Number.isFinite(Number(local))) {
      const h = Number(local)
      // "from height" is the common ancestor. Do not walk the displayed tip backwards.
      if (this.state.localBlock == null || h >= this.state.localBlock) {
        patch.localBlock = h
        this.pushSyncSample(h, now)
      }
    }
    const view = mergeSyncView({
      local: patch.localBlock != null ? patch.localBlock : this.state.localBlock,
      peerTarget: network,
      publicTip: this.state.networkBlock,
      downloaded: null,
      amount: null,
      durationSec: null,
      samples: this.syncSamples,
      now
    })
    if (view.localBlock != null) patch.localBlock = view.localBlock
    if (view.networkBlock != null) patch.networkBlock = view.networkBlock
    const shown = this.holdEta(view.etaSec, now)
    if (shown != null) patch.syncEtaSec = shown
    if (Object.keys(patch).length) this.set(patch)
  }

  async pollSync () {
    if (!this.wantRunning || this.state.mode !== 'gpu' || !SHARD_PORTS[this.state.shard]) return
    const shard = this.state.shard
    const localUrl = 'http://127.0.0.1:' + SHARD_PORTS[shard].http
    const pubUrl = 'https://scdoscan.io/rpc/' + shard
    const call = this.o.rpc || rpcCall
    let info = null
    let dl = null
    let pub = null
    try { info = await call(localUrl, 'scdo_getInfo', []) } catch (e) {}
    try { dl = await call(localUrl, 'download_getStatus', []) } catch (e) {}
    try { pub = await call(pubUrl, 'scdo_getInfo', []) } catch (e) {}
    const now = Date.now()
    const local = info && info.CurrentBlockHeight
    if (local != null && Number.isFinite(Number(local))) this.pushSyncSample(Number(local), now)
    const view = mergeSyncView({
      local: local != null ? Number(local) : this.state.localBlock,
      peerTarget: peerTargetOf(dl),
      publicTip: pub && pub.CurrentBlockHeight,
      downloaded: dl && (dl.Downloaded != null ? dl.Downloaded : dl.downloaded),
      amount: dl && (dl.Amount != null ? dl.Amount : dl.amount),
      durationSec: dl && (dl.Duration != null ? dl.Duration : dl.duration),
      samples: this.syncSamples,
      now
    })
    const patch = {}
    if (view.localBlock != null) patch.localBlock = view.localBlock
    if (view.networkBlock != null) patch.networkBlock = view.networkBlock
    const shown = this.holdEta(view.etaSec, now)
    if (shown != null) patch.syncEtaSec = shown
    if (Object.keys(patch).length) this.set(patch)
    this.refreshClassicGpu()
  }

  async start (address, opts) {
    opts = opts || {}
    if (this.wantRunning) {
      const err = new Error('this miner is already running')
      err.code = 'ALREADY_RUNNING'
      throw err
    }
    const parsed = parseClassicAddress(address)
    if (!parsed) {
      const err = new Error('Classic mining needs a 1S01 / 2S02 / 3S03 / 4S04 address')
      err.code = 'BAD_ADDRESS'
      throw err
    }
    if (opts.shard != null && Number(opts.shard) !== parsed.shard) {
      const err = new Error('address is shard ' + parsed.shard + ', not shard ' + opts.shard)
      err.code = 'BAD_SHARD'
      throw err
    }
    const backend = opts.backend === 'gpu' ? 'gpu' : 'cpu'
    const gpuMiner = resolveGpuMiner(opts)
    const mineLabel = poolFallbackLabel(opts, gpuMiner)
    const env = this.o.env || process.env
    const caps = this.capabilities(env)
    const asInt = (v, fallback) => {
      const n = Number(normalizeMiningInput(v))
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
    }
    let threads = asInt(opts.threads, caps.threadsDefault || 1)
    if (typeof this.o.clampThreads === 'function') {
      try {
        const capped = Number(this.o.clampThreads(threads))
        if (Number.isFinite(capped) && capped >= 1) threads = Math.floor(capped)
      } catch (e) {}
    }
    const threadblocks = asInt(opts.threadblocks, 100)
    const blockthreads = asInt(opts.blockthreads, 100)
    const pool = poolForShard(parsed.shard, poolsFromEnv(env) || this.o.pools)
    const workerName = opts.worker || (backend === 'cpu' || gpuMiner !== 'zminer-gpu' ? 'wallet' : computerName(env))

    let binary, args, cwd, shaOpts, ctrlC = false, nodeEnv = null
    if (backend === 'cpu') {
      if (!caps.cpu.available) {
        const err = new Error('zminer binary not found. Run scripts/build-zminer.sh and place zminer.exe in miner-bin/win32/, or set SCDO_ZMINER_EXE.')
        err.code = 'NO_ZMINER'
        throw err
      }
      binary = caps.cpu.path
      shaOpts = Object.assign({ required: true }, this.sumsFor(binary, env.SCDO_ZMINER_SHA256))
      args = renderArgs(ZMINER_ARGS, {
        pool: pool.stratum, user: parsed.address, worker: workerName, threads
      })
      cwd = path.dirname(binary)
    } else if (gpuMiner === 'zminer-gpu') {
      if (!caps.gpu.available || !caps.gpu.path) {
        const err = new Error('zminer-gpu.exe, zpowdet.dll and cudart64_12.dll were not found together. The Windows pack downloads them into resources/miners/zminer-gpu/.')
        err.code = 'NO_ZMINER_GPU'
        throw err
      }
      binary = caps.gpu.path
      shaOpts = { required: false }
      args = renderArgs(ZMINER_GPU_ARGS, {
        pool: pool.stratum,
        user: parsed.address,
        worker: workerName
      })
      if (opts.batch != null && Number(opts.batch) >= 1) {
        const bi = args.indexOf('-batch')
        if (bi >= 0) args[bi + 1] = String(Math.floor(Number(opts.batch)))
      }
      cwd = path.dirname(binary)
    } else if (gpuMiner === 'external') {
      const profile = externalProfile(env)
      if (!profile || !caps.external || !caps.external.available) {
        const err = new Error('custom GPU miner is not configured (SCDO_ZPOW_GPU_BIN)')
        err.code = 'NO_CLASSIC_NODE'
        throw err
      }
      binary = profile.binary
      shaOpts = Object.assign({ required: !!profile.sha256 }, profile.sha256 ? { expected: profile.sha256 } : this.sumsFor(binary, ''))
      args = renderArgs(profile.args, {
        pool: pool.stratum,
        user: parsed.address,
        threads,
        worker: workerName,
        shard: String(parsed.shard)
      })
      cwd = path.dirname(binary)
    } else {
      if (!caps.gpu.node) {
        const err = new Error('Classic node binary not found. Build node.exe from SCDOLAB/go-scdo and set SCDO_CLASSIC_NODE, or place it in miner-bin/win32/classic/ with libcudart.dll.')
        err.code = 'NO_CLASSIC_NODE'
        throw err
      }
      if (!caps.gpu.cudart) {
        const err = new Error('libcudart is not next to the Classic node (' + caps.gpu.node + ')')
        err.code = 'NO_CUDART'
        throw err
      }
      binary = caps.gpu.node
      shaOpts = Object.assign({ required: false }, this.sumsFor(binary, env.SCDO_CLASSIC_NODE_SHA256))
      const dir = path.join(this.o.dataRoot, 'classic', 'shard' + parsed.shard)
      const written = writeNodeConfig({ dir, shard: parsed.shard, coinbase: parsed.address })
      args = renderArgs(CLASSIC_NODE_ARGS, {
        config: written.file, threads, threadblocks, blockthreads
      })
      cwd = path.dirname(binary)
      nodeEnv = written.nodeEnv
      ctrlC = true
    }
    await assertSha256(binary, shaOpts)

    fs.mkdirSync(path.join(this.o.dataRoot, 'logs'), { recursive: true })
    this.earnBase = null
    this.state = Object.assign(this.fresh(), {
      wallet: parsed.address,
      shard: parsed.shard,
      mode: backend,
      backend: backend === 'cpu' ? 'zminer' : gpuMiner,
      pool: backend === 'gpu' && gpuMiner === 'classic-node' ? null : { stratum: pool.stratum, stats: minerStatsUrl(pool, parsed.address), live: pool.live },
      phase: 'starting',
      code: backend === 'cpu' || gpuMiner === 'zminer-gpu' ? 'POOL_CONNECTING' : (gpuMiner === 'classic-node' ? 'CLASSIC_STARTING' : 'CLASSIC_SYNCING'),
      message: '',
      mineLabel: mineLabel,
      syncPct: opts.syncPct == null ? null : opts.syncPct,
      worker: workerName,
      startedAt: Date.now()
    })
    this.restarts = []
    this.syncSamples = []
    this.etaHold = null
    this.etaHoldAt = 0
    this.wantRunning = true
    this.launchSpec = { binary, args, cwd, env: nodeEnv, ctrlC }
    this.launchThreads = threads
    const batchAt = args.indexOf('-batch')
    this.lastStart = {
      address: parsed.address,
      opts: Object.assign({}, opts, {
        threads,
        shard: parsed.shard,
        backend,
        batch: batchAt >= 0 ? Number(args[batchAt + 1]) : opts.batch
      })
    }
    this.emit('status', this.status())
    this.armChild()
    if (this.state.pool) this.poller = setInterval(() => this.pollPool().catch(() => {}), 15000)
    this.pollPool().catch(() => {})
    if (backend === 'gpu' && gpuMiner === 'classic-node') {
      if (this.syncTimer) clearInterval(this.syncTimer)
      this.syncTimer = setInterval(() => this.pollSync().catch(() => {}), 4000)
      this.pollSync().catch(() => {})
    }
    return this.status()
  }

  armChild () {
    const spec = this.launchSpec
    const proc = spawnMiner({ binary: spec.binary, args: spec.args, cwd: spec.cwd, env: spec.env || undefined })
    this.proc = proc
    this.livePid = proc.pid || 0
    try { if (typeof this.o.onSpawn === 'function') this.o.onSpawn(proc, this) } catch (e) {}
    proc.on('error', e => this.log('spawn error: ' + e.message))
    const onData = (buf) => {
      this.buf += buf.toString()
      const lines = this.buf.split(/\r?\n/)
      this.buf = lines.pop()
      lines.forEach(l => this.log(l))
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null
      if (this.livePid === proc.pid) this.livePid = 0
      this.log('exited (code ' + code + ')')
      if (this.suppressExitRestart) return
      if (!this.wantRunning) return
      const message = formatExitMessage(code, this.state.logTail)
      if (code === 2 || code === 3) {
        this.wantRunning = false
        this.set({ phase: 'error', code: code === 3 ? 'SELFTEST' : 'LOGIN', lastError: message, message })
        return
      }
      if (typeof this.o.guardOwnsRestart === 'function' && this.o.guardOwnsRestart()) {
        this.set({ phase: 'starting', code: 'RESTARTING', lastError: message, message })
        return
      }
      this.scheduleRestart(code, message)
    })
  }

  setArg (flag, value) {
    const args = this.launchSpec && this.launchSpec.args
    if (!args) return false
    const i = args.indexOf(flag)
    if (i < 0 || i + 1 >= args.length) return false
    const next = String(value)
    if (String(args[i + 1]) === next) return false
    args[i + 1] = next
    if (this.lastStart && this.lastStart.opts) {
      if (flag === '-threads' || flag === '--threads') this.lastStart.opts.threads = Number(value)
      if (flag === '-batch') this.lastStart.opts.batch = Number(value)
    }
    return true
  }

  async restartChild () {
    if (!this.wantRunning || !this.launchSpec) return false
    this.suppressExitRestart = true
    const proc = this.proc
    this.proc = null
    this.livePid = 0
    try {
      if (proc && proc.exitCode == null && proc.signalCode == null && pidAlive(proc.pid)) {
        await stopMiner(proc, { platform: this.o.platform || process.platform, execFile: this.o.execFile })
      }
    } catch (e) {}
    this.suppressExitRestart = false
    if (!this.wantRunning || !this.launchSpec) return false
    this.armChild()
    return true
  }

  async pauseForGuard () {
    if (this.lastStart) this.guardHeld = this.lastStart
    this._guardPausing = true
    try { await this.stop() } finally { this._guardPausing = false }
  }

  async resumeFromGuard () {
    const held = this.guardHeld
    if (!held || !held.address || this.wantRunning) return false
    this.guardHeld = null
    await this.start(held.address, held.opts || {})
    return true
  }

  scheduleRestart (code, message) {
    const now = Date.now()
    const recent = (this.restarts || []).filter(t => now - t < 10 * 60 * 1000)
    recent.push(now)
    this.restarts = recent
    if (recent.length >= 6) {
      this.wantRunning = false
      if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
      const stopped = message + ' — stopped after 6 exits in 10 min'
      this.set({ phase: 'error', code: 'CRASHING', lastError: stopped, message: stopped })
      return
    }
    const delay = Math.min(30000, this.restartBaseMs * Math.pow(2, recent.length - 1))
    const shown = delay >= 1000 ? Math.round(delay / 1000) + 's' : (delay / 1000).toFixed(1) + 's'
    const waiting = message + ' — restarting in ' + shown
    this.set({ phase: 'starting', code: 'RESTARTING', lastError: message, message: waiting })
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.wantRunning || this.proc) return
      this.log('restarting after exit ' + code)
      try { this.armChild() } catch (e) {
        this.wantRunning = false
        this.set({ phase: 'error', code: 'CRASHING', lastError: e.message, message: e.message })
      }
    }, delay)
  }

  async pollPool () {
    if (!this.wantRunning || !this.state.pool) return
    try {
      const fetchJson = this.o.fetchJson || httpGetJson
      const body = await fetchJson(this.state.pool.stats, 8000)
      let statsBody = null
      const statsUrl = String(this.state.pool.stats || '').replace(/\/api\/miner\/.*$/, '/api/stats')
      if (statsUrl && statsUrl !== this.state.pool.stats) {
        try { statsBody = await fetchJson(statsUrl, 8000) } catch (e) { statsBody = null }
      }
      const stats = parsePoolMiner(body)
      const fig = workerFigure(statsBody, this.state.wallet, this.state.worker) || workerFigure(body, this.state.wallet, this.state.worker)
      const patch = { poolStats: stats, poolError: null }
      if (this.state.backend !== 'zminer-gpu' && stats && stats.hashrate != null && stats.hashrate > 0 && (!(this.state.hashrate > 0) || this.state.hashrateSource === 'pool')) {
        patch.hashrate = stats.hashrate
        patch.hashrateSource = 'pool'
      }
      if (!fig) patch.sessionEarn = null
      else {
        if (!this.earnBase) this.earnBase = { shares: fig.shares, paid: fig.paid, earned: fig.earned }
        patch.sessionEarn = sessionDelta(this.earnBase, fig)
      }
      this.set(patch)
    } catch (e) {
      this.set({ poolError: e.message })
    }
  }

  async stop () {
    this.wantRunning = false
    if (!this._guardPausing) this.guardHeld = null
    this.earnBase = null
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.poller) { clearInterval(this.poller); this.poller = null }
    if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null }
    const proc = this.proc
    this.proc = null
    this.livePid = 0
    // A wanted session with no OS process is already stopped. Do not taskkill.
    if (proc && proc.exitCode == null && proc.signalCode == null && pidAlive(proc.pid)) {
      await stopMiner(proc, { platform: this.o.platform || process.platform, execFile: this.o.execFile })
    }
    if (this.state.phase !== 'error') this.set({ phase: 'stopped', code: 'STOPPED', message: '', mineLabel: '', syncPct: null })
    else this.emit('status', this.status())
  }
}

function computerName (env) {
  env = env || process.env
  const raw = env.COMPUTERNAME || os.hostname() || 'wallet'
  const name = String(raw).split('.')[0].replace(/[^A-Za-z0-9_-]/g, '')
  return name || 'wallet'
}

// One graphics-card process per Classic shard. Stop closes every one of them.
class GpuFleet extends EventEmitter {
  constructor (opts) {
    super()
    this.o = opts || {}
    this.kids = new Map()
    this.probe = new ZpowManager(opts)
    this._cuda = false
  }

  get wantRunning () {
    for (const kid of this.kids.values()) if (kid.wantRunning) return true
    return false
  }

  capabilities (env) { return this.probe.capabilities(env) }

  childPids () {
    const pids = []
    for (const kid of this.kids.values()) pids.push(...kid.childPids())
    return pids
  }

  status () {
    const shards = []
    for (const kid of this.kids.values()) {
      const st = kid.status()
      if (st.running || (st.phase && st.phase !== 'idle' && st.phase !== 'stopped')) shards.push(st)
    }
    const running = shards.filter(s => s.running)
    const cuda = shards.find(s => s.cudaFailed || s.code === 'NO_NVIDIA')
    if (!running.length) {
      if (cuda) return Object.assign({}, cuda, { chain: 'classic', mode: 'gpu', running: false, shards, cudaFailed: true })
      const last = shards[shards.length - 1]
      return last ? Object.assign({}, last, { running: false, shards }) : { chain: 'classic', mode: 'gpu', running: false, code: 'IDLE', phase: 'idle', shards: [] }
    }
    let hash = 0
    let anyHash = false
    let accepted = 0
    let earnShares = 0
    let earnPaid = 0
    let earnEarned = 0
    let earnOn = false
    let anyShare = false
    let anyPaid = false
    let anyEarned = false
    for (const s of running) {
      accepted += Number(s.sharesAccepted) || 0
      if (s.hashrateSource !== 'pool' && s.hashrate != null && Number.isFinite(Number(s.hashrate)) && (s.rateSeen || s.hashrateSource === 'status' || s.backend === 'zminer-gpu')) {
        anyHash = true
        if (Number(s.hashrate) > 0) hash += Number(s.hashrate)
      }
      const earn = s.sessionEarn
      if (earn && earn.exposed === true) {
        earnOn = true
        if (earn.shares != null && Number.isFinite(Number(earn.shares))) { earnShares += Number(earn.shares); anyShare = true }
        if (earn.paid != null && Number.isFinite(Number(earn.paid))) { earnPaid += Number(earn.paid); anyPaid = true }
        if (earn.earned != null && Number.isFinite(Number(earn.earned))) { earnEarned += Number(earn.earned); anyEarned = true }
      }
    }
    const one = running.length === 1 ? running[0] : null
    const pool = running.every(s => s.backend === 'zminer-gpu')
    return {
      chain: 'classic',
      mode: 'gpu',
      running: true,
      backend: pool ? 'zminer-gpu' : running[0].backend,
      shard: one ? one.shard : null,
      wallet: one ? one.wallet : null,
      phase: one ? one.phase : (running.some(s => s.phase === 'mining') ? 'mining' : running[0].phase),
      code: one ? one.code : running[0].code,
      hashrate: anyHash ? hash : null,
      hashrateSource: anyHash ? 'status' : null,
      rateSeen: anyHash,
      sharesSeen: running.some(s => s.sharesSeen === true),
      sessionEarn: earnOn ? {
        exposed: true,
        shares: anyShare ? earnShares : null,
        paid: anyPaid ? String(earnPaid) : null,
        earned: anyEarned ? String(earnEarned) : null
      } : null,
      sharesAccepted: accepted,
      procs: running.reduce((acc, s) => acc.concat(s.procs || []), []),
      shards: running,
      localBlock: one ? one.localBlock : null,
      networkBlock: one ? one.networkBlock : null,
      gpuActive: running.some(s => s.gpuActive),
      paused: running.every(s => s.paused),
      cudaFailed: false,
      message: one ? one.message : ''
    }
  }

  watch (kid) {
    kid.on('status', (st) => {
      if (st && (st.cudaFailed || st.code === 'NO_NVIDIA')) this.noteCuda()
      this.emit('status', this.status())
    })
  }

  noteCuda () {
    if (this._cuda) return
    this._cuda = true
    const jobs = []
    for (const kid of this.kids.values()) if (kid.wantRunning) jobs.push(kid.stop())
    Promise.all(jobs).then(() => this.emit('status', this.status())).catch(() => {})
  }

  async stopWhere (pred) {
    const jobs = []
    for (const [shard, kid] of this.kids) {
      if (kid.wantRunning && pred(shard, kid)) jobs.push(kid.stop())
    }
    await Promise.all(jobs)
  }

  childUp (kid) {
    const proc = kid && kid.proc
    if (!proc || proc.exitCode != null || proc.signalCode != null) return false
    return pidAlive(proc.pid)
  }

  async start (address, opts) {
    opts = opts || {}
    const parsed = parseClassicAddress(address)
    if (!parsed) {
      const err = new Error('Classic mining needs a 1S01 / 2S02 / 3S03 / 4S04 address')
      err.code = 'BAD_ADDRESS'
      throw err
    }
    const gpuMiner = resolveGpuMiner(opts)
    // A pool start must not stop the other shards' zminer-gpu processes.
    // An empty backend is a parallel start that has not spawned yet.
    if (gpuMiner === 'zminer-gpu') await this.stopWhere((shard, kid) => kid.state.backend && kid.state.backend !== 'zminer-gpu')
    else await this.stopWhere(shard => shard !== parsed.shard)
    let kid = this.kids.get(parsed.shard)
    // A previous start can still say it is running after the process has gone.
    // That must not skip the pool miner while a solo node is still syncing.
    if (kid && this.childUp(kid) && kid.wantRunning && kid.state.backend === gpuMiner && kid.state.wallet === parsed.address) return this.status()
    if (kid && (kid.wantRunning || kid.proc)) await kid.stop()
    kid = new ZpowManager(this.o)
    this.kids.set(parsed.shard, kid)
    this.watch(kid)
    try {
      await kid.start(address, Object.assign({}, opts, { backend: 'gpu', gpuMiner }))
    } catch (e) {
      this.kids.delete(parsed.shard)
      throw e
    }
    return this.status()
  }

  async stop () {
    const jobs = []
    for (const kid of this.kids.values()) jobs.push(kid.stop())
    await Promise.all(jobs)
    this.emit('status', this.status())
  }
}

function finitePct (v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

// Solo (a saved 進階 choice, or an explicit classic-node request that already
// carries a sync result) runs node.exe only when that shard is caught up.
// A bare classic-node request with no sync decision still launches the node.
// Anything still behind, including a saved solo choice, uses zminer-gpu.
function resolveGpuMiner (opts) {
  opts = opts || {}
  if (opts.gpuMiner === 'external') return 'external'
  const namedNode = opts.gpuMiner === 'classic-node'
  const soloIntent = opts.solo === true || opts.miningMode === 'solo'
  const pct = finitePct(opts.syncPct)
  const lowPct = pct != null && pct < 100
  if (soloIntent || opts.nodeSynced === false || lowPct) {
    const caughtUp = opts.nodeSynced === true && !lowPct
    return caughtUp ? 'classic-node' : 'zminer-gpu'
  }
  return namedNode ? 'classic-node' : 'zminer-gpu'
}

function poolFallbackLabel (opts, gpuMiner) {
  opts = opts || {}
  const asked = opts.gpuMiner === 'classic-node' || opts.solo === true || opts.miningMode === 'solo'
  const current = opts.mineLabel || ''
  if (gpuMiner !== 'zminer-gpu' || !asked) return current
  const pct = finitePct(opts.syncPct)
  const zh = opts.zh !== false
  if (pct != null && pct < 100) {
    return zh ? ('顯卡經礦池挖（本機節點同步 ' + pct + '%）') : ('Graphics card mining through the pool (local node sync ' + pct + '%)')
  }
  if (!current || current === '顯卡挖礦中' || current === 'Graphics card mining') {
    return zh ? '顯卡經礦池挖' : 'Graphics card mining through the pool'
  }
  return current
}

function positiveHeight (info) {
  if (!info || typeof info !== 'object') return null
  const raw = info.CurrentBlockHeight != null ? info.CurrentBlockHeight : info.currentBlockHeight
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function higherHeight (a, b) {
  if (a == null) return b == null ? null : b
  if (b == null) return a
  return a > b ? a : b
}

// Local getInfo against the public tip and the peer download target.
// Pool chain_height is not used: it can sit next to the local height while
// the public tip is still about twice as far (the 52% case).
function syncFromHeights (local, network) {
  if (local == null || network == null || !(network > 0)) return { synced: false, pct: null, local: local, network: network }
  const pct = Math.max(0, Math.min(100, Math.round((local / network) * 100)))
  const gap = network - local
  return { synced: gap >= 0 && gap <= BEHIND_BLOCKS, pct: pct, local: local, network: network }
}

async function measureShardSync (shard, call, timeoutMs) {
  const all = await measureAllShardSync(call, timeoutMs, shard)
  return all[Number(shard)] || { synced: false, pct: null, local: null, network: null }
}

async function measureAllShardSync (call, timeoutMs, onlyShard) {
  const rpc = call || rpcCall
  const ms = timeoutMs || 1200
  const wanted = onlyShard != null ? [Number(onlyShard)] : [1, 2, 3, 4]
  const out = {}
  await Promise.all(wanted.map(async (n) => {
    const port = SHARD_PORTS[n]
    out[n] = { synced: false, pct: null, local: null, network: null }
    if (!port) return
    const localUrl = 'http://127.0.0.1:' + port.http
    let info = null
    let dl = null
    let pub = null
    try { info = await rpc(localUrl, 'scdo_getInfo', [], ms) } catch (e) {}
    try { dl = await rpc(localUrl, 'download_getStatus', [], ms) } catch (e) {}
    try { pub = await rpc('https://scdoscan.io/rpc/' + n, 'scdo_getInfo', [], ms) } catch (e) {}
    const local = positiveHeight(info)
    const network = higherHeight(peerTargetOf(dl), positiveHeight(pub))
    out[n] = syncFromHeights(local, network)
  }))
  return out
}

async function localNodeHeights (call, timeoutMs) {
  const rpc = call || rpcCall
  const ms = timeoutMs || 800
  const out = {}
  await Promise.all([1, 2, 3, 4].map(async (n) => {
    const port = SHARD_PORTS[n]
    if (!port) return
    try {
      const info = await rpc('http://127.0.0.1:' + port.http, 'scdo_getInfo', [], ms)
      const h = info && (info.CurrentBlockHeight != null ? info.CurrentBlockHeight : info.currentBlockHeight)
      if (h != null && Number(h) > 0) out[n] = { local: Number(h) }
    } catch (e) {}
  }))
  return out
}

module.exports = { ZpowManager, GpuFleet, httpGetJson, rpcCall, formatExitMessage, localNodeHeights, computerName, resolveGpuMiner, measureShardSync, measureAllShardSync }
