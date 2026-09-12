# 마인크래프트 서버

Paper 1.21.11 + Velocity 프록시. 자바 에디션 전용 (Q2 결정).

## 처음 시작할 때

```powershell
# 1. Paper/Velocity 다운로드 + 플러그인 빌드 + 배치
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# 2. EULA 동의 (운영자 본인이 직접)
powershell -ExecutionPolicy Bypass -File scripts\accept-eula.ps1

# 3. 홈 서버 실행
powershell -ExecutionPolicy Bypass -File scripts\start-home.ps1
```

`setup.ps1`은 빌드 번호를 하드코딩하지 않고 PaperMC API에서 최신 STABLE을 조회합니다. 다시 실행하면 최신 빌드로 갱신되고, 이미 받은 파일은 건너뜁니다. 체크섬도 검증합니다.

## 구조

```
minecraft/
├── proxy/              Velocity — 플레이어가 접속하는 유일한 창구 (25565)
├── servers/
│   ├── home/           홈 25566 · 어드벤처 · 평화 난이도
│   ├── raid/           약탈 25567
│   ├── war/            국가전 25568
│   └── peace/          평화 25569
├── plugins/RucCore/    공용 플러그인 소스 (Gradle)
└── scripts/            setup / accept-eula / start-home
```

## ⚠️ 보안 — 반드시 지킬 것

| 항목 | 값 | 이유 |
|---|---|---|
| Velocity `online-mode` | **true** | false면 UUID 위조가 가능해져 **디스코드 인증(D10)이 통째로 무력화**됩니다 |
| 백엔드 `online-mode` | false | 정상입니다. 프록시가 이미 인증하고 서명된 정보를 넘깁니다 |
| 방화벽 | **25565만 개방** | 25566~25569가 외부에 열리면 누구나 아무 UUID로 직접 접속할 수 있습니다. 이게 프록시 구조의 유일한 치명적 함정입니다 |
| `forwarding.secret` | git 제외됨 | 프록시↔백엔드 신뢰의 근거입니다 |

백엔드 서버를 처음 켜면 Velocity 포워딩을 켜야 합니다. 각 서버의 `config/paper-global.yml`:

```yaml
proxies:
  velocity:
    enabled: true
    online-mode: true
    secret: '<proxy/forwarding.secret 파일과 동일한 값>'
```

## RucCore 플러그인

4개 서버가 전부 올리는 공용 플러그인입니다. 화폐·경험치·평판처럼 서버를 넘나드는 것은 전부 여기가 소유합니다.

### 현재 구현된 것 (v0.1.0)

| 기능 | 명세 | 상태 |
|---|---|---|
| Ruc 화폐 (4서버 공용) | §3.1 | ✅ |
| 자체 경험치 (바닐라와 분리) | §3.4 | ✅ |
| 레벨 곡선 (고레벨일수록 가파름) | §3.4 | ✅ |
| 우측 스코어보드 7줄 | §3.6 / D9 | ✅ |
| 핑 등급 표시 | §3.6 | ✅ |
| 좌표 표시 억제 | §2.2 | ✅ |
| `/tpa` `/tpahere` `/tpaccept` `/tpdeny` `/tpcancel` | §3.3 | ✅ |
| 한국어/영어 (`/언어`) | §6.3 | ✅ |
| 평판 7티어 표시 | §3.7 | ✅ (점수 변동 로직은 Phase 7) |
| 디스코드 인증 게이트 | D10 | ✅ (런타임 미검증) |

### 빌드

```powershell
cd plugins\RucCore
java -classpath "gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain build
```

결과물: `build/libs/RucCore-0.1.0.jar` (약 7MB — JDBC 드라이버 포함)

### 데이터베이스

기본값은 **H2**(임베디드, 설치 불필요)입니다. MySQL 호환 모드로 띄워서, 운영 전환 시 쿼리를 고칠 필요가 없습니다.

VPS로 옮길 때는 각 서버의 `plugins/RucCore/config.yml`에서:

```yaml
database:
  type: mysql
  mysql:
    host: ...
```

**4개 서버가 반드시 같은 DB를 봐야 합니다.** 그래야 "Ruc는 모든 서버 공용"(§3.1)과 드래곤 알의 네트워크 전역 버프(D3)가 성립합니다.

### 설정

`plugins/RucCore/config.yml`은 서버마다 `server-id`와 `server-display-name`만 다르고 나머지는 동일합니다.

경험치 곡선은 `xp.base`와 `xp.exponent`로 조절합니다. 필요 경험치 = `base × 레벨^exponent`이므로, exponent를 올리면 고레벨 구간이 급격히 가팔라집니다.

## 다음 작업

1. 홈 광장 맵 (Q6 — 라이선스 확인 필요)
2. NPC 서버 선택기 · 정보 보드 · 나침반 GUI (D1)
3. 인증 구역 좌표를 실제 맵에 맞게 설정
4. 약탈 서버 콤벳로그 처형 (Phase 3)

---

## 디스코드 인증 (D10)

### 왜 RCON을 쓰는가

RucCore는 자바 임베디드 DB(H2)를 쓰고 MOOKI는 Node.js입니다. **Node는 H2 파일을 읽을 수 없습니다.** `.env`에 이미 RCON 설정이 있었으므로 그것을 연동 통로로 씁니다. 운영에서 MySQL로 바꿔도 이 경로는 그대로 동작합니다.

```
플레이어 접속
   │
   ▼
RucCore: discord_id 가 있는가?
   ├─ 있음 → 광장 통과
   └─ 없음 → 인증 구역 격리 + 6자리 코드 발급
                │
                ▼
        디스코드에서  /인증 123456
                │
                ▼
        MOOKI → RCON → rucverify <code> <discordId> <name>
                │
                ▼
        RucCore 검증 → discord_id 기록 → "RUCVERIFY SUCCESS"
                │
                ▼
        RucCore 폴링(3초)이 감지 → 격리 해제 → 광장으로 이동
```

### 격리 중 차단되는 것

이동(구역 밖), 채팅, 블록 파괴·설치, 상호작용, 인벤토리, 아이템 드랍·획득, 데미지 주고받기, 허용 목록 외 명령어.

허용: `/인증`, `/언어`, `/help`

### 1:1 연동 — 실제 차단력의 근원

코드 입력 자체는 장벽이 아닙니다. **디스코드 계정 하나에 마크 계정 하나만** 묶이는 것이 핵심입니다. `ruc_player.discord_id`의 UNIQUE 인덱스가 DB 차원에서 강제하므로 애플리케이션 버그로도 뚫리지 않습니다.

부계정을 만들려면 전화번호 인증된 새 디스코드 계정이 필요해집니다.

추가 조건: 디스코드 계정 생성 후 7일 경과, 서버 멤버일 것, 5회 실패 시 10분 잠금.

### 봇이 죽었을 때

신규 유입이 전면 차단되므로 우회로가 필요합니다.

```
/인증승인 <닉네임>     (스태프, ruccore.admin 권한)
```

### RCON 보안

| 항목 | 값 |
|---|---|
| 포트 | 25576 (홈 서버) |
| 비밀번호 | `setup.ps1`이 서버마다 28자 랜덤 생성 |
| 노출 | **절대 외부에 열지 마세요.** RCON은 임의 콘솔 명령 실행 권한입니다 |

`server.properties`는 `rcon.password`를 담고 있어 **git에서 제외**됩니다. 저장소에는 `server.properties.example`만 있고, `setup.ps1`이 여기서 실제 파일을 만들면서 비밀번호를 새로 발급합니다.

`.env`에는 `RUC_RCON_HOST` / `RUC_RCON_PORT` / `RUC_RCON_PW` 세 개를 씁니다. 기존 `MC_*` 키는 건드리지 않았습니다.
