# 러크 서버 네트워크 전체 실행 (개발용)
#
# 순서가 중요합니다. 백엔드가 먼저 떠 있어야 프록시가 붙일 대상이 생깁니다.
# 프록시만 먼저 띄우면 접속한 사람이 "서버에 연결할 수 없음"을 보게 됩니다.
#
# 플레이어는 25565(프록시)로만 접속합니다. 백엔드 25566~25569 는
# server-ip=127.0.0.1 로 묶여 있어 밖에서 닿지 않습니다 — 이게 뚫리면
# 디스코드 인증(D10)이 통째로 우회됩니다.

$Root = Split-Path -Parent $PSScriptRoot

# -Dstdout.encoding 이 없으면 콘솔에서 한글 로그가 깨집니다.
$Enc = @("-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Dfile.encoding=UTF-8")

function Start-Backend($name, $xms, $xmx) {
    $dir = Join-Path $Root "servers\$name"
    if (-not (Test-Path (Join-Path $dir "eula.txt"))) {
        Write-Host "[$name] EULA 미동의 — scripts\accept-eula.ps1 을 먼저 실행하세요." -ForegroundColor Red
        return
    }
    Write-Host "[$name] 기동 중…" -ForegroundColor Cyan
    Start-Process -FilePath "java" -WorkingDirectory $dir -WindowStyle Minimized `
        -ArgumentList ($Enc + @("-Xms$xms", "-Xmx$xmx", "-jar", "paper.jar", "nogui"))
}

Start-Backend "home"  "1G"   "2G"
Start-Backend "raid"  "1G"   "2G"
Start-Backend "war"   "512M" "1G"
Start-Backend "peace" "512M" "1G"

Write-Host ""
Write-Host "백엔드가 준비될 때까지 기다립니다…" -ForegroundColor Yellow

foreach ($name in @("home", "raid", "war", "peace")) {
    $log = Join-Path $Root "servers\$name\logs\latest.log"
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) {
        if ((Test-Path $log) -and (Select-String -Path $log -Pattern "Done \(" -Quiet -ErrorAction SilentlyContinue)) {
            Write-Host "  [$name] 준비 완료" -ForegroundColor Green
            break
        }
        Start-Sleep -Seconds 3
    }
}

Write-Host ""
Write-Host "[proxy] Velocity 기동 중…" -ForegroundColor Cyan
$proxyDir = Join-Path $Root "proxy"
Start-Process -FilePath "java" -WorkingDirectory $proxyDir -WindowStyle Minimized `
    -ArgumentList ($Enc + @("-Xms256M", "-Xmx512M", "-XX:+UseG1GC", "-jar", "velocity.jar"))

Write-Host ""
Write-Host "접속 주소: localhost:25565" -ForegroundColor Green
