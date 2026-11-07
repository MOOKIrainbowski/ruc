# 러크 RPG 베타 — 인수인계 (다음에 이어서 개발할 때 가장 먼저 읽을 문서)

> 작성: 2026-11-08 · 기준 커밋: `c83207a` 위에 "그래픽 3차(맵 사실감 · 고급 UI)" 커밋이 올라간 상태
> 지시서 원본은 `RUC_RPG/RUC_RPG_PROMPT.md`(§30 단계표), 결정 기록은 `docs/DECISIONS.md`(D1~D54+), 단계 기록은 `docs/PLAN.md`.
> 이 문서는 "지금 어디까지 됐고, 어떻게 돌리고, 무엇을 조심하고, 다음에 뭘 하는가"만 모아 둔 요약입니다.

---

## 1. 한눈에 보기

| 항목 | 상태 |
|---|---|
| 개발 단계 | **P0~P6 완료 · 웹사이트에 배포됨.** 다음은 **P7 파티 · 던전**, 그다음 P8 베타 폴리시 |
| 그래픽 | 3등신 캐릭터(8프레임) · 세밀한 16×16 타일 · 32×32 아이콘 · 사실적 그래픽 모드 · 메이플풍 + 디아블로풍 + 고급(금테 양피지) UI · 사실적 맵(경계 · 데칼 · 접촉 그림자 · 장식) |
| 테스트 | 서버 쪽 56개(공용 17 · 전투 5 · 아이템 3 · 스킬 12 · 경제 7 · 퀘스트 6 · E2E 6) 전부 통과 |
| 운영 사이트 | `https://ruc-server.vercel.app` — `/rpg` 는 **"오픈 준비 중"** (게임 서버를 어디에도 호스팅하지 않았기 때문) |
| 게임 서버 호스팅 | **미정** — 사용자가 "가장 마지막 단계로 미룬다"고 함. 계획은 오라클 무료 VM (`RUC_RPG/deploy/README.md`) |
| RUC | **베타 격리 지갑**만 (`RUC_MODE=beta`). 마크 서버 실제 RUC 와 연동하는 코드는 만들지 않기로 사용자가 정함 (D1) |
| 배포 규칙 | 사용자가 "각 단계가 끝나고 버그 · 오류가 없음을 확인하면 묻지 말고 바로 배포"라고 상시 허락 (2026-11-07) |

### 사용자가 직접 해야 할 일 (비밀값 · 결제 · 계정이라 제가 못 함)
1. 오라클 클라우드 가입 + 무료 VM 만들기 → 공용 IP 알려 주기 (절차는 `RUC_RPG/deploy/README.md`, 서버 선택은 맨 마지막 단계로 미룬 상태)
2. Vercel 환경변수 2개: `RPG_TICKET_SECRET`(값은 `RUC_RPG/deploy/live.env` 에 이미 생성됨, 커밋 안 됨) · `NEXT_PUBLIC_RPG_WS_URL`(`wss://<IP의 점을 -로>.sslip.io`). 둘 다 들어가고 재배포되면 `/rpg` 가 자동으로 열림 (`web/lib/rpg.ts`)
3. (이미 함) Vercel `DISCORD_CLIENT_SECRET` 갱신

---

## 2. 폴더 구조

