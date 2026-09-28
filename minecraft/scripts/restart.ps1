# 서버 안전 재시작
#
# 사용:
#   .\scripts\restart.ps1 raid             약탈만
#   .\scripts\restart.ps1 home raid        둘 다
#   .\scripts\restart.ps1 proxy            프록시만
#   .\scripts\restart.ps1 all              지금 켜져 있어야 하는 것 전부
#
#   -Force   접속자가 있어도 묻지 않고 재시작
#
# 왜 이 스크립트가 있는가 — 손으로 할 때 빠지기 쉬운 것 세 가지를 담았습니다.
#   1. 접속자 확인. 사람이 들어와 있는데 내리면 그대로 튕깁니다.
#   2. save-all flush 를 먼저. 안 하면 마지막 몇 분의 진행이 날아갑니다.
#   3. 프록시는 RCON 이 없어 프로세스를 직접 죽여야 하고, 그냥 다시 띄우면
#      옛 프로세스가 포트를 쥔 채 남아 "포트는 열려 있는데 새 플러그인은
#      반영 안 되는" 상태가 됩니다 (conversation.md §5.1.1).

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Targets,
    [switch] $Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Enc = @("-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Dfile.encoding=UTF-8")

# 서버별 포트·메모리. start-network.ps1 과 같은 값이어야 합니다.
$Spec = @{
    home  = @{ Port = 25566; Rcon = 25576; Xms = "1G";   Xmx = "2G" }
    raid  = @{ Port = 25567; Rcon = 25577; Xms = "1G";   Xmx = "2G" }
    war   = @{ Port = 25568; Rcon = 25578; Xms = "512M"; Xmx = "1G" }
    peace = @{ Port = 25569; Rcon = 25579; Xms = "512M"; Xmx = "1G" }
}

# 지금 운영 중인 서버 (축소 운영). all 이 가리키는 대상입니다.
$Running = @("home", "raid")

if (-not $Targets -or $Targets.Count -eq 0) {
    Write-Host "무엇을 재시작할지 적어 주세요." -ForegroundColor Yellow
    Write-Host "  .\scripts\restart.ps1 raid"
    Write-Host "  .\scripts\restart.ps1 home raid"
    Write-Host "  .\scripts\restart.ps1 proxy"
    Write-Host "  .\scripts\restart.ps1 all      ($($Running -join ', ') + 프록시)"
    exit 1
}

if ($Targets -contains "all") {
    $Targets = $Running + @("proxy")
}

function Invoke-Rcon($port, $command) {
    $out = & node (Join-Path $PSScriptRoot "rcon.js") $port $command 2>&1
    return ($out | Out-String)
}

