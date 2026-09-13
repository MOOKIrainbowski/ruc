# 러크 서버 — 작업 인수인계

> 마지막 갱신: 2026-09-14 / 마지막 커밋 `bf747c7`
>
> 이 문서 하나만 읽고도 이어서 작업할 수 있게 쓴 것입니다. 계획의 원본은
> `docs/00-PLAN.md`, 설계 결정은 `docs/01-DEFINE-DECISIONS.md` 에 있습니다.
> 여기에는 **지금 상태**와 **다시 밟지 않아야 할 함정**을 적습니다.

---

## 1. 프로젝트 한 줄 요약

마인크래프트 서버 네트워크 **4개 서버**(홈 / 약탈 / 국가전 / 평화)를 Velocity
프록시로 묶고, **Ruc 화폐와 자체 경험치를 네트워크 전역에서 공유**합니다.
디스코드 봇(MOOKI)과 마케팅 웹사이트가 딸려 있습니다.

원본 요구사항은 `ruc-server-project-prompt.md` 입니다. 문서·대화는 전부 한국어로
진행합니다.

---

## 2. 지금 어디까지 왔나

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 기반 정리 · 보안 | ✅ 완료 |
| 1 | 웹사이트 (Next.js → Vercel) | ✅ 배포됨 |
| 2 | 네트워크 골격 + 홈(허브) 서버 | ✅ 완료 |
| — | 허브 맵 (여러 차례 재설계) | ✅ 완료 |
| 3 | 약탈 서버 (`RucRaid`) | ✅ 완료 |
| — | Velocity 프록시 연결 | ✅ 완료 |
| 3.5 | Shift+F 네트워크 메뉴 | ✅ 완료 |
| **4** | **국가전 서버** | ⬜ **다음 차례 (최대 난이도)** |
| 5 | 평화 서버 | ⬜ |
| 6 | 디스코드 정비 | ⬜ |
| 7 | 평판 · 신고 · 제재 | ⬜ |
| 8 | 수익화 | ⬜ (Q5 미해결로 보류) |
| 9 | 폴리싱 · 런칭 | ⬜ |

---

## 3. 지금 실행 중인 것

작성 시점 기준 **프록시 + 백엔드 4개가 전부 떠 있습니다.**

| 대상 | 포트 | RCON | 비고 |
|---|---|---|---|
| Velocity 프록시 | **25565** | — | 플레이어는 여기로만 접속 |
| home (허브) | 25566 | 25576 | `hub` 월드, 광장 |
| raid (약탈) | 25567 | 25577 | 바닐라 지형 |
| war (국가전) | 25568 | 25578 | 빈 바닐라 월드 (콘텐츠 없음) |
| peace (평화) | 25569 | 25579 | 빈 바닐라 월드 (콘텐츠 없음) |

백엔드는 전부 `server-ip=127.0.0.1` 로 묶여 있습니다. **이걸 풀면 안 됩니다** —
프록시를 건너뛰고 백엔드에 직접 붙으면 D10 디스코드 인증이 통째로 우회됩니다.

### 실행 / 종료

```powershell
# 전체 기동 (백엔드 4개 → 준비 대기 → 프록시)
minecraft\scripts\start-network.ps1

# 개별
minecraft\scripts\start-home.ps1
minecraft\scripts\start-raid.ps1
```

종료는 각 콘솔에 `stop`, 또는 RCON 으로 보냅니다. RCON 비밀번호는 로컬 개발용
`ruc-<서버이름>-local-dev` 입니다 (예: `ruc-raid-local-dev`).
**운영 전에 반드시 바꾸거나 RCON 을 끄세요.**

### 빌드

```bash
cd minecraft/plugins
java -Dorg.gradle.appname=gradlew -classpath gradle/wrapper/gradle-wrapper.jar \
     org.gradle.wrapper.GradleWrapperMain build
```

`gradlew` 스크립트 파일은 없고 wrapper jar 만 있습니다. 위 형태로 직접 부릅니다.
산출물은 `plugins/<모듈>/build/libs/<모듈>-0.1.0.jar` 이고,
`minecraft/servers/<서버>/plugins/` 로 복사해야 반영됩니다.

---

## 4. 구성 요소

