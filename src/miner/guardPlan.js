// Miner guard decisions. Pure: no OS calls, no process control.
// The host applies the returned actions. The computer itself is never restarted.
'use strict'

const MIN = 60 * 1000
const BACKOFF_MIN = [1, 2, 4, 8, 16, 30]
const SHARE_FRESH_MS = 10 * MIN
const STALL_MS = 5 * MIN
const IDLE_RESTORE_MS = 45 * 1000
const INPUT_RECENT_MS = 30 * 1000
const HIGH_CPU_HOLD_MS = 5 * 1000
const HIGH_CPU = 85
const RAM_FREE_MIN = 15
const COMMIT_MAX = 90
const MEM_CHECK_MS = 60 * 1000
const LEAK_WINDOW_MS = 30 * MIN
const LEAK_GROWTH = 0.5
const HOUR_MS = 60 * MIN
const QUICK_LIFE_MS = 30 * 1000
const QUICK_DEATHS = 3
// After a give-up, try again by itself (10, 30, then every 60 min) while the user still wants to mine.
// A give-up is usually caused by something outside the wallet (a second wallet/rigel holding the
// GPU or API port, a driver reset) that goes away on its own; staying stopped forever loses the night.
const GAVE_UP_RETRY_MIN = [10, 30, 60]
const AC_STABLE_MS = 15 * 1000
const DISK_MIN_BYTES = 500 * 1024 * 1024
const TEMP_LOW = 85
const TEMP_PAUSE = 90
const BATTERY_STOP = 20
const LOG_LIMIT = 50 * 1024 * 1024
const LOG_KEEP = 3
const GPU_BATCH = 8192

// One row per machine class. A later hybrid AMD row can be added here.
const ARCH_RULES = {
  'intel-hybrid': 'p-core-affinity',
  amd: 'physical-minus-one',
  'apple-silicon': 'qos-utility',
  'apple-intel': 'physical-minus-one',
  virtual: 'warn',
  uniform: 'physical-minus-one'
}

const TRAY_COPY = {
  green: { CN: '正在記帳 · 已自動避開你的使用高峰', EN: 'Bookkeeping · automatically stays out of your way' },
  yellow: { CN: '你在忙，我先緩緩，空閒了自動繼續', EN: "You're busy — I've slowed down and will resume when you're idle" },
  blue: { CN: '已暫停(全螢幕/電池/記憶體原因)，條件恢復後自動繼續', EN: 'Paused (fullscreen / on battery / low memory) — resumes automatically' },
  red: { CN: '記帳遇到麻煩，已停止重試 — 點我查看詳情', EN: 'Bookkeeping hit a snag and stopped retrying — click for details' }
}

const FIRST_RUN = {
  CN: '開啟記帳後，它會自動在你使用電腦時讓行、全螢幕和用電池時暫停 —— 不打擾，是你的。',
  EN: 'Once enabled, bookkeeping automatically yields while you work, and pauses during fullscreen apps and on battery — it stays out of your way.'
}

const COLOUR_RANK = { red: 4, yellow: 3, blue: 2, green: 1 }

const PAUSE_TEXT = {
  '電池': '因電池暫停',
  '全螢幕': '因全螢幕暫停',
  '溫度': '因溫度暫停',
  '記憶體': '因記憶體暫停',
  '重新啟動': '重新啟動太多次，已暫停',
  '睡眠': '因睡眠暫停',
  '磁碟': '磁碟空間不足，已暫停記帳',
  '手動': '已暫停一段時間',
  '異常': '記帳遇到麻煩，已停止重試。請將錢包加入防毒軟體的允許清單。',
  '不適合': '此裝置不適合記帳'
}

function classifyCores (groups) {
  const list = Array.isArray(groups) ? groups : []
  const classes = []
  for (const g of list) {
    if (g && g.efficiencyClass != null && Number.isFinite(Number(g.efficiencyClass))) classes.push(Number(g.efficiencyClass))
  }
  const distinct = [...new Set(classes)]
  const hybrid = distinct.length > 1
  const pClass = distinct.length ? Math.max.apply(null, distinct) : null
  const pGroups = hybrid ? list.filter(g => Number(g.efficiencyClass) === pClass) : list
  const pLogical = []
  for (const g of pGroups) for (const id of (g && g.logical) || []) pLogical.push(id)
  return { hybrid, pClass, physicalPCores: pGroups.length, pLogical }
}

