# Minecraft EULA 동의를 4개 서버에 한 번에 적용합니다.
#
# ⚠️ 이 스크립트를 실행한다는 것은 https://aka.ms/MinecraftEULA 에
#    동의한다는 뜻입니다. 읽어보신 뒤에 실행하세요.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "Minecraft EULA (https://aka.ms/MinecraftEULA) 에 동의하십니까?" -ForegroundColor Yellow
$answer = Read-Host "동의하시면 'yes' 를 입력하세요"

if ($answer -ne "yes") {
    Write-Host "취소되었습니다." -ForegroundColor Red
    exit 1
}

foreach ($s in @("home","raid","war","peace")) {
    $dir = "$Root\servers\$s"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Set-Content -Path "$dir\eula.txt" -Value "eula=true" -Encoding utf8
    Write-Host "  $s : eula=true"
}
Write-Host "완료. 이제 scripts\start-home.ps1 로 서버를 실행할 수 있습니다." -ForegroundColor Green
