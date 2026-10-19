@echo off
chcp 65001 >nul
echo TubeLens: установка помощника загрузки
echo.
rem "python" из WindowsApps — заглушка Microsoft Store: проверяем, что Python реально запускается
set "HAVEPY="
py -3 --version >nul 2>nul && set "HAVEPY=1"
if not defined HAVEPY python --version >nul 2>nul && set "HAVEPY=1"
if not defined HAVEPY (
  echo Python не найден, устанавливаю через winget...
  winget install --id Python.Python.3.12 -e --silent --accept-source-agreements --accept-package-agreements
)
where ffmpeg >nul 2>nul || winget install --id Gyan.FFmpeg -e --silent --accept-source-agreements --accept-package-agreements
where deno >nul 2>nul || winget install --id DenoLand.Deno -e --silent --accept-source-agreements --accept-package-agreements
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1" %*
echo.
echo Перезапустите Chrome полностью, затем откройте TubeLens - Загрузки.
pause
