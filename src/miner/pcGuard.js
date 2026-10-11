// Applies guard decisions to miner children on Windows, Mac and Linux.
'use strict'
const { freshGuard, stepGuard, trayView, dominantColour } = require('./guardPlan')
const powerHold = require('./powerHold')

const TICK_MS = 5000

function positiveInt (v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

function argValue (args, flags) {
  if (!args) return null
  for (const flag of flags) {
    const i = args.indexOf(flag)
    if (i >= 0 && i + 1 < args.length) {
      const n = positiveInt(args[i + 1])
      if (n) return n
    }
  }
  return null
}

// The configured count is the one the miner was started with. A later
// set-threads writes a smaller number into the args; that must not become
// the new base, or the next halve would cut the already-reduced count.
function launchedThreadCount (mgr, gst) {
  const declared = positiveInt(mgr && mgr.launchThreads)
  const fromArgs = argValue(mgr && mgr.launchSpec && mgr.launchSpec.args, ['-threads', '--threads'])
  const commanded = positiveInt(gst && gst.commanded)
  if (declared && fromArgs && fromArgs > declared && fromArgs !== commanded) return fromArgs
  if (declared) return declared
  if (commanded && fromArgs === commanded) return positiveInt(gst.baseThreads) || commanded
  return fromArgs
}

function minerStartToken (mgr) {
  const pid = (mgr && mgr.childPids && mgr.childPids()[0]) || 0
  if (pid) return 'p' + pid
  const stamp = mgr && mgr.state && mgr.state.startedAt
  if (stamp) return 't' + stamp
  if (mgr && mgr.childAlive && mgr.childAlive()) return 'alive'
  if (positiveInt(mgr && mgr.launchThreads) || argValue(mgr && mgr.launchSpec && mgr.launchSpec.args, ['-threads', '--threads'])) return 'cfg'
  return ''
}

function adoptLaunchedThreads (gst, mgr) {
  const token = minerStartToken(mgr)
  const count = launchedThreadCount(mgr, gst)
  if (!token || !count) return
  const fresh = token !== gst.seenStart
  if (!fresh && gst.baseThreads === count) return
  gst.seenStart = token
  gst.baseThreads = count
  const fromArgs = argValue(mgr.launchSpec && mgr.launchSpec.args, ['-threads', '--threads'])
  const commanded = positiveInt(gst.commanded)
  if (commanded && fromArgs === commanded) gst.threads = fromArgs
  else gst.threads = fromArgs && fromArgs <= count ? fromArgs : count
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
  const shareAgeMs = gst && gst.lastShareAt ? now - gst.lastShareAt : null
  if (gst && gst.gaveUp) return { phase: 'gave-up', reason: gst.reason || '異常', shareAgeMs, gaveUp: true }
  if (gst && gst.paused) return { phase: 'paused', reason: gst.reason || '', shareAgeMs }
  if (gst && gst.halved) return { phase: 'yielding', reason: '', shareAgeMs, yielding: true }
  const alive = mgr.childAlive ? mgr.childAlive() : false
  if (mgr.wantRunning && !alive) return { phase: 'restarting', reason: '', shareAgeMs }
  if (mgr.wantRunning || mgr.guardHeld) return { phase: 'mining', reason: '', shareAgeMs }
  return { phase: 'stopped', reason: '', shareAgeMs: null }
}

function combine (parts) {
  if (!parts.length) return null
  const colour = dominantColour(parts.map(p => p.view.colour))
  const top = parts.find(p => p.view.colour === colour)
  const reason = top ? (top.view.reason || '') : ''
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
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') return { started: false, view: null, snapshot () { return null } }
  const states = new Map()
  let view = null
  let engaged = false
  let ticking = false
  let lastAff = 0
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
      const probe = deps.readSample ? await deps.readSample({ pids }) : { platform, skipped: true }
      if (!probe || probe.skipped) return
      let gpuTempC = null
      try { gpuTempC = deps.gpuTempC ? await deps.gpuTempC() : null } catch (e) { gpuTempC = null }
      const now = typeof deps.now === 'function' ? deps.now() : Date.now()
      const aliveAny = miners.some(m => { try { return m.mgr.childAlive && m.mgr.childAlive() } catch (e) { return false } })
      const hold = powerHold.flags(now, aliveAny)
      const plan = deps.threadPlan ? deps.threadPlan() : null
      if (deps.applyPriority && pids.length) {
        const low = intent.lowPriority !== false
        for (const id of pids) {
          try { deps.applyPriority(id, low) } catch (e) {}
        }
      }
      if (enabled && plan && !plan.pending && pids.length && now - lastAff >= 60000) {
        const canPin = deps.pinProcess && (plan.qos === 'utility' || (plan.affinity && plan.affinity.length))
        const canAff = plan.affinity && plan.affinity.length && deps.applyAffinity
        if (canPin || canAff) {
          lastAff = now
          if (canPin) {
            for (const id of pids) { try { deps.pinProcess(id, plan) } catch (e) {} }
          } else {
            try { await deps.applyAffinity(pids, plan.affinity) } catch (e) {}
          }
        }
      }
      const parts = []
      let note = ''
      for (const m of miners) {
        const mgr = m.mgr
        if (mgr.wantRunning || mgr.guardHeld) engaged = true
        let gst = states.get(m.id)
        if (!gst) {
          // The guard often starts with the wallet, before any miner exists.
          // A placeholder of 1 must not stick: the real count is read below
          // every time a child actually starts.
          gst = freshGuard({ enabled, mineOnBattery, baseThreads: 1, threads: 1, lastMemCheck: now, lastProgressAt: now })
          gst.seenStart = ''
          gst.commanded = null
        }
        gst.enabled = enabled
        gst.mineOnBattery = mineOnBattery
        adoptLaunchedThreads(gst, mgr)
        if (enabled && plan && !plan.pending) {
          const planThreads = positiveInt(plan.threads)
          if (planThreads && !gst.commanded && !minerStartToken(mgr) && gst.baseThreads !== planThreads) {
            gst.baseThreads = planThreads
            gst.threads = planThreads
          }
          if (planThreads && gst.baseThreads > planThreads) gst.baseThreads = planThreads
        }
        const pid = (mgr.childPids && mgr.childPids()[0]) || 0
        const proc = pid && probe.procs ? probe.procs[pid] : null
        const active = !!(mgr.wantRunning || mgr.guardHeld)
        const sample = {
          platform: probe.platform || platform,
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
          remoteSession: !!probe.remoteSession,
          virtualMachine: !!(probe.virtualMachine || (plan && plan.virtual)),
          networkDown: !!probe.networkDown,
          diskLow: !!probe.diskLow,
          unsuitable: !!(plan && plan.unsuitable),
          planSig: plan && !plan.pending ? (plan.threads + ':' + ((plan.affinity || []).join(','))) : '',
          manualPauseUntil: Number(intent.guardPauseUntil) || 0,
          suspended: !!hold.suspended,
          wakeHold: !!hold.wakeHold,
          childDiedInSleep: !!hold.childDiedInSleep,
          childAlive: mgr.childAlive ? !!mgr.childAlive() : false,
          shares: mgr.state ? mgr.state.sharesAccepted || 0 : 0,
          hashrate: mgr.state && mgr.state.hashrateSource !== 'pool' ? mgr.state.hashrate || 0 : 0,
          workingSet: proc ? proc.ws : null,
          handles: proc ? proc.handles : null
        }
        const out = stepGuard(gst, sample, now)
        for (const a of out.actions) {
          if (a.type === 'set-threads') out.state.commanded = a.threads
        }
        states.set(m.id, out.state)
        const text = await applyActions(mgr, out.actions)
        if (deps.applyPriority && (out.state.halved || out.state.memStage >= 1)) {
          const ids = mgr.childPids ? mgr.childPids() : []
          for (const id of ids) {
            try { deps.applyPriority(id, true) } catch (e) {}
          }
        }
        if (text) note = text
        const ph = phaseOf(mgr, out.state, now)
        parts.push({ mgr, gst: out.state, view: trayView(ph) })
      }
      if (engaged && parts.length) view = combine(parts)
      if (note && deps.note) { try { deps.note(note) } catch (e) {} }
      if (deps.onChange) { try { deps.onChange() } catch (e) {} }
    } finally { ticking = false }
  }
  let pending = null
  function runTick () {
    if (!pending) pending = tick().finally(() => { pending = null })
    return pending
  }
  const timer = deps.now ? null : setInterval(() => { runTick().catch(() => {}) }, TICK_MS)
  if (timer && timer.unref) timer.unref()
  runTick().catch(() => {})
  handle.tick = runTick
  handle.stop = () => { if (timer) clearInterval(timer) }
  return handle
}

module.exports = { start, applyActions, chainStatus, launchedThreadCount, TICK_MS }
