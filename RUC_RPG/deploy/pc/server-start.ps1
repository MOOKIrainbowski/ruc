# 러크 RPG 게임 서버 — 이 PC 에서 켜기 (P18 · D105)
# 바탕화면 "러크 RPG 서버 켜기" 바로가기가 실행. 이 창이 열려 있는 동안만 서버가 돎 (창을 닫거나 PC 를 끄면 꺼짐).
# 서버가 오류로 멈추면 5초 뒤 다시 켬. "러크 RPG 서버 끄기" = 저장하고 정상 종료.
$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "러크 RPG 게임 서버 (이 창을 닫으면 서버가 꺼집니다)"
$deploy = Split-Path -Parent $PSScriptRoot            # RUC_RPG\deploy
$server = Join-Path (Split-Path -Parent $deploy) "server"
$home2 = "C:\RucRpg"                                   # 운영 데이터 (OneDrive 밖)
$port = 2580
foreach ($d in "data", "backups", "logs") { New-Item -ItemType Directory -Force (Join-Path $home2 $d) | Out-Null }
if (-not (Test-Path (Join-Path $deploy "live.env"))) { Write-Host "live.env 가 없습니다. 먼저 setup-pc.ps1 을 실행하세요." -ForegroundColor Red; Read-Host "Enter 를 누르면 닫힙니다"; exit 1 }

# 운영 설정 (live.env 보다 여기 값이 먼저 — 개발 서버 2567 과 겹치지 않게)
$env:PORT = "$port"
$env:RPG_BIND = "127.0.0.1"
$env:RPG_DATA_DIR = Join-Path $home2 "data"
$env:RPG_DB_FILE = "live.sqlite"
$env:RPG_BACKUP_DIR = Join-Path $home2 "backups"
$env:RPG_STOP_FILE = Join-Path $home2 "stop.flag"
$env:RUC_MODE = "beta"

# 인터넷 공개: Tailscale Funnel  https://<이 PC>.<tailnet>.ts.net  →  127.0.0.1:2580
$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { $ts = "C:\Program Files\Tailscale\tailscale.exe" }
& $ts funnel --bg $port | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Tailscale Funnel 을 켜지 못했습니다 — setup-pc.ps1 을 다시 실행해 보세요 (로그인 · Funnel 허용)." -ForegroundColor Yellow }

Write-Host "러크 RPG 게임 서버를 켭니다 (포트 $port). 끄려면 바탕화면 '러크 RPG 서버 끄기' 또는 이 창 닫기." -ForegroundColor Green
while ($true) {
  Remove-Item $env:RPG_STOP_FILE -ErrorAction SilentlyContinue
  $log = Join-Path $home2 ("logs\server-" + (Get-Date -Format "yyyyMMdd") + ".log")
  Push-Location $server
  & node --env-file="$(Join-Path $deploy 'live.env')" src/main.ts 2>&1 | ForEach-Object { $l = "$_"; $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -eq 0) { break }      # 끄기 단추 · Ctrl+C = 정상 종료
  $l = "[$(Get-Date)] 서버가 멈춰서 5초 뒤 다시 켭니다 (종료 코드 $code)"; $l; Add-Content -Path $log -Value $l -Encoding UTF8
  Start-Sleep -Seconds 5
}
& $ts funnel --https=443 off | Out-Null
Write-Host "서버를 껐습니다." -ForegroundColor Green
Start-Sleep -Seconds 2
