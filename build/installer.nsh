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

; All-users 2.0.12 is recorded at
; HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\<guid>
; (UNINSTALL_REGISTRY_KEY). electron-builder's assisted installer only looks at
; HKLM\Software\<guid> (INSTALL_REGISTRY_KEY) and otherwise stays per-user, so a
; wizard or the in-app updater (setup.exe /S --force-run, not elevated) would
; add a second Apps entry. If that uninstall key exists, upgrade that directory
; and elevate. A machine with no HKLM install stays per-user.

!macro scdoReadPerMachineUninstall
  ReadRegStr $R8 HKLM "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $R8 != ""
    StrCpy $R6 "1"
    StrCpy $R9 $R8 1 -1
    ${If} $R9 == "\"
      StrLen $R9 $R8
      IntOp $R9 $R9 - 1
      StrCpy $R8 $R8 $R9
    ${EndIf}
    ${If} $R7 == ""
      StrCpy $R7 $R8
    ${EndIf}
  ${EndIf}
  ReadRegStr $R8 HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $R8 != ""
    StrCpy $R6 "1"
    StrCpy $R9 $R8 1
    ${If} $R9 == "$\""
      StrCpy $R8 $R8 "" 1
      StrCpy $R5 0
      StrLen $R9 $R8
      ${Do}
        StrCpy $R4 $R8 1 $R5
        ${If} $R4 == "$\""
          StrCpy $R8 $R8 $R5
          ${Break}
        ${EndIf}
        IntOp $R5 $R5 + 1
      ${LoopUntil} $R5 >= $R9
    ${EndIf}
    StrCpy $R5 0
    StrLen $R9 $R8
    StrCpy $R4 ""
    ${Do}
      StrCpy $R3 $R8 1 $R5
      ${If} $R3 == "\"
        StrCpy $R4 $R8 $R5
      ${EndIf}
      IntOp $R5 $R5 + 1
    ${LoopUntil} $R5 >= $R9
    ${If} $R7 == ""
    ${AndIf} $R4 != ""
      StrCpy $R7 $R4
    ${EndIf}
  ${EndIf}
  ${If} $R6 != "1"
    ReadRegStr $R8 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayName"
    ${If} $R8 != ""
      StrCpy $R6 "1"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $R6 ""
  StrCpy $R7 ""

  SetRegView 64
  !insertmacro scdoReadPerMachineUninstall
  ${If} $R6 != "1"
    SetRegView 32
    !insertmacro scdoReadPerMachineUninstall
    SetRegView 64
  ${EndIf}

  ${If} $R6 == "1"
    StrCpy $hasPerMachineInstallation "1"
    StrCpy $hasPerUserInstallation "0"
  ${EndIf}

  ${If} $hasPerMachineInstallation == "1"
    ${IfNot} ${UAC_IsAdmin}
      ShowWindow $HWNDPARENT ${SW_HIDE}
      !insertmacro UAC_RunElevated
      ${Switch} $0
        ${Case} 0
          ${If} $1 = 1
            Quit
          ${EndIf}
          ${Break}
        ${Case} 1223
          MessageBox MB_ICONSTOP|MB_TOPMOST "SCDO Wallet is installed for all users. Administrator approval is required to upgrade that installation."
          Quit
        ${Default}
          MessageBox MB_ICONSTOP|MB_TOPMOST "Unable to elevate, error $0"
          Quit
      ${EndSwitch}
      Quit
    ${Else}
      ${If} $R7 != ""
      ${AndIf} ${FileExists} "$R7"
        ReadRegStr $R8 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
        ${If} $R8 == ""
          WriteRegStr HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation" "$R7"
        ${EndIf}
      ${EndIf}
      !ifmacrodef setInstallModePerAllUsers
        !insertmacro setInstallModePerAllUsers
      !endif
      ${If} $R7 != ""
      ${AndIf} ${FileExists} "$R7"
        StrCpy $INSTDIR $R7
        StrCpy $perMachineInstallationFolder $R7
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ClearErrors
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${EndIf}
  !endif
!macroend