```
러크서버/
├── minecraft/
│   ├── proxy/              Velocity 3.5.1 + velocity.toml + forwarding.secret(비공개)
│   ├── servers/
│   │   ├── home/ raid/ war/ peace/
│   │   └── shared/ruc.mv.db      ← 4개 서버 공용 H2 DB
│   ├── plugins/            Gradle 멀티 프로젝트 (RucCore / RucHome / RucRaid)
│   └── scripts/            *.ps1 실행 스크립트
├── web/                    Next.js 15 + Tailwind v4 → Vercel 배포됨
├── MOOKI(...)/             discord.js v14 봇 (/인증 담당)
├── docs/                   계획 · 결정 · 미해결 · 배포 · 맵 설계
└── mapfile/                참고용 맵 (학습 목적, 재배포 불가)
```

### 플러그인 구조

- **RucCore** (20개 java) — 4개 서버가 전부 올립니다.
  화폐 / 자체 XP / 평판 / 스코어보드 / `/tpa` / 디스코드 인증(D10) /
  **Shift+F 메뉴** / 프록시 통신(`NetworkService`) / 보상 배수 훅(`BonusRegistry`)
- **RucHome** (11개) — 허브 전용. 광장 생성(`PlazaBuilder`), 서버 선택 NPC,
  낙하 보호(`VoidGuard`), 벚꽃 연출
- **RucRaid** (11개) — 약탈 전용. 전투 태그, 전투로그 처형, `/home`·`/spawn`,
  드래곤 알(D3)

새 서버 모듈을 추가할 때는 `minecraft/plugins/settings.gradle.kts` 에
`include("RucWar")` 를 넣고, `build.gradle.kts` 는 RucRaid 것을 그대로 베끼면 됩니다
(`compileOnly(project(":RucCore"))` + `dependsOn(":RucCore:shadowJar")` +
`archiveClassifier.set("")`).

---

## 5. 반드시 알아야 할 함정

실제로 한 번씩 밟았던 것들입니다. 다시 밟지 마세요.

### 5.1 검증 방법

| 함정 | 내용 |
|---|---|
| **`execute ... run say X` 는 못 씁니다** | RCON 이 **빈 문자열**을 돌려줘서 "성공"으로 오독합니다. `run` 없이 `execute if block <x> <y> <z> <block>` 을 쓰면 `Test passed` / `Test failed` 가 옵니다. |
| **"not loaded" ≠ "블록 있음"** | 플레이어가 없으면 청크가 언로드됩니다. `forceload add` 로 먼저 로드하세요. `forceload` 는 **256청크 초과 시 조용히 실패**합니다. |
| **게임룰 조회가 안 됩니다** | 1.21.11 에서 게임룰 ID 가 전부 `minecraft:snake_case` 로 바뀌었습니다. `gamerule keepInventory` 는 거부됩니다. 확실한 소스는 `world/level.dat` 의 `Data.game_rules` (`save-all flush` 후 읽기). |
| **Material 상수를 추측하지 마세요** | `Material.CHAIN` 은 1.21.9 에서 `IRON_CHAIN` 으로 바뀌었습니다. 빌드 전에 `javap` 로 paper-api jar 를 직접 확인하는 습관이 여러 번 사고를 막았습니다. |

### 5.2 인코딩

| 대상 | 규칙 |
|---|---|
| `.ps1` | **BOM 이 필요합니다.** 없으면 PS 5.1 이 ANSI 로 읽어 한글이 깨집니다. |
| `server.properties` 등 Java properties | **BOM 이 있으면 안 됩니다.** 키가 `﻿eula` 가 되어 인식되지 않습니다. |
| JVM 실행 | `-Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dfile.encoding=UTF-8` 없으면 콘솔 한글이 깨집니다. (`logs/latest.log` 자체는 원래 UTF-8 이라 멀쩡합니다.) |
| `.env` | CRLF 입니다. 정규식에서 `$` 를 쓰면 `\r` 때문에 안 걸립니다. `split(/\r?\n/)` 로 자르세요. |

### 5.3 설정 배포

- **`saveDefaultConfig()` 는 기존 파일을 덮지 않습니다.** 소스의 기본값을 고쳐도
  이미 배포된 `servers/*/plugins/*/config.yml` 은 그대로입니다. 드래곤 알 제단이
  허공에 지어졌던 원인이 이것이었습니다. 기본값을 바꿨다면 **배포본도 같이 고치거나
  지우고 다시 생성**시켜야 합니다.
- 메시지 파일(`messages_*.yml`)에 키를 추가했으면 배포본을 지워서 jar 에서 다시
  꺼내지게 하세요.

### 5.4 `.gitignore`

`minecraft/**/world*/` 라고 쓰면 **자바 패키지 디렉터리 `.../home/world/` 까지
매칭**되어 소스가 커밋에서 빠집니다(한 번 겪었습니다). `minecraft/servers/*/world*/`
처럼 좁게 쓰세요. 커밋 전에 `git add -An <경로>` 로 실제 대상 파일을 확인하는 것이
안전합니다.

