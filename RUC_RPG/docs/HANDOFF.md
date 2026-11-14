# 러크 RPG 베타 — 인수인계 (다음에 이어서 할 때 가장 먼저 읽을 문서)

> 작성: 2026-11-09 · **개발 단계 P0~P18 모두 끝 · 웹사이트 배포 끝(마지막 커밋 `c7de2c2`) · 게임 서버를 이 PC 에서 돌릴 준비 끝.**
> **2026-11-10 공개 완료** — `https://ruc-server.vercel.app/rpg` ↔ 게임 서버 `wss://seojun-desktop.tail7d94d5.ts.net`(이 PC, Tailscale Funnel). 사용자가 실제 디스코드 계정으로 입장 확인. 서버는 바탕화면 바로가기로 켤 때만 열림.
> 지시서 원본 `RUC_RPG/RUC_RPG_PROMPT.md`, 결정 기록 `docs/DECISIONS.md`(D1~D105), 단계 기록 `docs/PLAN.md`, 서버 운영 안내 `RUC_RPG/deploy/README.md`.

> 0장은 공개 절차 기록 · 문제 해결용으로 남겨 둠. 공개 중 겪은 것(2026-11-10):
> - 이 PC 는 `.ps1` 실행 연결이 없음 → `setup-pc.cmd` 더블클릭
> - `/rpg` 가 서버가 켜져 있는데도 "게임 서버가 꺼져 있어요" — Vercel 함수(미국 iad1)에서 한국 PC 까지 Funnel 왕복이 몇 초씩 걸림. 2.5 → 5초로 늘려도 다시 막힘(11-14) → **서버 쪽 상태 확인을 없앰**, 브라우저가 직접 접속해 보고 실패하면 안내(`client/net.ts`)
> - "입장 확인에 실패했습니다" = Vercel `RPG_TICKET_SECRET` 이 `live.env` 와 다름(클립보드가 wss 주소로 덮였음) → 다시 붙여 넣고 Redeploy
> - Vercel 빌드 로그의 `npm warn Unknown env config "cache-dir"` 은 무시해도 됨
> - Vercel 에서 `NEXT_PUBLIC_RPG_WS_URL` 은 Config(공개 값), `RPG_TICKET_SECRET` 은 Sensitive

---

## 0. RPG 를 공개하려면 (다음 대화에서 가장 먼저 설명할 것)

### 0-1. 공개 구조 (사용자 결정 2026-11-09, D105)
```
플레이어 브라우저 ─ https ─ ruc-server.vercel.app/rpg   (웹: Vercel, 이미 배포됨)
                 └ wss ─── <PC이름>.<tailnet>.ts.net    (Tailscale Funnel: 인증서 · 공개 주소, 무료)
                                    └→ 이 PC 127.0.0.1:2580 (운영 게임 서버, 바탕화면 바로가기로 켜고 끔)
```
- 게임 서버는 **운영자 PC 에서 수동 실행** — PC 가 꺼져 있거나 서버를 안 켰으면 게임에 들어갈 수 없음(사용자가 원한 방식)
- RUC 는 **베타 지갑**(RPG 전용, 마크 서버 잔액과 분리) — 실제 RUC 연동은 사용자가 두 번 거절함(D1 · D105). 하지 말 것

