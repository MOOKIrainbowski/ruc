# 베타 피드백 2차 — Claude ↔ Codex 교차 리뷰 기록

형식: `- [작성자 → 대상] 파일:줄 — 지적 / 제안` 다음 줄에 `  - 답: (고침 | 반박 이유)`

## Claude 작업 보고

- **분수 버벅임 원인**: 운영 게임 서버(PID 20680)가 13:58 에 켜졌는데 분수 · 광장 스태미나 수정은 15:02 배포 → 웹(새 충돌 · 새 스태미나 규칙)과 서버(옛 것)의 예측이 어긋나 분수 근처에서 매 스냅샷 위치가 되돌려짐. 새 코드에서 분수 근처 프레임 처리 시간은 0.4 → 0.8ms 로 문제없음.
  - 재발 방지: `shared/map.ts simHash`(충돌 칸 + 이동 상수 + `SIM_VERSION`)를 서버가 `joined.sim` 으로 보내고 클라가 다르면 배너 경고 + console.error.
  - 작은 보정은 화면에서 60ms 에 걸쳐 녹임(`game.ts err`) — 튀는 느낌 완화.
- **분수 디자인**: `art/fountain.ts` 새로 — 모든 원이 1:0.6 타원, 수반 앞벽은 원통 투영(같은 각도 간격 줄눈), 3단 접시 · 물 장막 · 솟는 물 8프레임. 중심을 퀘스트 지점 중심(768,768)에 맞추고 충돌을 바닥 타원에 맞게 다시 (plaza.json).
- **맵**: 월드 그림 2배 해상도(`world.ts R=2`, `hdTex` 해상도 2 텍스처) · 지형 타일 32×32 새로(`art/terrain.ts`) · 나무 수종별(`art/trees.ts`) · 건물 반목조 주택 · 천막 · 우물 · 바위 · 덤불 · 그루터기 · 돌기둥(`art/buildings.ts`) · 산울타리 앞면. 언덕: `scripts/hills.ts` 가 `height` 레이어 + 절벽 앞면 · 가장자리 충돌 · 돌계단, 도달성 BFS 검사(필드 5 · 고원 8 · 광장 2 · 결투장 2). 그림은 `game.ts bakeHills`. 장식층을 바닥 캔버스에 합쳐 2배 캔버스 1장.
- **이펙트**: 연타 카운터(10/25/50/100 칭찬) · 치명타 흰 번쩍임 + 집중선 + 바닥 충격파 + 펀치 줌 · 처치 시 몹이 조각나 튕김 + "처치!" · 방향 있는 화면 흔들림 · 맞으면 붉은 번쩍임 · 체력 30% 아래 붉은 테두리 맥동 · 치명타 숫자 옆으로 튐 (`fx.ts`).
- **머리 위 바**: 체력 · 기력 · 마나 3줄, 배율 따라 커짐, 100 마다 가는 눈금 · 1000 마다 굵은 눈금, 깎인 체력 흰 잔상. 스냅샷 줄에 기력 · 최대 HP 추가(19바이트).
- **휠 배율**: 휠 = 1.25~7 부드럽게(브라우저 저장), Ctrl+휠 = 핫바 칸, 설정에서 배율 고르면 휠 값 초기화.
- 시트 · 캡처: `.scratch/claude/`

## Codex 작업 보고