### 5.5 대형 파일 작성

Java 텍스트 블록(`"""`)이 들어간 큰 파일을 bash heredoc 으로 쓰면 깨집니다.
Node 스크립트를 heredoc 에 넣을 때도 백슬래시가 이스케이프로 먹히거나 큰따옴표가
셸을 닫아버립니다. **큰 파일은 Write 도구로, 패치 스크립트는 스크래치패드에 파일로
저장한 뒤 실행**하는 쪽이 확실합니다.

---

## 6. 설계상 중요한 판단들

나중에 "왜 이렇게 했지?" 하고 되돌리기 쉬운 것들입니다.

### 6.1 전투로그 처형 — 순서가 규칙의 전부 (§2.4)

```java
inventory.clear();      // ← 반드시 먼저
wipeXp(player);
player.setTotalExperience(0);
player.setHealth(0.0);  // ← 그 다음에 죽입니다
```

그냥 죽이기만 하면 **콤벳로그가 오히려 이득**이 됩니다. 불리한 싸움에서 끊고,
안전한 곳에서 재접속해 죽으면 드랍을 지인이 줍고 상대에게는 아무것도 안 넘어가니까요.
**드랍이 남지 않는 것이 핵심**입니다.

관련해서:
- 전투 태그는 **양쪽 다** 겁니다. 때린 쪽만 걸면 맞기만 하다 끊고 도망치는 경로가
  그대로 열립니다.
- 화살·물약·TNT·길들인 동물까지 **최초 가해자를 역추적**합니다. 직접 타격만 보면
  원거리·폭발 딜러가 태그를 피해 갑니다.
- 태그 중 `/home` `/spawn` `/tpa` 를 막습니다. 안 막으면 처형 규칙이 무의미합니다.
- 퇴장 기록만 **동기로** DB 에 씁니다. 비동기면 퇴장 직후 서버가 내려갈 때 유실되고,
  하필 그게 노려지는 상황입니다.
- 레벨은 유지합니다(`execution-resets-level: false`). 수십 시간짜리 누적을 한 번의
  콤벳로그로 지우면 처벌이 아니라 그만둘 사유가 됩니다.

### 6.2 `EconomyService.reward()` vs `deposit()`

드래곤 알의 "Ruc +15%" 배수는 **`reward()` 에만** 적용됩니다. `deposit()` 에 걸면
`transfer()` 가 그걸 타기 때문에, **알 소지자에게 송금했다 돌려받는 것만으로 화폐가
늘어납니다.** "번 돈"과 "받은 돈"은 반드시 분리해야 합니다.

### 6.3 드래곤 알 배치 판정은 DB 플래그로 (D3)

"지금 월드에 알이 있는가"로 보면 안 됩니다. 누가 들고 있는 상태를 "없음"으로
오해해서 **알이 계속 복제**됩니다. `ruc_raid_state.dragon_egg_placed` 로 판정합니다.
DB 를 옮길 일이 있으면 이 플래그도 반드시 같이 옮기세요.

또한 **드래곤 알은 모래처럼 중력을 받는 블록**입니다. 제단 Y 를 허공에 고정하면
그대로 떨어집니다. 지금은 `altar.y: -1` (지표면 자동 스냅) + 흑요석 제단 건설입니다.

### 6.4 메뉴 판별은 홀더 타입으로

인벤토리 제목 문자열로 "우리 메뉴인지" 판단하면, 언어·색코드가 조금만 바뀌어도
**클릭 차단이 통째로 풀립니다.** `MenuHolder implements InventoryHolder` 타입으로
봅니다.

### 6.5 Shift + F 가 되는 이유

서버는 클라이언트의 임의 키를 볼 수 없습니다. 바닐라에서 **F 는 "손에 든 아이템
교체"**라 패킷이 오고, 그게 `PlayerSwapHandItemsEvent` 입니다. 웅크림 여부는 서버가
이미 아니까 둘을 합치면 Shift+F 가 됩니다. **모드·리소스팩 없이 되는 유일한
방법입니다.** 이벤트를 취소하지 않으면 메뉴가 열리면서 손의 아이템도 바뀝니다.
F 를 재배치한 사람을 위해 `/메뉴` 도 제공합니다.

### 6.6 레벨업 판정은 멱등하게, 접속 시에도

