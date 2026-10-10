// Pluggable process launch: binary + argv template + stdout parser.
// On Windows, windowsHide sets CREATE_NO_WINDOW. Stop closes stdin (zminer exits
// on EOF or a "stop" line) and sends SIGTERM. The Classic node also gets Ctrl+C
// so it can flush its database before a force-kill.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFile } = require('child_process')

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
// Classic GPU, solo and the pool start. go-scdo node has no stratum host flag.
// --pool on this binary is a local coinbase-list switch, not 82.223.19.88:3341.
// The payout address is basic.coinbase in {config}. See doc/mining-modes.md.
const CLASSIC_NODE_ARGS = ['start', '-c', '{config}', '-m', 'start', '--threads', '{threads}', '--threadblocks', '{threadblocks}', '--blockthreads', '{blockthreads}']

function relaxMinerPriority (proc) {
  if (!proc || proc.pid == null) return
  try {
    const level = process.platform === 'win32' ? os.constants.priority.PRIORITY_BELOW_NORMAL : 5
    os.setPriority(proc.pid, level)
  } catch (e) {}
}

function spawnMiner (spec) {
  const cwd = spec.cwd || path.dirname(spec.binary)
  const proc = spawn(spec.binary, spec.args, {
    cwd,
    windowsHide: true, // CREATE_NO_WINDOW on Windows
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spec.env || process.env
  })
  relaxMinerPriority(proc)
  return proc
}

function stopMiner (proc, opts) {
  opts = opts || {}
  const platform = opts.platform || process.platform
  return new Promise(resolve => {
    if (!proc || proc.exitCode != null || proc.signalCode != null) return resolve('gone')
    let finished = false
    const finish = (how) => { if (finished) return; finished = true; clearTimeout(timer); resolve(how) }
    const force = () => {
      try {
        if (platform === 'win32') execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {})
        else proc.kill('SIGKILL')
      } catch (e) {}
      setTimeout(() => finish('forced'), 2000)
    }
    const timer = setTimeout(force, opts.graceMs || 8000)
    proc.once('exit', () => finish('graceful'))
    try {
      if (opts.stdinStop !== false && proc.stdin && proc.stdin.writable) {
        proc.stdin.write('stop\n')
        proc.stdin.end()
      }
    } catch (e) {}
    if (platform === 'win32' && opts.ctrlC && opts.ctrlCScript) {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', opts.ctrlCScript, '-ProcessId', String(proc.pid)],
        { windowsHide: true, timeout: 20000 }, (err) => { if (err) force() })
    } else if (platform !== 'win32') {
      try { proc.kill('SIGTERM') } catch (e) {}
    }
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
  CLASSIC_NODE_ARGS,
  spawnMiner,
  stopMiner,
  ctrlCScript
}
