// AI kitten ops agent: self-heal decisions. Pure: no OS calls; agentService applies the actions.
// Covers the 2026-10-12 incidents:
//  - a duplicate Rigel holding 127.0.0.1:5055 -> 3 quick exits -> give-up (SCDO-4060)
//  - mining state lost after a reboot (ThinkPad)
//  - node on 0 peers stuck on "waiting for sync"
// plus a stuck miner (0 H/s while it should mine) and GPU overheat throttling.
'use strict'

const MIN = 60 * 1000
const RIGEL_API_PORT = 5055
const NO_PEERS_MS = 2 * MIN
const SYNC_STALL_MS = 10 * MIN
const ZERO_HASH_MS = 10 * MIN
const RESUME_GRACE_MS = 90 * 1000
const TEMP_THROTTLE = 85
const TEMP_PAUSE = 90
const TEMP_CLEAR = 80
const TEMP_CLEAR_MS = 5 * MIN
const COOLDOWN_MS = { 'free-port': 2 * MIN, 'restart-miner': 5 * MIN, 'reconnect-peers': 3 * MIN, 'resume-mining': 5 * MIN, throttle: 2 * MIN, 'pause-gpu': 2 * MIN, unthrottle: 2 * MIN }
const HOURLY_CAP = 6

function newMemo () { return { noPeersSince: null, lastHead: null, headAt: null, zeroHashSince: null, coolSince: null, throttled: false, last: {}, history: {} } }

function num (v) { const n = Number(v); return Number.isFinite(n) ? n : null }

// s: snapshot (see agentService.snapshot). memo: mutable state from newMemo(). Returns { actions, problems }.
function evaluate (s, memo, now) {
  now = now || Date.now()
  s = s || {}
  const problems = []
  const want = []
  const wantMining = !!s.wantMining
  const peers = num(s.peers)
  const head = num(s.localBlock)
  const net = num(s.networkBlock)
  const hr = num(s.hashrate)
  const temp = num(s.gpuTempC)
  const others = Array.isArray(s.otherRigels) ? s.otherRigels.filter(p => p && Number.isInteger(p.pid)) : []

  // 1. Duplicate Rigel on the API port (also the usual cause of give-up).
  if (wantMining && others.length && (s.portOwnerPid == null || others.some(p => p.pid === s.portOwnerPid) || s.gaveUp || s.quickExits >= 1)) {
    problems.push({ code: 'PORT_BUSY', detail: 'another Rigel holds port ' + RIGEL_API_PORT, pids: others.map(p => p.pid) })
    want.push({ type: 'free-port', port: RIGEL_API_PORT, pids: others.map(p => p.pid), reason: 'duplicate Rigel on ' + RIGEL_API_PORT })
    want.push({ type: 'restart-miner', reason: s.gaveUp ? 'clear give-up after freeing the port' : 'restart after freeing the port' })
  } else if (wantMining && s.gaveUp) {
    problems.push({ code: 'GAVE_UP', detail: 'miner guard gave up' })
  }

  // 2. Keep mining was armed but mining did not come back after a reboot / crash.
  if (s.armedResume && !s.running && num(s.uptimeMs) != null && s.uptimeMs >= RESUME_GRACE_MS) {
    problems.push({ code: 'RESUME_LOST', detail: 'Keep mining is on but mining is not running after restart' })
    want.push({ type: 'resume-mining', chains: Array.isArray(s.resumeChains) ? s.resumeChains : [], reason: 'restore mining state after restart' })
  }

  // 3. Node on 0 peers, or sync not moving.
  if (s.nodeRunning) {
    if (peers === 0) { if (!memo.noPeersSince) memo.noPeersSince = now } else memo.noPeersSince = null
    if (head != null && (memo.lastHead == null || head > memo.lastHead)) { memo.lastHead = head; memo.headAt = now }
    const behind = net != null && head != null && head < net - 3
    const stalled = behind && memo.headAt && now - memo.headAt >= SYNC_STALL_MS
    if (memo.noPeersSince && now - memo.noPeersSince >= NO_PEERS_MS) {
      problems.push({ code: 'NO_PEERS', detail: '0 peers, waiting for sync' })
      want.push({ type: 'reconnect-peers', reason: 'no peers' })
    } else if (stalled) {
      problems.push({ code: 'SYNC_STALLED', detail: 'local ' + head + ' / network ' + net })
      want.push({ type: 'reconnect-peers', reason: 'sync stalled' })
    }
  } else { memo.noPeersSince = null }

  // 4. Miner process up but 0 H/s for too long (stuck Rigel).
  const shouldHash = wantMining && s.running && !s.paused && (s.code === 'MINING' || s.code === 'MINING_STARTING')
  if (shouldHash && !(hr > 0)) { if (!memo.zeroHashSince) memo.zeroHashSince = now } else memo.zeroHashSince = null
  if (memo.zeroHashSince && now - memo.zeroHashSince >= ZERO_HASH_MS) {
    problems.push({ code: 'MINER_STUCK', detail: '0 H/s for ' + Math.round((now - memo.zeroHashSince) / MIN) + ' min' })
    want.push({ type: 'restart-miner', reason: 'stuck at 0 H/s' })
  }

  // 5. GPU temperature.
  if (temp != null) {
    if (temp >= TEMP_PAUSE) {
      problems.push({ code: 'GPU_HOT', detail: temp + ' °C' })
      want.push({ type: 'pause-gpu', tempC: temp, reason: 'GPU ≥ ' + TEMP_PAUSE + ' °C' })
      memo.coolSince = null
    } else if (temp >= TEMP_THROTTLE) {
      problems.push({ code: 'GPU_WARM', detail: temp + ' °C' })
      if (!memo.throttled) want.push({ type: 'throttle', tempC: temp, reason: 'GPU ≥ ' + TEMP_THROTTLE + ' °C' })
      memo.coolSince = null
    } else if (memo.throttled && temp <= TEMP_CLEAR) {
      if (!memo.coolSince) memo.coolSince = now
      if (now - memo.coolSince >= TEMP_CLEAR_MS) want.push({ type: 'unthrottle', tempC: temp, reason: 'GPU back under ' + TEMP_CLEAR + ' °C' })
    }
  }

  // Cooldowns, hourly cap, and de-duplication.
  const actions = []
  const seen = {}
  for (const a of want) {
    if (seen[a.type]) continue
    seen[a.type] = true
    const hist = (memo.history[a.type] || []).filter(t => now - t < 60 * MIN)
    memo.history[a.type] = hist
    if (memo.last[a.type] && now - memo.last[a.type] < (COOLDOWN_MS[a.type] || 5 * MIN)) continue
    if (hist.length >= HOURLY_CAP) { actions.push({ type: 'report', about: a.type, reason: 'hourly self-heal limit reached; needs a human' }); continue }
    memo.last[a.type] = now
    hist.push(now)
    if (a.type === 'throttle' || a.type === 'pause-gpu') memo.throttled = true
    if (a.type === 'unthrottle') { memo.throttled = false; memo.coolSince = null }
    actions.push(a)
  }
  return { actions, problems }
}

module.exports = { evaluate, newMemo, RIGEL_API_PORT, NO_PEERS_MS, SYNC_STALL_MS, ZERO_HASH_MS, RESUME_GRACE_MS, TEMP_THROTTLE, TEMP_PAUSE, TEMP_CLEAR, TEMP_CLEAR_MS, COOLDOWN_MS, HOURLY_CAP }