### 0-2. 현재 상태 확인 (Claude 가 먼저 할 일 — 읽기만, 아무것도 바꾸지 않음)
| 확인 | 방법 | 2026-11-09 마지막 상태 |
|---|---|---|
| Tailscale 로그인 | `"C:\Program Files\Tailscale\tailscale.exe" status --json` → `BackendState`, `Self.DNSName` | 설치됨(1.102), **로그인 안 됨**(`NoState`) |
| 운영 설정 파일 | `RUC_RPG/deploy/live.env` 가 있는지만 (`Test-Path`). **값은 절대 출력 · 커밋 금지** | 있음 — `RPG_TICKET_SECRET`(값 있음) · `RPG_ALLOWED_ORIGINS=https://ruc-server.vercel.app` · `RPG_BIND=127.0.0.1` · `PORT=2567`(켜기 스크립트가 2580 으로 덮어씀 — 그대로 둬도 됨) · `RPG_GM_IDS` 없음 |
| 바로가기 | 바탕화면에 `러크 RPG 서버 켜기.lnk` · `러크 RPG 서버 끄기.lnk` | 만들어 둠 |
| 운영 데이터 폴더 | `C:\RucRpg\data` · `backups` · `logs` | 있음(시험 실행 때 생김, DB 는 비어 있음) |
| 사이트 상태 | 로그인 없이 `curl -s https://ruc-server.vercel.app/rpg` 에서 문구 확인 | **"오픈 준비 중"** = Vercel 환경 변수가 아직 없음 |
| 운영 서버 | `curl -s http://127.0.0.1:2580/` | 꺼져 있음 (켜면 `{"ok":true,…}`) |

`/rpg` 화면 규칙(`web/app/rpg/page.tsx` · `web/lib/rpg.ts`): 환경 변수 2개 중 하나라도 없으면 "오픈 준비 중" → 둘 다 있으면 "디스코드로 로그인" → 로그인하면 게임 화면, 브라우저가 게임 서버에 못 붙으면 "게임 서버가 꺼져 있어요" + 다시 접속 버튼.

### 0-3. 사용자가 할 일 (계정 · 비밀값이라 Claude 가 대신하면 안 됨)
1. **Tailscale 로그인 + Funnel 허용** — `RUC_RPG\deploy\pc\setup-pc.cmd` 를 더블클릭
   (이 PC 는 `.ps1` 연결이 깨져 "PowerShell에서 실행" 메뉴가 없음 — 2026-11-10 확인. `.cmd` 가 `powershell -ExecutionPolicy Bypass -File setup-pc.ps1` 을 대신 실행)
   - 브라우저가 열리면 Tailscale 에 로그인(구글 · 마이크로소프트 · 깃허브 계정, 무료)
   - "Funnel 을 허용하세요" 또는 HTTPS 인증서 사용 링크가 나오면 열어서 허용 → **스크립트를 한 번 더 실행**
   - 끝나면 화면에 `NEXT_PUBLIC_RPG_WS_URL = wss://<PC이름>.<tailnet>.ts.net` 이 나오고, 비밀값은 **클립보드에 복사**됨(화면에 안 나옴)
2. **Vercel 환경 변수 2개** — vercel.com → 러크 프로젝트 → Settings → Environment Variables → 환경 **Production**
   - `NEXT_PUBLIC_RPG_WS_URL` = 1번에서 화면에 나온 `wss://…` 주소
   - `RPG_TICKET_SECRET` = 1번에서 클립보드에 복사된 값(값 칸에 Ctrl+V). 클립보드가 지워졌으면 setup-pc.ps1 을 다시 실행
3. **Redeploy** — Vercel → Deployments → 맨 위 배포의 ⋯ → Redeploy (`NEXT_PUBLIC_` 값은 빌드할 때 들어가서 다시 배포해야 반영됨)
4. **서버 켜기** — 바탕화면 **"러크 RPG 서버 켜기"** (창이 열려 있는 동안 서버가 돎)
5. (선택) **GM 권한** — `RUC_RPG/deploy/live.env` 에 `RPG_GM_IDS=<본인 디스코드 ID>` 한 줄(여러 명은 쉼표), 그다음 서버 끄고 다시 켜기. 메모장으로 직접 열어서 추가(비밀값 줄은 건드리지 않기)

### 0-4. 사용자가 끝냈다고 하면 Claude 가 확인할 것
1. `tailscale status --json` → `BackendState` 가 `Running`, `Self.DNSName` 기록
2. 서버가 켜져 있을 때 `curl -s https://<DNSName>/` → `{"ok":true,…}` (밖에서도 보이는지 = Funnel 정상)
3. `curl -s https://ruc-server.vercel.app/rpg` 에 "디스코드로 로그인" (= 환경 변수 · 재배포 반영)
4. 사용자에게 실제 브라우저(가능하면 휴대폰 LTE 같은 다른 망)로 디스코드 로그인 → 캐릭터 만들기 → 광장 입장까지 해 보라고 부탁. **Claude 가 사용자 디스코드 계정으로 로그인하거나 캐릭터를 만들지 않기**
5. 다 되면 HANDOFF · PLAN · 메모리(rpg-pc-hosting)에 "공개 완료(날짜 · 주소)" 기록 — 주소(ts.net)는 적어도 되지만 비밀값은 적지 않음