```
web/app/rpg/page.tsx              로그인 게이트 (서버 컴포넌트, rpgOpen() 이 거짓이면 "오픈 준비 중")
web/app/api/rpg/ticket/route.ts   입장 티켓 (60초 JWT). 개발 모드에서는 ?dev=이름 이 디스코드 세션보다 우선
web/lib/rpg.ts                    rpgOpen() — 개발 모드이거나 (WS 주소 + 티켓 비밀값)이 둘 다 있을 때만 열림
web/rpg/shared/                   클라 · 서버 공용 (TypeScript, 서버가 그대로 import)
  constants.ts                    TILE 16 · 틱 20Hz · CHAR_W/H 32×40 · CHAR_FEET 34
  movement.ts · combat.ts         이동 시뮬레이션 · 피해 공식 (클라 예측 + 서버 재생에 같이 씀)
  data/                           items · skills · jobs · mobs · effects · elements · economy · quests · maps/*.json
  protocol.ts                     네트워크 메시지 타입 (C2S · S2C · 방 이벤트 주석)
  locales/ko.json                 UI 문자열 (인라인 한글 금지 — 여기에 키를 추가)
web/rpg/client/                   PixiJS 렌더러 + React HUD
  game.ts                         게임 본체 (맵 굽기 · 엔티티 · 입력 · 예측 · 이펙트 연결). 가장 큼
  RpgGame.tsx                     React 루트 (접속 · 창 열고 닫기 · 상태)
  CombatHud.tsx · Hud.tsx         전투 HUD(구슬 · 스킬 · 막대 · 스탯창) · 미니맵 · 나침반
  Inventory.tsx · Growth.tsx · Economy.tsx · Quests.tsx    창들
  realistic.ts                    사실적 그래픽 모드 (조명 · 그림자 · 비네트)
  fx.ts                           전투 이펙트 · 피해 숫자
  art/                            코드로 그리는 도트 그림: character · mobs · world(타일 · 오브젝트 · 데칼) · icons · items · px(Px 버퍼 + refine32)
  rpg.css                         스타일 (맨 아래로 갈수록 나중 규칙이 덮어씀 — 라운드 1~4 겹쳐 있음)
RUC_RPG/server/                   게임 서버 (Node 24, `ws`, `node:sqlite`, TS 직접 실행)
  src/main.ts                     접속 · 메시지 분배 · 틱 루프
  src/room.ts                     방(채널) · 입력 처리 · 몹/플레이어 · 경험치
  src/combat.ts · skills.ts · mobs.ts · items.ts · progress.ts · economy.ts · quests.ts · db.ts
  test/                           단위 · E2E 테스트
RUC_RPG/scripts/                  맵 생성(gen-plaza → gen-field → decorate) · shot.mjs(헤드리스 캡처)
RUC_RPG/deploy/                   오라클 VM 배포 도구 (setup.sh · deploy.sh · README) — 아직 안 씀
RUC_RPG/docs/                     RPG_RECON · DECISIONS · PLAN · HANDOFF(이 문서)
```

---

## 3. 로컬에서 돌리기

두 개를 켭니다 (Windows, Git Bash 또는 PowerShell).
```
cd web && npm run dev                 # 웹  http://localhost:3000
cd RUC_RPG/server && npm run dev      # 게임 서버 ws://localhost:2567 (node --watch)
```
- 접속: `http://localhost:3000/rpg?dev=이름` (한글 · 영문 · 숫자 · 밑줄 12자 이하). 이름마다 별도 계정. **사용자의 실제 디스코드 계정에는 시험 캐릭터를 만들지 말 것.**
- 개발 모드 전용 도구: 브라우저 콘솔 `__rpg` (Game 객체)
  - `__rpg.net.send({t:"dev", lv: 30})` 레벨 · `{t:"dev", give:"enhance_stone", n:20}` / `{t:"dev", give:"book_meteor", rarity:"mythic"}` 아이템 · `{t:"dev", map:"field", x:448, y:1280}` 순간이동(막힌 칸이면 조용히 무시됨)
  - `__rpg.applySettings({...__rpg.settings, graphics:"realistic"})` 그래픽 모드 · 방을 옮기면 Game 이 새로 만들어지므로 `__rpg` 도 새 것
- DB: `RUC_RPG/server/data/rpg.sqlite` (git 에 안 들어감). 시험용 DB 는 `RPG_DB_FILE` 환경변수로 파일 이름을 바꿔 격리 (테스트가 이렇게 씀)
- **맵 JSON 을 바꾸면 게임 서버를 껐다 켜야 함** (`readFileSync` 라 `--watch` 가 못 봄). 웹은 자동 반영.
- 비밀값 위치: `web/.env.local`(DISCORD_CLIENT_SECRET · SESSION_SECRET · 개발용), `RUC_RPG/deploy/live.env`(운영 티켓 비밀값). 둘 다 `.gitignore`. **출력하거나 커밋하지 말 것. 사용자가 직접 넣음.**

### 검증 순서 (단계를 끝낼 때마다)
1. `cd RUC_RPG/server && npm test` — 전부 통과해야 함
2. `cd web && npx tsc --noEmit --noUnusedLocals` — 출력 없어야 함 (서버 쪽은 스크래치패드 tsconfig 로 했음: ws 타입 shim 이 필요해서 `TS7006` 몇 개는 기존부터 있는 잡음)
3. **`next build` 는 `next dev` 가 돌아가는 중에 하면 안 됨** (같은 `.next` 를 써서 500 "Cannot find module"). 순서: dev 를 **PID 로** 끄기 → `npx next build` → `rm -rf .next` → `npm run dev`. (Claude Code 의 TaskStop 은 next 자식 프로세스를 남기고, 패턴 기반 Stop-Process 는 자동 분류기가 막음 → `Get-CimInstance Win32_Process` 로 PID 를 찾아 `Stop-Process -Id`)
4. 화면 확인: 브라우저 확장이 되면 그것으로, 안 되면 `node RUC_RPG/scripts/shot.mjs ...` (헤드리스 크롬 + CDP, 개발 서버 둘이 떠 있어야 함)
5. 통과하면 커밋 → `git push origin main` (Vercel 자동 배포) → `/home` `/rpg` `/login` 200 확인

