; Same close helper the shipped SCDO Wallet 2.0.12 installer and uninstaller run
; before electron-builder's own "is the app running" check.
; The executable name stays ScdoWalletBeta.exe: existing shortcuts, the
; autostart/quit request, firewall rules, and this helper all name that file.
; Renaming it would leave those pointing at an exe the upgrade no longer installs.

!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  ; un.onInit reaches this before any InitPluginsDir. The install section
  ; already called it; calling it again is safe.
  InitPluginsDir
  File /oname=$PLUGINSDIR\scdo-close-wallet.ps1 "${BUILD_RESOURCES_DIR}\scdo-close-wallet.ps1"
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\scdo-close-wallet.ps1" -InstDir "$INSTDIR" -AppExe "ScdoWalletBeta.exe" -MaxWait 60`
  Pop $0
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend
