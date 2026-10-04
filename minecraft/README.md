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

## 접속 가능 버전

서버는 1.21.11 이고, **클라이언트는 1.21 ~ 1.21.11 (그리고 프록시가 아는 더 새 버전, 지금은 26.2 까지)** 로 접속할 수 있습니다.
프록시의 ViaVersion + ViaBackwards 가 버전을 번역합니다. 백엔드와 Ruc 플러그인은 늘 1.21.11 만 봅니다.

| 클라이언트 | 결과 |
|---|---|
| 1.21.11 | 그대로 |
| 1.21 ~ 1.21.10 | 접속 가능. 그 버전 뒤에 나온 블록 · 아이템 · 몹은 비슷한 것으로 **보이기만** 다르고, 규칙은 서버가 판정하므로 같습니다 |
| 1.20.6 이하 | 접속 차단 + 안내 메시지 |

**1.21 이 하한인 이유** — 그 아래부터는 "보이는 것"이 아니라 플레이가 달라집니다.

| 버전 | 깨지는 것 |
|---|---|
| 1.20.6 이하 | 철퇴 · 크래프터 · 시련의 회당 · 돌풍구 (1.21 콘텐츠) 를 제대로 쓸 수 없음 |
| 1.20.2 이하 | 오른쪽 스코어보드에 빨간 숫자가 그대로 보임 (`NumberFormat.blank` 는 1.20.3+) |
| 1.19.4 이하 | 네더라이트 강화(대장장이 형판) 불가. 1.19.3 이하는 홈 서버 NPC 이름표(`TextDisplay`)도 안 보임 |
| 1.17.x 이하 | 월드 높이(-64~320)를 몰라 지하에서 깨짐 |
| 1.8 이하 | 전투 방식 자체가 다름 — ViaRewind 는 넣지 않습니다 |

하한을 바꾸려면 `proxy/plugins/viaversion/config.yml` 의 `block-versions` 를 고치고 프록시를 재시작합니다.
같은 파일의 `velocity-servers.default: 774` 는 지우지 마세요 — 비우면 1.13 으로 잡혀서, 핑을 아직 못 받은 서버로 넘어갈 때 번역이 어긋납니다.
ViaVersion · ViaBackwards 는 `setup.ps1` 에서 5.12.0 으로 고정해 받습니다. 올릴 때는 두 개를 같은 버전으로 함께 올리세요.

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
| 디스코드 인증 게이트 | D10 | ✅ 런타임 검증 완료 |

**RucHome (v0.1.0)** — 홈 서버 전용

| 기능 | 명세 | 상태 |
|---|---|---|
| 허브 전용 빈 월드 + 광장 생성 | §2.3 | ✅ |
| PvP 불가 · 블록 파괴/설치 불가 | §2.3 | ✅ |
| 어드벤처 · 낙하데미지 없음 · 항상 낮/맑음 · 배고픔 고정 | D1 | ✅ |
| 서버 선택 NPC 3체 | D1 | ✅ |
| 나침반 GUI (5번 슬롯) | D1 | ✅ |
| 인증 격리 섬 (광장에서 512블록) | D10 | ✅ |
| 정보 보드 · 랭킹 벽 · 튜토리얼 | D1 | ⬜ |

### 빌드

Gradle 멀티 프로젝트입니다. 루트는 `plugins/` 이고, 모듈이 늘어나면 `settings.gradle.kts` 에 추가합니다.

```powershell
cd plugins
java -classpath "gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain build
```

결과물:
- `RucCore/build/libs/RucCore-0.1.0.jar` — 약 7MB (JDBC 드라이버 포함). 4개 서버 전부에 배치
- `RucHome/build/libs/RucHome-0.1.0.jar` — 약 23KB. 홈 서버에만 배치

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