---

## 4. 만든 것 (단계별)

- **P1 기반**: 로그인 게이트 · 입장 티켓 · 게임 서버(ws · sqlite · 채널) · 광장 맵 · 8방향 캐릭터 · 예측/보간 · 미니맵 · 설정
- **P2 전투 코어**: 스탯 · 피해 공식 · 상태효과 엔진 · 견습 스킬 · 필드 "햇살 초원" · 몹 AI · 전투 HUD · 사망/부활
- **P3 아이템**: 템플릿 · 희귀도 6단 · 인스턴스(UUID) · 인벤토리(V) · 핫바 · 장비창 · 창고(B) · 드롭 · 운 보정 · 포션 · 내구도 · 세트 · 특수효과
- **P4 성장**: 직업 6계열 · 세부 직업 30(★6) · 전직(세라) · 숙련도 · 스킬 레벨 · 등급 · 잠재력 · 스킬창(K) · ★6 직업 스킬 63개 · 원소 반응
- **P5 경제(베타 지갑)**: RUC 원장(요청 id 멱등) · 우편함 · 일반 상점(6시간 · 개인 진열) · 유저 상점(에스크로 · 복합 가격 · 수수료 5%) · 강화(+10 공지) · 마법부여 · 수리 · 분해 · 재조합
- **P6 퀘스트 · NPC · 알림**: 튜토리얼 11단계(말 걸기 → 분수 → 구르기 → 우편 → 상점 → 첫 전투 → 슬라임 5 → 강화 → 스킬 슬롯 → Lv10 → 전직) · NPC 대화창 · 일지(J) · 추적창 · 유저 퀘스트(처치/전달, 에스크로) · 알림 센터 · 토스트
- **그래픽 개선 1~3** (테스트 피드백 반영):
  - 캐릭터 32×40 · 3등신 · 동작 8프레임 · 남동/북동 3/4 몸 디자인 · 몹 · 물 · 모닥불 · 포털 8프레임
  - 타일 16×16 세밀화 · 오브젝트(나무 · 건물 · 천막 …) · 아이콘 32×32(`refine32`) · 맵 사실감(아래 5절)
  - 사실적 그래픽 모드(설정 → 화면 → 그래픽 모드): 24분 낮밤 조명 · 가로등/모닥불/포털 빛 · 해를 따르는 긴 그림자 · 비네트 · 빛 입자
  - UI: 메이플풍 통통한 애니메이션(창 · 토스트 · 레벨업) + 디아블로풍 구슬 · HUD 배경판 + 경험치 바 + **고급 마감(금 그라데이션 테두리 양피지 · 금박 제목 명판)**. **버튼은 갈색 나무 입체 버튼(선택 = 초록)** — 사용자가 "전과 동일하게"라고 지정했으니 바꾸지 말 것
  - 버그 수정: 화면 배율 ×4 = 가장 넓게 · 스킬 설명이 가려지던 문제(창 오른쪽에 띄움) · 미니맵이 HUD 배율에 같이 변하던 문제

## 5. 맵 사실감 구조 (이번 라운드)

- **바닥 굽기** `game.ts bakeGround()`: 타일 변형 → 2px 단위 부드러운 얼룩 노이즈 → 데칼(풀 뭉치 · 자갈 · 낙엽 · 버섯 · 잡초 · 금 · 이끼, `art/world.ts decalSheet`) → 경계(돌 쪽 어두운 그늘 + 잔디가 돌 위로 삐져나옴 · 흙길 가장자리 들쑥날쑥 · 짙은/연한 풀밭 경계 섞기 · 물가 젖은 띠 + 거품). 한 번만 계산해 캔버스 한 장으로 굽는다.
- **접촉 그림자**: 나무 · 건물 · 천막 · 벤치 · 통 … 밑에 부드러운 타원 (`contactShadow`, `CONTACT` 표). 사실적 모드의 긴 그림자와 별개로 항상 켜짐.
- **장식 오브젝트**: `통 · 상자 · 쌓인 상자 · 화분 · 깃발 · 우물 · 건초 · 자루 · 통나무 · 울타리 · 버섯` (`art/world.ts`) — `RUC_RPG/scripts/decorate.ts` 가 이미 만든 `plaza.json` / `field.json` 에 지형 · 몹 리젠을 건드리지 않고 길 · 물 · 다른 오브젝트에서 한 칸 떨어진 빈 곳에만 추가(여러 번 돌려도 한 번만 적용, `properties.decor`). 새 맵을 처음부터 만들 때는 `gen-plaza.ts` → `gen-field.ts` → `decorate.ts` 순서. **`gen-*.ts` 를 다시 돌리면 JSON 을 덮어쓰고 몹 · 오브젝트 id 가 바뀜** — 이미 배포된 월드와 어긋나니 신중히.