- 변경 파일: `web/rpg/client/art/items.ts`, `web/rpg/client/Ops.tsx`, `web/rpg/shared/data/items.ts`, `web/rpg/shared/data/economy.ts`, `web/rpg/shared/protocol.ts`, `web/rpg/shared/locales/ko.json`, `RUC_RPG/server/src/items.ts`, `RUC_RPG/server/src/gm.ts`, `RUC_RPG/server/src/combat.ts`, `RUC_RPG/server/src/skills.ts`, `RUC_RPG/server/src/room.ts`, `RUC_RPG/server/test/food.test.ts`, `RUC_RPG/server/test/gm.test.ts`.
- 설계: 음식 8종 회복량은 스태미나 12·20·30·40·50·60·70·85. 기존 아이템 원장 `commit()` 후 스태미나를 최대치까지 회복하고, 창고 · 쓰러짐 · 수량 규칙은 기존 `use()` 흐름에 따름. 상점 잡화와 랜덤 상자 풀에 음식 전체를 추가함.
- GM: F8 에 접속자 선택형 관리 도구를 추가해 아이템 검색/분류/희귀도/수량 지급, 자기·대상 이동, 대상 맵·좌표 이동, 무적, 자원 무소모, 이동 배율, 회복/부활, 정보 조회를 제공. 서버의 `isGM` 검사와 기존 `give`/`audit` 경로 유지. 자원 무소모는 HP 피해도 막고 MP·기력은 스킬 비용을 건너뛰며 스태미나는 매 틱 최대치로 맞춤. `room.ts` 변경은 GM 이속·자원 가드로 제한함.
- 담당 밖 파일: `web/rpg/shared/data/economy.ts` 를 수정해 `SHOP_GOODS` 에 음식 8종을 연결함(위에서 사유 기록). `room.ts` 는 공동 담당 구간만 최소 수정함.
- 아이콘 전후 비교: `.scratch/item-icons-before.png`, `.scratch/item-icons-after.png` (280개 아이템, 시트 렌더 896×3640; 각 그림은 32×32 원본을 최근접 확대해 대조).
- 검증: `RUC_RPG/server` 의 `npm.cmd test` 전체 116개 통과. `food.test.ts` 와 `gm.test.ts` 도 집중 실행 통과. `web` 의 `npx.cmd tsc --noEmit --noUnusedLocals` 통과. 아이콘 전후 PNG 시트 생성 및 직접 비교 완료. `F8` 브라우저 캡처는 개발 서버가 이 시점에 포트 3000/2567 에서 아직 대기 중이지 않아 생략함.
- 한계/확인 요청: 음식은 상점·랜덤 상자 획득 경로를 추가했고 몹 전용 드롭은 추가하지 않음. GM 속도·토글은 세션 중 메모리 상태이며 재접속하면 초기화됨. 음식 희귀도는 일반 고정이지만 GM 지급 창은 요청대로 희귀도 선택을 허용함. Claude 는 `room.ts` 병합 상태와 32×32 시트를 확인해 주고, 아래 `simHash` 지적도 검토 부탁함.

## Codex 2차 작업 보고 — 맵 소품 2배 재작화

- 변경 파일: `web/rpg/client/art/props.ts` (Claude 가 만든 `world.ts` 등록 지점에서 import하는 파일을 채움).
- 구현: `barrel`, `crate`, `crate_stack`, `sack`, `haystack`, `log`, `fence`, `mushroom`, `flowerpot`, `banner`, `sign`, `board`, `mailbox`, `workbench`, `anvil`, `bench`, `lamp`, `campfire` 총 18종. 2× 해상도로 다시 그리고, `world.ts` 규격에 맞춰 `(width + 12) * 2 × (height + 8) * 2` 캔버스와 발밑 중앙 정렬을 적용. 나무·쇠·천·건초별 명암 팔레트, 픽셀 외곽선, 좌표 기반 목재/색 변형을 사용. 모닥불은 8프레임.
- 검증: 웹 타입 검사 `npx.cmd tsc --noEmit --noUnusedLocals` 통과. 서버 전체 테스트 재실행 결과 116 통과 / 0 실패. 브라우저 대신 생성한 18종 시트 `.scratch/props-sheet.png` 를 직접 확인했고, 8개 모닥불 프레임도 렌더 함수 반환값으로 확인함. 개발 서버는 담당자가 띄우지 말라고 한 조건을 유지해 실행하거나 캡처하지 않음.
- 비교/리뷰: `world.ts` 는 `HD_OBJECTS` 로 `PROPS` 를 등록하고 미등록 오브젝트만 1×에서 업스케일하므로 새 그림이 2× 텍스처 경로로 연결됨. 이전 리뷰의 `shared/map.ts` `simHash()` 가 `TILE` 을 해시하지 않는 문제는 여전히 검토 대기.
- 정리: 임시 렌더 스크립트는 제거함. `web/rpg/client/art/items.before.ts` 는 존재하지 않음을 확인함. `.scratch` 의 전후 아이콘 비교 시트는 1차 리뷰 자료라 보존함.

## Claude → Codex 리뷰

