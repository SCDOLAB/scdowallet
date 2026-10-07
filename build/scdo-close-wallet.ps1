# SCDO Wallet installer/uninstaller helper (1.1.5b; 2.0.0: MaxWait up to 120 s for the installer, legacy exe name; cand3: log in %ProgramData%\SCDO Wallet\logs): close the running wallet GRACEFULLY and wait until the wallet's
# own miner processes (geth, scdo-stratum proxy, rigel) have exited before files are replaced. geth must shut down
# cleanly to keep its chain data. Only the wallet's own processes are touched: matched by exe path under the wallet
# install folder or the wallet miner folders. Other Rigel/geth installs (e.g. C:\SCDO\gpu-miner) are never touched.
# 1.1.5b (B1): the wallet is matched by its full exe path under $InstDir via Win32_Process.ExecutablePath (also readable from
# a 32-bit PowerShell); a process without a readable path, or outside $InstDir, is NOT ours and is only logged. Every wait is
# capped at $MaxWait seconds (default 30; the installer passes 10 to an uninstaller run with --updated).
param([string]$InstDir = '', [string]$AppExe = 'ScdoWalletBeta.exe', [int]$MaxWait = 30)
if ($MaxWait -lt 1 -or $MaxWait -gt 120) { $MaxWait = 30 }
$ErrorActionPreference = 'Continue'
# 2.0.0 cand3: persistent log %ProgramData%\SCDO Wallet\logs\installer-close.log (own file; the relaunch helper writes
# relaunch.log). Falls back to the 1.1.x location %TEMP%\ScdoWalletBeta-installer-close.log if ProgramData is not writable.
function Get-LogFile([string]$name, [string]$fallback) {
  try {
    $d = Join-Path $env:ProgramData 'SCDO Wallet\logs'
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d -EA Stop | Out-Null }
    $f = Join-Path $d $name
    if ((Test-Path -LiteralPath $f) -and (Get-Item -LiteralPath $f).Length -gt 1MB) { Move-Item -LiteralPath $f -Destination "$f.1" -Force -EA SilentlyContinue }
    [IO.File]::AppendAllText($f, '')
    return $f
  } catch { return (Join-Path $env:TEMP $fallback) }
}
$log = Get-LogFile 'installer-close.log' 'ScdoWalletBeta-installer-close.log'
function L([string]$m) { try { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " [$PID] " + $m) } catch {} ; Write-Output $m }
$appName = [IO.Path]::GetFileNameWithoutExtension($AppExe)
$mySession = (Get-Process -Id $PID).SessionId
$roots = New-Object System.Collections.ArrayList
foreach ($r in @((Join-Path $env:APPDATA 'ScdoWalletBeta\miner'), (Join-Path $env:ProgramData 'ScdoWalletBeta\miner'))) { [void]$roots.Add($r.TrimEnd('\')) }
if ($InstDir) { [void]$roots.Add((Join-Path $InstDir 'resources\miner').TrimEnd('\')) }
function Test-Under([string]$p) { if (-not $p) { return $false }; foreach ($r in $roots) { if ($p.StartsWith($r + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true } }; return $false }
function Get-WalletMiners { @(Get-CimInstance Win32_Process -Filter "Name='geth.exe' OR Name='scdo-stratum.exe' OR Name='rigel.exe'" -ErrorAction SilentlyContinue | Where-Object { Test-Under $_.ExecutablePath }) }
$instRoot = $InstDir.TrimEnd('\') + '\'
function Get-SameName { @(Get-CimInstance Win32_Process -Filter ("Name='" + $AppExe.Replace("'", "''") + "'") -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $mySession }) }
function Test-Ours($c) { $InstDir -and $c.ExecutablePath -and $c.ExecutablePath.StartsWith($instRoot, [StringComparison]::OrdinalIgnoreCase) }
function Get-AppProcs { @(Get-SameName | Where-Object { Test-Ours $_ } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }) }
function Wait-Until([scriptblock]$cond, [int]$seconds) { $t = [DateTime]::Now.AddSeconds($seconds); while ([DateTime]::Now -lt $t) { if (& $cond) { return $true }; Start-Sleep -Milliseconds 500 }; return (& $cond) }

L "start (installer close helper 2.0.6), log $log, InstDir=$InstDir session=$mySession maxWait=$MaxWait s ps64=$([Environment]::Is64BitProcess)"
foreach ($c in (Get-SameName | Where-Object { -not (Test-Ours $_) })) { L ("ignoring same-named process outside the install folder: pid $($c.ProcessId) path=" + $(if ($c.ExecutablePath) { $c.ExecutablePath } else { '(unknown)' })) }
# 1. ask the wallet to close (same as clicking X): 1.1.5+ shows "Stopping miner, saving chain data" and quits when done
$app = Get-AppProcs
if ($app.Count -gt 0) {
  # 2.0.6: the wallet's X button only hides it to the tray, so first ask the running wallet to quit gracefully
  # (it stops the miner and saves the chain data). The request is a hidden, short-lived second launch of the installed exe with
  # --scdo-quit; 2.0.6+ quits, older wallets just ignore it and are closed through their window below.
  $exe = Join-Path $InstDir $AppExe
  if ($InstDir -and (Test-Path -LiteralPath $exe)) {
    try { $q = Start-Process -FilePath $exe -ArgumentList '--scdo-quit' -WindowStyle Hidden -PassThru -EA Stop; L "sent quit request (--scdo-quit, pid $($q.Id))" } catch { L ("quit request failed: " + $_.Exception.Message) }
    Start-Sleep -Milliseconds 800
  }
  foreach ($p in $app) { $p.Refresh(); if (-not $p.HasExited -and $p.MainWindowHandle -ne [IntPtr]::Zero) { L "closing window of pid $($p.Id) '$($p.MainWindowTitle)'"; [void]$p.CloseMainWindow() } }
  $t0 = [DateTime]::Now
  $gone = Wait-Until { (Get-AppProcs).Count -eq 0 } $MaxWait
  L ("wallet exited: " + $gone + " after " + [int]([DateTime]::Now - $t0).TotalSeconds + " s")
  if (-not $gone) { L ("wallet still running after the $MaxWait s limit (pids " + ((Get-AppProcs | ForEach-Object { $_.Id }) -join ',') + ") - continuing; the installer's own check closes it") }
} else { L 'wallet not running' }
# 2. wait for the wallet's own miner processes (an older wallet or a killed wallet can leave them running)
$m = Get-WalletMiners
if ($m.Count -gt 0) {
  L ("waiting for wallet miner processes: " + (($m | ForEach-Object { $_.Name + '#' + $_.ProcessId }) -join ', '))
  if (-not (Wait-Until { (Get-WalletMiners).Count -eq 0 } ([Math]::Min(20, $MaxWait)))) { L "wallet miner processes still running after $([Math]::Min(20, $MaxWait)) s" }
}
# 3. still there: graceful Ctrl+C (rigel, proxy, geth), wait up to 60 s
$m = Get-WalletMiners
if ($m.Count -gt 0) {
  # cand3: the Ctrl+C helper goes next to this script (the installer's private, randomly named $PLUGINSDIR), with a random
  # name - never a fixed name in %TEMP%
  $ccDir = $(if ($PSScriptRoot) { $PSScriptRoot } else { $env:TEMP })
  $cc = Join-Path $ccDir ('scdo-ctrlc-' + [Guid]::NewGuid().ToString('N') + '.ps1')
  @'
param([int]$ProcessId)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class ScdoCtrlCI {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool add);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);
}
"@
[void][ScdoCtrlCI]::FreeConsole()
if (-not [ScdoCtrlCI]::AttachConsole([uint32]$ProcessId)) { exit 2 }
[void][ScdoCtrlCI]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)
if (-not [ScdoCtrlCI]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }
Start-Sleep -Milliseconds 300
[void][ScdoCtrlCI]::FreeConsole()
exit 0
'@ | Set-Content -Path $cc -Encoding ASCII
  foreach ($n in @('rigel.exe', 'scdo-stratum.exe', 'geth.exe')) {
    foreach ($p in @($m | Where-Object { $_.Name -eq $n })) {
      $r = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $cc, '-ProcessId', $p.ProcessId) -WindowStyle Hidden -Wait -PassThru
      L "Ctrl+C to $n pid $($p.ProcessId): exit $($r.ExitCode)"
      $pp = $p.ProcessId
      $lim = $(if ($n -eq 'geth.exe') { $MaxWait } else { [Math]::Min(10, $MaxWait) })
      if (-not (Wait-Until { -not (Get-Process -Id $pp -ErrorAction SilentlyContinue) } $lim)) { L "$n pid $pp did not exit within $lim s after Ctrl+C" }
    }
  }
  Remove-Item $cc -ErrorAction SilentlyContinue
}
# 4. last resort: force only the wallet's own miner processes that are still alive
foreach ($p in (Get-WalletMiners)) { L "forcing $($p.Name) pid $($p.ProcessId)"; & taskkill.exe /PID $p.ProcessId /T /F | Out-Null }
L ("done; wallet processes left: " + (Get-AppProcs).Count + ", wallet miner processes left: " + (Get-WalletMiners).Count)
exit 0
