// Applies guard decisions to Classic miner children. Windows only.
'use strict'
const { freshGuard, stepGuard, trayView } = require('./guardPlan')

const TICK_MS = 5000

function argValue (args, flags) {
  if (!args) return null
  for (const flag of flags) {
    const i = args.indexOf(flag)
    if (i >= 0 && i + 1 < args.length) {
      const n = Number(args[i + 1])
      if (Number.isFinite(n) && n >= 1) return Math.floor(n)
    }
  }
  return null
}

function chainStatus (mgr, gst) {
  if (gst && gst.paused) return '暫停'
  const st = mgr.status ? mgr.status() : {}
  if (st.code === 'RESTARTING' || (mgr.wantRunning && mgr.childAlive && !mgr.childAlive())) return '重新啟動'
  if (mgr.wantRunning && st.phase === 'mining') return '運算中'
  if (mgr.wantRunning) return '啟動中'
  return '已停止'
}

function phaseOf (mgr, gst, now) {
  if (gst && gst.paused) return { phase: 'paused', reason: gst.reason || '', shareAgeMs: gst.lastShareAt ? now - gst.lastShareAt : null }
  const alive = mgr.childAlive ? mgr.childAlive() : false
  if (mgr.wantRunning && !alive) return { phase: 'restarting', reason: '', shareAgeMs: gst && gst.lastShareAt ? now - gst.lastShareAt : null }
  if (mgr.wantRunning || mgr.guardHeld) {
    return { phase: 'mining', reason: '', shareAgeMs: gst && gst.lastShareAt ? now - gst.lastShareAt : null }
  }
  return { phase: 'stopped', reason: '', shareAgeMs: null }
}

function combine (parts) {
  if (!parts.length) return null
  const grey = parts.find(p => p.view.colour === 'grey')
  let colour = 'red'
  let reason = ''
  if (grey) { colour = 'grey'; reason = grey.view.reason || '' }
  else if (parts.some(p => p.view.colour === 'green')) colour = 'green'
  else if (parts.some(p => p.view.colour === 'yellow')) colour = 'yellow'
  else colour = 'red'
  let lastAction = ''
  for (const p of parts) if (p.gst && p.gst.lastAction) lastAction = p.gst.lastAction
  return {
    colour,
    reason,
    lastAction,
    active: parts.some(p => p.mgr.wantRunning || p.mgr.guardHeld),
    chains: parts.map(p => ({
      shard: (p.mgr.state && p.mgr.state.shard) || null,
      status: chainStatus(p.mgr, p.gst),
      hashrate: p.mgr.state ? p.mgr.state.hashrate : null,
      lastShareAt: p.gst && p.gst.lastShareAt ? p.gst.lastShareAt : null
    }))
  }
}

async function applyActions (mgr, actions) {
  const order = { 'set-threads': 1, 'set-intensity': 2, 'resume': 3, 'pause': 4, 'restart-child': 5, 'tray-note': 6 }
  const list = actions.slice().sort((a, b) => (order[a.type] || 9) - (order[b.type] || 9))
  let restart = false
  let didResume = false
  let note = ''
  for (const a of list) {
    if (a.type === 'set-threads' && mgr.setArg) {
      if (mgr.setArg('-threads', a.threads) || mgr.setArg('--threads', a.threads)) restart = true
    } else if (a.type === 'set-intensity' && mgr.setArg) {
      if (mgr.setArg('-batch', a.batch)) restart = true
    } else if (a.type === 'resume' && mgr.resumeFromGuard) {
      didResume = true
      try { await mgr.resumeFromGuard() } catch (e) {}
    } else if (a.type === 'pause' && mgr.pauseForGuard) {
      try { await mgr.pauseForGuard() } catch (e) {}
    } else if (a.type === 'restart-child') restart = true
    else if (a.type === 'tray-note' && a.text) note = a.text
  }
  if (restart && !didResume && mgr.wantRunning && mgr.restartChild) {
    try { await mgr.restartChild() } catch (e) {}
  }
  return note
}

function start (deps) {
  deps = deps || {}
  const platform = deps.platform || process.platform
  if (platform !== 'win32') return { started: false, view: null, snapshot () { return null } }
  const states = new Map()
  let view = null
  let engaged = false
  let ticking = false
  const handle = {
    started: true,
    get view () { return view },
    snapshot () { return view }
  }
  async function tick () {
    if (ticking) return
    ticking = true
    try {
      const intent = (deps.readIntent && deps.readIntent()) || {}
      const enabled = intent.guardSmooth !== false
      const mineOnBattery = !!intent.mineOnBattery
      const miners = (deps.listMiners && deps.listMiners()) || []
      const pids = []
      for (const m of miners) {
        try {
          const ids = m.mgr.childPids ? m.mgr.childPids() : []
          for (const id of ids) pids.push(id)
        } catch (e) {}
      }
      const probe = deps.readSample ? await deps.readSample({ pids }) : { platform: 'win32', skipped: true }
      if (!probe || probe.skipped || probe.platform !== 'win32') return
      let gpuTempC = null
      try { gpuTempC = deps.gpuTempC ? await deps.gpuTempC() : null } catch (e) { gpuTempC = null }
      const now = Date.now()
      const parts = []
      let note = ''
      for (const m of miners) {
        const mgr = m.mgr
        if (mgr.wantRunning || mgr.guardHeld) engaged = true
        let gst = states.get(m.id)
        if (!gst) {
          const fromArgs = argValue(mgr.launchSpec && mgr.launchSpec.args, ['-threads', '--threads'])
          const base = fromArgs || (mgr.launchThreads) || 1
          gst = freshGuard({ enabled, mineOnBattery, baseThreads: base, threads: base, lastMemCheck: now, lastProgressAt: now })
        }
        gst.enabled = enabled
        gst.mineOnBattery = mineOnBattery
        const pid = (mgr.childPids && mgr.childPids()[0]) || 0
        const proc = pid && probe.procs ? probe.procs[pid] : null
        const active = !!(mgr.wantRunning || mgr.guardHeld)
        const sample = {
          platform: 'win32',
          active,
          userRunning: !!mgr.wantRunning,
          inputAgeMs: probe.inputAgeMs,
          cpuPct: probe.cpuPct,
          fullscreen: !!probe.fullscreen,
          onBattery: !!probe.onBattery,
          batteryPct: probe.batteryPct,
          ramFreePct: probe.ramFreePct,
          commitPct: probe.commitPct,
          gpuTempC,
          childAlive: mgr.childAlive ? !!mgr.childAlive() : false,
          shares: mgr.state ? mgr.state.sharesAccepted || 0 : 0,
          hashrate: mgr.state && mgr.state.hashrateSource !== 'pool' ? mgr.state.hashrate || 0 : 0,
          workingSet: proc ? proc.ws : null,
          handles: proc ? proc.handles : null
        }
        const out = stepGuard(gst, sample, now)
        states.set(m.id, out.state)
        const text = await applyActions(mgr, out.actions)
        if (text) note = text
        const ph = phaseOf(mgr, out.state, now)
        parts.push({ mgr, gst: out.state, view: trayView(ph) })
      }
      if (engaged && parts.length) view = combine(parts)
      if (note && deps.note) { try { deps.note(note) } catch (e) {} }
      if (deps.onChange) { try { deps.onChange() } catch (e) {} }
    } finally { ticking = false }
  }
  const timer = setInterval(() => { tick().catch(() => {}) }, TICK_MS)
  if (timer.unref) timer.unref()
  tick().catch(() => {})
  handle.stop = () => clearInterval(timer)
  return handle
}

module.exports = { start, applyActions, chainStatus, TICK_MS }
