// Windows probes for the miner guard. Other systems return immediately and spawn nothing.
// The core list is read once. Until that read finishes, no affinity mask is applied:
// a mask built from "all logical cores minus two" includes Intel efficient cores,
// and those cores are what froze SCDO-5060TI.
'use strict'
const os = require('os')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { classifyCores, threadPlan, pendingPlan, fallbackPlan } = require('./guardPlan')
const hostProbe = require('./hostProbe')

const PROBE_PS1 = [
  "$ErrorActionPreference = 'Continue'",
  'Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Text;',
  'using System.Runtime.InteropServices;',
  'public class ScdoGuardProbe {',
  '  [DllImport("kernel32.dll", SetLastError=true)]',
  '  static extern bool GetLogicalProcessorInformationEx(int rel, IntPtr buf, ref uint len);',
  '  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTIN lii);',
  '  [DllImport("kernel32.dll")] static extern ulong GetTickCount64();',
  '  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);',
  '  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(ref POWER p);',
  '  [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEM m);',
  '  [StructLayout(LayoutKind.Sequential)] public struct LASTIN { public uint cb; public uint time; }',
  '  [StructLayout(LayoutKind.Sequential)] public struct POWER {',
  '    public byte ac; public byte flag; public byte pct; public byte status; public int life; public int full;',
  '  }',
  '  [StructLayout(LayoutKind.Sequential)] public struct MEM {',
  '    public uint len; public uint load; public ulong totalPhys; public ulong availPhys;',
  '    public ulong totalPage; public ulong availPage; public ulong totalVirt; public ulong availVirt; public ulong ext;',
  '  }',
  '  public static string Cores() {',
  '    uint len = 0;',
  '    GetLogicalProcessorInformationEx(0, IntPtr.Zero, ref len);',
  '    if (len == 0) return "";',
  '    IntPtr buf = Marshal.AllocHGlobal((int)len);',
  '    try {',
  '      if (!GetLogicalProcessorInformationEx(0, buf, ref len)) return "";',
  '      var sb = new StringBuilder();',
  '      int offset = 0; int total = (int)len;',
  '      while (offset + 8 <= total) {',
  '        int rel = Marshal.ReadInt32(buf, offset);',
  '        int size = Marshal.ReadInt32(buf, offset + 4);',
  '        if (size < 8 || offset + size > total) break;',
  '        if (rel == 0 && size >= 32) {',
  '          byte eff = Marshal.ReadByte(buf, offset + 9);',
  '          int groups = Marshal.ReadInt16(buf, offset + 30);',
  '          if (groups < 0) groups = 0;',
  '          var ids = new StringBuilder();',
  '          int gm = offset + 32;',
  '          for (int g = 0; g < groups && gm + 16 <= offset + size; g++) {',
  '            long mask = Marshal.ReadInt64(buf, gm);',
  '            int group = Marshal.ReadInt16(buf, gm + 8);',
  '            if (group < 0) group = 0;',
  '            for (int b = 0; b < 64; b++) if ((mask & (1L << b)) != 0) { if (ids.Length > 0) ids.Append(\',\'); ids.Append(group * 64 + b); }',
  '            gm += 16;',
  '          }',
  '          sb.Append((int)eff); sb.Append(\':\'); sb.Append(ids); sb.Append(\';\');',
  '        }',
  '        offset += size;',
  '      }',
  '      return sb.ToString();',
  '    } finally { Marshal.FreeHGlobal(buf); }',
  '  }',
  '  public static long InputAge() {',
  '    LASTIN lii = new LASTIN(); lii.cb = 8;',
  '    if (!GetLastInputInfo(ref lii)) return -1;',
  '    ulong now = GetTickCount64();',
  '    uint wrapped = unchecked((uint)now);',
  '    uint delta = wrapped - lii.time;',
  '    return (long)delta;',
  '  }',
  '  public static int NoteState() { int s = 0; SHQueryUserNotificationState(out s); return s; }',
  '  public static string Power() {',
  '    POWER p = new POWER();',
  '    if (!GetSystemPowerStatus(ref p)) return "0,-1";',
  '    return p.ac + "," + (int)p.pct;',
  '  }',
  '  public static string Mem() {',
  '    MEM m = new MEM(); m.len = (uint)Marshal.SizeOf(typeof(MEM));',
  '    if (!GlobalMemoryStatusEx(ref m)) return "";',
  '    return m.totalPhys + "," + m.availPhys + "," + m.totalPage + "," + m.availPage;',
  '  }',
  '}',
  '"@',
  'function Emit([string]$s) { [Console]::Out.WriteLine(\'SCDO \' + $s); [Console]::Out.Flush() }',
  'Emit \'READY\'',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  '  if ($line -eq \'QUIT\') { break }',
  '  try {',
  '    if ($line.StartsWith(\'SAMPLE\')) {',
  '      $rest = $line.Substring(6).Trim()',
  '      $procs = @()',
  '      if ($rest) {',
  '        foreach ($procId in ($rest -split \',\')) {',
  '          $n = 0; if (-not [int]::TryParse($procId, [ref]$n)) { continue }',
  '          if ($n -le 0) { continue }',
  '          $p = Get-Process -Id $n -ErrorAction SilentlyContinue',
  '          if ($p) { $procs += @{ pid = [int]$n; ws = [int64]$p.WorkingSet64; handles = [int]$p.HandleCount } }',
  '        }',
  '      }',
  '      if (-not $script:VendorName) {',
  '        try { $script:VendorName = [string](Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1 -ExpandProperty Manufacturer) } catch { $script:VendorName = \'\' }',
  '      }',
  '      $remote = $false',
  '      $sess = [Environment]::GetEnvironmentVariable(\'SESSIONNAME\')',
  '      if ($sess -and $sess.ToUpperInvariant().StartsWith(\'RDP\')) { $remote = $true }',
  '      $virt = $false',
  '      try {',
  '        $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue',
  '        if ($cs) {',
  '          $blob = [string]$cs.Manufacturer + \' \' + [string]$cs.Model',
  '          if ($blob -match \'VMware|VirtualBox|KVM|QEMU|Xen|Parallels|Virtual Machine\') { $virt = $true }',
  '        }',
  '      } catch {}',
  '      $obj = @{ cores = [ScdoGuardProbe]::Cores(); age = [ScdoGuardProbe]::InputAge(); note = [ScdoGuardProbe]::NoteState(); power = [ScdoGuardProbe]::Power(); mem = [ScdoGuardProbe]::Mem(); procs = $procs; remote = $remote; virt = $virt; vendor = [string]$script:VendorName }',
  '      Emit ($obj | ConvertTo-Json -Compress -Depth 4)',
  '    } elseif ($line.StartsWith(\'AFF \')) {',
  '      $rest = $line.Substring(4).Trim()',
  '      $sp = $rest.IndexOf(\' \')',
  '      if ($sp -lt 1) { Emit \'ERR\'; continue }',
  '      $mask = [Convert]::ToUInt64($rest.Substring($sp + 1).Trim(), 16)',
  '      foreach ($procId in ($rest.Substring(0, $sp) -split \',\')) {',
  '        $n = 0; if (-not [int]::TryParse($procId, [ref]$n)) { continue }',
  '        if ($n -le 0) { continue }',
  '        $p = Get-Process -Id $n -ErrorAction SilentlyContinue',
  '        if ($p) { $p.ProcessorAffinity = [IntPtr]::new([int64]$mask) }',
  '      }',
  '      Emit \'OK\'',
  '    } else { Emit \'ERR\' }',
  '  } catch { Emit \'ERR\' }',
  '}'
].join('\r\n')

