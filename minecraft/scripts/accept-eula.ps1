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

# ⚠️ BOM 없이 써야 합니다.
# PowerShell 5.1의 Set-Content -Encoding utf8 은 BOM을 붙이는데, 자바 프로퍼티
# 파서가 BOM을 키 이름의 일부로 읽어서 'eula' 가 아니라 '﻿eula' 가 됩니다.
# 그러면 동의가 인식되지 않고 서버가 계속 EULA를 요구합니다.
$noBom = New-Object System.Text.UTF8Encoding($false)

foreach ($s in @("home","raid","war","peace")) {
    $dir = "$Root\servers\$s"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [System.IO.File]::WriteAllText("$dir\eula.txt", "eula=true`n", $noBom)
    Write-Host "  $s : eula=true"
}
Write-Host "완료. 이제 scripts\start-home.ps1 로 서버를 실행할 수 있습니다." -ForegroundColor Green
