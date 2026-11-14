# Codex 작업 안내 — 러크 RPG 베타 피드백 2차 (Claude Code 와 공동 작업)

> 작성: Claude Code, 2026-11-14. 이 문서를 처음부터 끝까지 읽고 시작해 주세요.
> 같은 작업 폴더를 **동시에** 고칩니다. 아래 "파일 담당" 을 꼭 지켜 주세요.

## 0. 이 프로젝트 한눈에

- 러크(RUC) 마인크래프트 서버 커뮤니티의 브라우저 2D 픽셀 RPG. 운영 중(베타) — `https://ruc-server.vercel.app/rpg`
- **반드시 먼저 읽기**: `RUC_RPG/docs/HANDOFF.md` 2장(폴더 구조) · 3장(로컬 실행 · 검증) · 6장(아키텍처) · 7장(함정)
- 구조
  - `web/rpg/shared/` — 클라 · 서버 공용 TypeScript (서버가 그대로 import). 아이템 데이터 `shared/data/items.ts`, 프로토콜 `shared/protocol.ts`, UI 문자열 `shared/locales/ko.json`(**UI 한글은 여기 키로 — 인라인 한글 금지**, 아이템 · 스킬 이름 같은 콘텐츠 이름은 data 파일에 직접)
  - `web/rpg/client/` — PixiJS 렌더러(`game.ts`) + React HUD(`*.tsx`). 도트 그림은 전부 코드로 그림: `client/art/*.ts` (`Px` 픽셀 버퍼 — `art/px.ts`)
  - `RUC_RPG/server/` — Node 24 게임 서버(`ws`, `node:sqlite`, TS 직접 실행). 테스트 `npm test` (현재 114개 전부 통과)
- 서버 권위: 서버가 20Hz 시뮬레이션, 클라는 같은 `shared/movement.ts` 로 이동을 예측. 경제(아이템 이동)는 `economy.ts atomic()` / `items.ts commit()` 으로 원자적 + 원장 기록 — **아이템을 만들거나 없앨 때는 반드시 기존 `give()` / `commit()` 경로를 쓸 것** (직접 배열 조작 금지).
- 코드 스타일: 짧고 단순하게. 새 추상화 · 새 의존성 금지. 주석은 한국어. 기존 파일 스타일(한 줄 데이터 정의, `ponytail:` 주석 관례)을 따라 주세요.

## 1. 사용자 지시 전체 (참고용 — 이 중 Codex 담당은 2장)

1. 분수 주변 버벅임 · 조작 불량 — Claude
2. 분수 디자인 시점 통일 — Claude
3. 맵 퀄리티(시점을 브롤스타즈 정도로 낮춤 · 언덕/고지대 · 더 많은 픽셀 · 사실적인 나무 · 건물) — Claude
4. 전투 이펙트 강화(도파민) — Claude
5. 광장 스태미나 무소모 — Claude (이미 구현돼 있음. 운영 서버가 옛 코드로 돌던 게 원인)
6. **아이템 디자인 퀄리티 — 픽셀 수 늘리기 — Codex**
7. **음식(소모품) 아이템 여러 개 — 스태미나 회복량이 각각 다름 — Codex**
8. **GM 권한 확대 — F8 창에서 모든 아이템을 특정 유저에게 지급 · 순간이동 · 체력/마나/기력/스태미나 무소모 등 관리 편의 기능 — Codex**
9. 플레이어 머리 위 체력 · 기력 · 마나 바 크게 + 눈금(체력이 많을수록 구분선 많게) — Claude
10. 마우스 휠로 화면 배율 조절 — Claude

## 2. Codex 담당 작업