function archKind (cpu) {
  cpu = cpu || {}
  if (cpu.virtual) return 'virtual'
  if (cpu.qos === 'utility' || cpu.vendor === 'apple-silicon') return 'apple-silicon'
  if (cpu.vendor === 'apple-intel') return 'apple-intel'
  if (cpu.hybrid) return 'intel-hybrid'
  if (cpu.vendor === 'amd') return 'amd'
  return 'uniform'
}

function dominantColour (colours) {
  let best = 'green'
  let rank = 0
  for (const c of colours || []) {
    const n = COLOUR_RANK[c] || 0
    if (n > rank) { rank = n; best = c }
  }
  return best
}

function range (n) {
  const ids = []
  for (let i = 0; i < n; i++) ids.push(i)
  return ids
}

// Used until the core list has been read. No affinity mask: a guessed mask on
// an Intel hybrid processor includes the efficient cores.
function pendingPlan () {
  return { threads: 1, affinity: null, priority: 'below-normal', pending: true }
}

// Probe finished without a core list. Keep the lower logical ids only.
// On the hybrid CPUs that froze a desktop, those lower ids are the performance cores.
function fallbackPlan (logical) {
  const n = Math.max(0, Math.floor(Number(logical) || 0))
  if (n <= 2) return { threads: 1, affinity: null, priority: 'below-normal', pending: false, fallback: true }
  const keep = Math.max(1, Math.floor(n / 2))
  const threads = Math.max(1, Math.min(keep, Math.floor(n / 2) - 1) || 1)
  return { threads, affinity: range(keep), priority: 'below-normal', pending: false, fallback: true }
}

// Threads default to physical performance cores minus 1 (at least 1).
// Hybrid: affinity is the performance-core logical ids only.
// Otherwise, when more than 2 logical cores exist, leave the last 2 unbound.
function threadPlan (cpu) {
  cpu = cpu || {}
  const logical = Math.max(0, Math.floor(Number(cpu.logical) || 0))
  const hybrid = !!cpu.hybrid
  const pLogical = Array.isArray(cpu.pLogical) ? cpu.pLogical.map(Number).filter(n => Number.isFinite(n)) : []
  const physical = Math.max(0, Math.floor(Number(cpu.physicalPCores) || 0))
  const unsuitable = physical > 0 ? physical <= 2 : logical > 0 && logical <= 2
  const virtual = !!cpu.virtual
  const arch = archKind(cpu)
  if (cpu.qos) {
    const threads = Math.max(1, physical > 0 ? physical - 1 : 1)
    return { threads, affinity: null, priority: 'below-normal', unsuitable, qos: cpu.qos, virtual, arch }
  }
  let threads = physical > 0 ? Math.max(1, physical - 1) : (logical > 2 ? Math.max(1, logical - 2) : 1)
  let affinity = null
  if (hybrid && pLogical.length) {
    affinity = pLogical.slice()
    threads = Math.max(1, Math.min(threads, affinity.length))
  } else if (!hybrid && logical > 2) {
    const ids = Array.isArray(cpu.logicalIds) && cpu.logicalIds.length ? cpu.logicalIds.map(Number) : range(logical)
    if (physical > 0) {
      threads = Math.max(1, physical - 1)
      affinity = ids.slice()
    } else {
      threads = Math.max(1, Math.min(threads, logical - 2))
      affinity = ids.slice(0, Math.max(0, ids.length - 2))
      if (!affinity.length) affinity = null
    }
  } else if (!hybrid && logical > 0 && logical <= 2) {
    affinity = null
    threads = 1
  }
  return { threads: Math.max(1, threads), affinity, priority: 'below-normal', unsuitable, qos: null, virtual, arch }
}

function gaveUpRetryMs (index) {
  const i = Math.max(0, Math.floor(Number(index) || 0))
  return GAVE_UP_RETRY_MIN[Math.min(i, GAVE_UP_RETRY_MIN.length - 1)] * MIN
}

function backoffMs (index) {
  const i = Math.max(0, Math.floor(Number(index) || 0))
  const mins = i >= BACKOFF_MIN.length ? BACKOFF_MIN[BACKOFF_MIN.length - 1] : BACKOFF_MIN[i]
  return mins * MIN
}

function shouldRotate (size, limit) {
  const cap = limit == null ? LOG_LIMIT : limit
  return Number(size) >= cap
}

