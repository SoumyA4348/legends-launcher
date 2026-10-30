; Included automatically by electron-builder (build/installer.nsh).
; On a real uninstall (not an auto-update, which also runs the old uninstaller), offer to
; remove game data too, so a reinstall can start clean. Silent uninstalls keep the data.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "Also delete your Legends Launcher game data?$\r$\n$\r$\nThis removes worlds, mods, the Java runtime, downloaded game files and your saved sign-in.$\r$\nChoose No to keep them for a future reinstall." /SD IDNO IDNO keepGameData
      SetShellVarContext current
      RMDir /r "$APPDATA\PrivateCustomMinecraftLauncher"
      RMDir /r "$APPDATA\legends-launcher"
    keepGameData:
  ${endIf}
!macroend