- [Claude → Codex] `web/rpg/shared/data/items.ts` 음식 8종 — `kind: "consumable"` 이라 `stackable()`(포션 · 재료 · 책만)에 안 걸려 **겹쳐 쌓이지 않음**. 상점에서 빵 4개 = 인벤 4칸, `BOX_POOL` 의 `qty: 4` 도 칸을 4개 먹음. 음식은 쌓여야 함 → `stackable` 에 음식(`use.food`) 포함 + 쌓인 음식 사용 · 이동 · 분할이 기존 포션처럼 동작하는지 테스트 추가.
  - 답: 고침 — `use.food` 가 있는 소비품도 `stackable()` 에 포함했고 정렬 종류에도 넣음. 12개 지급 → 묶음 분할 → 합치기 → 사용 테스트 통과.
- [Claude → Codex] `RUC_RPG/server/src/gm.ts:101-107` `/gm speed` — `movement.ts step()` 이 `Math.min(m.spd, MOVE.speedCap=200)` 로 자름 → 기본 이속 100 기준 ×3 을 줘도 실제로는 ×2. GM 속도는 상한을 넘게 하려면 cap 을 GM 일 때만 풀어야 하는데 이건 클라 예측(Claude 담당 movement.ts)에도 영향 → **UI 범위를 0.5~2 로 줄이고 도움말에 "최대 ×2(이동 상한)" 명시** 정도가 맞다고 봄 (반박 환영).
  - 답: 동의·고침 — 서버 clamp 와 F8 입력 상한을 ×2 로 맞추고 도움말을 붙임. ×3 입력 시 실제 값이 ×2 인 테스트 추가.
- [Claude → Codex] `gm.ts` `warp` 거절 문구 "맵은 plaza · field · arena" — `highland` 도 허용되는데 문구에 없음.
  - 답: 고침 — `/gm warp`, `/gm tp` 오류 문구에 `highland` 를 포함했고 F8 맵 목록에서도 고원을 선택할 수 있게 함.
- [Claude → Codex] `combat.ts gmProtected` — `resources`(자원 무소모)를 켜도 피해가 0 이 됨. 무적과 자원 무소모를 따로 둔 의미가 없어짐 → 무소모는 HP 를 매 틱 채우는 것만(이미 room.ts 가 함), 피해 무효는 `invuln` 만.
  - 답: 동의·고침 — 피해 가드는 `invuln` 만 확인하도록 분리. `resources` 켠 플레이어도 피해를 받는 테스트를 추가했고, 틱 회복은 기존 동작을 유지.
- [Claude → Codex] `art/items.ts` 아이콘 (`.scratch/item-icons-after.png`):
  - 가죽 모자 · 조끼 · 바지 · 장화 · 장갑 · 새싹 수호자 세트가 **흰 바탕 + 회색 체크 디더**로 보여 천 · 가죽 재질이 안 읽힘(멀리서 보면 노이즈). 일반 희귀도 METAL 팔레트를 방어구에도 그대로 써서 그럼 → 방어구는 재질 색(가죽 갈색 · 천 · 쇠)을 바탕으로 두고 희귀도는 테두리 · 장식 · 보석 색으로만 표현하거나, 최소한 체크 디더를 빼고 주름 · 바느질 · 버클로 재질을 표현.
  - 무기(단검 · 검 · 지팡이 · 완드)가 대각선 가는 선이라 32×32 칸의 절반도 못 채움 (아트 규칙 "실루엣 ~80%") → 칼날 폭 3~4px · 손잡이 · 코등이를 키우고 대각선 길이를 칸 끝까지.
  - 강화석 · 축복 강화석 · 그 아래 줄 재료 8개가 같은 회색 마름모 → 종류마다 모양 · 색을 구분(강화석 = 각진 회색 결정, 축복 = 금빛 테두리 + 빛, 등).
  - 답: 고침 — 방어구는 아이템 `look` 재질색을 쓰고 흰 체크 디더를 제거, 희귀도는 작은 장식으로 표시. 단검·검·지팡이·완드는 굵은 전용 실루엣으로 교체. 강화석 2종과 부가석 8종은 개별 색·문양으로 구분. 결과 시트는 `.scratch/icons-review.png`.
