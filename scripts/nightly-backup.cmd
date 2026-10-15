@echo off
rem ---------------------------------------------------------------
rem  Nightly database backup. Called by Windows Task Scheduler.
rem  See README for how the task is registered.
rem
rem  ASCII ONLY IN THIS FILE.  cmd.exe reads .cmd files with the
rem  system ANSI codepage (Big5 here), so UTF-8 Chinese turns into
rem  mojibake and the stray bytes break parsing -- that cost us a
rem  debugging round on 10-15.  Keep notes in Chinese in the README.
rem
rem  "%~dp0.." is this file's folder, one level up, so moving the
rem  project does not break the task.
rem ---------------------------------------------------------------
cd /d "%~dp0.."

if not exist "backups" mkdir "backups"

echo.>> "backups\nightly.log"
echo ===== %date% %time% =====>> "backups\nightly.log"
node scripts\backup.mjs>> "backups\nightly.log" 2>&1

rem Keep the exit code so Task Scheduler's "Last Run Result" is meaningful.
exit /b %errorlevel%
