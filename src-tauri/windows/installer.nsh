; Registers the app as an email app, so it can open mailto: links and shows
; in Settings > Apps > Default apps (src/mail_handler.rs). Per user, as the
; installer installs per user (to %LOCALAPPDATA%\<product name>). Windows
; doesn't let an app make itself the default: the owner picks it there.
; Tauri runs these macros around its own install and uninstall steps
; (bundle > windows > nsis > installerHooks in tauri.windows.conf.json).
; PRODUCTNAME and MAINBINARYNAME are Tauri's, from tauri.conf.json (which
; a test keeps in step with brand.json); the ProgID matches
; mail_handler::prog_id.

!macro NSIS_HOOK_POSTINSTALL
  ; What a mailto: link runs: this copy, with the link as its argument.
  WriteRegStr HKCU "Software\Classes\${MAINBINARYNAME}.mailto" "" "${PRODUCTNAME} email link"
  WriteRegStr HKCU "Software\Classes\${MAINBINARYNAME}.mailto\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\${MAINBINARYNAME}.mailto\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; The Default apps entry: the app, and the links it can open.
  WriteRegStr HKCU "Software\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "A keyboard-first Gmail client."
  WriteRegStr HKCU "Software\${PRODUCTNAME}\Capabilities\URLAssociations" "mailto" "${MAINBINARYNAME}.mailto"
  WriteRegStr HKCU "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${PRODUCTNAME}\Capabilities"
  ; Tells Explorer the associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\${MAINBINARYNAME}.mailto"
  DeleteRegKey HKCU "Software\${PRODUCTNAME}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "${PRODUCTNAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
