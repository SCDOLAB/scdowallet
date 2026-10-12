// Desktop probes for the miner guard.
// Windows reads performance and efficient cores and binds the miner to the performance cores.
// Mac, Apple silicon and other non-hybrid processors use physical cores minus one,
// and leave at least two logical cores unused. Linux uses the same rule, and binds
// affinity when the kernel exposes a hybrid layout.
'use strict'
const os = require('os')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const guardWin = require('./guardWin')
const { applyPriority } = require('./priority')
const { classifyCores, threadPlan, pendingPlan, fallbackPlan, DISK_MIN_BYTES } = require('./guardPlan')
const probe = require('./hostProbe')

let unixPlan = null
let readyPromise = null
let prevCpu = null

function execText (cmd, args, ms) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: ms || 2000, windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 20 }, (err, stdout) => {
      resolve(String(stdout || ''))
    })
  })
}

function cpuPercentNow () {
  const cpus = os.cpus() || []
  let idle = 0
  let total = 0
  for (const c of cpus) {
    const t = c.times || {}
    const oneIdle = t.idle || 0
    idle += oneIdle
    total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + oneIdle + (t.irq || 0)
  }
  if (!prevCpu) { prevCpu = { idle, total }; return null }
  const idleD = idle - prevCpu.idle
  const totalD = total - prevCpu.total
  prevCpu = { idle, total }
  if (!(totalD > 0)) return null
  return Math.max(0, Math.min(100, ((totalD - idleD) / totalD) * 100))
}

function readNumFile (file) {
  try {
    const n = Number(String(fs.readFileSync(file, 'utf8')).trim())
    return Number.isFinite(n) ? n : null
  } catch (e) { return null }
}

function readTextFile (file) {
  try { return String(fs.readFileSync(file, 'utf8')).trim() } catch (e) { return '' }
}

function readLinuxGroups () {
  const base = '/sys/devices/system/cpu'
  let dirs = []
  try { dirs = fs.readdirSync(base).filter(n => /^cpu\d+$/.test(n)) } catch (e) { return [] }
  const records = []
  for (const dir of dirs) {
    const id = Number(dir.slice(3))
    const root = path.join(base, dir, 'topology')
    records.push({
      id,
      coreId: readNumFile(path.join(root, 'core_id')),
      packageId: readNumFile(path.join(root, 'physical_package_id')),
      coreType: readTextFile(path.join(root, 'core_type')),
      capacity: readNumFile(path.join(base, dir, 'cpu_capacity'))
    })
  }
  return probe.groupsFromCpuList(records)
}

function readLinuxPower () {
  const base = '/sys/class/power_supply'
  let names = []
  try { names = fs.readdirSync(base) } catch (e) { return { onBattery: false, batteryPct: null } }
  let saw = false
  let onBattery = false
  let batteryPct = null
  for (const name of names) {
    if (!/^BAT/i.test(name)) continue
    saw = true
    const one = probe.parsePowerSupply(readTextFile(path.join(base, name, 'status')), readTextFile(path.join(base, name, 'capacity')))
    if (one.onBattery) onBattery = true
    if (one.batteryPct != null) batteryPct = one.batteryPct
  }
  if (!saw) return { onBattery: false, batteryPct: null }
  return { onBattery, batteryPct }
}

function linuxProc (pid) {
  try {
    const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8')
    const rss = status.match(/VmRSS:\s+(\d+)/)
    let handles = 0
    try { handles = fs.readdirSync('/proc/' + pid + '/fd').length } catch (e) { handles = 0 }
    return { ws: rss ? Number(rss[1]) * 1024 : 0, handles }
  } catch (e) { return null }
}

async function linuxFullscreen () {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false
  const active = await execText('xprop', ['-root', '_NET_ACTIVE_WINDOW'], 1500)
  const id = (String(active).match(/0x[0-9a-fA-F]+/) || [])[0]
  if (!id || id === '0x0') return false
  const state = await execText('xprop', ['-id', id, '_NET_WM_STATE'], 1500)
  return probe.parseFullscreen(state)
}

function diskLow (dir) {
  try {
    if (typeof fs.statfsSync !== 'function') return false
    const st = fs.statfsSync(dir || os.homedir())
    return st.bavail * st.bsize < DISK_MIN_BYTES
  } catch (e) { return false }
}

function networkDown () {
  const all = os.networkInterfaces() || {}
  for (const list of Object.values(all)) {
    for (const one of list || []) {
      if (!one || one.internal) continue
      if (one.family === 'IPv4' || one.family === 4) return false
    }
  }
  return true
}

