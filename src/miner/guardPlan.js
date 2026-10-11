// Miner guard decisions. Pure: no OS calls, no process control.
// The host applies the returned actions. The computer itself is never restarted.
'use strict'

const MIN = 60 * 1000
const BACKOFF_MIN = [1, 2, 5, 10]
const SHARE_FRESH_MS = 10 * MIN
const STALL_MS = 15 * MIN
const IDLE_RESTORE_MS = 2 * MIN
const INPUT_RECENT_MS = 30 * 1000
const HIGH_CPU_HOLD_MS = 10 * 1000
const HIGH_CPU = 85
const RAM_FREE_MIN = 15
const COMMIT_MAX = 90
const MEM_CHECK_MS = 60 * 1000
const LEAK_WINDOW_MS = 30 * MIN
const LEAK_GROWTH = 0.5
const HOUR_MS = 60 * MIN
const MAX_RESTARTS_HOUR = 5
const TEMP_LOW = 85
const TEMP_PAUSE = 90
const BATTERY_STOP = 30
const LOG_LIMIT = 50 * 1024 * 1024
const LOG_KEEP = 3
const GPU_BATCH = 8192

const PAUSE_TEXT = {
  '電池': '因電池暫停',
  '全螢幕': '因全螢幕暫停',
  '溫度': '因溫度暫停',
  '記憶體': '因記憶體暫停',
  '重新啟動': '重新啟動太多次，已暫停'
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

function range (n) {
  const ids = []
  for (let i = 0; i < n; i++) ids.push(i)
  return ids
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
  let threads = physical > 0 ? Math.max(1, physical - 1) : (logical > 2 ? Math.max(1, logical - 2) : 1)
  let affinity = null
  if (hybrid && pLogical.length) {
    affinity = pLogical.slice()
    threads = Math.max(1, Math.min(threads, affinity.length))
  } else if (!hybrid && logical > 2) {
    threads = Math.max(1, Math.min(threads, logical - 2))
    const ids = Array.isArray(cpu.logicalIds) && cpu.logicalIds.length ? cpu.logicalIds.map(Number) : range(logical)
    affinity = ids.slice(0, Math.max(0, ids.length - 2))
    if (!affinity.length) affinity = null
  } else if (!hybrid && logical > 0 && logical <= 2) {
    affinity = null
    threads = 1
  }
  return { threads: Math.max(1, threads), affinity, priority: 'below-normal' }
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

// Keep `keep` archived copies: file.1 is the newest archive, file.keep is the oldest.
function rotateFile (file, fsImpl, opts) {
  opts = opts || {}
  const limit = opts.limit == null ? LOG_LIMIT : opts.limit
  const keep = opts.keep == null ? LOG_KEEP : opts.keep
  let size = 0
  try { size = fsImpl.statSync(file).size } catch (e) { return false }
  if (!shouldRotate(size, limit)) return false
  try { fsImpl.unlinkSync(file + '.' + keep) } catch (e) {}
  for (let i = keep - 1; i >= 1; i--) {
    const src = file + '.' + i
    try { if (fsImpl.existsSync(src)) fsImpl.renameSync(src, file + '.' + (i + 1)) } catch (e) {}
  }
  try { fsImpl.renameSync(file, file + '.1') } catch (e) { return false }
  return true
}

function trayView (input) {
  input = input || {}
  const phase = input.phase
  const reason = input.reason || ''
  if (phase === 'paused') return { colour: 'grey', reason }
  if (phase === 'stopped' || phase === 'restarting') return { colour: 'red', reason: '' }
  const fresh = input.shareAgeMs != null && input.shareAgeMs >= 0 && input.shareAgeMs < SHARE_FRESH_MS
  if (phase === 'mining' || phase === 'running') return { colour: fresh ? 'green' : 'yellow', reason: '' }
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
    batch: GPU_BATCH
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
  return Math.max(1, n)
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

function pauseReasonFor (state, sample) {
  const pct = sample.batteryPct
  if (pct != null && pct >= 0 && pct < BATTERY_STOP) return '電池'
  if (sample.onBattery && !state.mineOnBattery) return '電池'
  if (!state.enabled) return ''
  if (sample.fullscreen) return '全螢幕'
  if (sample.gpuTempC != null && sample.gpuTempC > TEMP_PAUSE) return '溫度'
  if (state.memStage >= 3 && memoryPressure(sample)) return '記憶體'
  if (state.paused && state.reason === '重新啟動') return '重新啟動'
  return ''
}

function enterPause (state, actions, reason) {
  if (state.paused && state.reason === reason) return
  state.paused = true
  state.reason = reason
  state.restartDue = 0
  state.lastAction = PAUSE_TEXT[reason] || reason
  actions.push({ type: 'pause', reason })
  if (reason === '記憶體' || reason === '重新啟動') actions.push({ type: 'tray-note', reason, text: state.lastAction })
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
  if (!sample || sample.platform !== 'win32') return { state: s, actions }
  now = Number(now) || 0

  if (s.memStage >= 3 && !memoryPressure(sample)) s.memStage = 0

  if (!sample.active) {
    s.paused = false
    s.reason = ''
    s.restartDue = 0
    return { state: s, actions }
  }

  if (sample.userRunning && s.paused) {
    s.paused = false
    s.reason = ''
    s.restarts = []
    s.restartIndex = 0
    s.restartDue = 0
    if (s.memStage >= 3) s.memStage = 0
    s.lastProgressAt = now
  }

  const why = pauseReasonFor(s, sample)
  if (why) {
    enterPause(s, actions, why)
    return { state: s, actions }
  }
  if (s.paused) {
    s.paused = false
    s.reason = ''
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
        s.lastAction = '重新啟動挖礦程式'
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
    if (before < s.threads) actions.push({ type: 'restart-child', cause: 'memory' })
  }
  pushLevels(s, actions)
  if (s.paused || actions.some(a => a.type === 'restart-child' || a.type === 'pause')) return { state: s, actions }

  const shares = Math.max(0, Math.floor(Number(sample.shares) || 0))
  const hashrate = Number(sample.hashrate) || 0
  if (sample.childAlive) {
    if (s.lastProgressAt == null) s.lastProgressAt = now
    if (shares > s.shares || hashrate > 0) s.lastProgressAt = now
    if (shares > s.shares) {
      s.lastShareAt = now
      s.restartIndex = 0
    }
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
          s.lastAction = '重新啟動挖礦程式'
          actions.push({ type: 'restart-child', cause: 'leak' })
          s.shares = shares
          return { state: s, actions }
        }
      }
    }
  }
  s.shares = shares

  const stalled = sample.childAlive && s.lastProgressAt != null && now - s.lastProgressAt >= STALL_MS
  const dead = !sample.childAlive
  if (stalled || dead) {
    const recent = (s.restarts || []).filter(t => now - t < HOUR_MS)
    s.restarts = recent
    if (recent.length >= MAX_RESTARTS_HOUR) {
      enterPause(s, actions, '重新啟動')
      return { state: s, actions }
    }
    if (!s.restartDue) s.restartDue = now + backoffMs(s.restartIndex)
    if (now >= s.restartDue) {
      s.restarts = recent.concat([now])
      s.restartIndex += 1
      s.restartDue = 0
      s.lastProgressAt = now
      s.childGeneration += 1
      s.baseline = null
      s.lastAction = '重新啟動挖礦程式'
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
  MAX_RESTARTS_HOUR,
  TEMP_LOW,
  TEMP_PAUSE,
  BATTERY_STOP,
  LOG_LIMIT,
  LOG_KEEP,
  GPU_BATCH,
  classifyCores,
  threadPlan,
  backoffMs,
  shouldRotate,
  rotateFile,
  trayView,
  freshGuard,
  plannedThreads,
  stepGuard
}
