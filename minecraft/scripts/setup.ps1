# 러크 서버 — 로컬 개발 환경 구축
#
# Paper / Velocity 최신 STABLE 빌드를 PaperMC API로 조회해서 내려받습니다.
# 빌드 번호를 하드코딩하지 않으므로, 다시 실행하면 최신 빌드로 갱신됩니다.
#
# 사용법:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

$ErrorActionPreference = "Stop"

# ── 설정 ────────────────────────────────────────────────────────────────
$McVersion = "1.21.11"      # §6.2 "안정 우선" — 1.21 계열 최신 STABLE
$Root = Split-Path -Parent $PSScriptRoot
$Servers = @("home", "raid", "war", "peace")

Write-Host "러크 서버 환경 구축 시작 (Minecraft $McVersion)" -ForegroundColor Green

# ── 공통 다운로드 함수 ──────────────────────────────────────────────────
function Get-PaperArtifact {
    param([string]$Project, [string]$Version, [string]$OutFile)

    if (Test-Path $OutFile) {
        Write-Host "  이미 있음, 건너뜀: $(Split-Path -Leaf $OutFile)" -ForegroundColor DarkGray
        return
    }

    $api = "https://fill.papermc.io/v3/projects/$Project/versions/$Version/builds/latest"
    $build = Invoke-RestMethod $api -TimeoutSec 60

    $download = $build.downloads."server:default"
    if (-not $download) { $download = $build.downloads.PSObject.Properties[0].Value }

    Write-Host "  $Project $Version 빌드 #$($build.id) ($($build.channel)) 내려받는 중…"
    Invoke-WebRequest $download.url -OutFile $OutFile -TimeoutSec 600

    # 체크섬 검증 — 받다가 깨진 jar로 서버가 안 뜨는 일을 막습니다.
    $expected = $download.checksums.sha256
    if ($expected) {
        $actual = (Get-FileHash $OutFile -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected.ToLower()) {
            Remove-Item $OutFile -Force
            throw "$Project 체크섬 불일치. 다시 실행해 주세요."
        }
        Write-Host "  체크섬 확인됨" -ForegroundColor DarkGray
    }
}

# ── Velocity 프록시 ─────────────────────────────────────────────────────
Write-Host "`n[1/4] Velocity 프록시" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$Root\proxy" | Out-Null

$velocityVersions = (Invoke-RestMethod "https://fill.papermc.io/v3/projects/velocity" -TimeoutSec 60).versions
$latestVelocity = ($velocityVersions.PSObject.Properties | Select-Object -First 1).Value[0]
Get-PaperArtifact -Project "velocity" -Version $latestVelocity -OutFile "$Root\proxy\velocity.jar"

# ── Paper 서버 4개 ──────────────────────────────────────────────────────
Write-Host "`n[2/4] Paper 서버 4개" -ForegroundColor Cyan
$paperJar = "$Root\paper-$McVersion.jar"
Get-PaperArtifact -Project "paper" -Version $McVersion -OutFile $paperJar

foreach ($s in $Servers) {
    $dir = "$Root\servers\$s"
    New-Item -ItemType Directory -Force -Path "$dir\plugins" | Out-Null
    Copy-Item $paperJar "$dir\paper.jar" -Force

    # server.properties 는 rcon.password 를 담고 있어 git에서 제외됩니다.
    # 템플릿에서 만들어내되, 비밀번호는 서버마다 새로 생성합니다.
    $props = "$dir\server.properties"
    $template = "$dir\server.properties.example"

    if ((Test-Path $template) -and (-not (Test-Path $props))) {
        $bytes = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $pw = ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
        $pw = $pw.Substring(0, [Math]::Min(28, $pw.Length))

        # BOM 없이 써야 합니다 — 자바 프로퍼티 파서가 BOM을 키의 일부로 읽습니다.
        $generated = (Get-Content $template -Raw).Replace('__GENERATED_AT_SETUP__', $pw)
        [System.IO.File]::WriteAllText($props, $generated,
            (New-Object System.Text.UTF8Encoding($false)))

        if ($s -eq "home") {
            Write-Host "  $s : server.properties 생성 (RCON 비밀번호 새로 발급)" -ForegroundColor Yellow
            Write-Host "    .env 의 RUC_RCON_PW 를 아래 값으로 맞추세요:" -ForegroundColor Yellow
            Write-Host "    $pw" -ForegroundColor White
        } else {
            Write-Host "  $s 준비됨"
        }
    } else {
        Write-Host "  $s 준비됨"
    }
}

# ── 플러그인 빌드 & 배치 ────────────────────────────────────────────────
Write-Host "`n[3/4] 플러그인 빌드" -ForegroundColor Cyan

# 멀티 프로젝트 루트에서 한 번에 빌드합니다 (RucCore + RucHome + 이후 추가 모듈).
Push-Location "$Root\plugins"
try {
    & java -classpath "gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain --no-daemon -q build
    if ($LASTEXITCODE -ne 0) { throw "플러그인 빌드 실패" }
} finally {
    Pop-Location
}

# 모든 서버에 올릴 공용 플러그인
$jar = Get-ChildItem "$Root\plugins\RucCore\build\libs\RucCore-*.jar" | Select-Object -First 1
foreach ($s in $Servers) {
    Copy-Item $jar.FullName "$Root\servers\$s\plugins\RucCore.jar" -Force
}
Write-Host "  RucCore.jar -> 4개 서버"

# 서버별 전용 모듈 (해당 서버에만 배치)
$moduleMap = @{ "RucHome" = "home" }
foreach ($module in $moduleMap.Keys) {
    $dir = "$Root\plugins\$module\build\libs"
    if (-not (Test-Path $dir)) { continue }
    $mjar = Get-ChildItem "$dir\$module-*.jar" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($mjar) {
        $target = $moduleMap[$module]
        Copy-Item $mjar.FullName "$Root\servers\$target\plugins\$module.jar" -Force
        Write-Host "  $module.jar -> $target"
    }
}

# ── EULA 안내 ───────────────────────────────────────────────────────────
Write-Host "`n[4/4] 남은 작업" -ForegroundColor Cyan
Write-Host @"

  Minecraft EULA 동의가 필요합니다. 이건 Mojang과의 법적 계약이므로
  운영자 본인이 직접 하셔야 합니다.

  1) https://aka.ms/MinecraftEULA 를 읽고
  2) 동의하신다면 각 서버의 eula.txt 에서 eula=false 를 eula=true 로 변경

  또는 4개 서버에 한 번에 적용:
      scripts\accept-eula.ps1

  그 다음 서버 실행:
      scripts\start-home.ps1

"@ -ForegroundColor Yellow

Write-Host "구축 완료." -ForegroundColor Green
