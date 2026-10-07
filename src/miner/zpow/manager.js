// Classic shard 1–4 mining. The main process keeps one instance for CPU and
// one for GPU, so both can run next to Shard0.
// CPU: zminer to the pool. Shard 1 is 82.223.19.88:3341. Shards 2–4 use 3342–3344.
// GPU: go-scdo node.exe CUDA zpow, one shard, coinbase = the user's address.
// A third binary can be dropped in with SCDO_ZPOW_GPU_BIN / SCDO_ZPOW_GPU_ARGS.
'use strict'
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const os = require('os')
const { EventEmitter } = require('events')
const { parseClassicAddress, normalizeMiningInput } = require('./address')
const { poolForShard, poolsFromEnv, minerStatsUrl, defaultCpuThreads } = require('./pools')
const { parseStatusLine, blockRatePerHour, parsePoolMiner, peerTargetOf, mergeSyncView, classicGpuPhase } = require('./status')
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
const { firstExisting, zminerCandidates, classicNodeCandidates, findCudart, assertSha256, sumsBeside } = require('./bins')
const { renderArgs, externalProfile, ZMINER_ARGS, CLASSIC_NODE_ARGS, spawnMiner, stopMiner, ctrlCScript } = require('./launch')

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
    this.state = this.fresh()
  }

  fresh () {
    return {
      chain: 'classic', phase: 'idle', code: 'IDLE', mode: null, backend: null, message: '',
      wallet: null, shard: null, pool: null, connected: null,
      hashrate: null, hashrateSource: null, sharesAccepted: 0, sharesRejected: 0,
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
      procs: this.proc ? [this.state.backend || 'zpow'] : []
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
    this.applyLine(line)
    this.refreshClassicGpu()
    try {
      const dir = path.join(this.o.dataRoot, 'logs')
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(path.join(dir, 'zpow.log'), shown + '\n')
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
      if (ev.hashrate != null) { patch.hashrate = ev.hashrate; patch.hashrateSource = 'status' }
      if (ev.accepted != null) patch.sharesAccepted = ev.accepted
      if (ev.rejected != null) patch.sharesRejected = ev.rejected
      if (ev.connected != null) patch.connected = ev.connected
      if (ev.blocks != null) patch.blocksFound = Math.max(this.state.blocksFound, ev.blocks)
      if (this.state.mode === 'cpu') {
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
    const node = firstExisting(classicNodeCandidates({ binDir: this.o.binDir, root: this.o.root, platform, env }))
    const cudart = node ? findCudart(node, platform, env) : null
    let external = null
    try { external = externalProfile(env) } catch (e) { external = { error: e.message, code: e.code } }
    const gpuReady = !!(node && cudart)
    const pools = {}
    try {
      const over = poolsFromEnv(env)
      for (const s of [1, 2, 3, 4]) pools[s] = poolForShard(s, over)
    } catch (e) { pools.error = e.message }
    return {
      cpu: { available: !!zminer, path: zminer },
      gpu: { available: gpuReady, path: node, cudart, reason: node && !cudart ? 'CUDART' : (node ? null : 'NO_BINARY') },
      external: external && external.binary ? { available: fs.existsSync(external.binary), path: external.binary, solo: !!external.solo, id: external.id } : null,
      pools,
      cpuCount: Math.max(1, (os.cpus() || []).length || 1),
      threadsDefault: defaultCpuThreads((os.cpus() || []).length || 1)
    }
  }

  childPids () { return this.proc && this.proc.pid ? [this.proc.pid] : [] }

  pushSyncSample (h, now) {
    if (h == null || !Number.isFinite(Number(h))) return
    const t = now || Date.now()
    const height = Number(h)
    const last = this.syncSamples[this.syncSamples.length - 1]
    if (last && t - last.t < 2000 && last.h === height) return
    this.syncSamples.push({ t, h: height })
    const cutoff = t - 4 * 60 * 1000
    while (this.syncSamples.length > 2 && this.syncSamples[0].t < cutoff) this.syncSamples.shift()
  }

  // Displayed ETA changes at most every 30s. Caught up (0) updates immediately.
  holdEta (etaSec, now) {
    const t = now || Date.now()
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
    const gpuMiner = opts.gpuMiner === 'external' ? 'external' : 'classic-node'
    const env = this.o.env || process.env
    const caps = this.capabilities(env)
    const asInt = (v, fallback) => {
      const n = Number(normalizeMiningInput(v))
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
    }
    const threads = asInt(opts.threads, caps.threadsDefault || 1)
    const threadblocks = asInt(opts.threadblocks, 100)
    const blockthreads = asInt(opts.blockthreads, 100)
    const pool = poolForShard(parsed.shard, poolsFromEnv(env) || this.o.pools)

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
        pool: pool.stratum, user: parsed.address, worker: opts.worker || 'wallet', threads
      })
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
        worker: opts.worker || 'wallet',
        shard: String(parsed.shard)
      })
      cwd = path.dirname(binary)
    } else {
      if (!caps.gpu.path) {
        const err = new Error('Classic node binary not found. Build node.exe from SCDOLAB/go-scdo and set SCDO_CLASSIC_NODE, or place it in miner-bin/win32/classic/ with libcudart.dll.')
        err.code = 'NO_CLASSIC_NODE'
        throw err
      }
      if (!caps.gpu.cudart) {
        const err = new Error('libcudart is not next to the Classic node (' + caps.gpu.path + ')')
        err.code = 'NO_CUDART'
        throw err
      }
      binary = caps.gpu.path
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
    this.state = Object.assign(this.fresh(), {
      wallet: parsed.address,
      shard: parsed.shard,
      mode: backend,
      backend: backend === 'cpu' ? 'zminer' : gpuMiner,
      pool: backend === 'gpu' && gpuMiner === 'classic-node' ? null : { stratum: pool.stratum, stats: minerStatsUrl(pool, parsed.address), live: pool.live },
      phase: 'starting',
      code: backend === 'cpu' ? 'POOL_CONNECTING' : (gpuMiner === 'classic-node' ? 'CLASSIC_STARTING' : 'CLASSIC_SYNCING'),
      message: '',
      startedAt: Date.now()
    })
    this.restarts = []
    this.syncSamples = []
    this.etaHold = null
    this.etaHoldAt = 0
    this.wantRunning = true
    this.launchSpec = { binary, args, cwd, env: nodeEnv, ctrlC }
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
      this.log('exited (code ' + code + ')')
      if (!this.wantRunning) return
      const message = formatExitMessage(code, this.state.logTail)
      if (code === 2 || code === 3) {
        this.wantRunning = false
        this.set({ phase: 'error', code: code === 3 ? 'SELFTEST' : 'LOGIN', lastError: message, message })
        return
      }
      this.scheduleRestart(code, message)
    })
  }

  scheduleRestart (code, message) {
    const now = Date.now()
    const recent = (this.restarts || []).filter(t => now - t < 10 * 60 * 1000)
    recent.push(now)
    this.restarts = recent
    if (recent.length >= 6) {
      this.wantRunning = false
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
      const body = await (this.o.fetchJson || httpGetJson)(this.state.pool.stats, 8000)
      const stats = parsePoolMiner(body)
      this.set({ poolStats: stats, poolError: null })
    } catch (e) {
      this.set({ poolError: e.message })
    }
  }

  async stop () {
    this.wantRunning = false
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.poller) { clearInterval(this.poller); this.poller = null }
    if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null }
    const proc = this.proc
    this.proc = null
    if (proc) {
      const ctrl = this.state.backend === 'classic-node'
      await stopMiner(proc, {
        platform: this.o.platform,
        graceMs: ctrl ? 60000 : 8000,
        ctrlC: ctrl,
        stdinStop: !ctrl,
        ctrlCScript: ctrl ? ctrlCScript(path.join(this.o.dataRoot, 'tools')) : undefined
      })
    }
    if (this.state.phase !== 'error') this.set({ phase: 'stopped', code: 'STOPPED', message: '' })
    else this.emit('status', this.status())
  }
}

module.exports = { ZpowManager, httpGetJson, rpcCall, formatExitMessage }
