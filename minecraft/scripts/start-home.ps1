# 홈 서버 실행 (개발용)
$Root = Split-Path -Parent $PSScriptRoot
$dir = "$Root\servers\home"

if (-not (Test-Path "$dir\eula.txt")) {
    Write-Host "먼저 scripts\accept-eula.ps1 을 실행해 EULA에 동의해야 합니다." -ForegroundColor Red
    exit 1
}

Set-Location $dir
& java -Xms1G -Xmx2G -jar paper.jar --nogui