// Keep `keep` archived copies. With gzip, the copies are file.1.gz ... file.keep.gz.
function rotateFile (file, fsImpl, opts) {
  opts = opts || {}
  const limit = opts.limit == null ? LOG_LIMIT : opts.limit
  const keep = opts.keep == null ? LOG_KEEP : opts.keep
  const gzip = !!(opts.gzip && typeof fsImpl.readFileSync === 'function' && typeof fsImpl.writeFileSync === 'function')
  const slot = (i) => file + '.' + i + (gzip ? '.gz' : '')
  let size = 0
  try { size = fsImpl.statSync(file).size } catch (e) { return false }
  if (!shouldRotate(size, limit)) return false
  try { fsImpl.unlinkSync(slot(keep)) } catch (e) {}
  for (let i = keep - 1; i >= 1; i--) {
    const src = slot(i)
    try { if (fsImpl.existsSync(src)) fsImpl.renameSync(src, slot(i + 1)) } catch (e) {}
  }
  try { fsImpl.renameSync(file, file + '.1') } catch (e) { return false }
  if (gzip) {
    try {
      const zlib = require('zlib')
      const buf = fsImpl.readFileSync(file + '.1')
      fsImpl.writeFileSync(slot(1), zlib.gzipSync(buf))
      try { fsImpl.unlinkSync(file + '.1') } catch (e) {}
    } catch (e) {}
  }
  return true
}

// The guard decides the intended threads and whether the miner should be running.
// A readback from the process or its status API matches when those agree.
// Hashrate is included when the miner has reported one. A missing thread count
// (a graphics-card miner that has no thread argument) is not a mismatch.
function observeReadback (expect, actual) {
  expect = expect || {}
  actual = actual || {}
  const hashrate = actual.hashrate == null || !Number.isFinite(Number(actual.hashrate)) ? null : Number(actual.hashrate)
  const threads = actual.threads == null || !Number.isFinite(Number(actual.threads)) ? null : Math.floor(Number(actual.threads))
  if (!expect.running) {
    const still = !!actual.running || (hashrate != null && hashrate > 0)
    return { match: !still, threads, hashrate }
  }
  if (threads == null) return { match: true, threads: null, hashrate, unchecked: true }
  return { match: !!actual.running && threads === Math.floor(Number(expect.threads) || 0), threads, hashrate }
}

function trayView (input) {
  input = input || {}
  const phase = input.phase
  const reason = input.reason || ''
  if (input.abnormal || phase === 'abnormal') return { colour: 'red', reason: '異常' }
  if (input.gaveUp || phase === 'gave-up') return { colour: 'red', reason: reason || '異常' }
  if (input.yielding || phase === 'yielding') return { colour: 'yellow', reason: '' }
  if (phase === 'paused') return { colour: 'blue', reason }
  if (phase === 'mining' || phase === 'running') return { colour: 'green', reason: '' }
  if (phase === 'restarting') return { colour: 'blue', reason: reason || '重新啟動' }
  return { colour: 'red', reason: '' }
}

function freshGuard (opts) {
  opts = opts || {}
  const base = Math.max(1, Math.floor(Number(opts.baseThreads) || 1))
  return {
    enabled: opts.enabled !== false,
    mineOnBattery: !!opts.mineOnBattery,
    baseThreads: base,
    threads: Math.max(1, Math.floor(Number(opts.threads) || base)),
    halved: false,
    highCpuSince: null,
    paused: false,
    reason: '',
    memStage: 0,
    lastMemCheck: opts.lastMemCheck == null ? 0 : opts.lastMemCheck,
    lastProgressAt: opts.lastProgressAt == null ? null : opts.lastProgressAt,
    lastShareAt: opts.lastShareAt == null ? null : opts.lastShareAt,
    shares: Math.max(0, Math.floor(Number(opts.shares) || 0)),
    restarts: Array.isArray(opts.restarts) ? opts.restarts.slice() : [],
    restartDue: 0,
    restartIndex: Math.max(0, Math.floor(Number(opts.restartIndex) || 0)),
    baseline: null,
    intensity: 'normal',
    lastAction: '',
    childGeneration: 0,
    batch: GPU_BATCH,
    wasUserRunning: false,
    lastHashrate: null,
    childBornAt: null,
    quickDeaths: 0,
    gaveUp: false,
    gaveUpAt: null,
    gaveUpCount: 0,
    acSince: null,
    onBatteryPrev: null,
    remoteCap: false,
    vmNoted: false,
    unsuitableNoted: false,
    appliedPlan: null,
    expectExit: false,
    sleepHeld: false
  }
}