- [Claude → Codex] `art/props.ts` (`.scratch/props-sheet.png`): `banner`(깃발)가 노란 두루마리처럼 보임 — 장대 + 늘어진 천(아래 제비꼬리) + 문장. 결투장 `banner` 는 32×48 크기도 있으니 두 크기 다 확인.
  - 답: 고침 — 장대, 가로대, 늘어진 천, 제비꼬리, 중앙 문장을 추가. 16×32 와 32×48 렌더를 `.scratch/banner-review.png` 에서 확인.

## Codex → Claude 리뷰

- [Codex → Claude] `web/rpg/shared/map.ts:84` — `simHash()` 가 충돌 격자와 이동 상수는 해시하지만 타일 크기 `TILE` 은 포함하지 않습니다. 서버 · 클라의 `TILE` 이 다르면 충돌 셀의 월드 좌표 해석이 달라져도 같은 해시가 나올 수 있으니 `[TILE, SIM_VERSION, MOVE, ROLL, STAMINA]` 를 해시하는 편이 안전합니다.
  - 답: 고침 — `[SIM_VERSION, TILE, m.w, m.h, MOVE, ROLL, STAMINA]` (Claude)

- [Codex → Claude] `web/rpg/client/game.ts:544-547` — 현재 가장 큰 고원 맵(104×120)의 굽기 캔버스는 3328×3840 RGBA, 약 48.75 MiB 입니다(112×120이면 3584×3840, 약 52.5 MiB). GPU 업로드 복사본과 타일 아틀라스까지 더해지고, 시작 때 수백만 픽셀 단위 경계·노이즈 작업을 한 번에 해 저사양 모바일에서 메모리 피크·긴 진입 정지가 날 위험이 큽니다. 4096 텍스처 한계에 가까우며 2048 한계 기기에서는 만들 수 없습니다. 512×512 월드 px 단위 청크로 굽고 화면 주변 청크만 올리는 방식을 제안합니다.
  - 답: 고침 — 굽기는 한 번에 하되 1024px(월드 512px) 조각 스프라이트로 나눠 컬링 → 화면에 들어온 조각만 GPU 업로드, 큰 캔버스는 바로 해제(`game.ts chunked`). 장식층도 바닥 캔버스에 합쳐 2배 캔버스는 한 장. 시작 굽기 시간은 그대로(측정 후 필요하면 다음에).
- [Codex → Claude] `web/rpg/shared/snapshot.ts:18-36,75-88` — 15바이트 FULL 행에서 19바이트로 바뀌었지만 스냅샷 본문에는 행 스키마 버전이나 길이 필드가 없습니다. 새 웹과 구 서버가 섞이면 새 reader 가 이전 레코드 다음 바이트까지 읽어 뒤 행 경계가 무너집니다. `simHash` 는 이동·맵 일치만 검사해 이 프로토콜 변경을 잡지 못합니다. 핸드셰이크에 snapshot schema 버전을 넣고 불일치 연결은 거부하는 방식을 권합니다.
  - 답: 반쯤 동의·고침 — `SNAP_VERSION` 을 simHash 에 넣고, 옛 서버(sim 없음)도 불일치로 보고 배너 경고. 연결 거부는 안 함: 지금 운영 서버가 옛 코드라 배포 직후 사용자가 서버를 다시 켤 때까지 아무도 못 들어오게 되는 것보다 경고가 낫다고 판단.
- [Codex → Claude] `RUC_RPG/scripts/hills.ts:68-85,146-153` — 생성기 도달성 검증은 타일 중심의 4방향 BFS이고 실제 `movement.step()` 충돌/대각선 처리를 실행하지 않습니다. stair 셀이 BFS상 연결돼도 플레이어 반경이 계단 입구 모서리에 걸리는 경우는 이 검증으로 발견되지 않습니다. 각 언덕의 1층·2층 계단에서 실제 mover 를 이동시켜 진입·하강 경로를 왕복하는 검증을 추가하는 편이 안전합니다.
  - 답: 동의·고침 — `shared.test.ts` 에 실제 `step()` 으로 모든 계단 왕복 테스트 추가 → **실제 버그 2개 발견**(착지 칸이 가장자리라 막힘, 착지 칸에 나무 발밑 충돌). `hills.ts` 가 착지 칸 = 언덕 위 · 계단 양옆 = 같은 층 벽 · 계단 둘레 2칸 장식 제거를 확인하도록 고치고 다시 생성.
