// Parsers for the miner guard. No process launches and no file reads.
'use strict'

function parseMeminfo (text) {
  const m = {}
  for (const line of String(text || '').split(/\n/)) {
    const hit = line.match(/^(\w+):\s+(\d+)/)
    if (hit) m[hit[1]] = Number(hit[2])
  }
  if (!(m.MemTotal > 0)) return { ramFreePct: null, commitPct: null }
  const avail = m.MemAvailable != null ? m.MemAvailable : m.MemFree
  const ramFreePct = avail != null ? (avail / m.MemTotal) * 100 : null
  let commitPct = null
  if (m.CommitLimit > 0 && m.Committed_AS != null) commitPct = (m.Committed_AS / m.CommitLimit) * 100
  return { ramFreePct, commitPct }
}

function parsePmset (text) {
  const lines = String(text || '').split(/\n/)
  const first = lines[0] || ''
  const onBattery = /Battery Power/i.test(first)
  const pct = String(text || '').match(/(\d+)%/)
  const batteryPct = pct ? Number(pct[1]) : null
  return {
    onBattery,
    batteryPct: batteryPct != null && batteryPct >= 0 && batteryPct <= 100 ? batteryPct : null
  }
}

function parsePowerSupply (status, capacity) {
  const st = String(status || '').trim().toLowerCase()
  const pct = Number(String(capacity == null ? '' : capacity).trim())
  return {
    onBattery: st === 'discharging',
    batteryPct: Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null
  }
}

function parseHidIdle (text) {
  const hit = String(text || '').match(/HIDIdleTime"\s*=\s*(\d+)/)
  if (!hit) return null
  const ns = Number(hit[1])
  if (!Number.isFinite(ns) || ns < 0) return null
  return Math.floor(ns / 1e6)
}

function parseDbusIdle (text) {
  const hit = String(text || '').match(/uint32\s+(\d+)/)
  if (!hit) return null
  const sec = Number(hit[1])
  if (!Number.isFinite(sec) || sec < 0) return null
  return sec * 1000
}

function parseFullscreen (text) {
  return /FULLSCREEN/i.test(String(text || ''))
}

function parseMacFullscreen (text) {
  return /^\s*true\s*$/im.test(String(text || ''))
}

function parseGpuTemp (text) {
  const line = String(text || '').split(/\r?\n/).map(s => s.trim()).find(s => s && s !== '[Not Supported]')
  if (!line) return null
  const n = parseInt(line, 10)
  return Number.isFinite(n) ? n : null
}

function parseMemoryPressure (text) {
  const hit = String(text || '').match(/free percentage:\s*(\d+(?:\.\d+)?)/i)
  if (!hit) return null
  const n = Number(hit[1])
  return Number.isFinite(n) ? n : null
}

// Kernel core_type 0 is performance and 1 is efficiency.
// CPUID hybrid type 0x20 is Atom and 0x40 is Core.
function coreTypeClass (value) {
  if (value == null || value === '') return 0
  const s = String(value).trim().toLowerCase()
  if (s === 'performance' || s === 'core' || s === 'p') return 1
  if (s === 'efficient' || s === 'efficiency' || s === 'atom' || s === 'e') return 0
  const n = Number(s)
  if (!Number.isFinite(n)) return 0
  if (n === 0x20) return 0
  if (n === 0x40) return 1
  if (n === 0) return 1
  if (n === 1) return 0
  return n
}

// One record per logical cpu. Higher efficiencyClass is the performance core.
// cpu_capacity wins when the values differ, because a larger capacity is the
// performance core on Linux. core_type is the fallback.
function groupsFromCpuList (cpus) {
  const byCore = new Map()
  for (const c of Array.isArray(cpus) ? cpus : []) {
    if (!c || c.id == null || !Number.isFinite(Number(c.id))) continue
    const coreKey = c.coreId == null ? ('id:' + c.id) : ('core:' + c.coreId)
    const key = (c.packageId == null ? '' : String(c.packageId) + ':') + coreKey
    let g = byCore.get(key)
    if (!g) {
      g = { logical: [], coreType: null, capacity: null }
      byCore.set(key, g)
    }
    g.logical.push(Number(c.id))
    if (c.coreType != null && String(c.coreType).trim() !== '') g.coreType = c.coreType
    if (c.capacity != null && Number.isFinite(Number(c.capacity))) g.capacity = Number(c.capacity)
  }
  const groups = [...byCore.values()]
  const caps = groups.map(g => g.capacity).filter(v => v != null)
  const capSpan = caps.length > 1 && Math.max.apply(null, caps) > Math.min.apply(null, caps)
  return groups.map(g => ({
    efficiencyClass: capSpan ? g.capacity : coreTypeClass(g.coreType),
    logical: g.logical
  }))
}

module.exports = {
  parseMeminfo,
  parsePmset,
  parsePowerSupply,
  parseHidIdle,
  parseDbusIdle,
  parseFullscreen,
  parseMacFullscreen,
  parseGpuTemp,
  parseMemoryPressure,
  coreTypeClass,
  groupsFromCpuList
}