function cloneState (state) {
  const s = Object.assign({}, state || freshGuard())
  s.restarts = (s.restarts || []).slice()
  if (s.baseline) s.baseline = Object.assign({}, s.baseline)
  return s
}

function plannedThreads (state) {
  let n = state.baseThreads
  if (state.memStage >= 1) n = Math.max(1, Math.floor(n / 2))
  if (state.halved) n = Math.max(1, Math.floor(n / 2))
  if (state.intensity === 'low') n = Math.max(1, Math.floor(n / 2))
  n = Math.max(1, n)
  if (state.remoteCap) n = 1
  return n
}

function plannedBatch (state) {
  return state.intensity === 'low' ? Math.max(1, Math.floor(GPU_BATCH / 2)) : GPU_BATCH
}

function memoryPressure (sample) {
  if (!sample) return false
  if (sample.ramFreePct != null && sample.ramFreePct < RAM_FREE_MIN) return true
  if (sample.commitPct != null && sample.commitPct > COMMIT_MAX) return true
  return false
}

function pauseReasonFor (state, sample, now) {
  if (state.gaveUp) return '異常'
  if (sample.manualPauseUntil && now < sample.manualPauseUntil) return '手動'
  if (sample.suspended || sample.wakeHold) return '睡眠'
  const pct = sample.batteryPct
  if (sample.onBattery && pct != null && pct >= 0 && pct < BATTERY_STOP) return '電池'
  if (sample.onBattery && !state.mineOnBattery) return '電池'
  if (!state.enabled) return ''
  if (sample.diskLow) return '磁碟'
  if (sample.fullscreen && !sample.remoteSession) return '全螢幕'
  if (sample.gpuTempC != null && sample.gpuTempC > TEMP_PAUSE) return '溫度'
  if (state.memStage >= 3 && memoryPressure(sample)) return '記憶體'
  if (state.paused && (state.reason === '重新啟動' || state.reason === '異常')) return state.reason
  return ''
}

function enterPause (state, actions, reason) {
  if (state.paused && state.reason === reason) return
  state.paused = true
  state.reason = reason
  state.restartDue = 0
  state.lastAction = PAUSE_TEXT[reason] || reason
  actions.push({ type: 'pause', reason })
  if (reason === '記憶體' || reason === '重新啟動' || reason === '異常' || reason === '磁碟' || reason === '不適合') {
    actions.push({ type: 'tray-note', reason, text: state.lastAction })
  }
}

function pushLevels (state, actions) {
  const threads = plannedThreads(state)
  const batch = plannedBatch(state)
  if (threads !== state.threads) {
    state.threads = threads
    actions.push({ type: 'set-threads', threads })
  }
  if (batch !== state.batch) {
    state.batch = batch
    actions.push({ type: 'set-intensity', intensity: state.intensity, batch })
  }
}