// null: not read yet. []: read, no groups. non-empty: processor groups.
let topo = null
let lastVendor = ''
let lastVirt = false
let worker = null
let inbox = []
let waiters = []
let chain = Promise.resolve()

function supported () { return process.platform === 'win32' }

function psExe () {
  const root = process.env.SystemRoot || 'C:\\Windows'
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function scriptFile () {
  const dir = path.join(os.tmpdir(), 'scdo-wallet-guard')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'probe.ps1')
  let cur = ''
  try { cur = fs.readFileSync(file, 'utf8') } catch (e) { cur = '' }
  if (cur !== PROBE_PS1) fs.writeFileSync(file, PROBE_PS1)
  return file
}

function pushLine (msg) {
  const w = waiters.shift()
  if (w) w(msg)
  else inbox.push(msg)
}

function nextLine (ms) {
  if (inbox.length) return Promise.resolve(inbox.shift())
  return new Promise(resolve => {
    let done = false
    const finish = (msg) => {
      if (done) return
      done = true
      clearTimeout(timer)
      const i = waiters.indexOf(finish)
      if (i >= 0) waiters.splice(i, 1)
      resolve(msg)
    }
    const timer = setTimeout(() => finish(''), ms)
    waiters.push(finish)
  })
}

function killWorker () {
  const w = worker
  worker = null
  inbox = []
  if (!w) return
  w.alive = false
  try { w.ps.kill() } catch (e) {}
}

