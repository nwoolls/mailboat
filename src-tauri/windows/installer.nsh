; Registers Mailboat as an email app, so it can open mailto: links and shows
; in Settings > Apps > Default apps (src/mail_handler.rs). Per user, as the
; installer installs per user (to %LOCALAPPDATA%\Mailboat). Windows doesn't
; let an app make itself the default: the owner picks Mailboat there.
; Tauri runs these macros around its own install and uninstall steps
; (bundle > windows > nsis > installerHooks in tauri.windows.conf.json).

!macro NSIS_HOOK_POSTINSTALL
  ; What a mailto: link runs: this copy, with the link as its argument.
  WriteRegStr HKCU "Software\Classes\Mailboat.mailto" "" "Mailboat email link"
  WriteRegStr HKCU "Software\Classes\Mailboat.mailto\DefaultIcon" "" "$INSTDIR\mailboat.exe,0"
  WriteRegStr HKCU "Software\Classes\Mailboat.mailto\shell\open\command" "" '"$INSTDIR\mailboat.exe" "%1"'
  ; The Default apps entry: Mailboat, and the links it can open.
  WriteRegStr HKCU "Software\Mailboat\Capabilities" "ApplicationName" "Mailboat"
  WriteRegStr HKCU "Software\Mailboat\Capabilities" "ApplicationDescription" "A keyboard-first Gmail client."
  WriteRegStr HKCU "Software\Mailboat\Capabilities\URLAssociations" "mailto" "Mailboat.mailto"
  WriteRegStr HKCU "Software\RegisteredApplications" "Mailboat" "Software\Mailboat\Capabilities"
  ; Tells Explorer the associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Mailboat.mailto"
  DeleteRegKey HKCU "Software\Mailboat"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Mailboat"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
