# 러크 RPG 베타 — 인수인계 (다음에 이어서 개발할 때 가장 먼저 읽을 문서)

> 작성: 2026-11-08 · **P11 장비 외형 아트까지 반영** — 지시서 §30 의 P0~P8 + 베타 이후 P9 직업 · P10 소셜 (사용자 지시: P10 뒤 미뤄 둔 것들을 이어서 — P11 장비 외형 아트 → P12 미뤄 둔 것 모음, 운영 오픈은 마지막)
> 지시서 원본은 `RUC_RPG/RUC_RPG_PROMPT.md`(§30 단계표), 결정 기록은 `docs/DECISIONS.md`(D1~D90), 단계 기록은 `docs/PLAN.md`.
> 이 문서는 "지금 어디까지 됐고, 어떻게 돌리고, 무엇을 조심하고, 다음에 뭘 하는가"만 모아 둔 요약입니다.

---

## 1. 한눈에 보기

| 항목 | 상태 |
|---|---|
| 개발 단계 | **P0~P11 완료 · 웹사이트에 배포됨.** 다음 **P12 미뤄 둔 것 모음**(PLAN.md) → 마지막 **운영 오픈(게임 서버 호스팅)** |
| 그래픽 | 3등신 캐릭터(8프레임) · 세밀한 16×16 타일 · 32×32 아이콘 · 사실적 그래픽 모드 · 메이플풍 + 디아블로풍 + 고급(금테 양피지) UI · 사실적 맵(경계 · 데칼 · 접촉 그림자 · 장식) |
| 테스트 | node 기준 97개 전부 통과 (직업마다 "모든 스킬 시전" 30 + P9 전직 · 패시브 · 소환수 + P10 소셜 3) |
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
  data/                           items · skills · jobs · mobs(+보스 타임라인) · effects · elements · economy · quests · party · dungeons · maps/*.json (plaza · field · arena · dungeon)
  protocol.ts                     네트워크 메시지 타입 (C2S · S2C · 방 이벤트 주석)
  locales/ko.json                 UI 문자열 (인라인 한글 금지 — 여기에 키를 추가)
web/rpg/client/                   PixiJS 렌더러 + React HUD
  game.ts                         게임 본체 (맵 굽기 · 엔티티 · 입력 · 예측 · 이펙트 연결). 가장 큼
  RpgGame.tsx                     React 루트 (접속 · 창 열고 닫기 · 상태)
  CombatHud.tsx · Hud.tsx         전투 HUD(구슬 · 스킬 · 막대 · 스탯창) · 미니맵 · 나침반
  Inventory.tsx · Growth.tsx · Economy.tsx · Quests.tsx    창들
  Ops.tsx · sound.ts               P8: 채팅(Enter) · F3 디버그 · GM 창(F8) · 버그 제보 / WebAudio 효과음 · 배경음
  Party.tsx                       P7: 파티창(P) · 파티 프레임 · 확인 창(결투 · 던전 입장) · 던전 HUD · 보스 HP 바 · 관전/공용 부활 · 현황판(Tab) · 핑 휠(G) · 배너
  realistic.ts                    사실적 그래픽 모드 (조명 · 그림자 · 비네트)
  fx.ts                           전투 이펙트 · 피해 숫자
  art/                            코드로 그리는 도트 그림: character · mobs · world(타일 · 오브젝트 · 데칼) · icons · items · px(Px 버퍼 + refine32)
  rpg.css                         스타일 (맨 아래로 갈수록 나중 규칙이 덮어씀 — 라운드 1~4 겹쳐 있음)
RUC_RPG/server/                   게임 서버 (Node 24, `ws`, `node:sqlite`, TS 직접 실행)
  src/main.ts                     접속 · 메시지 분배 · 틱 루프
  src/room.ts                     방(채널) · 입력 처리 · 몹/플레이어 · 경험치
  src/combat.ts · skills.ts · mobs.ts(+보스 패턴) · items.ts · progress.ts · economy.ts · quests.ts · db.ts
  src/chat.ts · gm.ts                  P8: 채팅 · 욕설 필터 / GM 명령 · 제재 · 버그 제보
  scripts/balance.ts · bots.ts         P8: 밸런스 시뮬레이션(P9: 30직업, 3번째 인자로 골라 돌리기) · 봇(대역폭 측정)
  src/pets.ts                          P9: 소환수 · 설치물 (부르기 · 따라가기 · 공격 · 치유)
  src/social.ts                        P10: 친구 · 차단 · 귓속말 · 접속 알림 · 길드 · 길드 채팅 (+ chat.ts 채팅 저장)
  src/party.ts · pvp.ts · dungeon.ts   P7: 파티(메모리) · 핑 / 결투 · 결투장 · K/D/A · 현황판 / 던전 인스턴스 · 스테이지 · 보상 · 칭호
  test/                           단위 · E2E 테스트
RUC_RPG/scripts/                  맵 생성(gen-plaza → gen-field → decorate, gen-dungeon · gen-arena) · shot.mjs(헤드리스 캡처)
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
- **P7 파티 · 던전 · 결투**: 파티(초대 · 신청 · 추방 · 위임 · 해산 · 모집, 알림 수락 버튼, 1분 접속 유예) · 분배(경험치 20타일 균등 + 5%/인, RUC · 드롭 파티장 1.5 : 1) · 핑 휠 7종 · 파티 프레임 · 던전 "고목의 유적" 10스테이지(보스 페른 2페이즈 · 엘드라 3페이즈 — 분산 · 집결 · 구슬 전멸기, 공용 부활 3, 포션 5/스테이지, 15분, 클리어 우편 보상 · 칭호 · 최초 클리어 공지) · 결투장 · 필드 결투(1:1 · 파티) · K/D/A · 현황판 · 칭호 · 튜토리얼 13단계(파티 · 던전 1스테이지 추가) · 유저 퀘스트 목표 stage · duel
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
- **브라우저 테스트 중에 `web/rpg/client/*.tsx` 를 고치면 Fast Refresh 가 열린 탭 전부를 다시 접속시킴** → 던전에 있던 사람이 광장으로 가고 인스턴스가 비어 사라짐 (P7 테스트에서 겪음, 버그 아님). 클라 수정은 테스트 전에 끝낼 것.
- 파티는 메모리에만 있어서 **게임 서버를 다시 켜면 파티 · 던전이 모두 풀림**. 게임 서버 `--watch` 의 자식 node 만 끄면 "Waiting for file changes" 로 멈춤 → `src/main.ts` 를 touch 하면 다시 뜸.
- **스냅샷은 10Hz 바이너리 프레임**(D71): 서버 단위 테스트에서 가짜 ws 로 받은 스냅샷은 Buffer — `decodeSnapshot` 으로 풀 것. 틱 1번에는 스냅샷이 안 나갈 수 있음(2번에 1번).
- `chat.ts` 욕설 정규식에 `\W` 를 쓰면 한글이 다 걸림 — 사이 문자는 공백 · 숫자 · 문장 부호 · 기호만.
- 브라우저 확장이 안 붙으면 `scripts/shot.mjs` 의 4번째 인자로 JS 를 넣어 클릭 · 입력까지 할 수 있음(React 입력은 네이티브 setter + input 이벤트).
- 테스트 화면은 2560×1249 (확대 ×2) — 맵 폭이 1280px(80칸) 보다 작으면 가운데 정렬로 양옆이 빔(D70).
- 서버 `Room.tick` 끝의 스냅샷이 `room.ev` 를 비움 → 단위 테스트에서 방 이벤트는 보낸 메시지(`s` 의 `ev`)에서 읽을 것 (`party.test.ts evsSince`).
- `git` 이 CRLF 경고를 내는 것은 정상(autocrlf).
- 운영 DB 와 로컬 DB 는 별개. 운영 서버에 배포해도 DB 는 덮어쓰지 않도록 `deploy.sh` 가 만듦.

---

## 8. 알려진 한계 · 미룬 것

- **게임 서버 호스팅**(P8 이후/마지막): 오라클 무료 VM 계획만 있음. Vercel 에서는 불가(함수 웹소켓 베타는 연결이 5분(Hobby)/최대 13분(Pro)에 끊기고 인스턴스 메모리가 공유되지 않음, Sandbox 는 Hobby 45분 · CPU 월 5시간) — 조사 결과 `README.md` 참고.
- 유저 퀘스트 목표 `collect` 는 채집 시스템이 생길 때(D69). 같은 IP/부계정 감지 로그는 서버가 IP 를 받게 될 때(D46). 알림 `gift` 는 선물 기능이 생길 때.
- P7 에서 미룬 것: 부활 깃털 아이템(D62) · 길드 · 영지 · 국가(빈 테이블만, §21-4). 파티는 서버 재시작 시 풀림(D57).
- P8 에서 미룬 것: 장비 레이어 · 망토 · 문장 그림(정식 아트, D79) · 귓속말 · 채팅 저장 · 실제 음원(지금은 합성). §29 "50명 + 몹 30마리 한 화면 60fps"는 실제 내장 그래픽 노트북에서 다시 볼 것 — 이 PC 의 헤드리스(소프트웨어 GL) 수치만 있음. 필드 채널 정원이 40이라 50명이 한 화면에 모이지는 않음.
- 아이콘은 16×16 원본을 `refine32` 로 변환한 것이라 수작업 32×32 만큼은 아님(D49). 인벤토리 칸은 아직 마인크래프트식 회색 베벨.
- 창고 탭 확장 · 랜덤 상자 · 영약 같은 RUC 상품(정식 후보).
- P9 에서 미룬 것: 소환수가 맞거나 어그로를 끄는 체계(지금은 맞지 않는 시간제 장치, D81), 정령사 속성 버프 표(D82)를 툴팁에 보여 주기.
- 마크 서버의 실제 RUC 연동은 만들지 않음(베타 격리 지갑, D1).

---

## 9. 다음 할 일

### P7 구조 (바꾸기 전에)
- **적대 판정은 `Room.hostile(a, b)` 하나**: 플레이어 ↔ 몹 항상, 결투장 = 다른 파티, 결투 = 시작된 상대 편. 스킬 · 투사체 · 원소 반응 · 수호의 맹세가 모두 `room.foes()` / `w.hostile` 을 거침. 클라 `Game.isFoe` 가 같은 규칙(이름 빨강 · 적 지정 스킬).
- **room 은 party · pvp · dungeon 을 import 하지 않음** — `room.ts hooks`(mates · defeat · pvpKill · left), `mobs.ts bossHooks`, `party.ts partyHooks`, `dungeon.ts dgHooks`(main 이 채움)로 연결 (순환 import 방지).
- 던전 방 = `new Room("dungeon", 파티 id, map)` + `room.inst = Run`. main 의 틱 루프가 `dungeonRooms()` 도 돌림. 방이 비면 다음 틱에 사라짐. 결투 패배는 `World.spare` 로 죽음을 막음.
- 던전 개발용: `{ t: "dev", stage: n }` (1 = 지금 스테이지 끝내기, 2~10 = 건너뛰기, 보상 없음).

### P8 베타 폴리시 — 완료 (D71~D79)
- 넷코드 10Hz · AOI · 델타 · 바이너리, 컬링 · F3, 밸런스 시뮬 · 조정, 채팅 · 욕설 필터, GM 도구 · 제재, 버그 제보, 사운드, IP 로깅, 핵심 루프 E2E
- 운영 서버에 넣을 값: `RPG_GM_IDS`(운영자 디스코드 ID) · 필요하면 `RPG_BUG_WEBHOOK` → `RUC_RPG/deploy/live.env` (`.env.example` 참고)

### P9 세부 직업 24개 — 완료 (D80~D85)
- 30직업 모두 2차 전직 가능 · 전용 스킬 96개 · 패시브 24개 · 소환수 8종 · 마법형/혼합형 · 밸런스 시뮬 30직업
- **구조**: 패시브는 위치별로 나뉨(D82) — 새 패시브를 넣을 때 `combat.ts passiveMul`(피해 배율) · `hit`(타격 뒤) · `addEffect` · `Room.passive`(틱) 중 맞는 곳에. 소환수는 `room.pets` (몹 · 플레이어가 아님 → `room.unit()` 으로 안 찾아짐)
- 개발 캐릭터 만들기: `node RUC_RPG/scripts/devchar.mjs <개발이름> <닉네임> <속성> <레벨> [계열] [세부직업] [보조속성]` (로컬 개발 서버 둘이 떠 있을 때, 그다음 `/rpg?dev=<개발이름>`)

### P10 소셜 — 완료 (D86~D89)
- O = 소셜 창(친구 · 길드), Enter 채팅의 보낼 곳 버튼 = 채널 → 파티 → 길드, `/w 닉 말` · `/r 말` · `/g 말`. 친구 신청 · 길드 초대 · 가입 신청은 알림 종에서 바로 수락
- 길드 · 친구 대기 목록(초대 · 가입 신청)은 메모리 — 서버를 다시 켜면 다시 보내야 함. 친구 신청은 DB(pending)

### P11 장비 외형 아트 — 완료 (D90)
- 새 장비에 외형을 주려면 템플릿에 `look`(+ 투구 `shape`, 지팡이 · 완드 `gem`)만 넣으면 됨. 새 무기 종류는 `character.ts weapon()` 에 모양 추가

### 다음 할 일 (사용자 지시: P10 뒤 미뤄 둔 것들을 자동으로)
1. **P12 미뤄 둔 것 모음**(PLAN.md): 소모품(부활 깃털 · 영약 · 귀환 주문서 · 랜덤 상자 · 창고 탭 확장 · 선물), 채집 + collect 퀘스트, 정령사 툴팁, 인벤토리 칸 스타일, 소환수 피격
2. 운영 오픈(아래) → 실제 베타 테스터 피드백으로 밸런스 · 버그

### 마지막: 운영 오픈
- 오라클 VM → `bash RUC_RPG/deploy/deploy.sh --setup` → Vercel 환경변수 2개 → 재배포 → `/rpg` 열림 → 이후 단계마다 `deploy.sh` 로 게임 서버도 같이 배포

---

## 10. 새 대화를 시작할 때 이렇게 말하면 됩니다
> "RUC_RPG/docs/HANDOFF.md 읽고 다음 단계(P12 미뤄 둔 것 모음) 개발해줘."

(자동 메모리에도 진행 상태 · 배포 규칙 · 함정이 저장돼 있어 같은 PC · 같은 프로젝트에서는 이어집니다.)