function macA11y () {
  if (process.platform !== 'darwin') return false
  try {
    const electron = require('electron')
    const prefs = electron && electron.systemPreferences
    if (prefs && typeof prefs.isTrustedAccessibilityClient === 'function') return prefs.isTrustedAccessibilityClient(false) === true
  } catch (e) {}
  return false
}

async function loadUnixTopology () {
  const logical = Math.max(1, (os.cpus() || []).length || 1)
  if (process.platform === 'darwin') {
    const perfText = await execText('sysctl', ['-n', 'hw.perflevel0.physicalcpu'], 2000)
    const physText = await execText('sysctl', ['-n', 'hw.physicalcpu'], 2000)
    const virtText = await execText('sysctl', ['-n', 'kern.hv_vmm_present'], 2000)
    const perf = parseInt(String(perfText).trim(), 10)
    const physical = parseInt(String(physText).trim(), 10)
    const virtual = String(virtText).trim() === '1'
    if (Number.isFinite(perf) && perf > 0) {
      unixPlan = threadPlan({ physicalPCores: perf, logical, hybrid: false, qos: 'utility', vendor: 'apple-silicon', virtual })
    } else if (Number.isFinite(physical) && physical > 0) {
      unixPlan = threadPlan({ physicalPCores: physical, logical, hybrid: false, vendor: 'apple-intel', virtual })
    } else unixPlan = fallbackPlan(logical)
    return unixPlan
  }
  if (process.platform === 'linux') {
    const groups = readLinuxGroups()
    if (!groups.length) {
      unixPlan = fallbackPlan(logical)
      return unixPlan
    }
    const info = classifyCores(groups)
    const logicalIds = []
    for (const g of groups) for (const id of g.logical || []) logicalIds.push(id)
    let vendor = ''
    try { vendor = probe.parseVendor(fs.readFileSync('/proc/cpuinfo', 'utf8')) } catch (e) { vendor = '' }
    unixPlan = threadPlan({
      physicalPCores: info.physicalPCores || groups.length,
      logical: logicalIds.length || logical,
      hybrid: info.hybrid,
      pLogical: info.pLogical,
      logicalIds: logicalIds.length ? logicalIds : undefined,
      vendor
    })
    return unixPlan
  }
  unixPlan = threadPlan({ physicalPCores: logical, logical, hybrid: false })
  return unixPlan
}

function threadPlanCached () {
  if (process.platform === 'win32') return guardWin.threadPlanCached()
  if (unixPlan) return unixPlan
  return pendingPlan()
}

function ready () {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (process.platform === 'win32') {
        await guardWin.readSample({ pids: [] })
        guardWin.markProbed()
      } else if (process.platform === 'darwin' || process.platform === 'linux') {
        await loadUnixTopology()
      }
      return threadPlanCached()
    })().catch(err => {
      readyPromise = null
      throw err
    })
  }
  return readyPromise
}

function warm () { ready().catch(() => {}) }