### 0-5. 공개한 뒤 평소 운영 (사용자에게 함께 알려 줄 것)
- 켜기: 바탕화면 "러크 RPG 서버 켜기" · 끄기: "러크 RPG 서버 끄기"(접속자 저장 → 백업 → 종료 → Funnel 끔). 창을 그냥 닫아도 꺼지지만 마지막 30초 진행은 잃을 수 있음
- 오류로 멈추면 5초 뒤 자동으로 다시 켬. PC 를 끄면 서버도 꺼짐 → `/rpg` 가 "게임 서버가 꺼져 있어요"
- 데이터 `C:\RucRpg\data\live.sqlite`(OneDrive 밖) · 백업 `C:\RucRpg\backups`(끌 때 + 6시간마다, 최근 28개) · 로그 `C:\RucRpg\logs\server-날짜.log`
- 코드를 고친 뒤: 웹은 `git push` → Vercel 자동 배포, **게임 서버는 끄고 다시 켜야** 새 코드
- 운영 서버(2580)와 개발 서버(2567, `npm run dev`)는 따로 — 개발 · 테스트는 계속 `/rpg?dev=이름`(로컬)에서
- PC 이름을 바꾸거나 Tailscale 계정을 바꾸면 ts.net 주소가 바뀜 → Vercel `NEXT_PUBLIC_RPG_WS_URL` 고치고 Redeploy

### 0-6. 막히면
| 증상 | 확인 |
|---|---|
| `/rpg` 가 계속 "오픈 준비 중" | Vercel 환경 변수 2개 이름 · 환경(Production) 확인 → Redeploy 했는지 |
| 로그인 뒤 "게임 서버가 꺼져 있어요" | 서버 창이 열려 있는지 → 브라우저로 `https://<DNSName>/` 이 `{"ok":true}` 인지 → 아니면 `tailscale funnel status` · setup-pc.ps1 다시 |
| 접속하자마자 끊김(auth) | Vercel `RPG_TICKET_SECRET` 이 `live.env` 와 다름 → setup-pc.ps1 로 다시 복사해 붙여 넣고 Redeploy |
| 접속하자마자 끊김(origin, 4003) | `live.env` 의 `RPG_ALLOWED_ORIGINS` 에 `https://ruc-server.vercel.app` 이 있는지 |
| 서버 창이 바로 닫힘 | `C:\RucRpg\logs\server-날짜.log` 마지막 줄 |
| 상태 확인 | `Get-NetTCPConnection` 은 권한 없이 리슨 포트를 못 봄 — `http://127.0.0.1:2580/` 로 확인 |

### 0-7. 사용자에게 설명할 때 쓸 요약
> 게임은 다 만들어졌고 웹사이트에도 올라가 있어요. 남은 건 공개 스위치를 켜는 것뿐이에요.
> ① `setup-pc.ps1` 실행해서 Tailscale 로그인(무료) ② Vercel 에 값 2개 넣기(주소 + 클립보드의 비밀값) ③ Redeploy ④ 바탕화면 "러크 RPG 서버 켜기".
> 그러면 PC 가 켜져 있는 동안 누구나 `ruc-server.vercel.app/rpg` 에서 디스코드로 로그인해 들어올 수 있어요. 끝나면 말해 주세요 — 밖에서 접속되는지 제가 확인할게요.

---

## 1. 한눈에 보기

