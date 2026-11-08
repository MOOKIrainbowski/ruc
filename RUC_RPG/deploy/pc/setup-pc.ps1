# 러크 RPG — 이 PC 를 운영 게임 서버로 준비 (처음 한 번, P18)
# 1) Node · Tailscale 확인  2) Tailscale 로그인 · Funnel 확인  3) Vercel 에 넣을 값 안내 (비밀값은 화면에 안 보이고 클립보드로)  4) 바탕화면 바로가기
$ErrorActionPreference = "Continue"
$deploy = Split-Path -Parent $PSScriptRoot
$port = 2580
function Step($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

Step "1. Node"
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host "Node.js 24 를 설치하세요: https://nodejs.org" -ForegroundColor Red; Read-Host "Enter"; exit 1 }
Write-Host "Node $(& node --version)"

Step "2. Tailscale"
$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { $ts = "C:\Program Files\Tailscale\tailscale.exe" }
if (-not (Test-Path $ts)) { Write-Host "Tailscale 을 설치하세요: https://tailscale.com/download/windows (설치 뒤 이 스크립트를 다시 실행)" -ForegroundColor Red; Read-Host "Enter"; exit 1 }
$st = & $ts status --json | ConvertFrom-Json
if ($st.BackendState -ne "Running") {
  Write-Host "Tailscale 에 로그인합니다 — 브라우저가 열리면 로그인(구글 · MS · 깃허브)하세요." -ForegroundColor Yellow
  & $ts up
  $st = & $ts status --json | ConvertFrom-Json
}
$dns = "$($st.Self.DNSName)".TrimEnd(".")
if (-not $dns) { Write-Host "Tailscale 로그인이 끝나지 않았습니다. 로그인한 뒤 다시 실행하세요." -ForegroundColor Red; Read-Host "Enter"; exit 1 }
Write-Host "이 PC 의 주소: $dns"
Write-Host "Funnel(인터넷 공개)을 켜 봅니다 — 처음이면 Funnel 허용 링크가 나옵니다. 링크를 열어 허용한 뒤 이 스크립트를 다시 실행하세요."
& $ts funnel --bg $port
if ($LASTEXITCODE -eq 0) { & $ts funnel --https=443 off | Out-Null; Write-Host "Funnel OK" -ForegroundColor Green }

Step "3. Vercel 환경 변수 (Settings → Environment Variables → Production)"
Write-Host "  NEXT_PUBLIC_RPG_WS_URL = wss://$dns" -ForegroundColor Green
$line = Get-Content (Join-Path $deploy "live.env") | Where-Object { $_ -like "RPG_TICKET_SECRET=*" } | Select-Object -First 1
if ($line) {
  Set-Clipboard -Value ($line.Substring("RPG_TICKET_SECRET=".Length).Trim())
  Write-Host "  RPG_TICKET_SECRET = (클립보드에 복사했습니다 — Vercel 값 칸에 Ctrl+V)" -ForegroundColor Green
} else { Write-Host "  live.env 에 RPG_TICKET_SECRET 이 없습니다" -ForegroundColor Red }
Write-Host "  두 값을 넣은 뒤 Vercel 에서 Redeploy 하면 /rpg 입장이 열립니다."

Step "4. 바탕화면 바로가기"
$desk = [Environment]::GetFolderPath("Desktop")
$sh = New-Object -ComObject WScript.Shell
foreach ($p in @(@("러크 RPG 서버 켜기", "server-start.ps1", 1), @("러크 RPG 서버 끄기", "server-stop.ps1", 7))) {
  $lnk = $sh.CreateShortcut((Join-Path $desk ($p[0] + ".lnk")))
  $lnk.TargetPath = "powershell.exe"
  $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot $p[1])`""
  $lnk.WorkingDirectory = $PSScriptRoot
  $lnk.WindowStyle = $p[2]
  $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll," + ($(if ($p[1] -like "*start*") { 137 } else { 131 }))
  $lnk.Save()
}
Write-Host "바탕화면에 '러크 RPG 서버 켜기' · '러크 RPG 서버 끄기' 를 만들었습니다." -ForegroundColor Green
Read-Host "`nEnter 를 누르면 닫힙니다"