`XpService.normalize()` 는 여러 번 불러도 결과가 같고, `award()` 와 접속
시점(`catchUp()`) 양쪽에서 호출합니다. 판정이 `award()` 안에만 있으면 **저장된
경험치가 이미 요구치를 넘긴 상태에서 다음 획득까지 레벨이 멈춥니다.**

진행바는 **내림**을 씁니다. 반올림이면 95% 에서 이미 10칸이 다 차서, 막대가 가득
찼는데 레벨이 안 오르는 것처럼 보입니다.

---

## 7. 프록시와 UUID — 가장 최근에 정리된 부분

### 7.1 왜 Velocity 3.5.1 인가

받아뒀던 `velocity.jar` 는 **4.1.2-SNAPSHOT 이라 Java 25(class file 69)** 를 요구해서
JDK 21 에서 실행되지 않았습니다. 3.5.1(build 615, RECOMMENDED)은 class 65 이고,
`velocity.toml` 의 `config-version` 도 3.x 형식이라 설정을 그대로 씁니다.
구버전 jar 은 `velocity-4.1.2-snapshot.jar.bak` 로 남겨뒀습니다.

1.21.11 지원 확인법: 프로토콜 **774** 로 핑하면 774 를 그대로 돌려주고, 미지원
값(999)을 보내면 자기 최대치(776)로 답합니다.

### 7.2 스킨이 안 뜨던 이유

백엔드가 **오프라인 모드**였고 프록시가 없었습니다. 오프라인 모드에는 모장 인증이
없으니 **프로필에 텍스처 속성 자체가 들어오지 않습니다.** 코드가 프로필을 건드린
곳은 한 군데도 없었습니다.

지금은 프록시 `online-mode = true` + 백엔드 `velocity.online-mode: true` 라
서명된 프로필이 텍스처와 함께 전달됩니다.

### 7.3 UUID 가 바뀝니다 — 앞으로도 주의

| 종류 | 예시 | 버전 문자 |
|---|---|---|
| 오프라인 (이름 해시) | `d5a8ee67-79b3-**3**a0e-...` | 3 |
| 정품 (Mojang) | `cf9e8f21-108b-**4**8e5-...` | 4 |

프록시를 붙이기 전 데이터는 전부 오프라인 UUID 에 묶여 있어서 **orphan 이 됩니다.**
`M02ki` 의 디스코드 인증이 실제로 그랬고, 정품 UUID 행으로 이관했습니다.
`discord_id` 에 UNIQUE 가 걸려 있어 **원본 쪽을 먼저 비워야** 합니다.

### 7.4 DB 는 하나여야 합니다 (§3.1)

4개 서버가 각자 `plugins/RucCore/data` 를 쓰고 있었습니다. 프록시 전에는 안
드러났지만, 이동이 가능해지는 순간 **홈에서 인증한 사람이 약탈에서는 미인증자**가
되고 지갑도 따로 놉니다.

지금은 `h2-file: "../../../shared/ruc"` 로 4개가 `servers/shared/ruc.mv.db` 를
같이 봅니다 (H2 `AUTO_SERVER=TRUE`). 옛 개별 DB 는 `data.mv.db.old` 로 남겨뒀습니다.

4개가 동시에 뜨면 H2 잠금 경쟁(`FileLock.waitUntilOld`)으로 한두 개가 죽습니다.
`Database.openWithRetry()` 에 지수 백오프 재시도를 넣었고, 시작 스크립트도 어긋나게
띄웁니다.

> **운영 전환 시:** `database.type` 을 `mysql` 로 바꾸면 이 문제는 사라집니다.
> 쿼리는 H2 를 MySQL 호환 모드로 띄워 두었으므로 그대로 동작합니다.

---

## 8. 아직 검증하지 못한 것

로컬에서 자동으로 확인할 수 없어 **실제 플레이어 접속이 필요한** 항목입니다.

| 항목 | 확인 방법 |
|---|---|
| 스킨이 실제로 뜨는지 | `localhost:25565` 접속 후 Shift+F → "내 정보" 칸의 머리가 본인 스킨인지 |
| Shift + F 메뉴가 열리는지 | 웅크린 채 F. 안 되면 `/메뉴` |
| 메뉴에서 서버 이동 | 4칸 중 다른 서버 클릭. 인원 표시는 접속 후 최대 10초 뒤 채워짐 |
| **전투로그 처형** | `/raid tag` → 15초 안에 게임 종료 → 재접속. **빈손으로 죽고 바닥에 아무것도 안 떨어져야** 정상 |
| `/home` `/spawn` 시전·취소 | 시전 중 이동하면 취소되는지 |
| 드래곤 알 버프 | 제단(약탈 `0, 66, 0`)에서 알을 들고 체력 +4 / 발광 노출 확인 |
| 낙하 보호(VoidGuard) | 허브 가장자리 밖으로 떨어져 보기 |
| XP 레벨업 | `/rucxp 500` 으로 즉시 확인 (스태프 전용) |