### 6) 아이템 아이콘 퀄리티 (`web/rpg/client/art/items.ts`)
- 지금: 12×12 문자열 격자 그림을 16×16 에 놓고 `refine32` 로 32×32 로 늘림 → 사실상 12×12 해상도.
- 목표: **32×32 네이티브로 다시 그리기** (모든 아이콘: 무기 6 · 방어구 · 장신구 · 포션 · 재료 · 책 · 소모품 · 채집물 + 새 음식). 결과 캔버스 크기는 지금처럼 32×32 유지(인벤 · 핫바 · 상점 · 툴팁이 32×32 를 가정).
- 규칙: 여전히 **픽셀아트**(안티앨리어싱 · 그라데이션 블러 금지, 하드 픽셀). 외곽선 `OUTLINE`(#2b1d2e, 순수 검정 금지), 광원은 **왼쪽 위**(밝은 면 · 기본 · 그늘 3단 + 하이라이트 1px), 셀 셰이딩 + 디더 약간. 실루엣이 32×32 칸의 ~80% 를 채우게.
- 장비는 희귀도 팔레트 교체(`METAL[rarity]`)가 그대로 동작해야 함 (하급 녹슨 갈색 → 전설 금빛 + 반짝임). 전설은 반짝임 픽셀 유지.
- `overrides.items` (실제 그림 파일 교체, P17) 경로는 그대로 둘 것.
- 방법은 자유(문자열 격자 32×32 든, `Px` 의 rect/ellipse/line 으로 절차적으로 그리든). 단 코드가 폭발하지 않게 — 공통 모양(병 · 칼날 · 손잡이)을 함수로.
- `gatherNode`(필드의 채집 지점 16×16)는 맵 오브젝트라 Claude 의 맵 작업과 겹침 → **건드리지 말 것**.
- 확인: 아이콘 시트를 PNG 로 뽑아 직접 보고 비교(예: node 스크립트로 모든 아이콘을 한 장에 — `RUC_RPG/scripts/shot.mjs` 참고, 또는 브라우저 개발 화면 `/rpg?dev=codex1` 인벤토리). 전후 비교 PNG 를 스크래치에 남겨 Claude 에게 경로를 알려 주세요.

### 7) 음식 아이템 (소모품)
- `shared/data/items.ts` 에 음식 여러 개(최소 8개 정도: 빵 · 사과 · 구운 고기 · 생선구이 · 수프 · 꼬치 · 파이 · 꿀떡 … 이 세계관 이름으로 자유롭게) — **각각 스태미나 회복량이 다르게**. 스태미나는 `Mover.stamina` (`shared/movement.ts`, 서버 `p.m` 쪽 — room.ts 의 플레이어 이동 상태) 이고, 기력(`en`) · 마나(`mp`) 와는 다른 값입니다. 헷갈리지 말 것.
- 서버 사용 처리: `RUC_RPG/server/src/items.ts` `use()` / `useConsumable()` 흐름에 맞춰. 템플릿 `use` 필드에 `food: 회복량` 같은 식(또는 순간 회복 + 짧은 지속 회복 등 음식마다 개성)도 좋음. 쌓을 수 있게(`stackable`) · 재사용 대기 · 쓰러진 상태 금지 · 창고에서 사용 금지 등 기존 규칙 따르기.
- 스태미나는 클라가 예측하는 값 — 서버가 바꾸면 다음 ack 로 클라 예측이 맞춰짐(별도 처리 불필요할 것. 확인해 보고 이상하면 알려 주세요).
- 얻는 곳: 일반 상점 잡화(`SHOP_GOODS` 쪽) · 랜덤 상자 풀(`BOX_POOL`) · 적당한 몹 드롭 등 기존 표에 넣기. 가격 · 회복량 밸런스는 포션 · 스태미나 최대치(`shared/data/stats.ts STAMINA`)를 보고 정하기.
- 아이콘은 6) 과 같은 품질로.
- 서버 테스트 추가(`RUC_RPG/server/test/` 기존 소모품 테스트 참고): 음식 사용 → 스태미나 증가 · 개수 감소 · 최대치 넘지 않음.

### 8) GM 권한 확대 (`RUC_RPG/server/src/gm.ts` · `web/rpg/client/Ops.tsx` GM 창 · `shared/protocol.ts`)
- 지금: F8 GM 창 = 접속자 목록(이동 · 뮤트 · 킥 · 밴 버튼) + 버그 제보 + `/gm 명령` 입력칸. 명령은 채팅 `/gm …` 로 보냄. `isGM` = `RPG_GM_IDS` 또는 개발 모드의 `dev-` 계정.
- 추가할 것:
  - **아이템 지급 UI**: 모든 아이템(`ITEMS`)을 검색 · 분류(무기 · 방어구 · 장신구 · 포션 · 음식 · 재료 · 책 · 소모품)로 고르고, 대상 유저(접속자 목록에서 선택), 개수, 희귀도를 정해 지급. 아이콘(`itemIcon`)과 이름이 보이게. 지급은 기존 `give` 명령 경로(감사 로그 `audit` 유지).
  - **순간이동**: 나 → 유저, 유저 → 나(소환), 맵 + 좌표, (가능하면) 큰 지도(M)/미니맵 클릭 대신 GM 창의 맵 선택 + 좌표 입력으로 충분.
  - **GM 상태 토글(자기 자신 또는 대상)**: 무적(피해 0) · 자원 무소모(HP · MP · 기력 · 스태미나 안 줄어듦, 스킬 쿨타임 없음은 선택) · 이동 속도 배율 · 투명(다른 유저 화면에서 숨김은 선택 — 스냅샷 AOI 를 건드리니 신중히) · 즉시 회복 · 즉시 부활.
  - 그 밖에 운영에 편한 것: 대상 정보 보기(레벨 · 위치 · 장비 · RUC) · 레벨 설정 · RUC 지급 버튼화 등. 너무 많이 벌이지 말고 **실제로 운영자가 자주 쓸 것 위주**로.