| 항목 | 상태 |
|---|---|
| 개발 단계 | **P0~P18 완료 · 웹사이트에 배포됨 · 2026-11-10 공개 완료.** 다음은 베타 피드백 반영(9장) |
| 그래픽 | 3등신 캐릭터(8프레임) · 세밀한 16×16 타일 · 32×32 아이콘 · 사실적 그래픽 모드 · 메이플풍 + 디아블로풍 + 고급(금테 양피지) UI · 사실적 맵(경계 · 데칼 · 접촉 그림자 · 장식) |
| 테스트 | node 기준 112개 전부 통과 (직업마다 "모든 스킬 시전" 30 + P9 + P10 소셜 3 + P12 소모품 4 + P13 채집 · 소환수 3) |
| 운영 사이트 | `https://ruc-server.vercel.app/rpg` — **공개됨**. 서버가 꺼져 있으면 "게임 서버가 꺼져 있어요" |
| 게임 서버 호스팅 | **이 PC** (D105) — 바탕화면 "러크 RPG 서버 켜기 / 끄기", Tailscale Funnel `https://seojun-desktop.tail7d94d5.ts.net` → 127.0.0.1:2580 |
| RUC | **베타 격리 지갑**만 (`RUC_MODE=beta`). 마크 서버 실제 RUC 와 연동하는 코드는 만들지 않기로 사용자가 정함 (D1) |
| 배포 규칙 | 사용자가 "각 단계가 끝나고 버그 · 오류가 없음을 확인하면 묻지 말고 바로 배포"라고 상시 허락 (2026-11-07) |

### 사용자가 직접 해야 할 일 (비밀값 · 결제 · 계정이라 Claude 가 못 함)
- **0장 "RPG 를 공개하려면"** 참고 (Tailscale 로그인 · Vercel 환경 변수 2개 · Redeploy · 서버 켜기)
- (이미 함) Vercel `DISCORD_CLIENT_SECRET` 갱신

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
RUC_RPG/deploy/                   운영 배포: pc/(이 PC 운영 — server-start · server-stop · setup-pc) · live.env(비밀값, 커밋 안 됨) · README · 오라클 VM 도구(setup.sh · deploy.sh, 안 씀)
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
- **P8 베타 폴리시**: 넷코드 10Hz · 시야 · 델타 · 바이너리, F3 디버그, 밸런스 시뮬, 채팅 · 욕설 필터, GM 도구(F8), 버그 제보, 사운드, IP 로깅, E2E
- **P9 세부 직업 30개 전부**: 전용 스킬 96 · 패시브 24 · 소환수 8종 · 마법형/혼합형 직업
- **P10 소셜**: 친구 · 차단 · 귓속말 · 접속 알림 · 길드(만들기 · 초대 · 신청 · 공지 · 위임 · 해산 · 길드 채팅) · 소셜 창(O) · 채팅 저장
- **P11 장비 외형**: 투구 · 장갑 · 망토 · 무기 레이어, 2차 전직 계열 망토 · 문장
- **P12 · P13 미뤄 둔 것**: 소모품(영약 · 부활 깃털 · 귀환 주문서 · 랜덤 상자 · 창고 확장) · 상점 잡화 · 선물 · 채집 · 제조 · collect 퀘스트 · 소환수 피격/어그로
- **P14 영지 · 국가**: 초원 4개 영지(주간 정산 · 영지의 가호 · 세금) · 국가 · 길드 레벨 · 길드 창고
- **P15 정식 성장**: 최대 레벨 100 · 황혼 고원(Lv30~100) · 장비 4단계 · 3차 각성(Lv60)
- **P16 모바일**: 터치 조작 · 작은 화면 HUD · **P17**: 영약 접속 간 유지 · 파티원에게 부활 깃털 · 에셋 교체 구조 · **P18**: 이 PC 운영 준비(0장)
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

