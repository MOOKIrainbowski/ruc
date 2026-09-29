# 러크 서버 백업 (Phase 9a) — 월드 + DB + 설정
#
# 사용:
#   minecraft\scripts\backup.ps1                  지금 한 번 백업
#   minecraft\scripts\backup.ps1 -Keep 30         최근 30개만 남기기 (기본 14)
#   minecraft\scripts\backup.ps1 -Dest D:\Backup  다른 곳에 저장
#   minecraft\scripts\backup.ps1 -Register        매일 05:00 자동 실행 등록
#   minecraft\scripts\backup.ps1 -Unregister      자동 실행 해제
#
# ── 무엇을 담는가 ─────────────────────────────────────────────────────
#   worlds\<서버>\<월드>   level.dat 이 있는 폴더 전부 (hub 포함)
#   db\ruc-h2.sql          공용 H2 DB — SQL 덤프 (DbDump.java)
#   config\                server.properties, 플러그인 config, velocity.toml,
#                          봇의 roles.json · 티켓 · 제재 기록
#
# 봇의 .env(토큰)는 담지 않습니다. 토큰은 개발자 포털에서 다시 받으면 되고,
# 백업 파일이 새면 토큰까지 새는 것이 더 나쁩니다.
#
# ── 왜 이렇게 하는가 ──────────────────────────────────────────────────
# 1. 켜져 있는 서버는 save-off → save-all flush → 복사 → save-on 순서입니다.
#    save-off 없이 복사하면 복사 도중에 서버가 청크를 써서 반쯤 쓰인 region
#    파일이 백업에 들어갑니다. save-on 은 finally 에서 반드시 돌립니다 —
#    빠뜨리면 그 뒤로 월드가 저장되지 않습니다.
# 2. session.lock 은 서버가 잡고 있어 복사가 실패합니다. 빼고 복사합니다.
# 3. DB 파일(ruc.mv.db)을 그대로 복사하면 쓰는 도중의 파일을 뜰 수 있습니다.
#    DbDump.java 가 SQL 덤프를 뜹니다 (BACKUP TO · SCRIPT TO 가 왜 안 되는지는
#    그 파일 주석에). 복원 방법도 거기 있습니다.
#    (MySQL 로 옮기면 이 부분을 mysqldump 로 바꾸세요 — 인수인계 §9a)
# 4. 기본 저장 위치는 OneDrive\RucBackups 입니다. 이 PC 가 죽어도 사본이
#    클라우드에 남습니다. 저장소(git) 밖이라 커밋되지 않습니다.

param(
    [string]$Dest = (Join-Path $env:USERPROFILE "OneDrive\RucBackups"),
    [int]$Keep = 14,
    [switch]$Register,
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent          # minecraft\
$Repo = Split-Path $Root -Parent                  # 러크서버\
$TaskName = "RucServerBackup"

$Servers = [ordered]@{
    home  = @{ Port = 25566; Rcon = 25576 }
    raid  = @{ Port = 25567; Rcon = 25577 }
    war   = @{ Port = 25568; Rcon = 25578 }
    peace = @{ Port = 25569; Rcon = 25579 }
}

# ── 자동 실행 등록 / 해제 ─────────────────────────────────────────────

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "자동 백업을 해제했습니다 ($TaskName)." -ForegroundColor Green
    return
}

if ($Register) {
    $taskArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Dest `"$Dest`" -Keep $Keep"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs -WorkingDirectory $PSScriptRoot
    $trigger = New-ScheduledTaskTrigger -Daily -At "05:00"
    # 05:00 에 PC 가 꺼져 있었으면 켜진 뒤 바로 한 번 돕니다.
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
        -Description "러크 서버 월드·DB 백업 (minecraft\scripts\backup.ps1)" -Force | Out-Null
    Write-Host "매일 05:00 자동 백업을 등록했습니다 ($TaskName)." -ForegroundColor Green
    Write-Host "  저장 위치: $Dest  /  보관 $Keep 개" -ForegroundColor DarkGray
    Write-Host "  해제: backup.ps1 -Unregister" -ForegroundColor DarkGray
    return
}

# ── 준비 ──────────────────────────────────────────────────────────────

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$LogFile = Join-Path $Dest "backup.log"
function Log($msg, $color = "Gray") {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line -ForegroundColor $color
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Test-Listening($port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Invoke-Rcon($port, [string[]]$commands) {
    $out = & node (Join-Path $PSScriptRoot "rcon.js") $port @commands 2>&1
    if ($LASTEXITCODE -ne 0) { throw "RCON $port 실패: $out" }
    return ($out | Out-String)
}

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$work = Join-Path $env:TEMP "ruc-backup-$stamp"
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force -Path $work | Out-Null

$failed = @()
Log "백업 시작 → $Dest"

# ── 월드 ──────────────────────────────────────────────────────────────

foreach ($name in $Servers.Keys) {
    $s = $Servers[$name]
    $dir = Join-Path $Root "servers\$name"
    if (-not (Test-Path $dir)) { continue }

    $worlds = Get-ChildItem -Path $dir -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName "level.dat") }
    if (-not $worlds) { continue }

    $online = Test-Listening $s.Port
    $savedOff = $false
    try {
        if ($online) {
            Invoke-Rcon $s.Rcon @("save-off", "save-all flush") | Out-Null
            $savedOff = $true
        }
        foreach ($w in $worlds) {
            $target = Join-Path $work "worlds\$name\$($w.Name)"
            # robocopy: 1 이하 = 성공, 8 이상 = 실패. session.lock 은 서버가 잡고 있습니다.
            robocopy $w.FullName $target /E /XF session.lock /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "$($w.Name) 복사 실패 (robocopy $LASTEXITCODE)" }
        }
        Log ("  [{0}] 월드 {1}개{2}" -f $name, @($worlds).Count, $(if ($online) { " (실행 중 — save-off)" } else { "" }))
    } catch {
        Log "  [$name] 실패: $($_.Exception.Message)" "Red"
        $failed += $name
    } finally {
        if ($savedOff) {
            try { Invoke-Rcon $s.Rcon @("save-on") | Out-Null }
            catch { Log "  [$name] ⚠️ save-on 실패 — 콘솔에서 save-on 을 직접 치세요!" "Red"; $failed += "$name-save-on" }
        }
    }
}

