; Goated Panels Hub's own steps in the Windows installer and uninstaller.
;
; The app was called Asset Library before (decision I2). Its appId didn't change, so this installer
; sees an old install as the same app: it runs the old uninstaller first (which closes the old app
; and removes its files and shortcuts, keeping the library) and then installs. The library data
; folder is moved by the app itself on first launch, from %APPDATA%\Asset Library.

; The Premiere Pro panel keeps the product's name in Adobe's installer, whatever the app is called.
!define ASSET_LIBRARY_PANEL "Asset Library"
; The app's name, and so its folder names, before the rename.
!define LEGACY_PRODUCT_NAME "Asset Library"

!macro customInit
  ; An old install's folder ends in "\Asset Library": install beside it under the new name
  ; instead of inside it. The old uninstaller removes the old folder.
  ${GetFileName} "$INSTDIR" $R0
  ${if} $R0 == "${LEGACY_PRODUCT_NAME}"
    ${GetParent} "$INSTDIR" $R1
    StrCpy $INSTDIR "$R1\${PRODUCT_FILENAME}"
  ${endif}
!macroend

; Uninstalling from Windows (Settings > Apps, or "Uninstall Goated Panels Hub..." in the app).
; Skipped when an update runs the old uninstaller: the new version installs its own panel and
; keeps the library.
!macro assetLibraryRemovePanels
  nsExec::Exec '"$0" /remove "${ASSET_LIBRARY_PANEL}"'
  Pop $2
  nsExec::Exec '"$0" /remove "${ASSET_LIBRARY_PANEL} CEP"'
  Pop $2
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; The Premiere Pro panel, both builds, through Adobe's installer. Old copies can sit side by
    ; side, so each name is removed a few times; a remove with nothing left just fails quietly.
    StrCpy $0 "$COMMONFILES64\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe"
    ${if} ${FileExists} "$0"
      !insertmacro assetLibraryRemovePanels
      !insertmacro assetLibraryRemovePanels
      !insertmacro assetLibraryRemovePanels
    ${endif}

    ; Start at login and the assetlibrary:// link, both registered by the app for this user.
    ; The login entry is named after the appId, so it's the same before and after the rename.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.saxenascreation.assetlibrary"
    DeleteRegKey HKCU "Software\Classes\assetlibrary"

    ; The library data. The app passes --delete-app-data or --keep-app-data when the editor
    ; already chose in its own dialog; otherwise ask (silent uninstalls keep it).
    StrCpy $R2 "keep"
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${ifNot} ${Errors}
      StrCpy $R2 "delete"
    ${else}
      ClearErrors
      ${GetOptions} $R0 "--keep-app-data" $R1
      ${ifNot} ${Errors}
        Goto keepLibrary
      ${endif}
      MessageBox MB_YESNO|MB_ICONQUESTION "Also delete your library (folder list, tags, favorites and thumbnails)?$\r$\n$\r$\nYour own asset files are never touched." /SD IDNO IDNO keepLibrary
        StrCpy $R2 "delete"
      keepLibrary:
    ${endif}
    ${if} $R2 == "delete"
      SetShellVarContext current
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
      ; The old folder name: a junction to the folder just deleted (plain RMDir removes the
      ; junction itself without following it), or the old folder when the app never moved it.
      RMDir "$APPDATA\${LEGACY_PRODUCT_NAME}"
      RMDir /r "$APPDATA\${LEGACY_PRODUCT_NAME}"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    ${endif}
  ${endif}
!macroend