---

## 9. 다음 작업 — Phase 4 (국가전)

계획서상 **최대 난이도(5~7일)** 구간입니다.

- [ ] 길드 시스템 (§3.5) — 길드장/부길드장/길드원, 창설 조건(최소 레벨 + Ruc),
      주간 보상, 시즌 랭킹
- [ ] **국가 승격** — 길드원 수 임계치 초과 시 Nation 인정
- [ ] **입장 제한** — 국가 소속이 아니면 진입 차단.
      **Velocity 단에서 거부**해야 합니다 (서버에 들여보낸 뒤 킥하면 로딩 낭비).
      → Velocity 플러그인을 따로 만들어야 하므로 **새로운 빌드 대상**입니다.
- [ ] **코어 제작 체인** (D2) + 코어 아이템
- [ ] **영토 시스템** — 코어 설치 지점 → 청크 클레임, 전쟁 시간대에만 탈취 가능
- [ ] **전쟁 시간대 스케줄러** — 피크 타임에만 개전
- [ ] `/국가창고`, `/tp [코어명]`

### 착수 전에 정할 것

1. **war 서버 월드** — 지금은 빈 바닐라 월드입니다. 영토/코어를 얹으려면 지형
   기준을 먼저 정해야 합니다 (바닐라 그대로 갈지, 허브처럼 생성할지).
2. **Velocity 플러그인 빌드** — 입장 제한을 프록시 단에서 하려면 Velocity API
   모듈이 필요합니다. Gradle 에 서브프로젝트를 하나 더 추가하는 작업이 선행됩니다.
3. **길드 데이터 스키마** — `ruc_guild`, `ruc_guild_member`, `ruc_claim` 정도가
   필요합니다. 공용 DB 에 들어갑니다.

---

## 10. 아직 열려 있는 질문

| # | 내용 | 막고 있는 것 |
|---|---|---|
| Q1 | 호스팅 (하이브리드 권장안 제시됨) | 실제 운영 배포 |
| Q4 | 기존 Ruc 잔고 이관 비율 — 한 유저가 **1,000,116,255** 보유. 환산 비율이나 상한이 필요 | 디스코드 경제 통합 |
| Q5 | 수익화 수단 + 한국 통신판매업 신고 | Phase 8 전체 |

Q2(버전 = Java 판 1.21.x 안정), Q3(JDK 21 설치됨), Q6(맵은 직접 생성)은 해결됐습니다.

---

## 11. 보안 체크리스트 (운영 전환 전)

- [ ] RCON 비밀번호 4개 전부 변경 또는 `enable-rcon=false`
- [ ] `minecraft/proxy/forwarding.secret` 유출 여부 확인 (gitignore 되어 있음)
- [ ] `MOOKI(...)/.env` 의 디스코드 토큰 — git 에 올라간 적 없는지 재확인
- [ ] 방화벽에서 **25565 만** 개방. 25566~25569 는 절대 열지 말 것
- [ ] `database.type` 을 `mysql` 로 전환
- [ ] `online-mode = true` (프록시) 유지 — false 로 두면 UUID 위조로 D10 인증이
      통째로 무력화됩니다

---

## 12. 유용한 도구 (스크래치패드)

세션마다 임시 디렉터리에 만들어 쓴 것들입니다. 필요하면 다시 만드세요.

- `slp.js` — 서버 목록 핑. 프록시/백엔드 5개 상태를 한 번에 확인
- `login2.js` — 백엔드 직접 로그인 시도. 프록시 우회가 막혔는지 검증
- `nbt.js` / `render.js` / `elevation.js` / `holecheck.js` / `census.js` —
  맵 렌더링·검증 도구 일체 (직접 만든 NBT/region 파서 + PNG 인코더)
- H2 조회용 단발 Java 프로그램 —
  `java -cp <h2.jar> Foo.java` 형태로 컴파일 없이 바로 실행됩니다

H2 jar 위치:
`~/.gradle/caches/modules-2/files-2.1/com.h2database/h2/2.3.232/.../h2-2.3.232.jar`

paper-api jar (Material 확인용):
`~/.gradle/caches/modules-2/files-2.1/io.papermc.paper/paper-api/1.21.11-R0.1-SNAPSHOT/.../paper-api-1.21.11-R0.1-SNAPSHOT.jar`
