// Windows probes for the miner guard. Other systems return immediately and spawn nothing.
'use strict'
const os = require('os')
const { spawn, execFile } = require('child_process')
const { classifyCores, threadPlan } = require('./guardPlan')

const PROBE_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ScdoGuardProbe {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetLogicalProcessorInformationEx(int rel, IntPtr buf, ref uint len);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTIN lii);
  [DllImport("kernel32.dll")] static extern ulong GetTickCount64();
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(ref POWER p);
  [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEM m);
  [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
  [StructLayout(LayoutKind.Sequential)] public struct LASTIN { public uint cb; public uint time; }
  [StructLayout(LayoutKind.Sequential)] public struct POWER {
    public byte ac; public byte flag; public byte pct; public byte status; public int life; public int full;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MEM {
    public uint len; public uint load; public ulong totalPhys; public ulong availPhys;
    public ulong totalPage; public ulong availPage; public ulong totalVirt; public ulong availVirt; public ulong ext;
  }
  public static string Cores() {
    uint len = 0;
    GetLogicalProcessorInformationEx(0, IntPtr.Zero, ref len);
    if (len == 0) return "";
    IntPtr buf = Marshal.AllocHGlobal((int)len);
    try {
      if (!GetLogicalProcessorInformationEx(0, buf, ref len)) return "";
      var sb = new StringBuilder();
      int offset = 0; int total = (int)len;
      while (offset + 8 <= total) {
        int rel = Marshal.ReadInt32(buf, offset);
        int size = Marshal.ReadInt32(buf, offset + 4);
        if (size < 8 || offset + size > total) break;
        if (rel == 0 && size >= 32) {
          byte eff = Marshal.ReadByte(buf, offset + 9);
          int groups = Marshal.ReadInt16(buf, offset + 30);
          if (groups < 0) groups = 0;
          var ids = new StringBuilder();
          int gm = offset + 32;
          for (int g = 0; g < groups && gm + 16 <= offset + size; g++) {
            long mask = Marshal.ReadInt64(buf, gm);
            int group = Marshal.ReadInt16(buf, gm + 8);
            if (group < 0) group = 0;
            for (int b = 0; b < 64; b++) if ((mask & (1L << b)) != 0) { if (ids.Length > 0) ids.Append(','); ids.Append(group * 64 + b); }
            gm += 16;
          }
          sb.Append((int)eff); sb.Append(':'); sb.Append(ids); sb.Append(';');
        }
        offset += size;
      }
      return sb.ToString();
    } finally { Marshal.FreeHGlobal(buf); }
  }
  public static long InputAge() {
    LASTIN lii = new LASTIN(); lii.cb = 8;
    if (!GetLastInputInfo(ref lii)) return -1;
    ulong now = GetTickCount64();
    uint wrapped = unchecked((uint)now);
    uint delta = wrapped - lii.time;
    return (long)delta;
  }
  public static int NoteState() { int s = 0; SHQueryUserNotificationState(out s); return s; }
  public static string Power() {
    POWER p = new POWER();
    if (!GetSystemPowerStatus(ref p)) return "0,-1";
    return p.ac + "," + (int)p.pct;
  }
  public static string Mem() {
    MEM m = new MEM(); m.len = (uint)Marshal.SizeOf(typeof(MEM));
    if (!GlobalMemoryStatusEx(ref m)) return "";
    return m.totalPhys + "," + m.availPhys + "," + m.totalPage + "," + m.availPage;
  }
  public static string Times() {
    long i, k, u;
    if (!GetSystemTimes(out i, out k, out u)) return "";
    return i + "," + k + "," + u;
  }
}
"@
$cores = [ScdoGuardProbe]::Cores()
$age = [ScdoGuardProbe]::InputAge()
$note = [ScdoGuardProbe]::NoteState()
$power = [ScdoGuardProbe]::Power()
$mem = [ScdoGuardProbe]::Mem()
$times = [ScdoGuardProbe]::Times()
$procs = @()
foreach ($procId in @($pids)) {
  if ($procId -le 0) { continue }
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p) { $procs += @{ pid = [int]$procId; ws = [int64]$p.WorkingSet64; handles = [int]$p.HandleCount } }
}
@{ cores = $cores; age = $age; note = $note; power = $power; mem = $mem; times = $times; procs = $procs } | ConvertTo-Json -Compress
`

let topo = null
let prevCpu = null

function supported () { return process.platform === 'win32' }

function runPS (script) {
  return new Promise(resolve => {
    let ps
    try {
      ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true })
    } catch (e) { resolve(''); return }
    let out = ''
    let done = false
    const finish = (text) => { if (done) return; done = true; clearTimeout(timer); resolve(text || '') }
    const timer = setTimeout(() => { try { ps.kill() } catch (e) {} finish('') }, 8000)
    ps.stdout.on('data', d => { out += d.toString() })
    ps.on('error', () => finish(''))
    ps.on('close', () => finish(out))
    try { ps.stdin.write(script); ps.stdin.end() } catch (e) { finish('') }
  })
}

function parseCores (text) {
  const groups = []
  for (const part of String(text || '').split(';')) {
    if (!part) continue
    const bits = part.split(':')
    const logical = String(bits[1] || '').split(',').filter(Boolean).map(Number).filter(n => Number.isFinite(n))
    const efficiencyClass = Number(bits[0])
    if (!Number.isFinite(efficiencyClass)) continue
    groups.push({ efficiencyClass, logical })
  }
  return groups
}

function cpuPercent (idle, kernel, user) {
  if (![idle, kernel, user].every(n => Number.isFinite(n))) return null
  if (!prevCpu) { prevCpu = { idle, kernel, user }; return null }
  const idleD = idle - prevCpu.idle
  const kernelD = kernel - prevCpu.kernel
  const userD = user - prevCpu.user
  prevCpu = { idle, kernel, user }
  const total = kernelD + userD
  if (!(total > 0)) return null
  const busy = (kernelD - idleD) + userD
  return Math.max(0, Math.min(100, (busy / total) * 100))
}

function safeSample (extra) {
  return Object.assign({
    platform: 'win32',
    skipped: false,
    inputAgeMs: null,
    cpuPct: null,
    fullscreen: false,
    onBattery: false,
    batteryPct: null,
    ramFreePct: null,
    commitPct: null,
    procs: {}
  }, extra || {})
}

async function readSampleWin (opts) {
  const pids = ((opts && opts.pids) || []).map(n => Math.floor(Number(n))).filter(n => n > 0 && n < 1e9)
  const script = PROBE_PS.replace('@($pids)', '@(' + pids.join(',') + ')')
  let body = ''
  try { body = await runPS(script) } catch (e) { body = '' }
  let json = null
  try { json = JSON.parse(String(body).trim()) } catch (e) { json = null }
  if (!json || typeof json !== 'object') return safeSample()
  if (!topo) {
    const groups = parseCores(json.cores)
    if (groups.length) topo = groups
  }
  const age = Number(json.age)
  const note = Number(json.note)
  const power = String(json.power || '').split(',')
  const ac = Number(power[0])
  const pct = Number(power[1])
  const mem = String(json.mem || '').split(',').map(Number)
  const times = String(json.times || '').split(',').map(Number)
  let ramFreePct = null
  let commitPct = null
  if (mem.length >= 4 && mem[0] > 0 && mem[2] > 0) {
    ramFreePct = (mem[1] / mem[0]) * 100
    commitPct = ((mem[2] - mem[3]) / mem[2]) * 100
  }
  const procs = {}
  const list = Array.isArray(json.procs) ? json.procs : (json.procs ? [json.procs] : [])
  for (const p of list) {
    if (p && p.pid) procs[p.pid] = { ws: Number(p.ws) || 0, handles: Number(p.handles) || 0 }
  }
  return safeSample({
    inputAgeMs: Number.isFinite(age) && age >= 0 ? age : null,
    cpuPct: cpuPercent(times[0], times[1], times[2]),
    fullscreen: note === 2 || note === 3,
    onBattery: ac === 0,
    batteryPct: pct >= 0 && pct <= 100 ? pct : null,
    ramFreePct,
    commitPct,
    procs
  })
}

function readSample (opts) {
  if (process.platform !== 'win32') return Promise.resolve({ platform: process.platform, skipped: true })
  return readSampleWin(opts)
}

function threadPlanCached () {
  if (process.platform !== 'win32') return null
  const logical = Math.max(1, (os.cpus() || []).length || 1)
  if (!topo || !topo.length) {
    return threadPlan({ physicalPCores: 0, logical, hybrid: false })
  }
  const info = classifyCores(topo)
  const logicalIds = []
  for (const g of topo) for (const id of g.logical || []) logicalIds.push(id)
  return threadPlan({
    physicalPCores: info.physicalPCores,
    logical: logicalIds.length || logical,
    hybrid: info.hybrid,
    pLogical: info.pLogical,
    logicalIds: logicalIds.length ? logicalIds : undefined
  })
}

function gpuTempC () {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise(resolve => {
    execFile('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const n = parseInt(String(stdout || '').split(/\r?\n/)[0], 10)
      resolve(Number.isFinite(n) ? n : null)
    })
  })
}

function applyAffinity (pid, logicalIds) {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const id = Math.floor(Number(pid))
  const ids = (logicalIds || []).map(n => Math.floor(Number(n))).filter(n => n >= 0 && n < 64)
  if (!id || !ids.length || ids.length !== (logicalIds || []).length) return Promise.resolve(false)
  let mask = 0n
  for (const bit of ids) mask |= 1n << BigInt(bit)
  const script = '$p = Get-Process -Id ' + id + ' -ErrorAction SilentlyContinue; if ($p) { $p.ProcessorAffinity = [IntPtr]::new([uint64]' + mask.toString() + ') }'
  return runPS(script).then(() => true, () => false)
}

module.exports = { supported, readSample, threadPlanCached, gpuTempC, applyAffinity, parseCores }