- 게임 서버는 운영자 PC 가 켜져 있을 때만(사용자가 원한 방식) · 게임 서버를 다시 켜면 파티 · 던전 · 초대 대기 목록이 풀림
- 몹은 길찾기 없이 직진 + 벽 미끄러짐(`mobs.ts` ponytail) — 던전에서 끼인다는 제보가 오면 A*
- 실제 RUC 연동(`RUC_MODE=live`)은 만들지 않음 — 사용자가 두 번 거절(D1 · D105), 베타 격리 지갑
- 그림 · 소리는 코드로 그린 것 · 합성 — 실제 아티스트 그림 · 음원은 파일만 넣으면 쓰이게 해 둠(`web/public/rpg/assets/`, D104)
- §29 "50명 + 몹 30마리 한 화면 60fps"는 실제 내장 그래픽 노트북에서 재지 않음(헤드리스 수치만)
- 파티 · 길드 초대 · 가입 신청 · 국가 초대 대기 목록은 메모리 — 서버를 다시 켜면 다시 보내야 함(친구 신청은 DB)
- 밸런스는 허수아비 시뮬레이션 기준(D85) — 원거리 · 기동형의 장점이 안 잡힘, 실제 베타 테스터 피드백으로 다시
- 3차 각성은 새 스킬이 아니라 전용 궁극기 강화(D100), 고원 몹 그림은 기존 그림의 색조 변종(D99)

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

### P12 미뤄 둔 것 모음 1 — 완료 (D91~D93)
- 소모품은 `items.ts useConsumable`(서버) · 귀환은 main 틱의 `recallTick`. 새 소모품 = 템플릿에 `use` + 필요하면 `SHOP_GOODS` · `BOX_POOL`
- 창고 칸 수는 `capOf("storage", tabs)` — 서버 이동 · 빈 칸 찾기 · 클라 창고 그리드가 모두 씀

### P13 미뤄 둔 것 모음 2 — 완료 (D94 · D95)
- 채집 지점은 `Room.nodes`(필드만, 서버가 배치) · `Room.gather` · 방 이벤트 `gn`. 몹이 노릴 대상은 `Room.combatant(id)`(플레이어 · 소환수) — 새 몹 공격 코드도 이걸 쓸 것
- 소환수는 `Unit.petOf` 가 있는 전투 유닛: `damaged` · `struck` · `killed` · 수호의 맹세가 이걸 보고 플레이어 전용 처리를 건너뜀

### P14 영지 · 국가 — 완료 (D96~D98)
- `server/src/realm.ts`(영향력 · 정산 · 가호 · 국가 · 국가 채팅) · `shared/data/realm.ts`(영지 구역 · 주 번호 · 길드 레벨 표). room `hooks.kill` · `hooks.sec` 로 연결(main)

### 다음 할 일 (PLAN.md "베타 제외 → 베타 편입")
1. ~~운영 오픈~~ — **2026-11-10 완료**. (선택) GM 권한: `live.env` 에 `RPG_GM_IDS` · 버그 제보 디스코드: `RPG_BUG_WEBHOOK` → 서버 껐다 켜기
- P18: 운영 서버는 이 PC(`deploy/pc/server-start.ps1` · `server-stop.ps1` · `setup-pc.ps1`), 데이터 `C:\RucRpg`
- P17: 진짜 그림 · 음원은 `web/public/rpg/assets/` + `manifest.json` (README 참고)
- P16: 모바일은 `client/Touch.tsx`. 휴대폰 화면 캡처 = `MOBILE=1 node RUC_RPG/scripts/shot.mjs <url> <png> …`
- P15: 새 맵 종류 `highland` — 맵 종류가 늘면 `CHANNEL_CAP` · `ROOM_NAME` · main `maps`/`worlds` · 클라 `MAP_JSON` · BGM · `hud.<종류>` 문구를 같이
2. 실제 베타 테스터 피드백으로 밸런스 · 버그 (원거리 · 기동형 장점이 허수아비 시뮬에 안 잡힘, D85)
3. 하지 않은 것: 실제 RUC 연동(사용자 거절, 베타 지갑 유지), 실제 음원 · 아티스트 그림 파일(넣을 자리는 있음 — `web/public/rpg/assets/README.md`), 실제 노트북 60fps 측정(하드웨어)

### 운영 오픈
- **이 PC 에서**(D105) — 0장. 오라클 VM 방법(`deploy.sh`)은 24시간 켜 두고 싶어질 때를 위해 `deploy/README.md` 아래에 남겨 둠

---