---

## 6. 아키텍처 핵심 (바꾸기 전에 알아야 할 것)

- **서버 권위**: 서버가 20Hz 로 시뮬레이션하고, 클라이언트는 60Hz 입력을 보내 예측 · 서버 ack 로 보정. 이동 · 구르기 · 시전은 같은 공용 코드(`shared/movement.ts`)로 양쪽이 계산. 치트 방지는 입력 크레딧 · 레이트 리밋(초당 150개) · 거리 검사.
- **경제는 멱등 + 원자적**: 클라가 조작마다 `rid` 를 붙이고 서버가 원장 키(`UNIQUE`)로 씀 → 같은 요청이 두 번 와도 한 번만. 조작 하나 = `tx()` 하나(RUC + 아이템 + 우편), 실패하면 롤백하고 메모리를 DB 에서 다시 읽음 (`economy.ts atomic()`). RUC 가 안 움직이는 조작도 0 RUC 원장 줄로 같은 보호. 아이템은 같은 UUID 행의 주인 · 위치만 바뀜(우편 = `mail` · 에스크로 = `escrow`, slot 규칙은 D39 · D45).
- **퀘스트 진행은 서버 이벤트만**: `quest(p, 종류, 대상)` 를 room · economy · progress 가 부름. 클라이언트가 진행도를 신고하는 경로는 없음. 새 목표 유형을 추가하려면 `shared/data/quests.ts` 의 `ObjType` · `objText` + 서버에서 `quest()` 호출 지점 추가.
- **순환 import 주의**: `room.ts ↔ quests.ts ↔ economy.ts` 가 서로를 부르지만 함수 선언만 쓰므로 동작함(런타임 호출 시점에만 참조). 모듈 최상단에서 서로의 값을 쓰면 깨짐.
- **렌더 계층(Pixi)**: `world`(바닥 · 물 · decor_below · 그림자층 · entityLayer(zIndex = y 정렬) · fx · decor_above) → 사실적 모드 오버레이(라이트맵 곱하기 · 비네트) → `screenLayer`(이름표 · 라벨). HUD 는 React DOM.
- **스프라이트 시트 규약**: 캐릭터 `CHAR_W×CHAR_H` = 32×40, 행 = 방향 8(S SE E NE N NW W SW), 열 = 동작(idle walk run attack cast) × `FRAMES`(8). 발밑 anchor = `CHAR_FEET/CHAR_H`. 크기를 바꾸면 `PLAYER_PLATE_H` · NPC 라벨 · 말풍선 위치 · 초상화 크기를 같이 봐야 함.
- **문자열**: UI 한글은 `shared/locales/ko.json` + `t("키")`. 스킬 · 아이템 · 퀘스트 같은 콘텐츠 이름은 `shared/data/*.ts` 에 있음(데이터 파일).

---

## 7. 함정 · 교훈 (겪은 것들)

- `next build` 와 `next dev` 동시 실행 금지(위 3절). Windows 에서 TaskStop 은 자식 프로세스를 못 끔.
- Bash 도구에서 heredoc 안에 백틱 · 작은따옴표 · 역슬래시(`\n`) 가 들어가면 명령 전체가 깨짐 → **Python 패치 스크립트를 Write 도구로 스크래치패드에 만들어 실행**(이 문서의 대부분 코드가 그렇게 들어감). 한글 경로는 괜찮음.
- `Px.set` 에 `#rrggbbaa`(반투명)를 주면 이미 있는 불투명 픽셀 위에 섞어 칠함(하이라이트용). 빈 픽셀 위에서는 그대로 반투명으로 써짐.
- `.rpg-panel` 에 `position: relative` 를 직접 주면 Tailwind 의 `absolute` 를 덮어써서 레이아웃이 깨짐(스탯창 사고). 지금은 `.rpg-panel:not(.absolute):not(.fixed)`.
- 맵 JSON 변경은 게임 서버 재시작 필요. 방(맵)을 옮기면 Game 이 새로 만들어져 `__rpg` · 그래픽 설정 참조가 바뀜.
- 브라우저 확장(`mcp__claude-in-chrome`)이 끊기면 `RUC_RPG/scripts/shot.mjs` 로 헤드리스 캡처. 이 방식은 FPS 가 낮게 나옴(소프트웨어 GL) — 성능 판단 금지.
- `git` 이 CRLF 경고를 내는 것은 정상(autocrlf).
- 운영 DB 와 로컬 DB 는 별개. 운영 서버에 배포해도 DB 는 덮어쓰지 않도록 `deploy.sh` 가 만듦.

