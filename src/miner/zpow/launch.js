// Pluggable process launch: binary + argv template + stdout parser.
// On Windows, windowsHide sets CREATE_NO_WINDOW. Stop kills the process tree
// at once. These miners do not exit on stdin, and a Ctrl+C helper can sit for
// a minute without the process dying.
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
// zminer-gpu: Classic graphics-card pool miner. One process per shard, all on device 0.
// zpowdet.dll and cudart64_12.dll must sit beside the exe. See doc/mining-modes.md.
const ZMINER_GPU_ARGS = ['-pool', '{pool}', '-user', '{user}', '-worker', '{worker}', '-device', '0', '-batch', '8192']
// Solo only. go-scdo node has no stratum host flag. --pool on this binary is a
// local coinbase-list switch, not 82.223.19.88:3341. The payout is basic.coinbase.
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
    // No stdin pipe. Ending it on stop can stall the main thread on Windows.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spec.env || process.env
  })
  relaxMinerPriority(proc)
  return proc
}

function killTree (pid, platform) {
  return new Promise(resolve => {
    if (!pid) return resolve()
    const cap = setTimeout(resolve, 3000)
    const done = () => { clearTimeout(cap); resolve() }
    if (platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 4000 }, () => done())
    } else {
      try { process.kill(pid, 'SIGKILL') } catch (e) {}
      done()
    }
  })
}

// Kill now. A grace period only delays the button; these processes ignore a
// polite stop. The promise always settles within a few seconds.
function stopMiner (proc, opts) {
  opts = opts || {}
  const platform = opts.platform || process.platform
  return new Promise(resolve => {
    if (!proc || proc.exitCode != null || proc.signalCode != null) return resolve('gone')
    let finished = false
    let extra = null
    const cap = setTimeout(() => finish('forced'), 4000)
    const finish = (how) => {
      if (finished) return
      finished = true
      clearTimeout(cap)
      clearTimeout(extra)
      resolve(how)
    }
    const pid = proc.pid
    proc.once('exit', () => finish('graceful'))
    try { proc.kill('SIGKILL') } catch (e) {}
    killTree(pid, platform).then(() => {
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
  ctrlCScript
}
