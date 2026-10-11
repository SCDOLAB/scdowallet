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

; 3.1.2 installs for the current user under %LOCALAPPDATA%\Programs.
; An older all-users copy is recorded at
; HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\<guid>
; (UNINSTALL_REGISTRY_KEY). Remember that folder so customInstall can run its
; uninstaller, then keep the new files in the per-user directory.
; Account files stay in the home directory, outside both install folders.
Var oldInstallDir

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

  ${If} $R7 != ""
    StrCpy $oldInstallDir $R7
  ${ElseIf} $perMachineInstallationFolder != ""
    StrCpy $oldInstallDir $perMachineInstallationFolder
  ${EndIf}

  ; Do not reuse the old Program Files directory and do not elevate this installer.
  StrCpy $hasPerMachineInstallation "0"
  StrCpy $hasPerUserInstallation "1"
  !insertmacro setInstallModePerUser
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
    StrCpy $isForceCurrentInstall "1"
    StrCpy $isForceMachineInstall "0"
  !endif
!macroend

; 2.0.12 and 3.0.x share ScdoWalletBeta.exe, so Windows keeps the old blue
; icon in the shortcut and the taskbar cache. Recreate both shortcuts against
; icon index 0, then SHCNE_ASSOCCHANGED (flush) and SHCNE_UPDATEITEM.
!macro customInstall
  Push $R0
  Push $R1
  ${If} $oldInstallDir == ""
    ${If} ${FileExists} "$PROGRAMFILES64\SCDO Wallet\ScdoWalletBeta.exe"
      StrCpy $oldInstallDir "$PROGRAMFILES64\SCDO Wallet"
    ${ElseIf} ${FileExists} "$PROGRAMFILES\SCDO Wallet\ScdoWalletBeta.exe"
      StrCpy $oldInstallDir "$PROGRAMFILES\SCDO Wallet"
    ${ElseIf} ${FileExists} "$PROGRAMFILES64\ScdoWalletBeta\ScdoWalletBeta.exe"
      StrCpy $oldInstallDir "$PROGRAMFILES64\ScdoWalletBeta"
    ${ElseIf} ${FileExists} "$PROGRAMFILES\ScdoWalletBeta\ScdoWalletBeta.exe"
      StrCpy $oldInstallDir "$PROGRAMFILES\ScdoWalletBeta"
    ${EndIf}
  ${EndIf}
  ; A silent update may not be an administrator, so removing Program Files can fail.
  ; The new per-user copy and its shortcuts are still written.
  ${If} $oldInstallDir != ""
  ${AndIf} $oldInstallDir != $INSTDIR
    StrCpy $R0 "$oldInstallDir\Uninstall SCDO Wallet.exe"
    ${IfNot} ${FileExists} "$R0"
      StrCpy $R0 "$oldInstallDir\Uninstall ScdoWalletBeta.exe"
    ${EndIf}
    ${If} ${FileExists} "$R0"
      ExecWait '"$R0" /S' $R0
    ${EndIf}
  ${EndIf}
  !ifdef MENU_FILENAME
    CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
    ClearErrors
  !endif
  Delete "$newStartMenuLink"
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${ifNot} ${isNoDesktopShortcut}
    Delete "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
  System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x1005, w "$appExe", i 0)'
  System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x1005, w "$newStartMenuLink", i 0)'
  ${ifNot} ${isNoDesktopShortcut}
    System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x1005, w "$newDesktopLink", i 0)'
  ${endIf}
  StrCpy $R1 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\SCDO Wallet.lnk"
  ${If} ${FileExists} "$R1"
    System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x1005, w "$R1", i 0)'
  ${EndIf}
  StrCpy $R1 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\ScdoWalletBeta.lnk"
  ${If} ${FileExists} "$R1"
    System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x1005, w "$R1", i 0)'
  ${EndIf}
  ; Drop leftover old-name per-user shortcuts. Never remove the links just created.
  ${If} "$DESKTOP\ScdoWalletBeta.lnk" != "$newDesktopLink"
    Delete "$DESKTOP\ScdoWalletBeta.lnk"
  ${EndIf}
  ${If} "$SMPROGRAMS\SCDO Wallet.lnk" != "$newStartMenuLink"
    Delete "$SMPROGRAMS\SCDO Wallet.lnk"
  ${EndIf}
  Delete "$SMPROGRAMS\ScdoWalletBeta.lnk"
  ; All-users leftovers. NSIS has no $COMMONDESKTOP / $COMMONPROGRAMS constants;
  ; $DESKTOP and $SMPROGRAMS point at the all-users folders under
  ; SetShellVarContext all. Without admin rights these deletes just fail quietly.
  SetShellVarContext all
  Delete "$DESKTOP\SCDO Wallet.lnk"
  Delete "$DESKTOP\ScdoWalletBeta.lnk"
  Delete "$SMPROGRAMS\SCDO Wallet.lnk"
  Delete "$SMPROGRAMS\ScdoWalletBeta.lnk"
  !ifdef MENU_FILENAME
    Delete "$SMPROGRAMS\${MENU_FILENAME}\SCDO Wallet.lnk"
    Delete "$SMPROGRAMS\${MENU_FILENAME}\ScdoWalletBeta.lnk"
  !endif
  SetShellVarContext current
  ClearErrors
  Pop $R1
  Pop $R0
!macroend

; Uninstall removes the program folder only. Account files stay in the home directory.
!macro customUnInstall
  ; Do not delete account files.
  ; The uninstaller pass never runs customInit/customInstall, so reference
  ; oldInstallDir here too; otherwise makensis warning 6001 fails the pack (-WX).
  StrCpy $oldInstallDir ""
!macroend
