# 러크 RPG 게임 서버 — 끄기 (P18): 서버에 "끄기" 표시 파일을 만들면 서버가 저장 · 백업하고 정상 종료, 그다음 Funnel 도 끔
$home2 = "C:\RucRpg"
New-Item -ItemType Directory -Force $home2 | Out-Null
New-Item -ItemType File -Force (Join-Path $home2 "stop.flag") | Out-Null
Write-Host "서버에 끄기를 요청했습니다. 저장을 기다리는 중..." -ForegroundColor Yellow
# 서버가 응답하지 않을 때까지 (최대 30초) — 끄기 표시 파일은 서버가 지움
for ($i = 0; $i -lt 30; $i++) {
  try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:2580/" -TimeoutSec 1 | Out-Null } catch { break }
  Start-Sleep -Seconds 1
}
$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { $ts = "C:\Program Files\Tailscale\tailscale.exe" }
& $ts funnel --https=443 off | Out-Null
Write-Host "러크 RPG 게임 서버를 껐습니다." -ForegroundColor Green
Start-Sleep -Seconds 2