function stepGuard (state, sample, now) {
  const s = cloneState(state)
  const actions = []
  if (!sample || sample.skipped) return { state: s, actions }
  now = Number(now) || 0

  if (s.memStage >= 3 && !memoryPressure(sample)) s.memStage = 0

  if (!sample.active) {
    s.paused = false
    s.reason = ''
    s.restartDue = 0
    s.wasUserRunning = false
    return { state: s, actions }
  }

  // A give-up stays until mining is started again. It does not clear
  // on every tick while the user still wants the miner to run.
  if (sample.userRunning && !s.wasUserRunning && s.paused && (s.reason === '重新啟動' || s.reason === '異常' || s.gaveUp)) {
    s.paused = false
    s.reason = ''
    s.gaveUp = false
    s.quickDeaths = 0
    s.restarts = []
    s.restartIndex = 0
    s.restartDue = 0
    if (s.memStage >= 3) s.memStage = 0
    s.lastProgressAt = now
  }
  s.wasUserRunning = !!sample.userRunning

  // Auto-recover from a give-up after a cool-down instead of waiting for a manual restart.
  if (s.gaveUp && sample.userRunning && s.gaveUpAt != null && now - s.gaveUpAt >= gaveUpRetryMs(Math.max(0, (s.gaveUpCount || 1) - 1))) {
    s.gaveUp = false
    s.gaveUpAt = null
    if (s.reason === '異常') s.reason = ''
    s.quickDeaths = 0
    s.restarts = []
    s.restartIndex = 0
    s.restartDue = 0
    s.childBornAt = null
    s.lastProgressAt = now
    s.lastAction = '自動重試記帳'
  }

  if (s.sleepHeld && !sample.suspended && !sample.wakeHold) {
    s.sleepHeld = false
    s.restarts = []
    s.restartIndex = 0
    s.restartDue = 0
    s.quickDeaths = 0
    s.childBornAt = null
  }

  const onBat = !!sample.onBattery
  if (s.onBatteryPrev === true && !onBat) s.acSince = now
  if (onBat) s.acSince = null
  s.onBatteryPrev = onBat
  const acFresh = !onBat && s.acSince != null && (now - s.acSince) < AC_STABLE_MS
  const powerSample = acFresh ? Object.assign({}, sample, { onBattery: true }) : sample
  s.remoteCap = !!sample.remoteSession

  if (sample.virtualMachine && !s.vmNoted) {
    s.vmNoted = true
    s.lastAction = '虛擬機中記帳效率極低，建議關閉'
    actions.push({ type: 'tray-note', reason: '虛擬機', text: s.lastAction })
  }
  if (sample.unsuitable && !s.unsuitableNoted) {
    s.unsuitableNoted = true
    s.lastAction = '此裝置不適合記帳'
    actions.push({ type: 'tray-note', reason: '不適合', text: s.lastAction })
  }

  const why = pauseReasonFor(s, powerSample, now)
  if (why) {
    if (why === '睡眠') s.sleepHeld = true
    s.childBornAt = null
    enterPause(s, actions, why)
    return { state: s, actions }
  }
  if (s.paused) {
    s.paused = false
    s.reason = ''
    s.childBornAt = null
    s.lastAction = '恢復執行緒'
    actions.push({ type: 'resume' })
  }
  if (!s.enabled) return { state: s, actions }

  if (sample.gpuTempC != null && sample.gpuTempC > TEMP_LOW) {
    if (s.intensity !== 'low') {
      s.intensity = 'low'
      s.lastAction = '溫度過高，已降低強度'
    }
  } else if (sample.gpuTempC != null && s.intensity !== 'normal') {
    s.intensity = 'normal'
  }

  const inputRecent = sample.inputAgeMs != null && sample.inputAgeMs <= INPUT_RECENT_MS
  const cpuHigh = sample.cpuPct != null && sample.cpuPct > HIGH_CPU
  if (inputRecent && cpuHigh) {
    if (s.highCpuSince == null) s.highCpuSince = now
    else if (!s.halved && now - s.highCpuSince >= HIGH_CPU_HOLD_MS) {
      s.halved = true
      s.lastAction = '執行緒減半'
    }
  } else s.highCpuSince = null
  if (sample.inputAgeMs != null && sample.inputAgeMs >= IDLE_RESTORE_MS && s.halved) {
    s.halved = false
    s.lastAction = '恢復執行緒'
  }

  const pressured = memoryPressure(sample)
  if (!s.lastMemCheck) s.lastMemCheck = now
  else if (now - s.lastMemCheck >= MEM_CHECK_MS) {
    s.lastMemCheck = now
    if (pressured) {
      if (s.memStage === 0) {
        s.memStage = 1
        s.lastAction = '執行緒減半'
      } else if (s.memStage === 1) {
        s.memStage = 2
        s.lastAction = '重新啟動記帳節點'
        s.expectExit = true
        actions.push({ type: 'restart-child', cause: 'memory' })
      } else if (s.memStage === 2) {
        s.memStage = 3
        enterPause(s, actions, '記憶體')
        pushLevels(s, actions)
        return { state: s, actions }
      }
    } else if (s.memStage > 0 && s.memStage < 3) {
      s.memStage = 0
      s.lastAction = '恢復執行緒'
    }
  }
  if (s.memStage === 1 && !actions.some(a => a.type === 'restart-child')) {
    const before = plannedThreads(s)
    if (before < s.threads) {
      s.expectExit = true
      actions.push({ type: 'restart-child', cause: 'memory' })
    }
  }
  pushLevels(s, actions)
  if (s.paused || actions.some(a => a.type === 'restart-child' || a.type === 'pause')) return { state: s, actions }

  const shares = Math.max(0, Math.floor(Number(sample.shares) || 0))
  const hashrate = Number(sample.hashrate) || 0
  if (sample.childAlive) {
    if (s.lastProgressAt == null) s.lastProgressAt = now
    if (shares > s.shares) {
      s.lastProgressAt = now
      s.lastShareAt = now
      s.restartIndex = 0
      s.gaveUpCount = 0
    } else if (s.lastHashrate != null && hashrate !== s.lastHashrate) {
      s.lastProgressAt = now
    }
    s.lastHashrate = hashrate
    if (sample.workingSet != null) {
      if (!s.baseline || s.baseline.gen !== s.childGeneration) {
        s.baseline = { at: now, ws: Number(sample.workingSet) || 0, handles: Number(sample.handles) || 0, gen: s.childGeneration }
      } else if (now - s.baseline.at >= LEAK_WINDOW_MS) {
        const wsGrow = s.baseline.ws > 0 && Number(sample.workingSet) > s.baseline.ws * (1 + LEAK_GROWTH)
        const hGrow = s.baseline.handles > 0 && Number(sample.handles) > s.baseline.handles * (1 + LEAK_GROWTH)
        if (wsGrow || hGrow) {
          s.childGeneration += 1
          s.baseline = null
          s.lastProgressAt = now
          s.lastAction = '重新啟動記帳節點'
          s.expectExit = true
          actions.push({ type: 'restart-child', cause: 'leak' })
          s.shares = shares
          return { state: s, actions }
        }
      }
    }
  }
  s.shares = shares

  if (sample.planSig && s.appliedPlan && sample.planSig !== s.appliedPlan && sample.childAlive) {
    s.appliedPlan = sample.planSig
    s.expectExit = true
    s.lastAction = '重新啟動記帳節點'
    actions.push({ type: 'restart-child', cause: 'topology' })
    return { state: s, actions }
  }
  if (sample.planSig) s.appliedPlan = sample.planSig

  if (!sample.childAlive && s.childBornAt != null) {
    const life = now - s.childBornAt
    s.childBornAt = null
    if (s.expectExit) s.expectExit = false
    else if (life >= 0 && life < QUICK_LIFE_MS) s.quickDeaths += 1
    else s.quickDeaths = 0
    if (s.quickDeaths >= QUICK_DEATHS) {
      s.gaveUp = true
      s.gaveUpAt = now
      s.gaveUpCount = (s.gaveUpCount || 0) + 1
      enterPause(s, actions, '異常')
      return { state: s, actions }
    }
  }
  if (sample.childAlive && s.childBornAt == null) s.childBornAt = now

  const stalled = sample.childAlive && !sample.networkDown && s.lastProgressAt != null && now - s.lastProgressAt >= STALL_MS
  const dead = !sample.childAlive
  if (stalled || dead) {
    const recent = (s.restarts || []).filter(t => now - t < HOUR_MS)
    s.restarts = recent
    if (!s.restartDue) s.restartDue = now + backoffMs(s.restartIndex)
    if (now >= s.restartDue) {
      s.restarts = recent.concat([now])
      s.restartIndex += 1
      s.restartDue = 0
      s.lastProgressAt = now
      s.childGeneration += 1
      s.baseline = null
      s.lastAction = '重新啟動記帳節點'
      actions.push({ type: 'restart-child', cause: 'backoff' })
    }
  } else s.restartDue = 0

  return { state: s, actions }
}

module.exports = {
  BACKOFF_MIN,
  SHARE_FRESH_MS,
  STALL_MS,
  IDLE_RESTORE_MS,
  INPUT_RECENT_MS,
  HIGH_CPU_HOLD_MS,
  HIGH_CPU,
  RAM_FREE_MIN,
  COMMIT_MAX,
  MEM_CHECK_MS,
  LEAK_WINDOW_MS,
  LEAK_GROWTH,
  HOUR_MS,
  QUICK_LIFE_MS,
  QUICK_DEATHS,
  GAVE_UP_RETRY_MIN,
  gaveUpRetryMs,
  AC_STABLE_MS,
  DISK_MIN_BYTES,
  TEMP_LOW,
  TEMP_PAUSE,
  BATTERY_STOP,
  LOG_LIMIT,
  LOG_KEEP,
  GPU_BATCH,
  ARCH_RULES,
  TRAY_COPY,
  FIRST_RUN,
  classifyCores,
  archKind,
  dominantColour,
  threadPlan,
  pendingPlan,
  fallbackPlan,
  backoffMs,
  shouldRotate,
  rotateFile,
  trayView,
  observeReadback,
  freshGuard,
  plannedThreads,
  stepGuard
}
