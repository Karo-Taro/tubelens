# Установка помощника загрузки TubeLens (Windows).
# Запуск: ПКМ → «Выполнить с помощью PowerShell»  или
#   powershell -ExecutionPolicy Bypass -File install_windows.ps1 [-ExtensionId <id>]
# Удаление: powershell -ExecutionPolicy Bypass -File install_windows.ps1 -Uninstall
param([string]$ExtensionId = "mnaoadllhdlnmdccgppbbicpplfihceh", [switch]$Uninstall)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = "com.tubelens.dl"
$hostKeys = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$name",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$name",
  "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$name",
  "HKCU:\Software\Chromium\NativeMessagingHosts\$name")
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

function Stop-Helper {
  # venv-обёртка pythonw.exe запускает дочерний pythonw.exe — останавливаем оба
  Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'tubelens_dl\.py' -and $_.CommandLine -match '--serve' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Uninstall) {
  Stop-Helper
  foreach ($k in $hostKeys) { if (Test-Path $k) { Remove-Item -Path $k -Force } }
  Remove-ItemProperty -Path $runKey -Name "TubeLensHelper" -ErrorAction SilentlyContinue
  Write-Host "Помощник TubeLens отключён: автозапуск и регистрация в браузерах удалены." -ForegroundColor Green
  Write-Host "Окружение Python, настройки и helper.log остались в $(Join-Path $env:LOCALAPPDATA 'TubeLens') — удалите папку вручную, если не нужна."
  exit 0
}

# свежий PATH: Python/ffmpeg/deno могли быть только что установлены через winget
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

# 1. Python
$py = $null
foreach ($c in @("py -3", "python", "python3")) {
  try { $v = & cmd /c "$c --version" 2>$null; if ($LASTEXITCODE -eq 0 -and $v -match "Python 3") { $py = $c; break } } catch {}
}
if (-not $py) {
  Write-Host "Python 3 не найден. Установите: winget install Python.Python.3.12  (или https://python.org)" -ForegroundColor Red
  exit 1
}
Write-Host "Python: $py"

# 2. Изолированное окружение + yt-dlp
# окружение вне папки расширения: Chrome не загружает расширения с файлами, начинающимися на "_"
$venv = Join-Path $env:LOCALAPPDATA (Join-Path "TubeLens" "venv")
New-Item -ItemType Directory -Force (Split-Path $venv) | Out-Null
if (-not (Test-Path "$venv\Scripts\python.exe")) { & cmd /c "$py -m venv `"$venv`"" }
if (-not (Test-Path "$venv\Scripts\python.exe")) {
  Write-Host "Не удалось создать окружение Python в $venv" -ForegroundColor Red
  exit 1
}
& "$venv\Scripts\python.exe" -m pip install -U pip "yt-dlp[default]" | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Host "pip не смог установить yt-dlp (код $LASTEXITCODE). Проверьте интернет и запустите установщик ещё раз." -ForegroundColor Red
  exit 1
}

# 3. Обёртка-запускатель (Chrome на Windows требует .bat/.exe)
# cmd.exe читает .bat в OEM-кодировке: так пути с кириллицей (C:\Users\Иван) не ломаются
$bat = Join-Path $here "tubelens_dl.bat"
$oem = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
[IO.File]::WriteAllText($bat, "@echo off`r`n`"$venv\Scripts\python.exe`" -u `"$here\tubelens_dl.py`" %*`r`n", $oem)

# 4. Манифест хоста
$manifest = Join-Path $here "$name.json"
$json = @{
  name = $name
  description = "TubeLens downloader (yt-dlp)"
  path = $bat
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json
[IO.File]::WriteAllText($manifest, $json, (New-Object Text.UTF8Encoding($false)))  # без BOM

# 5. Регистрация для Chrome / Edge / Brave / Chromium
foreach ($k in $hostKeys) {
  New-Item -Path $k -Force | Out-Null
  Set-ItemProperty -Path $k -Name "(default)" -Value $manifest
}

# 5b. Конфиг помощника: какому расширению разрешён доступ (и место для своих CLI-команд)
$cfgPath = Join-Path (Split-Path $venv) "config.json"
$cfg = @{ allowed_origins = @("chrome-extension://$ExtensionId") }
if (Test-Path $cfgPath) {
  try { $old = Get-Content $cfgPath -Raw | ConvertFrom-Json; if ($old.cli) { $cfg.cli = $old.cli } } catch {}
}
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))

# 6. Локальный HTTP-помощник (для браузеров без Native Messaging: Linken Sphere, CEF-сборки и т.п.)
#    Автозапуск при входе в Windows. Убрать: install_windows.ps1 -Uninstall
$pyw = Join-Path $venv "Scripts\pythonw.exe"
$script = Join-Path $here "tubelens_dl.py"
Set-ItemProperty $runKey -Name "TubeLensHelper" -Value "`"$pyw`" `"$script`" --serve"
Stop-Helper
Start-Sleep -Milliseconds 500
Start-Process -FilePath $pyw -ArgumentList "`"$script`"", "--serve" -WindowStyle Hidden
Start-Sleep -Seconds 2
try {
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:47321/ping" -Headers @{ "X-TubeLens" = "1" } -TimeoutSec 5
  Write-Host "Помощник запущен: yt-dlp $($r.ytdlp), ffmpeg: $($r.ffmpeg), deno: $($r.deno)" -ForegroundColor Green
} catch { Write-Host "Не удалось проверить помощника на 127.0.0.1:47321: $($_.Exception.Message)" -ForegroundColor Yellow }

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "`nffmpeg не найден — будут доступны только готовые форматы (обычно до 720p)." -ForegroundColor Yellow
  Write-Host "Для 1080p+/MP3 установите: winget install Gyan.FFmpeg" -ForegroundColor Yellow
}
if (-not (Get-Command deno -ErrorAction SilentlyContinue)) {
  Write-Host "`ndeno не найден — YouTube требует JS-движок для части форматов. Установите: winget install DenoLand.Deno" -ForegroundColor Yellow
}
Write-Host "`nГотово! Обновите расширение TubeLens и откройте раздел «Загрузки»." -ForegroundColor Green