function ensureWorker () {
  if (worker && worker.alive) return Promise.resolve(worker)
  return new Promise(resolve => {
    let ps
    try {
      ps = spawn(psExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile()], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (e) { resolve(null); return }
    const w = { ps, alive: true }
    worker = w
    let buf = ''
    ps.stdout.on('data', d => {
      buf += d.toString()
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        if (line.indexOf('SCDO ') === 0) pushLine(line.slice(5))
      }
    })
    ps.on('error', () => { if (worker === w) killWorker() })
    ps.on('close', () => { if (worker === w) { w.alive = false; worker = null } })
    if (ps.stdin) ps.stdin.on('error', () => {})
    nextLine(15000).then(msg => {
      if (msg !== 'READY' || !w.alive) { killWorker(); resolve(null); return }
      resolve(w)
    })
  })
}

function ask (cmd) {
  const run = chain.then(async () => {
    const w = await ensureWorker()
    if (!w || !w.alive) return ''
    try { w.ps.stdin.write(cmd + '\n') } catch (e) { killWorker(); return '' }
    const msg = await nextLine(8000)
    if (!msg) { killWorker(); return '' }
    return msg
  })
  chain = run.then(() => {}, () => {})
  return run
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

function markProbed () {
  if (topo == null) topo = []
}

async function readSampleWin (opts) {
  const pids = ((opts && opts.pids) || []).map(n => Math.floor(Number(n))).filter(n => n > 0 && n < 1e9)
  let msg = ''
  try { msg = await ask('SAMPLE ' + pids.join(',')) } catch (e) { msg = '' }
  let json = null
  try { json = JSON.parse(String(msg || '').trim()) } catch (e) { json = null }
  if (!json || typeof json !== 'object') return safeSample()
  topo = parseCores(json.cores)
  const age = Number(json.age)
  const note = Number(json.note)
  const power = String(json.power || '').split(',')
  const ac = Number(power[0])
  const pct = Number(power[1])
  const mem = String(json.mem || '').split(',').map(Number)
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
  lastVendor = hostProbe.parseVendor(json.vendor)
  lastVirt = json.virt === true
  return safeSample({
    inputAgeMs: Number.isFinite(age) && age >= 0 ? age : null,
    fullscreen: hostProbe.parseNoteState(note),
    remoteSession: json.remote === true || hostProbe.parseRemoteSession(process.env.SESSIONNAME),
    virtualMachine: lastVirt,
    vendor: lastVendor,
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
  if (topo == null) return pendingPlan()
  if (!topo.length) return fallbackPlan(logical)
  const info = classifyCores(topo)
  const logicalIds = []
  for (const g of topo) for (const id of g.logical || []) logicalIds.push(id)
  return threadPlan({
    physicalPCores: info.physicalPCores,
    logical: logicalIds.length || logical,
    hybrid: info.hybrid,
    pLogical: info.pLogical,
    logicalIds: logicalIds.length ? logicalIds : undefined,
    vendor: lastVendor,
    virtual: lastVirt
  })
}

function applyAffinity (pid, logicalIds) {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const pids = (Array.isArray(pid) ? pid : [pid]).map(n => Math.floor(Number(n))).filter(n => n > 0 && n < 1e9)
  const ids = (logicalIds || []).map(n => Math.floor(Number(n))).filter(n => n >= 0 && n < 64)
  if (!pids.length || !ids.length || ids.length !== (logicalIds || []).length) return Promise.resolve(false)
  let mask = 0n
  for (const bit of ids) mask |= 1n << BigInt(bit)
  return ask('AFF ' + pids.join(',') + ' ' + mask.toString(16)).then(msg => msg === 'OK', () => false)
}

module.exports = { supported, readSample, threadPlanCached, applyAffinity, parseCores, markProbed }