function Wait-PortClosed($port, $seconds = 60) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $c) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Wait-Ready($name, $seconds = 180) {
    # 로그에서 "Done (" 를 찾으면 안 됩니다.
    #
    # Paper 는 기동할 때 이전 latest.log 를 .gz 로 넘기는데, 그 사이에 잠깐
    # **옛 로그가 그대로 남아 있습니다.** 거기에는 지난번 기동의 "Done (" 이
    # 들어 있어서, 방금 띄운 서버가 아직 시작도 안 했는데 완료로 읽힙니다.
    # 실제로 이 스크립트를 처음 돌렸을 때 그렇게 오판했습니다.
    #
    # 포트가 열렸는지를 봅니다. 애매하지 않고 로그 회전과 무관합니다.
    $port = $Spec[$name].Port
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($c) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Stop-Backend($name) {
    $s = $Spec[$name]

    $listening = Get-NetTCPConnection -LocalPort $s.Port -State Listen -ErrorAction SilentlyContinue
    if (-not $listening) {
        Write-Host "  [$name] 이미 꺼져 있습니다." -ForegroundColor DarkGray
        return $true
    }

    # 1. 접속자 확인
    $list = Invoke-Rcon $s.Rcon "list"
    if ($list -match "There are (\d+) of") {
        $count = [int]$Matches[1]
        if ($count -gt 0) {
            Write-Host "  [$name] 접속자 $count 명이 있습니다." -ForegroundColor Yellow
            Write-Host "         $($list.Trim())" -ForegroundColor DarkGray
            if (-not $Force) {
                $answer = Read-Host "         그래도 재시작할까요? (y/N)"
                if ($answer -ne "y") {
                    Write-Host "  [$name] 건너뜁니다." -ForegroundColor DarkGray
                    return $false
                }
            }
        }
    }

    # 2. 저장 후 종료
    Write-Host "  [$name] 저장 중…" -ForegroundColor Cyan
    Invoke-Rcon $s.Rcon "save-all flush" | Out-Null
    Invoke-Rcon $s.Rcon "stop" | Out-Null

    if (Wait-PortClosed $s.Port) {
        Write-Host "  [$name] 종료됨" -ForegroundColor Green
        return $true
    }
    Write-Host "  [$name] 60초 안에 안 내려갔습니다. 콘솔 창을 확인하세요." -ForegroundColor Red
    return $false
}

function Start-Backend($name) {
    $s = $Spec[$name]
    $dir = Join-Path $Root "servers\$name"

    if (-not (Test-Path (Join-Path $dir "eula.txt"))) {
        Write-Host "  [$name] EULA 미동의 — scripts\accept-eula.ps1 을 먼저 실행하세요." -ForegroundColor Red
        return
    }

    Write-Host "  [$name] 기동 중…" -ForegroundColor Cyan
    Start-Process -FilePath "java" -WorkingDirectory $dir -WindowStyle Minimized `
        -ArgumentList ($Enc + @("-Xms$($s.Xms)", "-Xmx$($s.Xmx)", "-jar", "paper.jar", "nogui"))

    if (Wait-Ready $name) {
        Write-Host "  [$name] 준비 완료" -ForegroundColor Green
    } else {
        Write-Host "  [$name] 3분 안에 준비되지 않았습니다. logs\latest.log 를 보세요." -ForegroundColor Red
    }
}

function Restart-Proxy() {
    Write-Host "  [proxy] velocity 프로세스를 찾습니다…" -ForegroundColor Cyan

    # 프록시에는 RCON 이 없습니다. 프로세스를 직접 내려야 합니다.
    # 플레이어 데이터를 들고 있지 않아 강제 종료가 안전합니다 — 백엔드는
    # 절대 이렇게 내리지 마세요.
    $procs = Get-CimInstance Win32_Process -Filter "Name='java.exe'" |
             Where-Object { $_.CommandLine -match 'velocity\.jar' }

    foreach ($p in $procs) {
        Write-Host "  [proxy] 종료 PID $($p.ProcessId) (시작 $($p.CreationDate))" -ForegroundColor DarkGray
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 3

    # 25565 가 진짜로 비었는지 확인합니다. 여기서 확인하지 않으면 새 프록시가
    # BindException 으로 죽고, 포트는 열려 있어서 정상처럼 보입니다.
    $still = Get-NetTCPConnection -LocalPort 25565 -State Listen -ErrorAction SilentlyContinue
    if ($still) {
        Write-Host "  [proxy] 25565 를 PID $($still.OwningProcess) 가 아직 쥐고 있습니다. 중단합니다." -ForegroundColor Red
        return
    }

    Write-Host "  [proxy] 기동 중…" -ForegroundColor Cyan
    Start-Process -FilePath "java" -WorkingDirectory (Join-Path $Root "proxy") -WindowStyle Minimized `
        -ArgumentList ($Enc + @("-Xms256M", "-Xmx512M", "-XX:+UseG1GC", "-jar", "velocity.jar"))
    Start-Sleep -Seconds 10

    $now = Get-NetTCPConnection -LocalPort 25565 -State Listen -ErrorAction SilentlyContinue
    if ($now) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($now.OwningProcess)"
        Write-Host "  [proxy] 준비 완료 — PID $($now.OwningProcess) (시작 $($p.CreationDate))" -ForegroundColor Green
    } else {
        Write-Host "  [proxy] 25565 가 열리지 않았습니다. proxy\logs\latest.log 를 보세요." -ForegroundColor Red
    }
}

# ── 실행 ──────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "재시작 대상: $($Targets -join ', ')" -ForegroundColor White
Write-Host ""

# 백엔드를 먼저 다 내리고, 다 올린 뒤, 프록시를 마지막에 만집니다.
# 프록시가 먼저 뜨면 붙일 백엔드가 없어서 접속한 사람이 오류를 봅니다.
$backends = $Targets | Where-Object { $Spec.ContainsKey($_) }
$doProxy  = $Targets -contains "proxy"

$stopped = @()
foreach ($name in $backends) {
    if (Stop-Backend $name) { $stopped += $name }
}
foreach ($name in $stopped) {
    Start-Backend $name
}
if ($doProxy) { Restart-Proxy }

Write-Host ""
Write-Host "--- 지금 상태 ---" -ForegroundColor White
foreach ($name in @("home", "raid", "war", "peace")) {
    $c = Get-NetTCPConnection -LocalPort $Spec[$name].Port -State Listen -ErrorAction SilentlyContinue
    if ($c) { $state = "켜짐" ; $color = "Green" } else { $state = "꺼짐" ; $color = "DarkGray" }
    Write-Host ("  {0,-6} {1}" -f $name, $state) -ForegroundColor $color
}
$px = Get-NetTCPConnection -LocalPort 25565 -State Listen -ErrorAction SilentlyContinue
if ($px) { Write-Host "  proxy  켜짐" -ForegroundColor Green } else { Write-Host "  proxy  꺼짐" -ForegroundColor DarkGray }
Write-Host ""