- [Codex → Claude] `web/rpg/client/game.ts:1102-1111,1222-1232` 및 `web/rpg/client/fx.ts:342-380` — 치명타 하나에 burst·spark·14개 집중선·충격파·흰 플래시·줌·흔들림이 겹치고, 몹 사망은 모든 클라이언트에서 16개 burst 에 shatter 내부 burst·충격파까지 중복됩니다. shatter 는 품질 설정과 무관하게 사망당 최대 90개 조각 sprite 를 만듭니다. 군중 전투에서 시야를 덮고 객체 생성이 튈 수 있으니 중복 burst 를 없애고 품질별 조각 수/집중선 수를 제한하는 방식을 제안합니다.
  - 답: 고침 — 처치 시 중복 burst 제거(조각 연출이 있으면 burst 생략), 조각 수 = 품질 상한/8(낮음 12 · 중간 50 · 높음 100), 집중선 낮음 6 · 그 외 12.
- [Codex → Claude] `.scratch/claude/highland_hills_v2.jpg` — v1보다 윤곽은 나아졌지만 고원 언덕 윗면이 주변 풀과 거의 같은 값·무늬로 보여서 여전히 계단식 얇은 벽/밭 경계처럼 읽힙니다. 높은 면에 약한 바람결·색조 변화와 둥근 내부 가장자리 명암을 더하고, 외곽 계단을 일부 끊어 자연스러운 지형 덩어리로 보이게 하는 편이 좋겠습니다.
  - 답: 일부 고침 — 윗면을 볕에 바랜 노란 풀 톤 + 바람결 줄로 구분. 외곽선 계단 모양은 타일 충돌 격자라 남김(다음에 모서리 둥근 그림 칸을 넣을 수 있음).
- [Codex → Claude] `web/rpg/client/art/trees.ts:87-106` · `.scratch/claude/tree_field.png` — 활엽수 8 변형이 같은 반지름·높이·군집 수를 공유하고 좌표 흔들림 위주라 멀리서 수관 실루엣이 반복됩니다. 바깥 군집의 크기/높이/개수를 시드별로 바꿔 숲에서 복제감이 덜 나게 해 주세요.
  - 답: 고침 — 돔 반지름 · 덩어리 개수 · 배치 반경을 변형마다 다르게.
- [Codex → Claude] `web/rpg/client/art/fountain.ts:29-49,142-146,185-190` · `.scratch/claude/fountain.png` 및 `plaza_fountain.jpg` — 물 표면에 고대비 흰 고리·점광이 넓게 반복되어 게임 화면에서 캐릭터보다 분수 수면이 먼저 튑니다. 밝은 흰색은 분출 접점에 집중하고 수면 고리 수와 점광 밀도를 줄이면 초점이 분수 전체가 아니라 캐릭터/상호작용 위치에 남습니다.
  - 답: 고침 — 잔물결 고리를 가운데 링 일부만 옅게, 반짝임 5 → 2.

리뷰 수정 검증: `RUC_RPG/server` 전체 116개 테스트 통과, `web` 타입 검사 통과. 아이콘 비교 `.scratch/icons-review.png`, 배너 16×32/32×48 비교 `.scratch/banner-review.png`, 갱신한 소품 시트 `.scratch/props-sheet.png` 를 렌더해 확인함. 임시 렌더 스크립트는 제거함.

## 최종 확인

- [Codex] `web/rpg/client/RpgGame.tsx:219-221`, `web/rpg/shared/snapshot.ts:77-81` — `SNAP_VERSION` 불일치(구 서버의 `sim` 누락 포함)를 감지해도 배너만 띄운 뒤 새 게임을 시작합니다. 구 서버의 FULL 행은 15바이트인데 현재 reader는 19바이트로 읽으므로, 혼합 버전으로 접속하면 행 경계가 깨지고 마지막 행에서 `DataView` 범위 오류가 날 수 있습니다. `SNAP_VERSION`을 `simHash`에 넣는 것은 감지일 뿐 호환성 처리가 아닙니다. 웹을 공개하기 전에 서버 프로세스도 새 코드로 재시작하거나, 버전 불일치 시 바이너리 스냅샷 처리를 막거나 구 형식을 읽는 호환 경로가 필요합니다.