### 베타 피드백 1차 — 2026-11-14 (완료 · 배포)
- **타격감**: 공격 8프레임을 동작 길이에 맞춰 끝까지 재생(예전엔 280ms 에 잘려 회수 동작이 안 보였음) · 옆모습은 어깨에서 원을 그리는 팔 + 각도별 칼(`character.ts` `ATK_ARM/ATK_BLADE`) + 2~3프레임 잔상(스미어) · 상체 앞으로 · 앞발 내딛기. 베기 초승달 · 타격 불꽃 · 넉백 · 내가 때리면 히트스톱 50/90ms · 피해 숫자 튀어나옴 · 시전 마법진(`fx.ts swing/spark/circle`)
- **대시**: 90° 회전 구르기 → 전용 동작 `dash`(시트 6번째 동작, 몸을 낮추고 기울인 질주) + 잔상(`fx.ghost`) + 흙먼지
- **퀘스트 안내**: 추적 창 300px · 금테 · 새 퀘스트 반짝 · 설명/갈 곳(방향 · 칸)/팁, 시작 팝업 크게 6.5초, 첫 퀘스트도 알림. 화면에 금색 흐르는 화살표 줄 + 목표 테두리 + 머리 위 화살표(`game.ts questGoal/drawQuest` — 목표 유형 → 장소, 다른 맵이면 포털)
- **분수 퀘스트**: 서버가 0.5초마다 보던 것을 매 스텝(달리면 지점을 지나쳤음) · 지난 지점 비트 `reach` 를 `qs` 로 보냄 · 다시 접속하면 저장된 개수만큼 이어짐 · 지점 옆 화분 6개 치움 · 바닥에 네 지점(북동남서 ✔) + 도는 길 표시
- **분수 그림**: 예전 분수는 테두리 타일(decor_below)이 물(water 레이어) 위에 그려져 물이 안 보였음 → 오브젝트 `fountain`(3단 이탈리아식, 8프레임, `world.ts fountainFrames`), 충돌은 타원(반지름 60×48). **plaza.json 바뀜 → 운영 게임 서버 재시작 필요**
- **광장 스태미나**: `step/tryRoll(…, safe)` — 광장은 달리기 · 구르기에 스태미나를 안 씀 (클라 예측 · 서버 같이)
- **포털**: 돌 아치 + 깊이 있는 나선 소용돌이 + 룬 (`portalFrames`)
- **팝업**: 창 높이를 화면 안으로 고정하고 안에서 스크롤, 닫기 버튼은 위에 붙음 (`rpg.css` · 창 밖에 설명을 띄우는 스킬창은 `.rpg-noclip`)
- **미니맵 · 지도(M)**: 시설 모양 아이콘 · 사냥터 구역 · 건물 윤곽 · 퀘스트 별, 지도에서 마우스를 올리면 설명(`Hud.tsx staticMarkers`)
- **HUD 깨짐 원인**: `.rpg-panel:not(.absolute):not(.fixed){position:relative}` 가 툴팁(`rpg-tip rpg-panel`)의 absolute 를 덮어써서 툴팁이 흐름에 끼어들었음 → `:not(.rpg-tip)`
- 테스트 114 (광장 스태미나 · 분수 비트/재접속/지점이 막히지 않음 추가)

