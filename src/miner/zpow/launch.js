// Pluggable process launch: binary + argv template + stdout parser.
// On Windows, windowsHide sets CREATE_NO_WINDOW. Stop kills the process tree
// at once. zminer and zminer-gpu exit 0 when stdin hits EOF, so stdin must
// stay an open pipe. Ending that pipe on stop can stall the main thread.
'use strict'
const fs = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { applyPriority } = require('../priority')

const CTRL_C_PS1 = [
  'param([int]$ProcessId)',
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  'using System; using System.Runtime.InteropServices;',
  'public static class ScdoCtrlC {',
  '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);',
  '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();',
  '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool add);',
  '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);',
  '}',
  "'@",
  '[void][ScdoCtrlC]::FreeConsole()',
  'if (-not [ScdoCtrlC]::AttachConsole([uint32]$ProcessId)) { Write-Output ("attach failed " + [Runtime.InteropServices.Marshal]::GetLastWin32Error()); exit 2 }',
  '[void][ScdoCtrlC]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)',
  'if (-not [ScdoCtrlC]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }',
  'Start-Sleep -Milliseconds 300',
  '[void][ScdoCtrlC]::FreeConsole()',
  'exit 0'
].join('\r\n')

function renderArgs (template, ctx) {
  ctx = ctx || {}
  if (!Array.isArray(template)) {
    const err = new Error('miner args must be an array')
    err.code = 'BAD_ARGS'
    throw err
  }
  return template.map(part => String(part).replace(/\{(\w+)\}/g, (m, key) => {
    if (ctx[key] == null || ctx[key] === '') {
      const err = new Error('miner arg {' + key + '} is empty')
      err.code = 'BAD_ARGS'
      throw err
    }
    return String(ctx[key])
  }))
}

function externalProfile (env) {
  env = env || process.env
  if (!env.SCDO_ZPOW_GPU_BIN) return null
  let args = ['-pool', '{pool}', '-user', '{user}', '-threads', '{threads}']
  if (env.SCDO_ZPOW_GPU_ARGS) {
    try { args = JSON.parse(env.SCDO_ZPOW_GPU_ARGS) } catch (e) {
      const err = new Error('SCDO_ZPOW_GPU_ARGS is not a JSON array')
      err.code = 'BAD_ARGS'
      throw err
    }
  }
  if (!Array.isArray(args)) {
    const err = new Error('SCDO_ZPOW_GPU_ARGS must be a JSON array')
    err.code = 'BAD_ARGS'
    throw err
  }
  return {
    id: 'external',
    kind: 'gpu',
    binary: env.SCDO_ZPOW_GPU_BIN,
    sha256: env.SCDO_ZPOW_GPU_SHA256 || '',
    args,
    solo: env.SCDO_ZPOW_GPU_SOLO === '1'
  }
}

const ZMINER_ARGS = ['-pool', '{pool}', '-user', '{user}', '-worker', '{worker}', '-threads', '{threads}']
// zminer-gpu: Classic graphics-card pool miner. One process per shard, all on device 0.
// zpowdet.dll and cudart64_12.dll must sit beside the exe. See doc/mining-modes.md.
const ZMINER_GPU_ARGS = ['-pool', '{pool}', '-user', '{user}', '-worker', '{worker}', '-device', '0', '-batch', '8192']
// Solo only. go-scdo node has no stratum host flag. --pool on this binary is a
// local coinbase-list switch, not 82.223.19.88:3341. The payout is basic.coinbase.
const CLASSIC_NODE_ARGS = ['start', '-c', '{config}', '-m', 'start', '--threads', '{threads}', '--threadblocks', '{threadblocks}', '--blockthreads', '{blockthreads}']

function relaxMinerPriority (proc, low) {
  if (!proc || proc.pid == null) return
  applyPriority(proc.pid, low !== false)
}

function spawnMiner (spec) {
  const cwd = spec.cwd || path.dirname(spec.binary)
  const proc = spawn(spec.binary, spec.args, {
    cwd,
    windowsHide: true, // CREATE_NO_WINDOW on Windows
    // Open stdin. 'ignore' is EOF, and zminer-gpu then prints its exit line
    // and returns 0 before it logs in. Do not end this pipe on stop.
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spec.env || process.env
  })
  if (proc.stdin) proc.stdin.on('error', () => {})
  relaxMinerPriority(proc, spec.lowPriority)
  return proc
}

// signal 0 checks the pid. A dead miner must not wait on taskkill.
function pidAlive (pid) {
  const n = Number(pid)
  if (!n) return false
  try {
    process.kill(n, 0)
    return true
  } catch (e) {
    return !!(e && e.code === 'EPERM')
  }
}

function killTree (pid, platform, exec) {
  return new Promise(resolve => {
    if (!pid || !pidAlive(pid)) return resolve()
    const cap = setTimeout(resolve, 1500)
    const done = () => { clearTimeout(cap); resolve() }
    const run = exec || execFile
    if (platform === 'win32') {
      run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 1800 }, () => done())
    } else {
      try { process.kill(pid, 'SIGKILL') } catch (e) {}
      done()
    }
  })
}

// Kill now. Do not write or end stdin (that stalls Windows, and EOF is how
// these miners stop themselves). No live child settles at once, without
// taskkill. A live process is killed and the promise always settles within
// 2 seconds, even if taskkill never returns.
function stopMiner (proc, opts) {
  opts = opts || {}
  const platform = opts.platform || process.platform
  return new Promise(resolve => {
    const pid = proc && proc.pid
    if (!proc || !pid || proc.exitCode != null || proc.signalCode != null || !pidAlive(pid)) return resolve('gone')
    let finished = false
    let extra = null
    const cap = setTimeout(() => finish('forced'), 2000)
    const finish = (how) => {
      if (finished) return
      finished = true
      clearTimeout(cap)
      clearTimeout(extra)
      resolve(how)
    }
    proc.once('exit', () => finish('graceful'))
    try { proc.kill('SIGKILL') } catch (e) {}
    killTree(pid, platform, opts.execFile).then(() => {
      if (!finished) extra = setTimeout(() => finish('forced'), 200)
    })
  })
}

function ctrlCScript (dir) {
  const file = path.join(dir, 'send-ctrl-c.ps1')
  try { if (fs.readFileSync(file, 'utf8') === CTRL_C_PS1) return file } catch (e) {}
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, CTRL_C_PS1)
  return file
}

module.exports = {
  renderArgs,
  externalProfile,
  ZMINER_ARGS,
  ZMINER_GPU_ARGS,
  CLASSIC_NODE_ARGS,
  spawnMiner,
  stopMiner,
  killTree,
  pidAlive,
  ctrlCScript
}