- 모든 GM 명령은 서버에서 `isGM` 검사 + `audit` 기록 (보안 경계 — 클라 UI 를 숨기는 것만으로는 안 됨).
- GM 상태(무적 등)를 서버에서 구현할 때: 피해 처리 · 자원 소모 지점은 `server/src/combat.ts` · `skills.ts` · `room.ts`. **`room.ts` 는 Claude 도 고칠 수 있으니 고칠 곳을 최소 · 국소적으로**(한두 줄 가드). 스태미나 무소모는 서버 틱에서 최대치로 채우는 식이면 클라 예측(`movement.ts`, Claude 담당)을 안 건드려도 됨.
- 테스트 추가: GM 이 아닌 사람은 명령 거절 · 지급 · 무적 · 무소모가 동작.

## 3. 파일 담당 (동시 편집 충돌 방지)

| 담당 | 파일 |
|---|---|
| **Codex** | `web/rpg/client/art/items.ts`, `web/rpg/client/art/icons.ts`(아이템 관련만), `web/rpg/shared/data/items.ts`, `RUC_RPG/server/src/items.ts`, `gm.ts`, `combat.ts`, `skills.ts`, `web/rpg/client/Ops.tsx`, `web/rpg/client/Inventory.tsx`(필요하면), 새 서버 테스트 파일 |
| **Claude** | `web/rpg/client/game.ts`, `fx.ts`, `realistic.ts`, `art/world.ts`, `art/character.ts`, `art/mobs.ts`, `art/px.ts`, `Hud.tsx`, `CombatHud.tsx`, `RpgGame.tsx`, `shared/movement.ts`, `shared/map.ts`, `shared/tiles.ts`, `shared/constants.ts`, `shared/data/maps/*.json`, `RUC_RPG/scripts/*`, `server/src/main.ts` |
| 같이 (작게, 국소적으로) | `server/src/room.ts`, `shared/protocol.ts`, `shared/locales/ko.json`(Codex 는 `gm.*` · `food.*` · `item.*` 키, Claude 는 `fx.*` · `hud.*` · `map.*` 키 — 파일 끝 쪽에 덧붙이기), `web/rpg/client/rpg.css`(Codex 는 GM 창 관련 규칙만 맨 끝에) |

- 담당 밖 파일을 꼭 고쳐야 하면 먼저 `RUC_RPG/docs/COLLAB_REVIEW.md` 에 "무엇을 왜" 적고 Claude 에게 알려 주세요(대개 Claude 가 대신 고침).
- **하지 말 것**: `git commit` / `git push` / `git checkout` / `git stash` / `git reset` (커밋 · 배포는 Claude 가 마지막에 한 번에), 개발 서버 켜기 · 끄기(포트 3000 · 2567 은 Claude 가 띄워 둠 — 필요하면 그대로 쓰기), `next build`(dev 와 충돌 — HANDOFF 7장), 운영 서버(포트 2580 · `C:\RucRpg`) 건드리기, 비밀값 파일(`.env*`, `live.env`) 읽기 · 출력.
- 브라우저 확인은 로컬 `http://localhost:3000/rpg?dev=codex1` (이름은 `codex` 로 시작하게 — 사용자 계정 X). `?dev=` 계정은 개발 모드에서 자동 GM.

## 4. 검증 (끝냈다고 하기 전에 전부)
1. `cd RUC_RPG/server && npm test` — 전부 통과
2. `cd web && npx tsc --noEmit --noUnusedLocals` — 출력 없음 (Claude 작업 중인 파일 때문에 오류가 나면 그 파일 · 줄을 알려 주세요)
3. 아이콘 전후 비교 PNG · GM 창 캡처(가능하면)
4. `RUC_RPG/docs/COLLAB_REVIEW.md` 의 "Codex 작업 보고" 칸에: 바꾼 파일 · 설계 결정 · 남은 한계 · Claude 에게 확인받고 싶은 것

## 5. 교차 리뷰 (경쟁 + 토론)
- 사용자는 두 에이전트가 **서로의 결과물을 비판적으로 검토하고 토론해서** 품질을 끌어올리기를 원합니다.
- 각자 1차 구현이 끝나면, 상대 담당 파일의 diff(`git diff -- <파일>`)를 보고 `COLLAB_REVIEW.md` 에 구체적인 지적(파일:줄 · 무엇이 문제 · 어떻게 고칠지)을 남깁니다. 칭찬보다 **결함 · 버그 · 어색한 그림 · 성능 · 보안** 위주로. 받은 지적은 반박하거나 고치고 그 결과를 적습니다.
- 디자인(그림)은 "실제로 더 좋아 보이는가" 가 기준 — 캡처 PNG 로 비교.