async function readUnix (opts) {
  const platform = process.platform
  const pids = ((opts && opts.pids) || []).map(n => Math.floor(Number(n))).filter(n => n > 0 && n < 1e9)
  const sample = {
    platform,
    skipped: false,
    inputAgeMs: null,
    cpuPct: null,
    fullscreen: false,
    onBattery: false,
    batteryPct: null,
    ramFreePct: null,
    commitPct: null,
    procs: {}
  }
  if (platform === 'darwin') {
    const [idleText, battText, pressText] = await Promise.all([
      execText('ioreg', ['-c', 'IOHIDSystem'], 2500),
      execText('pmset', ['-g', 'batt'], 2000),
      execText('memory_pressure', [], 2000)
    ])
    sample.inputAgeMs = probe.parseHidIdle(idleText)
    const batt = probe.parsePmset(battText)
    sample.onBattery = batt.onBattery
    sample.batteryPct = batt.batteryPct
    const pressed = probe.parseMemoryPressure(pressText)
    const total = os.totalmem()
    sample.ramFreePct = pressed != null ? pressed : (total > 0 ? (os.freemem() / total) * 100 : null)
    let full = probe.parsePmsetAssertions(await execText('pmset', ['-g', 'assertions'], 2000))
    if (!full && macA11y()) {
      const script = 'tell application "System Events" to get value of attribute "AXFullScreen" of windows of (first application process whose frontmost is true)'
      full = probe.parseMacFullscreen(await execText('osascript', ['-e', script], 2000))
    }
    sample.fullscreen = full
    try {
      const virt = await execText('sysctl', ['-n', 'kern.hv_vmm_present'], 1500)
      sample.virtualMachine = String(virt).trim() === '1'
    } catch (e) { sample.virtualMachine = false }
    if (pids.length) {
      const args = ['-o', 'pid=,rss=']
      for (const pid of pids) args.push('-p', String(pid))
      const text = await execText('ps', args, 2000)
      for (const line of String(text).split(/\n/)) {
        const bits = line.trim().split(/\s+/)
        if (bits.length >= 2) {
          const pid = Number(bits[0])
          const rss = Number(bits[1])
          if (pid && Number.isFinite(rss)) sample.procs[pid] = { ws: rss * 1024, handles: 0 }
        }
      }
    }
    return sample
  }
  try {
    const mem = probe.parseMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'))
    sample.ramFreePct = mem.ramFreePct
    sample.commitPct = mem.commitPct
  } catch (e) {}
  const power = readLinuxPower()
  sample.onBattery = power.onBattery
  sample.batteryPct = power.batteryPct
  sample.inputAgeMs = probe.parseDbusIdle(await execText('dbus-send', ['--print-reply', '--dest=org.freedesktop.ScreenSaver', '/org/freedesktop/ScreenSaver', 'org.freedesktop.ScreenSaver.GetSessionIdleTime'], 1500))
  try { sample.fullscreen = await linuxFullscreen() } catch (e) { sample.fullscreen = false }
  let virtBlob = ''
  virtBlob += readTextFile('/sys/class/dmi/id/sys_vendor') + ' ' + readTextFile('/sys/class/dmi/id/product_name')
  try { virtBlob += ' ' + fs.readFileSync('/proc/cpuinfo', 'utf8') } catch (e) {}
  sample.virtualMachine = probe.parseVirtBlob(virtBlob)
  sample.remoteSession = !!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.XRDP_SESSION)
  try { sample.networkDown = probe.parseProcRoute(fs.readFileSync('/proc/net/route', 'utf8')) } catch (e) { sample.networkDown = networkDown() }
  for (const pid of pids) {
    const row = linuxProc(pid)
    if (row) sample.procs[pid] = row
  }
  return sample
}

async function readSample (opts) {
  const platform = process.platform
  let sample
  if (platform === 'win32') sample = await guardWin.readSample(opts)
  else if (platform === 'darwin' || platform === 'linux') sample = await readUnix(opts)
  else return { platform, skipped: true }
  if (sample && !sample.skipped) {
    sample.cpuPct = cpuPercentNow()
    if (sample.diskLow == null) sample.diskLow = diskLow(os.homedir())
    if (sample.networkDown == null) sample.networkDown = networkDown()
    if (sample.remoteSession == null) sample.remoteSession = probe.parseRemoteSession(process.env.SESSIONNAME)
  }
  return sample
}

function pinProcess (pid, plan) {
  const id = Math.floor(Number(pid))
  if (!id || !plan || plan.pending) return Promise.resolve(false)
  const jobs = []
  if (plan.affinity && plan.affinity.length) jobs.push(applyAffinity(id, plan.affinity))
  if (plan.qos === 'utility' && process.platform === 'darwin') {
    jobs.push(new Promise(resolve => {
      execFile('taskpolicy', ['-c', 'utility', '-p', String(id)], { timeout: 2000, windowsHide: true }, err => resolve(!err))
    }))
  }
  if (!jobs.length) return Promise.resolve(false)
  return Promise.all(jobs).then(list => list.some(Boolean), () => false)
}

function gpuTempC () {
  return new Promise(resolve => {
    execFile('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err && !stdout) return resolve(null)
      resolve(probe.parseGpuTemp(stdout))
    })
  })
}

function applyAffinity (pid, logicalIds) {
  const pids = (Array.isArray(pid) ? pid : [pid]).map(n => Math.floor(Number(n))).filter(n => n > 0 && n < 1e9)
  const ids = (logicalIds || []).map(n => Math.floor(Number(n))).filter(n => n >= 0)
  if (!pids.length || !ids.length) return Promise.resolve(false)
  if (process.platform === 'win32') return guardWin.applyAffinity(pids, ids)
  if (process.platform !== 'linux') return Promise.resolve(false)
  return Promise.all(pids.map(one => new Promise(resolve => {
    execFile('taskset', ['-pc', ids.join(','), String(one)], { timeout: 2000, windowsHide: true }, err => resolve(!err))
  }))).then(list => list.some(Boolean), () => false)
}

module.exports = {
  ready,
  warm,
  readSample,
  threadPlanCached,
  gpuTempC,
  applyAffinity,
  applyPriority,
  pinProcess,
  loadUnixTopology
}
