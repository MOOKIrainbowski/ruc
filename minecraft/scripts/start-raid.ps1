# 약탈 서버 실행 (개발용)
#
# -Dstdout.encoding / -Dfile.encoding 을 UTF-8 로 주지 않으면 콘솔에서
# 한글 로그가 전부 깨집니다. (logs 폴더의 latest.log 자체는 원래 UTF-8 입니다.)
$Root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $Root "servers\raid"

if (-not (Test-Path (Join-Path $dir "eula.txt"))) {
    Write-Host "먼저 scripts\accept-eula.ps1 을 실행해 EULA에 동의해야 합니다." -ForegroundColor Red
    exit 1
}

Set-Location $dir
& java -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dfile.encoding=UTF-8 -Xms2G -Xmx3G -jar paper.jar --nogui