### 베타 피드백 2차 — 2026-11-14 (Claude Code + Codex 공동, 기록 `docs/COLLAB_REVIEW.md` · 배정 `docs/COLLAB_CODEX.md`)
- **분수 버벅임 원인 = 운영 서버가 옛 코드**(13:58 시작, 분수 · 스태미나 수정 15:02 배포) → 웹 예측과 서버 충돌 · 스태미나가 달라 매 스냅샷 되돌려짐. 재발 방지: `shared/map.ts simHash`(충돌 + 이동 상수 + `SIM_VERSION` + `SNAP_VERSION`)를 `joined.sim` 으로 비교, 다르면 배너 "게임 서버가 웹과 다른 버전". **코드 배포 뒤 운영 게임 서버를 꼭 다시 켤 것.** 이동 규칙을 바꾸면 `SIM_VERSION`, 스냅샷 형식을 바꾸면 `SNAP_VERSION` 올리기. 작은 서버 보정은 화면에서 60ms 에 녹임(`game.ts err`)
- **월드 그림 2배 해상도**: `art/world.ts R = 2`(타일 32×32 그림), 텍스처는 `hdTex`(해상도 2) — 월드 좌표는 그대로. 다시 그린 것은 `HD_OBJECTS` / `HD_TILES`(`art/terrain.ts`), 아직인 것(포털 · 석상 · 모닥불 외 일부)은 1배 그림을 Scale2x. 새 그림 파일: `terrain.ts`(지형 · 절벽 · 계단) · `trees.ts`(맵별 수종 — `setTreeBiome`) · `fountain.ts` · `buildings.ts`(반목조 주택 · 천막 · 우물 · 바위 · 덤불 · 그루터기 · 기둥) · `props.ts`(Codex: 소품 18종). 바닥은 장식층까지 한 캔버스로 구워 1024px 조각 스프라이트(`chunked`)로 올림
- **시점**: 모든 그림을 3/4(약 55°)로 통일 — 바닥 원 = 1:0.6 타원, 세운 면은 앞면이 넓게 (아트 규칙 `COLLAB_CODEX.md` 6장)
- **언덕**: 맵 JSON `height` 레이어(층 + 16 = 계단), `scripts/hills.ts` 로 생성(앞면 · 가장자리 충돌을 collision 에 굽고, 도달성 BFS · 계단 착지 · 양옆 벽 확인). 그림은 `game.ts bakeHills`, 규칙은 `shared/map.ts heightKind`. 테스트: 모든 계단을 실제 `step()` 으로 왕복(`shared.test.ts`). **다시 생성하려면 맵 JSON 을 git 원본으로 되돌린 뒤 실행**(광장은 분수 충돌을 다시 넣어야 함 — 중심 768,768 · 타원 62×42 안 칸, 분수 오브젝트 y 807)
- **분수**: 중심 = 퀘스트 지점 중심(768,768), 충돌 = 바닥 타원
- **이펙트**(`fx.ts`): 연타 수 · 치명타 번쩍임/집중선/충격파/펀치 줌 · 처치 조각 · 방향 흔들림 · 피격 붉은 번쩍임 · 낮은 체력 테두리. 품질별 상한
- **머리 위 바**: 체력 · 기력 · 마나, 100/1000 눈금, 깎인 체력 잔상. 스냅샷 줄 = `[id,x,y,dir,flags,HP‰,MP‰,EN‰,최대HP]`(FULL 19바이트)
- **휠 배율** 1.25~7(브라우저 저장) · Ctrl+휠 = 핫바 칸
- **Codex**: 음식 8종(스태미나 12~85, 쌓임, 상점 잡화 · 랜덤 상자) · GM 창(F8) 아이템 지급 UI · 소환/이동/맵 좌표 · 무적 · 자원 무소모 · 이동 배율(최대 ×2 = 이동 상한) · 회복/부활 · 정보 · 아이템 아이콘 32×32 네이티브 재작화 · 소품 2배
- 테스트 117
- **아이템 아이콘 되돌림 (같은 날, 사용자 피드백 "무기가 픽셀이 따로 노는 것처럼 깨져 보임")**: Codex 의 32×32 직접 점찍기 대신 예전 방식(12×12 격자 + 팔레트 → Scale2x → 명암 `refine`)으로, Scale2x 를 두 번 해 **64×64**(`px.ts refine(src, 2)`). 음식 · 부가석 · 강화석은 같은 격자 방식(`ART.food_*` · `ART.gem` · `TPL_PAL`). 바닥 아이템 스프라이트는 해상도 2 텍스처

## 10. 새 대화를 시작할 때 이렇게 말하면 됩니다
> "RUC_RPG/docs/HANDOFF.md 읽고 베타 피드백 반영해줘." (공개는 끝남 — 문제가 생기면 0-6 표)

(자동 메모리에도 진행 상태 · 배포 규칙 · 함정이 저장돼 있어 같은 PC · 같은 프로젝트에서는 이어집니다.)