---

## 6. 2차 배정 (지금 작업이 끝난 뒤) — 맵 소품 2배 재작화

사용자 지시 3번(맵 퀄리티)을 Claude 가 맡았는데 양이 많아 소품을 나눕니다. **Claude 가 월드 그림 파이프라인을 2배 해상도로 바꿨습니다**:
- `art/world.ts` `R = 2`: 1 월드 px = 2 그림 px. 타일 하나 = 32×32 그림. `objectFrames(o)` 는 2배 캔버스를 돌려주고 game.ts 가 해상도 2 텍스처(`hdTex`)로 올려 **월드 크기는 그대로, 픽셀은 4배**.
- 아직 다시 그리지 않은 그림은 1배 그림을 Scale2x 로 키운 것(`upCanvas`) — 그래서 지금도 다 보이지만 뭉툭함.
- 다시 그린 것은 `HD_OBJECTS[type]` 에 등록 → 그 그림을 씀.

### Codex 담당: `web/rpg/client/art/props.ts` (새 파일, 이미 빈 표 `PROPS` 를 만들어 둠 — world.ts 가 합쳐 씀)
`barrel` `crate` `crate_stack` `sack` `haystack` `log` `fence` `mushroom` `flowerpot` `banner` `sign` `board` `mailbox` `workbench` `anvil` `bench` `lamp` `campfire`(8프레임 애니메이션 — 지금 1배 그림 참고)
- 지금 1배 그림은 `world.ts objectFrames1x` 의 각 `case` — 크기 · 발밑 위치 · 색감을 참고하되 **새로 그리기**(그대로 키우지 말 것).
- 캔버스 크기 = `(o.width + 12) * 2` × `(o.height + 8) * 2` (기존 여백 PAD_X 6 · PAD_TOP 8 의 2배). 그림 아래 끝(발밑) = 캔버스 아래 끝, 가로 가운데 = 오브젝트 x. 오브젝트 width/height 는 맵 JSON 값(대부분 16~48).
- `props.ts` 는 `./px` 만 import (world.ts 를 import 하면 순환). 필요한 도우미(ball · lerpHex 등)는 px.ts 에 있는 것을 쓰거나 props.ts 안에 작게.

### 아트 규칙 (Claude · Codex 공통 — 맵 전체가 한 그림처럼 보이게)
1. **시점 = 브롤스타즈 정도의 3/4 시점(위에서 약 55°)**: 바닥에 놓인 원은 가로:세로 = 1 : 0.6 타원. 세워진 면(벽 · 통 옆면 · 상자 앞면)은 높이의 약 0.85 로 **앞면이 넓게** 보이고, 윗면은 깊이의 0.6 으로 납작하게. **한 물체 안에서 시점을 섞지 말 것**(사용자 지적: 지금 분수는 수반은 위에서, 테두리는 정면에서 본 모양이라 어색함).
2. 광원 = 왼쪽 위. 재질마다 5단 램프(하이라이트 · 밝음 · 기본 · 그늘 · 깊은 그늘) + 맞닿는 곳 AO(어두운 1~2px). 색 그늘은 채도를 살짝 올리며 어둡게(회색으로 죽이지 않기).
3. 외곽선: 실루엣만, 재질의 가장 어두운 색보다 한 단계 더 어두운 **유색** 외곽선(순수 검정 · `#000` 금지). 안쪽 선은 외곽선보다 밝게(셀렉티브 아웃라인).
4. 하드 픽셀 · 디더(2×2 체커) 허용 · 안티앨리어싱 · 블러 · 반투명 그라데이션 금지(그림자 · 빛 반사 하이라이트만 `#rrggbbaa` 로 섞기 허용).
5. 질감: 나뭇결 · 쇠 리벳 · 돌 결 · 천 주름 등 **실제 물건 레퍼런스처럼** 디테일을 2배 해상도만큼 더 넣기. 같은 종류 여러 개가 똑같아 보이지 않게 `hash(o.x, o.y)` 로 약간씩 변형.
6. 접촉 그림자는 game.ts 가 따로 깔아 주므로 그림 안에 바닥 그림자를 크게 넣지 말 것(발밑 1~2px AO 정도만).

확인: `/rpg?dev=codex1` 로 광장(소품 대부분) · 초원(`__rpg.net.send({t:'dev',map:'field',x:448,y:1280})`) 캡처 전후 비교 PNG. 끝나면 COLLAB_REVIEW.md 에 보고.