---

## 8. 알려진 한계 · 미룬 것

- **게임 서버 호스팅**(P8 이후/마지막): 오라클 무료 VM 계획만 있음. Vercel 에서는 불가(함수 웹소켓 베타는 연결이 5분(Hobby)/최대 13분(Pro)에 끊기고 인스턴스 메모리가 공유되지 않음, Sandbox 는 Hobby 45분 · CPU 월 5시간) — 조사 결과 `README.md` 참고.
- 튜토리얼 파티 · 던전 단계는 P7 에서 추가(D43). 유저 퀘스트 목표 `reach_stage` · `duel_win` · `collect` 는 던전/결투/채집이 생긴 뒤(D44). 같은 IP/부계정 감지 로그는 서버가 IP 를 받게 될 때(D46). 알림의 파티 4종 · 선물 · 수락/거절 버튼은 P7(D47).
- 아이콘은 16×16 원본을 `refine32` 로 변환한 것이라 수작업 32×32 만큼은 아님(D49). 인벤토리 칸은 아직 마인크래프트식 회색 베벨.
- 사운드(BGM · 효과음)는 없음(P8). 준비 중 직업 24개의 스킬 키트(D36). 창고 탭 확장 · 랜덤 상자 · 영약 같은 RUC 상품(정식 후보).
- 마크 서버의 실제 RUC 연동은 만들지 않음(베타 격리 지갑, D1).

---

## 9. 다음 할 일

### P7 파티 · 던전 (지시서 §20 · §21 · §30)
- **파티**(§21): 초대 · 신청 · 수락 · 추방 · 위임, 최대 인원, 1.5:1 경험치/드롭 분배, 파티 프레임(HUD), 핑 휠(§21-3), 파티 알림(`party_invite` · `party_join_request` · `party_accepted` · `party_kicked` — 종류는 이미 `NOTI_KINDS` 에 있음, 수락/거절 버튼은 `Quests.tsx Bell` 에 추가)
- **던전 "고목의 유적"**(§20-3 · §20-4): 인스턴스 방(새 `RoomKind`) 10스테이지 · 보스 2종(JSON 타임라인) · 공용 부활 3회 · 최초 클리어 서버 공지(`rpg_broadcasts` · `notice` 는 이미 있음) · 광장 북쪽 "고대 유적의 문" 포털(`target: "dungeon"` — 서버가 지금 "준비 중" 메시지를 돌려줌, `main.ts use()`)
- **K/D/A · 결투**(§13-3): 광장 동쪽 결투장 포털(`target: "arena"`)
- 튜토리얼 9 · 10단계(파티 만들기 · 던전 1스테이지)를 `shared/data/quests.ts` 에 추가하고 `tut_job` 앞에 끼우기. 유저 퀘스트 목표 `reach_stage` 추가
- DoD(§30): 5인 파티로 1~10 스테이지
- 건드릴 곳 예상: `shared/constants.ts`(`CHANNEL_CAP` · `RoomKind`), `server/src/room.ts`(던전 방 · 스테이지 진행), 새 `server/src/party.ts`, `protocol.ts`, `client/` 파티 프레임 · 핑 · 던전 HUD, `MAP_JSON`(RpgGame.tsx)에 던전 맵, `gen-dungeon.ts`

### P8 베타 폴리시 (지시서 §30)
- 밸런스 시뮬레이션 스크립트 · 성능(AOI · 델타 · 바이너리 · 풀링, F3 오버레이) · GM 도구 · 버그 제보 · 사운드 · E2E · IP 로깅(D46)

### 마지막: 운영 오픈
- 오라클 VM → `bash RUC_RPG/deploy/deploy.sh --setup` → Vercel 환경변수 2개 → 재배포 → `/rpg` 열림 → 이후 단계마다 `deploy.sh` 로 게임 서버도 같이 배포

---

## 10. 새 대화를 시작할 때 이렇게 말하면 됩니다
> "RUC_RPG/docs/HANDOFF.md 읽고 이어서 P7 파티 · 던전 개발해줘."

(자동 메모리에도 진행 상태 · 배포 규칙 · 함정이 저장돼 있어 같은 PC · 같은 프로젝트에서는 이어집니다.)