# ── DB ────────────────────────────────────────────────────────────────

try {
    $h2Jar = Join-Path $Root "servers\home\plugins\RucCore.jar"   # H2 드라이버가 들어 있습니다
    $dbDir = Join-Path $work "db"
    New-Item -ItemType Directory -Force -Path $dbDir | Out-Null
    $dump = Join-Path $dbDir "ruc-h2.sql"

    # 한글 경로를 java 인자로 넘기지 않으려고 상대 URL 을 씁니다 (작업 폴더 = shared).
    # URL 옵션은 RucCore 의 config 와 같아야 같은 방식으로 파일을 엽니다.
    # 출력 경로는 %TEMP% 아래라 한글이 없습니다.
    Push-Location (Join-Path $Root "servers\shared")
    try {
        $out = & java -cp $h2Jar (Join-Path $PSScriptRoot "DbDump.java") `
            "jdbc:h2:file:./ruc;MODE=MySQL;DATABASE_TO_LOWER=TRUE;AUTO_SERVER=TRUE" `
            $dump 2>&1
    } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dump)) { throw "덤프 실패: $out" }
    Log ("  [db] H2 덤프 {0:N0} KB — {1}" -f ((Get-Item $dump).Length / 1KB), ($out | Out-String).Trim())
} catch {
    Log "  [db] 실패: $($_.Exception.Message)" "Red"
    $failed += "db"
}

# ── 설정 ──────────────────────────────────────────────────────────────

$cfg = Join-Path $work "config"
$copies = @(
    @{ From = "minecraft\proxy\velocity.toml";                          To = "proxy\velocity.toml" }
    @{ From = "minecraft\proxy\plugins\rucgate\config.properties";      To = "proxy\rucgate.properties" }
    @{ From = "MOOKI(General-purpose Discord server bot)\config\roles.json"; To = "mooki\roles.json" }
    @{ From = "MOOKI(General-purpose Discord server bot)\tickets_data.json"; To = "mooki\tickets_data.json" }
    @{ From = "MOOKI(General-purpose Discord server bot)\sanctions_data.json"; To = "mooki\sanctions_data.json" }
    @{ From = "MOOKI(General-purpose Discord server bot)\reaction_roles.json"; To = "mooki\reaction_roles.json" }
)
foreach ($name in $Servers.Keys) {
    $copies += @{ From = "minecraft\servers\$name\server.properties"; To = "$name\server.properties" }
    Get-ChildItem -Path (Join-Path $Root "servers\$name\plugins") -Directory -ErrorAction SilentlyContinue |
        ForEach-Object {
            $yml = Join-Path $_.FullName "config.yml"
            if (Test-Path $yml) {
                $copies += @{ From = $yml.Substring($Repo.Length + 1); To = "$name\plugins\$($_.Name)\config.yml" }
            }
        }
}
$n = 0
foreach ($c in $copies) {
    $src = Join-Path $Repo $c.From
    if (-not (Test-Path $src)) { continue }
    $dst = Join-Path $cfg $c.To
    New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
    $n++
}
Log "  [config] 파일 $n 개"

# ── 압축 · 보관 ───────────────────────────────────────────────────────

$zip = Join-Path $Dest "ruc-$stamp.zip"
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $zip) { Remove-Item -Force $zip }
    # CreateFromDirectory 는 쓰지 않습니다. Windows PowerShell 5.1 의 .NET 은 항목
    # 이름에 '\' 를 넣어서, 리눅스(호스팅)에서 풀면 폴더가 아니라
    # "db\ruc-h2.sql" 이라는 이름의 파일 하나가 됩니다. 항목을 직접 '/' 로 넣습니다.
    Add-Type -AssemblyName System.IO.Compression
    $archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -Path $work -Recurse -File) {
            $entry = $file.FullName.Substring($work.Length + 1).Replace('\', '/')
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $file.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal)
        }
    } finally { $archive.Dispose() }
    Log ("완료 — {0} ({1:N1} MB)" -f (Split-Path $zip -Leaf), ((Get-Item $zip).Length / 1MB)) "Green"
} catch {
    Log "압축 실패: $($_.Exception.Message)" "Red"
    $failed += "zip"
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

# 오래된 것 정리 — 이 스크립트가 만든 이름만 지웁니다.
$old = Get-ChildItem -Path $Dest -Filter "ruc-*.zip" | Sort-Object Name -Descending | Select-Object -Skip $Keep
foreach ($f in $old) {
    Remove-Item -Force $f.FullName
    Log "  오래된 백업 삭제: $($f.Name)" "DarkGray"
}

if ($failed.Count -gt 0) {
    Log "⚠️ 일부 실패: $($failed -join ', ')" "Red"
    exit 1
}
exit 0
