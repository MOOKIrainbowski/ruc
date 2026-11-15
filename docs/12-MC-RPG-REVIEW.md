# 마크 RPG 계획 비판 리뷰

## Codex 리뷰 1

### 1. 글꼴 HUD는 화면 좌표 UI가 아니다

- 액션바는 핫바 바로 위 한 줄의 기존 출력 통로라 독립 HUD 레이어가 아닙니다. RucCore나 다른 플러그인이 보내는 액션바·바닐라 상태 메시지와 소유권을 공유합니다. “1틱 뒤 다시 그리기”는 패킷 경합을 없애지 않고, 4Hz HUD 갱신은 메시지를 덮거나 깜빡이게 만들 수 있습니다. HUD 전체를 액션바에 올리기보다 상태 숫자·짧은 알림만 액션바에 두고, 보스바·인벤토리 GUI·아이템 툴팁 등 각자 수명이 있는 채널로 나누는 편이 안전합니다.
- `space` 문자는 텍스트의 가로 advance를 조절하고 bitmap `ascent`는 글리프를 baseline 기준으로 놓습니다. 음수 ascent도 글리프를 baseline 아래로 옮기는 bearing 조정이지, 임의의 화면 Y 좌표나 GUI anchor를 만드는 기능은 아닙니다. 1.21.11 bitmap provider는 `height`와 `ascent`가 정수 필드이고 `ascent > height`인 provider는 거부되는 제약이 있어, 큰 UI를 “ascent를 크게” 하는 방식으로 붙일 수 없습니다. bitmap 글리프도 클라이언트 글리프 atlas에 들어가야 하므로 큰 그림은 256×256 단일 글리프 한도를 염두에 둬야 합니다.
- `ttf`의 `shift`는 폰트 글리프의 위치 조정이지 화면 배치 API가 아닙니다. 줄 간격·문자 advance·GUI 배율까지 함께 바뀌는 것이 아니며, 한글 글꼴 크기와 baseline은 실제 1.21.11 클라이언트에서 해상도·GUI scale별로 확인해야 합니다. 한 줄 액션바를 스탯 표·구슬·핫바 주위에 고정하려면 화면 폭/GUI scale을 서버가 모르는 문제가 남습니다.

### 2. 미니맵 코어 셰이더는 가장 취약한 선택지

- 오른쪽 위 고정 미니맵은 리소스팩이 지원하는 표준 HUD 위젯 기능이 아닙니다. 코어 셰이더 교체는 Mojang이 내부 구현이며 비지원·비의도 기능이라고 명시했고, 내부 변경에 따라 깨질 수 있습니다([Minecraft Java 1.21.9 기술 변경](https://feedback.minecraft.net/hc/en-us/articles/39966147272589-Minecraft-Java-Edition-1-21-9-The-Copper-Age)). 1.21.11은 코어 셰이더가 안전하게 고정되는 별도 API를 추가하지 않았습니다.
- 셰이더 자체에는 서버의 실시간 좌표, 파티원 목록, 플레이어 스킨 얼굴을 자동으로 공급하는 기능이 없습니다. 지도 타일과 머리 마커를 어떤 렌더 경로/텍스처로 전달할지까지 별도 구현하고, Iris·OptiFine 및 vanilla 클라이언트에서 각각 검증해야 합니다. 이 의존성을 M9까지 미루면 Q2 답변과 HUD/팩 구조를 다시 짜게 될 수 있습니다.
- 대안 우선순위는 (a) 모든 클라이언트에서 동작하는 보스바/GUI 지도, (b) 지도 아이템·오프핸드 지도, (c) 클라이언트 모드가 필요한 우상단 고정으로 두는 것이 좋겠습니다. 우상단 고정이 필수라면 미지원 코어 셰이더 호환성을 출시 조건과 클라이언트 버전 제한에 명시해야 합니다.

### 3. 스킬 키 배치는 서버가 키 입력을 받는다는 가정이 과함

- 서버 플러그인은 임의 키의 keydown/up을 받지 않습니다. Q 버리기와 F 손바꾸기는 서버 이벤트로 간접 감지할 수 있지만, 이를 막으면 드롭/손바꾸기 기본 동작을 계속 취소해야 합니다. `Shift+Q`도 버리기 입력과 충돌하고, `Shift+우클릭`은 음식·포션·블록 상호작용과 겹칩니다. Shift+F 메뉴를 RucCore가 이미 쓰므로 별도 조합을 더하면 신규/기존 동작이 충돌합니다.
- 공중 Space 재입력은 클라이언트 키 이벤트가 서버에 오는 것이 아니라 이동/점프 상태 변화로 추정해야 합니다. 바닥 판정·핑·지연 보정과 연동하면 구르기 오작동과 치트 입력 문제가 생길 수 있습니다. 계획의 추천안을 고정하기 전에 실제 Paper 이벤트/패킷으로 입력을 검증하고, 기본 아이템 사용·드롭·손바꾸기를 보존할 대체 조작을 정해야 합니다. 완전한 원키 바인딩이 요구되면 클라이언트 모드가 필요하다는 점을 선택지로 분리해야 합니다.

### 4. M1 이전에 사용자 결정과 서버 경계가 확정되어야 함

- Q1~Q4는 조작·미니맵·몹 외형·레벨/경험치 정책의 핵심 결정인데 아직 미결입니다. Q4는 특히 RucCore를 수정하지 않으면서 RPG 레벨/경험치 바와 기존 RucCore 레벨/스코어보드를 어떻게 함께 유지할지 결정해야 합니다. 이 답이 없으면 M1 캐릭터 생성·저장·HUD 완료 기준을 세울 수 없습니다. M0 종료 체크리스트에 Q1~Q4의 선택과 기존 플레이어 데이터 이행/초기화 원칙을 넣어 주세요.
- RUC 잔액은 RucCore 서비스에 있고 RPG 아이템/우편/거래는 RucRpg H2에 있습니다. 두 저장소를 한 원자 트랜잭션으로 묶지 않으면 결제 직후 서버 종료 때 화폐만 빠지거나 아이템만 지급되는 상태가 가능합니다. `atomic()`을 그대로 옮겼다고 볼 수 없으므로, RucCore가 제공할 예약/차감·환불 API와 멱등 거래 ID 또는 단일 경제 저장소를 먼저 정하고 실패 주입 테스트를 완료 기준에 추가해야 합니다.
- PDC UUID는 복사 방지 표식일 뿐 유일성 보장은 아닙니다. 크리에이티브·상자/셜커·사망 드롭·플레이어 데이터 복구·플러그인 복제 경로에서 같은 UUID가 둘 생길 수 있습니다. 로그인/이동/거래/저장 때 권위 있는 소유권 원장으로 중복을 탐지하고 한 개만 유효하게 만드는 정책을 정해야 경제 기능보다 앞서 안전성을 입증할 수 있습니다.
- “바닐라 방어력 0, HP는 RPG가 관리”에는 플레이어·몹의 낙하/불/질식/폭발/투사체 등 환경 피해를 어떤 RPG 피해 경로로 보내는지 빠져 있습니다. 모든 `EntityDamageEvent` 원인을 명시적으로 분류하고, 바닐라 음식·재생·죽음·부활과 RPG HP/스태미나가 중복 적용되지 않는 테스트가 필요합니다.

### 5. 콘텐츠/월드 범위와 완료 기준

- 큰 범위를 10단계로 나눈 것은 좋지만, 단계 완료에 “같은 RPG”를 판정할 데이터 일치율·저장 이행·동시접속·재접속·장애 복구 기준이 없습니다. 특히 159스킬은 기능 이름 나열만으로는 판정 형태·대상 선택·시전 취소·쿨다운/자원 소모·상태효과·로그아웃 중 지속 효과가 누락됐는지 알기 어렵습니다. 웹 공식 golden 외에 스킬별 동작 명세/수용 테스트 목록을 만들고 단계별 통과 기준으로 연결해 주세요.
- 국가전 월드 백업·새 RPG 월드 변환은 되돌리기 어려운 운영 변경입니다. 현재 월드를 복사한 시험 서버에서 블록/좌표/포털/NPC/리젠/충돌을 확인하고 백업 복구까지 연습한 다음에만 운영 경로를 바꾸도록 배포 체크리스트에 명시하는 편이 안전합니다.

## Codex 작업 1 완료

- 만든 파일: `RUC_RPG/scripts/export-mc.ts`; 데이터 `minecraft/plugins/RucRpg/src/main/resources/data/{items,skills,jobs,mobs,effects,elements,stats,economy,quests,dungeons,party,pets,realm,progress}.json`; golden `minecraft/plugins/RucRpg/src/test/resources/golden.json`.
- 확인 방법: 저장소 루트에서 `node RUC_RPG/scripts/export-mc.ts` 실행. Node v24.14.0에서 실행했고, 스크립트 안의 JSON 안전성 assert가 NaN/Infinity 및 비JSON 값을 검사합니다. 생성 로그는 데이터 14개와 golden 1개(스킬 수치 120건, 피해 20건, 몹 35건)입니다.
- 남은 문제: `TIERS`는 원본 `items.ts`에서 비공개이므로 생성된 단계 장비 템플릿에서 동일 값들을 재구성했습니다. golden은 Java 이식 기준 표본이며, Java 쪽에서 이 필드 구조를 소비하는 방식은 후속 구현/리뷰에서 확인해야 합니다.

## Claude 답변 1 (2026-11-15) — 받아들임 / 반박

**사용자 결정이 나왔습니다(계획서 12장 · R4~R7)**: Q1 조작 = 추천안 그대로, Q2 미니맵 = **코어 셰이더로 오른쪽 위**(사용자가 위험을 듣고 고름), Q3 몹 · NPC = **RPG 디자인을 살린 개성 있는 3D 모델**(자체 모델 엔진, 계획서 5-2), Q4 = RPG 레벨 따로. → 리뷰 4번 첫 항목은 해결.

1. 글꼴 HUD
   - **받아들임**: 액션바는 공유 통로. RucCore 가 이 서버에서 쓰는 액션바는 메뉴 클릭 안내 · `xp.gained` · /home 카운트다운 정도라 드묾 → HUD 는 내용이 바뀔 때만(최대 4Hz) + 1초마다 다시 보냄. 덮인 RucCore 문구는 잃어도 되는 것뿐. RPG 쪽 알림은 HUD 안의 토스트 칸으로. 한계로 기록.
   - **반박(방법 보완)**: ascent ≤ height 제약은 **글리프 그림 위아래를 투명으로 채워 height 를 키우는** 흔한 방법으로 넘김(예: 16px 아이콘을 핫바 60px 위에 두려면 높이 80 · ascent 76 인 글리프). 음수 ascent 로 아래(구슬 = 핫바 옆)도 됨. 가로는 화면 가운데 기준이라 핫바와 함께 움직이므로 화면 폭을 몰라도 겹치지 않음 — 화면 오른쪽 위 같은 "가장자리 기준"만 안 되고, 그건 셰이더로(Q2).
   - 256×256 글리프 한도: 스탯 표 배경 · 지도 조각을 그 안으로 쪼갬.
2. 미니맵 셰이더: 사용자 결정이라 진행. **위험은 받아들여 기록** — 1.21.11 기준으로 만들고, 셰이더가 안 먹는 클라이언트에선 표식 색 글리프를 **투명**으로(안 보일 뿐 깨지지 않게). 좌표 · 머리 공급 = 서버가 보스바 글자로 보냄(지도 조각 글리프 + 소수 오프셋을 색 채널에 인코딩), 머리 = 1.21.9+ `object` 텍스트 컴포넌트(player head). 셰이더 형식 조사는 Codex 몫(아래).
3. 키
   - Q · 웅크리고 Q = `PlayerDropItemEvent`(무기를 든 경우만 취소 → 무기 외 아이템은 그대로 버려짐), F = `PlayerSwapHandItemsEvent`(웅크리지 않은 경우, 웅크린 F 는 RucCore 메뉴), 웅크리고 우클릭 = `PlayerInteractEvent`(**무기를 들고 있을 때만** — 음식 · 포션 · 블록 상호작용은 무기가 아니라 겹치지 않음).
   - 구르기 = 표준 "더블 점프" 기법: 땅에 있을 때 `setAllowFlight(true)` → 공중에서 Space = `PlayerToggleFlightEvent`(서버 이벤트, 추정 아님) → 취소하고 구르기. 크리에이티브/관전은 제외. 쿨은 서버가.
4. 경제 · 복사 · 환경 피해
   - 저장소 정정: RucRpg 도 **RucCore 공용 DB(rpg_ 테이블)** 를 씀(RucWar 와 같은 방식). Gold 는 RucCore `EconomyService`(자기 캐시가 있어 같은 SQL 트랜잭션에 못 넣음) → **원장 + 예약 방식**: `rpg_ledger(op_id UNIQUE, state pending/done/refunded)` 를 먼저 쓰고 → Gold 차감 → 아이템 지급 → done. 서버가 중간에 죽으면 켤 때 pending 을 보고 환불. 실패 주입 테스트를 M5 완료 기준에 넣음. **받아들임.**
   - UUID 원장: `rpg_item_uid(uid PK, holder, where, seen_at)`. 같은 uid 가 두 곳에서 보이면 원장과 다른 쪽을 지우고 로그. 크리에이티브 복사 = GM 만. M4 완료 기준. **받아들임.**
   - 환경 피해: `EntityDamageEvent` 원인 표를 만들어 전부 RPG HP 로(낙하 · 불 · 질식 · 폭발 · 익사 = 바닐라 피해 × 최대HP/20, 공허 = 즉사). 바닐라 재생 · 배고픔 자연 감소 끔. M2 완료 기준. **받아들임.**
5. 완료 기준: 스킬 164개 각각 "시전 → 판정 모양 · 대상 · 자원 · 쿨 · 효과" 수용 테스트를 데이터에서 자동 생성(웹 RPG 의 "모든 스킬 시전" 테스트와 같은 방식). 월드 교체는 시험 서버(`servers/rpg-test`, 이미 만듦)에서 먼저, 운영 국가전 월드는 이름만 바꿔 보관(`world-old-war-20261115`) — 되돌리기 = 이름 되돌리기. **받아들임.**

### export 리뷰 (Claude)
- 14파일 + golden 확인. 구조 좋음. `TIERS` 재구성은 원본과 같은 값인지 golden 에 `tierGear` 결과 목록을 추가해 주면 Java 쪽이 의존하지 않고 검증 가능.

## Codex 작업 2 — M1 HUD 그림 · 글꼴 생성기 (배정)

파일: `RUC_RPG/scripts/mc-art.ts` (당신 것), 출력 = `minecraft/resourcepack/assets/ruc/**` + `minecraft/plugins/RucRpg/src/main/resources/hud-glyphs.json`.

1. **바닐라 HUD 숨기기**: 하트 · 배고픔 · 방어 · 산소 · 탈것 체력 스프라이트를 투명 PNG 로(`assets/minecraft/textures/gui/sprites/hud/**`, 1.21.11 이름 확인). 경험치 바는 그대로(RPG 경험치를 보여 줄 것). 경험치 레벨 숫자도 그대로.
2. **HUD 글꼴 `ruc:hud`** (bitmap 글리프, 위 1번 답변의 투명 패딩 방식):
   - 체력 바(초록 `#4CC764`) · 스태미나 바(`#C9A27A`) — 웹 `CombatHud` `Bar` 모양(테두리 · 눈금 100/1000 · 보호막 흰 덧칠). 채움 단계 글리프 방식이든 1px 조각 이어 붙이기든 당신이 정하되 **한 바 = 최대 40글자 이하**.
   - 마나 구슬(파랑) · 기력 구슬(주황) — 웹 `rpg-orb2`(유리 구 · 출렁이는 액체 · 반사광 · 금속 테두리)를 도트로. 채움 0~32 단계 + "안 쓰는 자원" 회색판.
   - 스킬 칸 틀 + **스킬 아이콘 164개**(웹 `art/icons.ts` 의 그림 그대로) + 쿨타임 덮개 8단계 + 자원 부족 붉은 덮개 + 키 글자(Q · ⇧Q · F · ⇧우클).
   - 효과 아이콘(웹 효과 아이콘) + 남은 초 숫자용 작은 도트 숫자.
   - 스탯 표 배경(양피지 금테, 256 이하 조각).
   - 각 줄(바 · 스킬 · 효과 · 구슬 · 스탯 표 행 1~8)의 세로 위치는 **글리프 ascent 로 고정** — 줄 이름별 글꼴을 나눠도 됨(`ruc:hud_row0` …).
   - 간격 글꼴 `ruc:space`: −1 ~ −1024, +1 ~ +1024 (2의 거듭제곱 조합).
   - 텍스트(숫자 · 한글): Galmuri(OFL) 를 `ttf` 로, 줄마다 `shift` 다른 글꼴. 라이선스 파일 같이 넣기. 글꼴 파일을 받아야 하면 받는 곳 · 크기를 먼저 저에게 알려 주세요(다운로드는 제가 확인 후).
3. **`hud-glyphs.json`** (Java 가 읽는 계약): `{ "<이름>": { "font": "ruc:hud_row2", "char": "", "width": 18 } … }` + 간격 글꼴 표 + 각 줄 기준 높이. Java HUD 조립기는 이 파일만 보고 글자를 이어 붙입니다.
4. **미니맵 셰이더 조사**(코드 말고 문서 먼저): 1.21.11 `rendertype_text` 코어 셰이더 파일 이름 · uniform · 입력 형식, 표식 색으로 글리프를 화면 오른쪽 위로 옮기고 사각형 밖을 자르는 방법, 1.21.9+ `object`(player head) 텍스트 컴포넌트가 같은 셰이더를 지나는지. 결과를 이 문서 "Codex 조사 1" 로.

검증: `node RUC_RPG/scripts/mc-art.ts` 후 `python minecraft/scripts/pack.py` 가 통과하고, 생성 PNG 몇 장을 이 문서에 경로로 적어 주세요(Claude 가 열어 봄). Java(`RucRpg/src/main/java`)는 Claude 가 동시에 HUD 조립기 · 스탯 엔진을 씁니다 — 건드리지 마세요.

### export 추가 요청 (Claude, Codex 작업 2 다음에)
- `effects.json` 에 `mods` 가 빠짐(TS 에서 함수라 JSON 이 못 담음) — 스탯 버프/디버프 23개가 Java 에서 효과 없음. 모든 `mods` 가 `계수 × v^(0|1) × stacks^(0|1)` 꼴이니 `(v,s) = (1,1) · (2,1) · (1,2)` 로 불러 `{ k, op: "add"|"mul", c, v: bool, s: bool, el? }` 로 뽑고, 선형이 아니면 assert 로 실패시켜 주세요.
- 같은 이유로 **함수라서 조용히 빠진 필드**가 다른 파일에도 있는지 전수 점검(JSON.stringify 가 함수를 버림) — 목록을 이 문서에.

## Codex 조사 1 — 1.21.11 텍스트 셰이더와 미니맵 표식

로컬 설치본 `1.21.11.jar`에서 확인했습니다.

- 셰이더는 `assets/minecraft/shaders/core/rendertype_text.vsh` 및 `.fsh`입니다. `rendertype_text.json`은 없습니다. 텍스트 VSH 입력은 `Position: vec3`, `Color: vec4`, `UV0: vec2`, `UV2: ivec2`이고 라이트맵 샘플러는 `Sampler2`입니다. FSH는 폰트 아틀라스 `Sampler0`를 읽고 alpha `< 0.1` 픽셀을 버립니다.
- VSH는 `gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0)`로 정점 위치를 만듭니다. 기본 uniform block(`dynamictransforms.glsl`)의 행렬·색·안개 uniform은 `ModelViewMat`, `ProjMat`, `ColorModulator`, `FogEnvironmentalStart`, `FogEnvironmentalEnd`, `FogRenderDistanceStart`, `FogRenderDistanceEnd`, `FogColor`입니다. 입력 정점 색은 `Color * texelFetch(Sampler2, UV2 / 16, 0)`로 조명과 합쳐집니다.
- 별도의 `ScreenSize` uniform이나 미니맵 사각형 uniform은 이 셰이더 입력에 없습니다. 표식 전용 색을 정점 `Color`에서 가려내고 GUI 직교 투영의 `ProjMat`을 이용해 clip 좌표를 평면 이동시키는 설계는 가능성이 있지만, 이 셰이더가 월드 표지판·채팅·일반 HUD 텍스트에도 쓰이므로 표식 색 외 모든 글자는 원래 위치를 보존해야 합니다. 클리핑은 fragment의 `gl_FragCoord`와 화면 크기를 같은 GUI 좌표계로 계산해야 합니다. 실제 1.21.11 클라이언트와 GUI 배율별 검증 전에는 고정 우상단 배치가 확인됐다고 볼 수 없습니다.
- `object` 텍스트는 문자 글리프가 아니라 스프라이트 객체입니다. Mojang 1.21.9 릴리스 노트는 atlas 객체를 8×8 스프라이트로, `player` 객체를 플레이어 머리로 설명합니다. 따라서 `rendertype_text`의 `Sampler0` 글리프 색 표식으로 플레이어 머리 객체를 판별·이동시키는 설계는 성립하지 않습니다(객체 렌더 경로에 대한 판단은 이 형식 설명으로부터의 추론). 머리 마커를 유지한다면 별도 배치 경로가 필요하고, 이 셰이더만 쓰려면 머리 대신 색으로 식별되는 폰트 글리프를 써야 합니다. [Mojang 1.21.9 릴리스 노트](https://feedback.minecraft.net/hc/en-us/articles/39966147272589-Minecraft-Java-Edition-1-21-9-The-Copper-Age)는 내부 코어 셰이더가 바뀔 수 있다고도 경고합니다.

## Codex 리뷰 2

1. `docs/12-MC-RPG-REVIEW.md`의 `Claude 답변 1` 미니맵 안에서, `player` 객체 텍스트 컴포넌트를 텍스트 셰이더 표식 색 방식으로 움직이는 구상에는 동의하지 않습니다. 1.21.9 `object`는 폰트 아틀라스 문자가 아닌 8×8 스프라이트/플레이어 머리 객체라 `rendertype_text`의 글리프 색 판별 대상이 아닙니다. 미니맵 머리 표식은 별도 GUI/렌더 경로로 배치하거나, 텍스트 셰이더 적용 범위 안에서는 색 표식 글리프로 바꿔야 합니다. 1.21.11 실제 클라이언트에서 GUI 배율·채팅·표지판 회귀도 시험해야 합니다.

## Codex 작업 2 완료 보고

- 생성기: `RUC_RPG/scripts/mc-art.ts`. 웹의 `skillIcon`·`effectIcon`·`statIcon`을 호출해 164 스킬(플레이어 속성 색 변형 포함), 효과 61종, 스탯 아이콘을 만들고 256px 이하 시트로 패킹합니다. 222px 바는 폭 6px 조각 37개(한 줄 37글자), 조각별 1px 채움 단계와 보호막 오버레이를 생성합니다. 마나/기력 구슬은 0~32, 쿨타임 덮개는 8단계입니다. 양피지 9분할, 키캡, 소형 숫자, `space` -1024…-1 및 +1…+1024 글리프도 포함했습니다.
- vanilla HUD 투명 PNG 59개를 1.21.11 jar에서 확인한 하트(차량·상태 변형 포함)·음식·방어구·공기 스프라이트 경로에 생성했습니다. XP 바/숫자와 점프 바는 덮지 않았습니다.
- 출력 예시(Claude 시각 검토용): `minecraft/resourcepack/assets/ruc/textures/font/hud/glyphs/skill_magic_arrow.png`, `effect_haste.png`, `orb_mana_16.png`, `bar_hp_0_6.png`, `cooldown_7.png`, `stats_panel_tl.png`. atlas는 같은 폴더의 `atlas_*.png`; 글꼴은 `minecraft/resourcepack/assets/ruc/font/hud.json` 및 `hud_row0`…`hud_row8.json`; Java 계약은 `minecraft/plugins/RucRpg/src/main/resources/hud-glyphs.json`입니다.
- Galmuri 파일은 외부에서 받지 않았습니다. 로컬 `web/node_modules/galmuri` 2.40.3의 `dist/Galmuri11.ttf`(5,376,428 bytes)를 복사했고 `ofl.md`를 `assets/ruc/font/OFL.txt`로 포함했습니다. 기존 저장소 의존성에서 가져왔으므로 사용자 다운로드 확인은 필요하지 않았습니다.
- 검증: `node RUC_RPG/scripts/mc-art.ts` 통과(164 스킬·61 효과·2,007 bitmap 글리프 출력). 기본 `python` 별칭은 실행 불가였지만 로컬 Python 3.14로 `minecraft/scripts/pack.py`를 실행해 `web/public/pack/ruc-war.zip` 생성과 SHA-1 `6ea586d3d030b49d6741bf0a1f9500bfe667b307`를 확인했습니다. 팩 스크립트의 부수 쓰기가 `minecraft/servers/war/server.properties`에 닿지 않도록 그 경로만 차단했습니다. 그러므로 ZIP의 해시는 생성됐지만 서버 설정의 SHA-1은 갱신하지 않았습니다.
- 제한: 현재 오브·패널은 웹 HUD 색과 형태를 픽셀로 옮긴 정적 자산이며, 웹 `rpg-orb2`의 CSS 액체 애니메이션은 재현하지 않습니다. 셰이더도 조사만 했고 리소스팩에 넣지 않았습니다. Java 조립기에서 overlay 글리프는 같은 위치에 음수 `ruc:space`로 되돌아간 뒤 이어 붙이는 방식으로 겹쳐 그려야 합니다. 실제 게임 화면 검토는 아직 없습니다.

## Claude 답변 2 (2026-11-15) — HUD 그림 검토 · 미니맵 머리 반박 수용 + 대안

**그림 검토**(`skill_magic_arrow` · `skill_meteor` · `effect_haste/stun` · `orb_*` · `bar_hp` · `cooldown` · `stats_panel` 확대해 봄): 웹과 같은 디자인으로 잘 나옴. 구슬 반사광 · 테두리 좋음. 받아들임.

**문제 1 — 세로 배치가 모자람.** 지금 행은 baseline 44~76(4px 간격 9단)이라 32px 아이콘을 쌓으면 효과 줄 · 스킬 줄 · 바 · 구슬(핫바 옆 바닥) · 스탯 표(8줄)를 다 못 놓음. 또 32px 아이콘은 핫바 칸(20px)보다 커서 화면을 많이 가림. → 아래 **화면 좌표 배치표**대로 다시 뽑아 주세요. 좌표 = GUI px, 원점 = 화면 아래 가운데, y 는 위로 +.

| 요소 | x 범위 | y 범위 | 크기 · 비고 |
|---|---|---|---|
| (바닐라) 핫바 | −91 … 91 | 0 … 22 | 그대로 |
| (바닐라) 경험치 바 | −91 … 91 | 24 … 29 | 그대로 = RPG 레벨 |
| 체력 바 | −91 … −2 | 31 … 40 | 하트 자리. 9px 높이, 눈금 100 · 1000, 보호막 흰 덧칠, 칸 조각 방식 그대로(조각 수 ≤ 30) |
| 스태미나 바 | 2 … 91 | 31 … 40 | 배고픔 자리. 탈진이면 붉은 판 |
| 스킬 줄 | −56 … 56 | 43 … 63 | 패시브 · Q · ⇧Q · F · ⇧우클 5칸, 칸 20×20(핫바 칸과 같은 크기 · 같은 틀 느낌), 간격 2px. 아이콘은 16px 로 축소해 칸 안에. 쿨 덮개 8단계 · 자원 부족 붉은 덮개 · 칸 아래 작은 키 글자 |
| 효과 줄 | 가운데 정렬, 최대 10개 | 66 … 78 | 아이콘 10×10 + 오른쪽 아래 남은 초(작은 숫자 3×5) |
| 마나 구슬 | −131 … −95 | 0 … 36 | 36px 구슬, 0~32 단계, 가운데 숫자(작은 숫자) |
| 기력 구슬 | 95 … 131 | 0 … 36 | 같음. 안 쓰는 자원 = 회색판 |
| 스탯 표 | −233 … −135 | 0 … 84 | 양피지 금테 배경 + 8줄(줄 높이 10): 아이콘 8×8 + 이름 + 값(Galmuri). 줄 = 공격력 · 주문력 · 물방 · 마방 · 공속 · 이속 · 치명 · 운 |

- 액션바는 가로 가운데 정렬이라 Java 는 **전체 advance 합이 0** 이 되게 끝에 간격을 붙여 x 를 맞춥니다 → `hud-glyphs.json` 의 각 글리프에 **실제 advance**(bitmap = 그림 폭 + 1, 공급자 규칙대로)를 적어 주세요.
- 세로: 1.21.11 jar 에서 액션바 글자 위치(화면 아래에서 몇 px)와 bitmap `ascent` → 화면 y 공식을 확인해 각 요소 글꼴의 ascent 를 계산하고, 공식 · 기준값을 `notes` 에 적어 주세요. 위 표의 y 범위에 픽셀 단위로 맞으면 됨.
- `hud-glyphs.json` v2 에 **`layout`** 을 넣어 주세요: 요소별 `{ x, y, w, h, font }` (위 표 그대로) — Java 는 이름 규칙 + layout 만 봄. 이름 규칙: `bar.hp.<칸>.<채움>` · `bar.stamina…` · `bar.shield…` · `bar.exhaust…`, `skill.slot` · `skill.<id>` · `skill.cd.<0-7>` · `skill.nores` · `key.<Q|SQ|F|SR|P>`, `effect.<id>` · `num.small.<0-9>`, `orb.<mana|energy>.<0-32>` · `orb.<mana|energy>.unused` · `num.orb.<0-9>`, `stats.bg.<조각>` · `stats.icon.<줄>.<아이콘>`, 스탯 표 글자 = 줄마다 ttf 글꼴 `stats.font.<줄>`.

**문제 2 — 미니맵 머리**: 반박 받아들임(`object` 머리는 글리프가 아니라 표식 색으로 못 옮김). 대안:
- **표식은 색이 아니라 글리프 그림(텍스처)으로**: 미니맵 전용 글꼴의 글리프 텍셀 알파를 특수값(예: 254)으로 두고, VSH 가 `texture(Sampler0, UV0)` 로 그 알파를 보고 판별 → 이동 · 자르기. 그러면 **정점 색이 자유로워짐**.
- **머리 = 서버가 그린 8×8 픽셀**: 서버가 접속자 스킨(프로필 textures URL)에서 얼굴 8×8 을 잘라 캐시, 미니맵에 "1px 정사각 표식 글리프" 64개를 각 픽셀 색으로 찍음. 리소스팩에 스킨을 넣을 필요 없음 · 다른 플레이어도 그 사람 머리.
- **지도 조각 스크롤**: 지도 조각 글리프도 표식 글꼴, 정점 색 비트에 미세 오프셋을 넣어 셰이더가 밀고 사각형 밖 discard.
- 전송 = 보스바 제목(오른쪽 위로 옮겨지므로 보스바 자리에는 안 보이게: 표식 글리프 외 글자 없음).

## Codex 작업 3 (배정)
1. 위 배치표로 HUD 글리프 다시 생성 + `hud-glyphs.json` v2(advance · layout · 이름 규칙). 끝나면 Java 조립기(`hud/GlyphHud.java`, Claude)가 바로 붙음.
2. effects.json `mods` export(위 "export 추가 요청") + 함수라 빠진 필드 전수 점검.
3. 미니맵 셰이더 **시제품**(`assets/minecraft/shaders/core/rendertype_text.vsh/.fsh`): 위 대안 설계. 표식이 없는 글자는 바닐라와 완전히 같게. 시험용 글리프(빨간 8×8, 파란 사각형)와 "보스바 제목에 이렇게 넣으면 오른쪽 위 (−4, 4) 에 64×64 로 보인다" 는 사용 예시를 이 문서에. 실제 화면 확인은 사용자에게 요청할 것이라 **실패해도 바닐라 화면이 깨지지 않는 것**이 가장 중요.

## Codex 작업 4 (작업 3 다음, 배정)
창(팝업) 시스템용 **아이템 모델**과 **창 배경**:
1. 아이템 모델(1.21.4+ `assets/ruc/items/<경로>.json` + `models/item/<경로>.json`, 평면 `item/generated`):
   - `ruc:skill/<스킬id>` 164개(기본색) · `ruc:effect/<효과id>` 61 · `ruc:stat/<아이콘>` · `ruc:element/<속성id>` 12(웹 속성 문양) · `ruc:line/<계열id>` 6 · `ruc:job/<직업id>` 30(계열 아이콘 + 직업 색)
   - UI: `ruc:ui/button_wood`(갈색 나무 입체 버튼 — 사용자 지정, 바꾸지 말 것) · `ruc:ui/button_green`(선택) · `ruc:ui/tab` · `ruc:ui/tab_on` · `ruc:ui/close` · `ruc:ui/arrow_left/right` · `ruc:ui/blank`(투명 — 빈 칸 채움) · `ruc:ui/lock`
   - 결과 목록 `minecraft/plugins/RucRpg/src/main/resources/pack-models.json` (`["skill/magic_arrow", …]`) — Java 는 여기 있는 모델만 `item_model` 로 지정(없는 모델 = 보라 검정 방지).
2. 창 배경: 상자 GUI 제목에 넣는 글꼴 글리프(웹 고급 UI = 금테 양피지 + 금박 제목 명판). 크기별 `gui.bg.27` · `gui.bg.54` · 제목 명판, 상자 칸 격자에 맞춘 칸 테두리. `hud-glyphs.json` 에 `gui` 묶음으로(advance · 바닐라 제목 위치 기준 오프셋).

## Codex 작업 5 (작업 3 · 4 다음) — export 빠진 표 + 아이템 아이콘
1. `items.json` 에 추가: `EQUIP_SLOTS` · `EQUIP_NAME` · `LOCS` · `STORAGE` · `STACK` · `POTION_CD_MS` · `SPECIAL_TIER` · `BOX_POOL` · `BOOK_IDS` · `GATHER`(있으면). `SPECIALS[*].mods` · `ENCHANTS[*].mods` 는 함수 → effects 와 같은 선형 스펙 `{k, op, c, v, el?}` 로(인자 (v, el) — el 은 속성 방어 부가석). `stackable` 규칙(함수)도 표로(`STACKABLE_KINDS` 등).
2. 아이템 아이콘 모델: 웹 `itemIcon(tpl, rarity)` 그대로 64×64 →
   - 장비(검 · 도끼 · 투구 · 흉갑 · 바지 · 신발 제외 — 사용자 결정 "기존 방어구만 사용" 이라 바닐라 모양): `ruc:item/<icon>_<rarity>` (단검 · 지팡이 · 활 · 완드 · 장갑 · 망토 · 반지 · 목걸이 · 귀걸이 …)
   - 장비 아닌 것: `ruc:item/<tpl>` (포션 · 음식 · 재료 · 스킬북 · 소모품). **부가석(ench_*)은 만들지 말 것** — 바닐라 마법부여 책 모양(사용자 지정).
   - `pack-models.json` 에 함께.

## Codex 리뷰 3

- 좌표표에서 스킬 칸 아래와 바 위의 빈 구간은 y=40…43, 높이 3px뿐입니다. 키 라벨은 겹치지 않도록 3px 마이크로 글자로 만들었지만, GUI 배율 1에서 읽기 어려울 수 있습니다. 기준 좌표를 우선 지켰습니다. 게임 화면에서 판독성이 부족하면 키 표기의 위치/높이와 바 또는 스킬 줄 좌표 중 하나를 조정해야 합니다.
- 셰이더가 옮기는 것은 alpha/RGB sentinel 글리프뿐입니다. `object` 플레이어 머리와 실제 프로필 스킨 수집은 이 시제품에 포함되지 않습니다. 요청한 시험은 일반 폰트 텍스트에 영향을 주지 않도록 별도 texture sentinel 색도 함께 확인합니다.

## Codex 작업 3 완료 보고

### HUD 글리프 v2

- `RUC_RPG/scripts/mc-art.ts`가 `hud-glyphs.json` v2와 가족별 bitmap font/atlas를 생성합니다. PNG atlas는 각 변 256px 이하이며, 현재 1,428개의 PUA 글리프(스킬 164개 및 속성 변형 포함, 효과 61개, 30칸 바 조각, 구슬·스킬 칸·숫자·8줄 스탯 아이콘·미니맵 시험 표식)를 만듭니다. bitmap 계약은 실제 불투명 픽셀 폭 + 1의 `advance`, 이미지 `width/height`, 글리프별 font를 기록합니다.
- `layout`에는 표의 GUI 좌표를 바·스킬 칸/아이콘/쿨/자원 부족 덮개/키·효과 줄·구슬·스탯 표와 8개 스탯 행으로 나눠 넣었습니다. 바는 각 30개 조각, pitch 3px, 표시 폭 89px입니다. 칸을 이어 붙일 때마다 advance 1px를 줄이는 간격 글리프를 끼웁니다. 구슬 숫자는 중앙 기준점도 제공합니다. 이름은 `bar.hp.<칸>.<채움>`, `skill.cd.<0-7>`, `orb.<mana|energy>.<0-32>` 등 요청한 규칙을 따릅니다.
- 세로 기준은 기본 액션바 글자 상단이 화면 아래에서 65px인 경우로 기록했습니다. bitmap 글리프 상단은 `65 + ascent`; 목표 상단이 Y면 `ascent = Y - 65`입니다. 예: HP 바 top=40 → ascent −25, 효과 아이콘 top=78 → 13, 스탯 배경 top=84 → 19. 바닐라 컨텍스트 오버레이가 액션바 높이를 바꾸면 y가 이동하므로 기본 HUD 상태의 좌표이며, 실제 게임 확인은 필요합니다.
- 비교 가능한 생성 이미지: `minecraft/resourcepack/assets/ruc/textures/font/hud/glyphs/bar_hp_0_3.png`, `skill_magic_arrow.png`, `effect_haste.png`, `orb_mana_16.png`, `stats_bg_panel.png`, `minimap_red.png`, `minimap_blue.png`. 3px 키 라벨은 좁은 틈에 맞춘 선택이며 실제 가독성은 확인되지 않았습니다.

### 효과 수식 export 및 함수 필드 감사

- `effects.json`의 모든 `mods` 함수를 `{ k, op, c, v, s, el? }` 배열로 바꿨습니다. `(v,stacks)=(1,1),(2,1),(1,2),(0,1),(1,0),(2,2)` 결과를 비교해 `c × v^(0|1) × stacks^(0|1)` 형태가 아닌 경우 생성 단계가 실패합니다.
- 모든 내보내기 테이블을 재귀 감사했습니다. 효과 수식은 명시적으로 변환되어 보존됩니다. JSON 직렬화라면 빠질 나머지 함수 필드 20개는 `items.json`: `SPECIALS.{sturdy,swift,vamp,fortune}.mods`, `ENCHANTS.{atk,ap,def,hp,speed,crit,eldef,vamp}.mods`; `economy.json`: 같은 `ENCHANTS` 8개입니다. 이번 배정 범위에서는 해당 아이템/강화 함수 표현을 변환하지 않았습니다.

### 미니맵 셰이더 시제품

- `minecraft/resourcepack/assets/minecraft/shaders/core/rendertype_text.vsh/.fsh`에서 텍스처 sentinel을 확인해 표식만 이동시키고, 상단 우측 GUI 사각형 밖의 픽셀을 버립니다. sentinel은 alpha=254와 전용 RGB `(17,253,239)`를 함께 검사하므로 일반 흰색 글리프는 대상이 되지 않습니다. 일반 글자는 기본 정점 위치·색·텍스처·안개 계산을 유지합니다. 글리프 색은 컴포넌트 색으로 바꿀 수 있습니다.
- 시험 폰트는 `ruc:hud_minimap`; 빨강 글리프 `\uE5FD`, 파랑 글리프 `\uE5FE`입니다. 시험 bossbar를 만든 뒤 제목을 다음 텍스트 컴포넌트로 바꾸고 자기 자신에게 표시하면 됩니다(서버 콘솔에서는 `@s` 대신 테스트 플레이어 UUID/선택자 사용):

  ```mcfunction
  /bossbar add ruc:minimap_test {"text":"\uE5FD","font":"ruc:hud_minimap","color":"#ef3030","extra":[{"text":"\uE5FE","font":"ruc:hud_minimap","color":"#3060ff"}]}
  /bossbar set ruc:minimap_test players @s
  ```

- 목표 clip 창은 GUI 기준 `x=[화면너비−68, 화면너비−4]`, `y=[4,68]`로 64×64이며 우·상단에서 각각 4px 안쪽입니다. 현재 VSH는 원래 제목 중심을 `(W/2,12)`로 가정해 `(W−36,36)`으로 옮깁니다. bossbar 제목의 실제 원점/GUI 배율 및 셰이더 컴파일은 실행 클라이언트에서 아직 확인하지 않았으므로, 위 시제품은 vanilla 1.21.11 클라이언트 화면으로 확인해 주세요. 미니맵이 깨지거나 일반 글자에 영향이 보이면 이 두 shader 파일을 제거/비활성화하면 vanilla 경로로 돌아갑니다.

### 생성 및 패키징 확인

- `node RUC_RPG/scripts/mc-art.ts` 통과: 스킬 164개, 효과 61개, bitmap 1,428개, 투명 vanilla HUD 스프라이트 59개.
- `node RUC_RPG/scripts/export-mc.ts` 통과: 데이터 JSON 14개와 `golden.json`; 공식 exporter JSON assert 통과. 함수 감사 결과는 위 목록과 같습니다.
- 리소스팩 패키징은 `python3.14 minecraft/scripts/pack.py`로 수행합니다. 이 스크립트가 `minecraft/servers/war/server.properties`도 갱신하므로, 이번 확인에서는 해당 파일로 향하는 쓰기만 막고 ZIP 생성 경로는 그대로 실행했습니다. 게임 클라이언트 shader compile/실화면 검증은 미실행입니다.

## Claude 답변 3 (2026-11-15)
- 작업 3 받음. 3px 키 글자는 실제 화면에서 보고 판단(사용자 확인 요청 예정) — 안 읽히면 스킬 줄을 y 45~65 로 2px 올림.
- 효과 mods export 확인 — Java EffectDefs 가 `{k, op, c, v, s, el}` 그대로 읽음(CombatTest `statModsApplyWhenExported` 가 이제 실제로 돎).
- 그동안 Claude 쪽: M4 아이템(바닐라 모양 · 툴팁 · 장비창 · 드롭 · 상급 몹 보너스 방어구) · M6 월드(맵 5개 → 블록 · 몹 구역 · 포털 · NPC 마네킹) 완료 — **Codex 리뷰 4 로 비판적으로 봐 주세요**: `RucRpg/src/main/java/.../item/*`, `world/MapBuilder.java`, `world/RpgWorlds.java`, `mob/MobRuntime.java`(구역 소환 규칙). 특히 복사 · 경제 위험, 맵 빌더가 웹 맵과 다르게 보일 곳.
- 다음 배정: **작업 4(창 아이템 모델 · 창 배경) → 작업 5(빠진 표 · SPECIALS/ENCHANTS mods · 아이템 아이콘)** 순서로.

## Codex 리뷰 4

- `minecraft/plugins/RucRpg/src/main/java/kr/rucserver/rpg/item/ItemService.java:129-140,201-206` · 장비 UID는 새로 만들 때 UUID를 뽑아 PDC에 넣지만, 이 저장소에는 UID 등록부/고유성 검사가 없습니다. 복사된 ItemStack은 같은 강화·희귀도·UID를 가진 두 개의 정상 장비로 읽히며, 거래/강화 화면의 UID 재확인도 두 복제본을 구분하지 못합니다. M4가 받아들인 `rpg_item_uid(uid PK, holder, where, seen_at)`를 실제 권위 원장으로 만들고 인벤토리·장비·창고·드롭·우편 등 소유권 이동을 원자적으로 반영해야 합니다. 복사된 UID 탐지 시 중복 쪽을 격리하는 정책과 복제·로그아웃·재접속 검증이 필요합니다.
- `minecraft/plugins/RucRpg/src/main/java/kr/rucserver/rpg/item/EquipStore.java:58-71` · 장비 저장은 기존 행 삭제와 새 행 삽입이 별도 자동 커밋 문장입니다. 삽입 실패/프로세스 종료가 둘 사이에 끼면 DB 장비가 사라지고, 비동기 저장 요청이 역순 완료되면 오래된 슬롯 값이 새 값을 덮을 수 있습니다. 단일 DB 트랜잭션의 upsert/delete로 바꾸고, 호출 시점의 스택 스냅샷과 저장 순서(버전 또는 플레이어별 직렬 큐)를 보장하세요. 인벤토리↔장착 이동은 DB와 Bukkit 인벤토리에 걸친 별도 복구/원장 단계가 있어야 중간 크래시에서 복제·유실을 막습니다.
- `minecraft/plugins/RucRpg/src/main/java/kr/rucserver/rpg/item/ItemRuntime.java:148-158` · `use()`가 없는 재료/책 등 모든 RPG 비장비 우클릭을 취소한 뒤 “사용할 수 없는 아이템”을 띄웁니다. 이 아이템을 든 채 블록을 우클릭하는 상호작용도 막히므로, RPG 메뉴/상점 등 우클릭을 쓰는 블록과의 상호작용이 깨집니다. 템플릿에 실제 `use`가 있는 소모품만 취소하고, 나머지는 바닐라 이벤트를 통과시키는 조건을 먼저 두세요.
- `minecraft/plugins/RucRpg/src/main/java/kr/rucserver/rpg/world/MapBuilder.java:78-113`, `world/RpgMap.java:72-75` · 맵 파서는 `collision`, `decor_below`, `decor_above` 레이어를 보유하지만 빌더는 지면·물·높이·계단만 읽습니다. 웹에서 통행 불가로 지정한 타일이 뚫리거나, 충돌 없는 장식이 블록 충돌을 만들고 위·아래 장식물이 사라져 전투/시야/경로가 웹 맵과 달라집니다. 각 레이어의 렌더링과 충돌 의미를 분리해 변환하고, 타일별 웹 점유 맵 대 Minecraft 블록 충돌 비교를 맵 5종에서 자동 점검해야 합니다.
- `minecraft/plugins/RucRpg/src/main/java/kr/rucserver/rpg/world/MapBuilder.java:31-33,59-63,78-97` · 한 틱에 맵의 네 행을 통째로 처리합니다. 각 타일을 2×2 블록으로 확장하고 매 칸의 공기 제거·지층·언덕 옆면·장식까지 동기식 Bukkit 쓰기로 만들기 때문에 큰 맵/높은 언덕은 한 틱에 수만 번 블록을 만질 수 있어 청크 생성 때 서버 TPS가 튈 위험이 큽니다. 행 수가 아닌 블록 변경량/시간 예산으로 분할하고, 월드별 빌드 잠금·진행률·취소 및 재개를 두세요. 또한 지형 최고점은 `BASE_Y + L*LEVEL_H`인데 지우기는 `BASE_Y+12`까지만이라 L>6인 구역을 낮춰 재빌드하면 이전 언덕 윗부분이 남습니다(`:87-90`). 지울 높이를 맵 최대 높이와 기존 빌드 높이에서 계산해야 합니다.
- `minecraft/plugins/RucRpg/src/main/java/kr/rucserver/rpg/world/RpgWorlds.java:107-113`, `mob/MobRuntime.java:91-101,154-160` · 구역 중심은 맵 픽셀에서 전투 픽셀로 ×2 변환하지만 반경 `min(o.w,o.h)`에는 같은 배율이 적용되지 않습니다. 소환 반경이 의도한 타일 크기의 절반으로 줄고, 실제 샘플링 반경·몹 활성 반경이 모두 `MobUnit.Zone.r`에 의존합니다. 중심·반경을 같은 단위로 변환하고 폭/높이 중 짧은 변의 절반을 반경으로 정의하세요. 추가로 바닥 탐색은 구역 중심 `baseY`에서 위아래 8블록만 보는데, 지형 높이 레벨은 2블록 단위로 30블록까지 오를 수 있어 언덕 구역에서 유효 지점을 못 찾고 재시도만 할 수 있습니다. 후보 좌표의 실제 표면 높이를 맵 높이 데이터에서 구하거나 탐색 범위를 최고 레벨까지 확장하고, 계단/물/막힌 머리 공간 테스트도 포함해야 합니다.

## Codex 작업 4 완료 보고

- `RUC_RPG/scripts/mc-art.ts`가 27/54칸 상자 GUI용 `gui.bg.27`, `gui.bg.54`, 금테 제목판 `gui.title`을 추가 생성합니다. 배경 이미지는 176×166/176×222이고, 제목 기본 원점 (+8,+6)에서 왼쪽으로 8px 당겨 패널을 놓도록 `hud-glyphs.json.gui`에 font, advance(177), ascent(13), 슬롯 격자, 제목판 위치 및 글리프 뒤 커서를 되돌릴 간격 조합 계약을 기록했습니다. 아이템을 덮지 않게 안쪽을 투명하게 두고 낮은 알파의 양피지 톤과 가는 칸 선만 넣었습니다. 제목 글리프가 슬롯 위에 그려지는지 실제 컨테이너에서 확인은 필요합니다.
- 새 `RUC_RPG/scripts/mc-model-art.ts`는 요청한 164 스킬, 61 효과, 14 스탯, 12 속성, 6 계열, 30 직업 모델과 9 UI 모델을 만들며, 나무 버튼은 `rpg.css`의 갈색/테두리/입체 강조 색을 참조했습니다. 직업별 색 데이터가 원본 `JOBS`에 없어 계열 색을 쓰고, 기존 `kind`가 magic/hybrid인 직업만 구분 색을 사용합니다.
- 생성 위치는 `minecraft/resourcepack/assets/ruc/{items,models,item textures}`이며 Java가 읽을 `minecraft/plugins/RucRpg/src/main/resources/pack-models.json`에 생성 모델 548개를 기록했습니다. 1.21 item definition은 `items/<모델 id>.json`이 `models/item/<경로>.json`을 참조하도록 만들었습니다.

## Codex 작업 5 완료 보고

- `items.json`에 `EQUIP_SLOTS`, `EQUIP_NAME`, `LOCS`, `STORAGE`, `STACK`, `STACKABLE_KINDS`, `STACKING_RULES`, `POTION_CD_MS`, `SPECIAL_TIER`, `BOX_POOL`, `BOOK_IDS`, `GATHER`를 내보냈습니다. `STACKABLE_KINDS`와 `SPECIAL_TIER`를 원본 `items.ts`에서 export해 exporter와 웹 규칙이 따로 굳지 않게 했습니다.
- `SPECIALS[*].mods` 및 `ENCHANTS[*].mods`를 `{k, op, c, v, el?}`로 바꾸고 v=0,1,2,3의 출력 키·연산·계수가 선형인지 검사합니다. 속성 방어(`eldef`)는 샘플 속성 값을 고정해 내보내지 않고 Java가 인스턴스 속성을 전달하도록 `el`을 생략합니다. `item-models.json`은 아이콘 키에 여러 장비 템플릿이 모이는 경우 사용한 정규 템플릿을 기록합니다.
- `itemIcon(tpl, rarity)` 64×64 그림으로 비바닐라 장비 아이콘 9종×6 희귀도, 비장비 198종 모델을 만들었습니다. 검·도끼·기존 방어구 아이콘은 제외했고 `ench_*` 부가석 모델 8종도 요청대로 생성하지 않았습니다. 목록과 생성기를 함께 확인하기 위해 `pack-models.json`에는 전체 548개 모델이 고유하게 들어 있습니다.
- 생성 확인: `node RUC_RPG/scripts/export-mc.ts`가 JSON 14개와 golden을 생성하고 함수 누락 0개를 보고했습니다. `node RUC_RPG/scripts/mc-art.ts`는 HUD 글리프 1,431개와 GUI 글리프를 생성했고, `node RUC_RPG/scripts/mc-model-art.ts`는 모델 548개를 생성했습니다. Node의 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 web 패키지의 `type` 미지정 경고이며 생성은 성공했습니다. Minecraft 클라이언트의 실제 컨테이너/아이콘 렌더링은 이 작업에서 실행하지 않았습니다.

## Claude 답변 4 (2026-11-15)
- 작업 4 · 5 받음 — pack-models.json 548개면 Java `Gui.icon` · `ItemService.write` 가 그대로 씀. 창 배경 글리프는 Gui 제목 조립에 붙임(Claude).
- 리뷰 4 받아들임: (1) UID 원장 + 중복 격리 (2) EquipStore 트랜잭션 + 플레이어별 직렬 저장 (3) 우클릭은 쓸 수 있는 것만 취소 (4) collision · decor 레이어 반영 + 맵별 충돌 대조 (5) 맵 짓기 블록 예산 분할 · 지울 높이 계산 → Claude 가 지금 고침.
- 반박 1개: 몹 구역 반경 — 맵 px 의 `min(w,h)` 는 전투 px(×2)로 바꾼 뒤 반으로 나눈 `min(w,h)×2/2` 와 같아 이미 맞는 단위. 바닥 탐색 ±8 은 언덕 최대 2층 × 2블록 = 4 라 충분하지만 여유로 ±12 로 넓힘.
- M5 경제 · M6 퀘스트/튜토리얼 · M7 파티/던전/결투 완료 → **Codex 리뷰 5** 부탁: `econ/*` · `quest/QuestEngine.java` · `party/*` (Gold 차감/환불 순서, 창고 캐시, 퀘스트 보상 우편 멱등, 던전 인스턴스 재사용 · 관전 부활).

## Codex 작업 6 — 몹 · NPC · 소환수 3D 모델 (사용자 결정 Q3, 가장 큰 그림 작업)
사용자: "시간이 많이 소비되더라도 지금 rpg 게임에 디자인을 최대한 반영한 각각의 개성있는 3d모델 텍스쳐를 가진 몹과 npc". Claude 가 모델 엔진(Java: ItemDisplay 뼈 · 보간 애니메이션)을 만들고, Codex 가 **모델 내용**을 만듭니다.
1. `RUC_RPG/scripts/mc-models.ts`(새 파일): 몹 19(slime · rabbit · goblin · wolf · dusk_imp · stone_boar · frost_harpy · ember_golem · shade_knight · storm_drake · sprout_slime · shroom_shaman · moss_golem · shadow_vine · tree_knight · twin_witch · purify_orb · fern · eldra) + 소환수(pets.json PETS 8) + NPC 7(lumi · volt · mir · sera · owen · pip · dario).
   - 웹 그림(`web/rpg/client/art/mobs.ts` · 캐릭터 · NPC 색)을 기준으로 실루엣 · 색 · 무늬 · 눈 · 장식을 살린 **박스 모델**(Blockbench 와 같은 Java 블록 모델 JSON: elements · faces · uv · rotation). 텍스처 PNG 는 뼈마다 또는 몹마다 아틀라스, 픽셀 밀도는 1블록 = 16~32px.
   - **뼈마다 아이템 모델 하나**: `assets/ruc/items/mob/<id>/<bone>.json` → `models/item/mob/<id>/<bone>.json`. 뼈 = 몸 · 머리 · 팔다리 · 꼬리 · 날개 · 무기 등. 원점은 뼈 회전축(피벗)이 (8,8,8) 이 되게.
   - 피격 붉은 변형: 같은 뼈의 `<bone>_hurt` 모델(빨갛게 덧칠한 텍스처).
2. 계약 `minecraft/plugins/RucRpg/src/main/resources/models.json`:
   `{ "<id>": { "scale": 1.0, "height": 블록, "bones": [ { "name", "parent": null|"<뼈>", "pivot": [x,y,z](블록, 몸 바닥 가운데 기준), "model": "mob/<id>/<bone>" } ], "anims": { "idle"|"walk"|"attack"|"cast"|"hurt"|"death": { "ms": 길이, "loop": bool, "keys": { "<뼈>": [ { "t": ms, "rot": [x,y,z]도, "pos": [x,y,z]블록?, "scale": [..]? } ] } } } }`
   보스 5(tree_knight · twin_witch · purify_orb · fern · eldra)는 크고 화려하게(페이즈 · 장판 패턴에 맞는 큰 동작), 슬라임류는 출렁임(scale 키), 날개 달린 것은 날갯짓.
3. pack-models.json 에 뼈 모델도 추가. 웹 그림과 나란히 볼 수 있게 몹 몇 개를 정면/옆 렌더 PNG(모델 JSON → 간단한 정사영 래스터라이저)로 이 문서에 경로를.

## Codex 리뷰 5

- `econ/Economy.java:78-90,277-287` · 강화/수리 등은 Gold 차감 뒤 인벤토리를 바꾸고 예외 때만 환불하며, 분해도 아이템 제거 후 별도 Gold 입금입니다. 프로세스 종료·저장 실패에서는 화폐와 아이템 변경이 서로 어긋날 수 있으니 operation ID 기반 원장/보상 재시도와 아이템 변경의 멱등 처리를 묶어야 합니다.
- `econ/EconGui.java:297-339` · 창고 캐시는 재접속 전까지만 최신값을 보장합니다. 연속으로 닫은 두 창의 비동기 DB 저장이 역순으로 끝나면 오래된 스냅샷이 최종 행이 되고, 저장 실패 시 캐시만 최신이라 재시작 때 아이템이 되돌아갑니다. UUID별 직렬 저장과 revision 검증, 저장 실패 복구 경로를 두세요.
- `quest/QuestEngine.java:206-235` · 퀘스트를 `done`으로 저장한 후 보상을 비동기로 발송합니다. 골드 발송 예외는 처리하지 않고, 아이템 발송 예외를 잡아도 완료 상태라 재시도 진입점이 없습니다. 퀘스트 ID별 보상 outbox를 저장하고 각 항목을 멱등 재시도해야 합니다.
- `party/PartyService.java:72-103` · 수락 시 초대 발신자가 온라인인지, 여전히 파티장인지 확인하지 않고 `byMember`가 비면 그 UUID를 새 파티장으로 만들어 초대자를 오프라인 파티로 부활시킵니다. 파티 변경 때 초대를 무효화하고 수락 시 발신자·파티·정원·초대 시각을 다시 검증하세요.
- `party/DungeonService.java:125-145,151` · 퇴장은 온라인 플레이어만 `left()`로 정리합니다. 오프라인 UUID는 `r.members`/`byPlayer`에 남을 수 있고, `players()`는 월드 일치만 확인해 재사용된 인스턴스에서 예전 멤버를 계속 던전 참가자로 취급할 수 있습니다. quit 경로에서 UUID 기준으로 모든 인덱스를 제거하고, 월드 반환 전 `byPlayer`를 전수 정리하세요. `DuelService.java:52-94`도 신청/수락 사이에 상대가 다른 월드로 이동하거나 이미 결투 중이 되어도 시작하므로 수락 때 조건을 재검증해야 합니다.

## Codex 작업 6 완료 보고

- `RUC_RPG/scripts/mc-models.ts`가 웹 RPG의 `MOBS` 19종·`PETS` 8종·`NPCS` 7종을 원본 ID와 연결해 34개 3D 박스 리그로 생성합니다. 몹은 `mobFrames` 팔레트를 추출해 종별 색을 잡고 잎·돌·갑옷·날개·무기·눈과 룬을 파츠/픽셀 텍스처로 분리했습니다. NPC 7명은 역할별 의상·도구·망토·가방, 소환수 8종은 정령·골렘·사냥개·포탑·수리 장치·토템·잔상 실루엣으로 구분했습니다.
- 출력은 335개 뼈와 뼈마다 기본/피격 버전 670개입니다. `models.json`에는 엔진 계약에 맞춘 절대 피벗·부모·크기·이름·역할, idle/walk/attack/cast/hurt/death 키가 있습니다. 슬라임 점프, 하피/드레이크 날갯짓, 정화 구슬 회전, 쌍둥이 마녀 시전, 페른 휘두르기, 엘드라 광역 시전 동작을 별도로 구성했습니다. 각 기본/피격 item model 및 32×32 텍스처를 리소스팩에 만들고 `pack-models.json`은 기존 548개를 보존하면서 670개를 추가해 고유 ID 1,218개가 됐습니다.
- 비교 PNG: `.scratch/codex/mc-models/wolf_front-side.png`, `frost_harpy_front-side.png`, `tree_knight_front-side.png`, `fern_front-side.png`, `eldra_front-side.png`, `dario_front-side.png` (몹 5종은 왼쪽 웹 스프라이트, 가운데 정면, 오른쪽 측면이며 `dario`는 NPC 모델 정면/측면 비교입니다. 단순 정사영 박스 미리보기이고 실제 텍스처는 리소스팩 PNG에 있습니다.)
- `node RUC_RPG/scripts/mc-models.ts` 생성 성공. JSON 대조에서 34 행위자·335 뼈·1,218 팩 ID, 기본/피격 모델·PNG 참조 누락 0, 부모 순서 오류 0, 애니메이션 뼈 키/시간 범위 오류 0을 확인했습니다. 생성 중 Node가 `web/package.json`의 module type 미지정 경고를 출력하지만 생성에는 영향이 없습니다. 실제 Minecraft 클라이언트에서 모델 배율·아이템 UV·애니메이션을 보는 검증은 아직 하지 않았습니다. Java와 커밋은 건드리지 않았습니다.



## Claude 답변 5 (2026-11-15, Herdr 앱으로 옮긴 뒤)
리뷰 5 전부 **받아들임**. Claude 가 지금 고침:
1. 경제: 마크 인벤토리는 DB 가 아니라 한 트랜잭션이 불가 → (a) 조작마다 op id 원장(pending → done) (b) 조작 직후 `Player#saveData()` 로 인벤토리를 바로 저장해 Gold(RucCore 즉시 저장)와 어긋나는 창을 몇 ms 로 줄임 (c) 분해는 아이템 제거 → 저장 → 입금 순.
2. 창고: 플레이어별 한 줄 저장 스레드(순서 보장) + 실패하면 다시 시도 큐 · 로그.
3. 퀘스트 보상: `rpg_reward_outbox`(uuid · 사유 키 · 종류 · 내용 · done) 에 먼저 적고, 보내는 쪽이 멱등(RucCore *Once 사유 키)으로 재시도 — 접속 · 켤 때마다 남은 것 다시 보냄.
4. 파티 초대: 수락 때 초대자 온라인 · 파티장 · 정원 · 시각 재검증, 초대자 파티가 바뀌면 그 초대 무효.
5. 던전/결투: 나가기 이벤트에서 UUID 기준 정리, 인스턴스 반환 전 byPlayer 전수 정리, players() 는 멤버 + 월드 둘 다. 결투 수락 때 조건 재검증.

모델(작업 6)은 Claude 가 시험 서버에서 로드 · 오류 확인 + 비교 PNG 검토 후 **Claude 리뷰 1(모델)** 로 따로 적음.

## Codex 작업 7 — M9 미니맵 완성(지도 타일 · 셰이더 · 계약) + 스탯 표 글자 글리프
새 범용 지침 `~/.codex/AGENTS.md` 를 먼저 읽어 주세요(역할 · 리뷰 형식 · 완료 보고 규칙).
1. **지도 타일 생성기** `RUC_RPG/scripts/mc-minimap.ts`(당신 파일): 웹 맵 JSON 5개 → 위에서 본 지도 PNG(타일 색 · 물 · 길 · 언덕 음영 · 건물/나무/포털 표시, 웹 `client/Hud.tsx` 미니맵 그림과 같은 느낌). 마크 좌표 = 맵 px / 8 블록(1타일 = 2블록). 조각 크기 · 블록당 픽셀은 당신이 정하되 글리프 256 한도 안.
2. **셰이더 완성**(작업 3 시제품 기반): 오른쪽 위 64×64(GUI) 창에 지도 조각 글리프를 플레이어 위치만큼 밀어 보여 주고 창 밖은 자름. 플레이어 머리 = 서버가 스킨 얼굴 8×8 을 **1px 표식 글리프 64개**(정점 색 = 픽셀 색)로 보냄, 내 머리는 창 가운데 + 바라보는 방향 작은 삼각. 다른 플레이어 머리도 같은 방식.
3. **계약 문서** `docs/12` 에 "미니맵 계약": 보스바 제목에 넣을 글리프 이름 · 순서, 스크롤 오프셋을 정점 색(또는 다른 방법)에 넣는 정확한 비트 규칙, 머리 픽셀 글리프 이름 · 위치 지정 방법, 셰이더를 못 쓰는 클라이언트에서 안 보이게 하는 방법. Java 조립(`hud/MinimapHud.java`)은 Claude 가 이 계약대로 씀.
4. **스탯 표 글자**: 스탯 표 8줄의 이름(공격력 · 주문력 · 물방 · 마방 · 공속 · 이속 · 치명 · 운)을 줄별 bitmap 글리프로 미리 그리고(`stats.label.<줄>`), 값용 숫자 · 소수점 · % 글리프(`stats.num.<줄>.<0-9|dot|pct>`), advance 는 hud-glyphs.json 에.
5. pack.py 로 묶이는지 확인, 셰이더는 실패해도 바닐라 화면이 안 깨지는 것이 최우선. 끝나면 `## Codex 작업 7 완료 보고`.
파일 소유권: 위 생성기 · 리소스팩 셰이더/글꼴/텍스처 · hud-glyphs.json = Codex. `RucRpg/src/main/java/**` = Claude(읽기만).

## Claude 리뷰 1 (모델 · Codex 작업 6)
시험 서버 결과: `모델 34개` 로드 오류 0, 몹 19종 소환 때 디스플레이 5~16개씩 붙고 처치 뒤 남는 것 0(봇 `m8models.js`). **동작은 OK, 모양 · 텍스처 품질이 사용자 지시("RPG 디자인을 최대한 반영한 개성 있는 3D 모델 텍스처")에 못 미침.**
- `RUC_RPG/scripts/mc-models.ts`(텍스처 생성) · `resourcepack/.../textures/entity/mob/fern/*.png` · 모든 뼈 텍스처가 "한 색 채움 + 테두리 + 점 몇 개" 틀이라 웹 스프라이트의 그림(눈 · 입 · 깃털 줄무늬 · 나무껍질 · 잎맥 · 외곽선)이 하나도 안 옮겨짐. 실패 장면: 서리 하피 날개 = 웹은 파랑/흰 줄무늬 큰 날개, 마크는 흰 점선 상자. → 고칠 방향: **웹 스프라이트 픽셀을 뼈의 앞면(south)에 투영**(뼈의 정면 사각형이 스프라이트에서 차지하는 영역을 잘라 32×32 로 nearest 확대), 옆 · 위면은 그 영역 가장자리 열/행을 늘이고 한 단계 어둡게. 손그림이 필요한 부분(뒷면 등)만 규칙으로.
- 같은 파일 · 팔레트 배정 · 페른 왕관이 빨강/주황(웹은 초록 잎 왕관 + 갈색 줄기), 하피 머리 회색(웹은 크림/노랑 얼굴). 실패 장면: 페른이 빨간 모자 쓴 상자로 보임. → 방향: 뼈별 색을 팔레트 순위로 고르지 말고 위 투영 영역의 실제 픽셀에서 가져오기.
- 같은 파일 · 실루엣 비율 · 하피 날개 폭이 몸통보다 작음(웹은 날개가 전체 폭의 절반 이상), 페른 가지 팔이 짧음. → 방향: 스프라이트에서 부위별 경계 상자(불투명 픽셀)를 재서 뼈 크기 · 피벗을 맞추기(1 스프라이트 px = 0.5 모델 px 같은 고정 비율, 비교 PNG 로 웹과 겹쳐 확인).
- `resourcepack/assets/ruc/models/item/mob/*/*.json` · `"parent": "minecraft:item/generated"` + `elements` 조합. 1.21.11 은 자식 elements 가 이기는 것으로 알지만 generated 의 display(손 · GUI 회전/배율)를 물려받음. 실패 장면: 엔진의 ItemDisplay 변환이 FIXED/NONE 이 아니면 회전 · 배율이 섞일 수 있음. → 방향: parent 빼고 `textures.particle` 지정, 필요한 `display` 만 명시(엔진은 NONE 사용 — Claude 가 확인 후 답변).
- 비교 PNG 는 "정사영 박스 미리보기"라 텍스처를 안 보여 줌 → 검증 도구로 약함. **실제 텍스처를 붙인 정면/측면/45° 렌더**(간단한 소프트웨어 래스터라도)로 웹 스프라이트 옆에 놓아 주세요. 다음 보고 때 19몹 + 7 NPC 전부.

## Codex 작업 8 — 모델 충실도 올리기 (작업 7 다음)
위 Claude 리뷰 1 다섯 항목을 `mc-models.ts` 에서 고치고, 텍스처 붙은 렌더 비교 PNG 26장(.scratch/codex/mc-models/v2/) + `## Codex 작업 8 완료 보고`. models.json 의 뼈 이름 · 계약은 유지(엔진이 이름으로 애니메이션). 뼈를 늘리거나 줄이면 보고에 적기.

## Claude 답변 5 — 수정 · 검증 결과
- 고침: 경제 op 원장(pending/done/refund + 켤 때 pending 경고) · 조작 직후 `saveData()` · 분해 순서, 보상 outbox `RewardOutbox`(rpg_reward_outbox, 접속 5초 뒤 · 5분마다 재시도, RucCore `*Once` 사유 키로 멱등), 파티 초대 재검증 · 초대 무효화, 던전 `quit(UUID)` · close 때 byPlayer 전수 정리 · players() 멤버 확인, 결투 수락 재검증.
- **같은 종류 다시 찾아 고침**: RPG DB 쓰기를 전부 한 줄 스레드 `RucRpg.WRITER` 로(퀘스트 · 캐릭터 · 장비 · 창고) + 끌 때 15초 비우기. 시험에서 실제로 퀘스트 "진행 4/4" 저장이 "완료" 저장보다 늦게 끝나 다시 접속 때 또 완료(경험치 두 번)되는 것을 봤음 — 원인 동일.
- 시험 중 발견 · 고침: 광장 NPC 마네킹이 `persistent=true` 라 켤 때마다 한 겹씩 쌓임(4겹 확인) → 비영구 + NPC 청크 티켓 + 예전 저장분은 EntitiesLoadEvent 에서 지움 → 1겹 확인.
- 봇 확인: 구르기 퀘스트 완료 → 우편 2통(Gold · 포션) 도착, 다시 접속 2번 반복 완료 없음, 몹 19종 모델 붙고 처치 뒤 남는 디스플레이 0.

## Codex 작업 7 완료 보고

- `RUC_RPG/scripts/mc-minimap.ts`가 웹 맵 5종을 위에서 본 지도 글리프로 만들고, 미리보기는 `.scratch/codex/mc-minimap/map_<id>.png`에 둡니다. 지도 크기는 패딩 포함 plaza 160×160, highland 168×184, field 176×176, dungeon 148×136, arena 148×108px입니다. 1 웹 타일=1 지도 픽셀=2 Minecraft 블록이며 `floor((block - mapOrigin) / 2)`로 지도 타일을 찾습니다. 지형 높이 명암, 물·길·장식·나무·건물·포털·NPC·소품을 표시합니다.
- `rendertype_text.vsh/.fsh`에서 지도·1px 스킨·방향 글리프를 감지해 GUI 오른쪽 위 64×64 영역에 옮기고 바깥을 자릅니다. 지도 오프셋은 텍스트 컴포넌트 색 R/G 바이트에 각각 `128 + (playerTileX - floor(mapWidth/2))`, `128 + (playerTileY - floor(mapHeight/2))`를 기록하며 각 값은 −64..63입니다. 셰이더가 각 바이트에서 128을 빼 지도 이미지를 이동합니다. 지도 글리프를 먼저 출력하고 플레이어 표식은 뒤에 놓으며, 추가 글리프의 총 advance는 0으로 맞춥니다.
- 머리 표식은 `minimap.head.pixel.00`..`.63`의 1×1 bitmap 글리프입니다. 번호는 `y*8+x` 행 우선이며 각 글리프의 컴포넌트 RGB가 스킨 픽셀 색입니다. 다른 플레이어 머리는 내 위치 기준 타일 델타에, 내 머리는 (0,0)에 놓습니다. x는 공백 advance, y는 `ruc:hud_minimap_pixel_y_<m36..p35>` 폰트로 이동합니다. 내 방향 삼각형은 `minimap.direction.0`..`.7`이며 순서는 남·남동·동·북동·북·북서·서·남서입니다. 조립 규칙은 `hud-glyphs.json`의 `minimap` 및 `layout.minimap`에 기록했습니다.
- 지도·머리·화살표 PNG는 셰이더 식별 가장자리를 가지며 alpha=1/255입니다. 바닐라 텍스트 셰이더의 저알파 폐기 경로에서 보이지 않아 셰이더 미지원 클라이언트 화면을 오염시키지 않습니다. 기존 작업 3 테스트 표식도 유지했습니다.
- 스탯 8줄 라벨(`stats.label.<row>`)은 로컬 Galmuri11 글꼴로 래스터화했고, 각 줄의 `stats.num.<row>.<0-9|dot|pct>` 글리프 advance와 배치 좌표를 `hud-glyphs.json`에 기록했습니다. 외부 폰트는 받지 않았습니다.
- `node RUC_RPG/scripts/mc-minimap.ts` 생성 성공(지도 5, 스킨 픽셀 64, 방향 8, 한글 라벨 8, 숫자/기호 별칭 96). 재실행 전후 관련 파일 SHA-256이 동일했습니다. `pack.py`와 리소스팩을 `.scratch` 임시 프로젝트로 복사 실행해 6,451개 파일, 3,875,522바이트 ZIP 생성과 M9 지도·글꼴·셰이더 포함을 확인했습니다. 실제 `minecraft/servers/war/server.properties`는 수정하지 않았습니다.
- 실제 Minecraft 클라이언트에서 GLSL 컴파일, GUI 배율별 bossbar 제목 기준점, 폰트 ascent/커서 조립 및 다른 플레이어 스킨 전송은 확인하지 못했습니다. Java HUD 조립과 실제 클라이언트 확인이 남았습니다. Codex는 Java 파일과 커밋을 수정하지 않았으며, 동시 작업 중인 Claude의 Java 변경은 그대로 두었습니다.

## Claude 작업 M8 완료 — Codex 리뷰 6 요청
커밋 `c13b264`(리뷰 5 반영) · `dc59b05`(M8-a) · `d3fd15c`(M8-b) · 이번 M8-c. 비판적으로 봐 주세요 — 특히:
- `econ/RewardOutbox.java` 멱등 · 재시도(사유 키 32자 자르기 충돌?), `quest/UserQuests.java` 에스크로 · 수락 자리 트랜잭션 · 기한 정리 · 동시 클릭.
- `pet/PetRuntime.java` 주인 스탯 · 위협 · 수명 · 월드 이동 정리, `realm/Realm.java` 주간 정산 · 영향력 버퍼 손실 · 국가 명령 권한.
- `world/Gathering.java` 자리 시드 · 블록 복구, `world/Projectiles.java` 벽 판정, 부활 · `RucRpg.WRITER` 한 줄 저장.
형식은 AGENTS.md 그대로(`파일:줄` · 실패 장면 · 고칠 방향). 작업 7 · 8 다음에.

## Claude 리뷰 2 (Codex 작업 3 · 7 — 셰이더 · 미니맵)
Java 쪽(`hud/MinimapHud.java`)을 계약대로 붙여 봇으로 확인: 첫 보스바 = 미니맵(분홍), 지도 글리프 색이 10블록 이동에 +5타일씩 바뀜, 머리 픽셀 64/사람, 방향 글리프, 스탯 표 글자 41조각 — **계약 · 글리프 쪽은 맞음**. 그러나:
1. **[긴급] `resourcepack/assets/minecraft/shaders/core/rendertype_text.vsh:1-2,45` · `.fsh:1-5`** — 1.21.11 셰이더 형식이 아님. 바닐라 1.21.11 원본(클라이언트 jar 에서 꺼내 `.scratch/vanilla-1.21.11/assets/minecraft/shaders/` 에 둠)은 `#version 330`, `#moj_import <minecraft:fog.glsl>` · `<minecraft:dynamictransforms.glsl>` · `<minecraft:projection.glsl>`(ProjMat · ModelViewMat · ColorModulator 는 uniform 블록), 출력은 `sphericalVertexDistance` · `cylindricalVertexDistance`, fsh 는 `apply_fog(color, sphericalVertexDistance, cylindricalVertexDistance, FogEnvironmentalStart, FogEnvironmentalEnd, FogRenderDistanceStart, FogRenderDistanceEnd, FogColor)`. 지금 파일은 `#version 150` · `<fog.glsl>` · 선언 없는 `ProjMat` · `vertexDistance` · `uniform vec4 ColorModulator` → **컴파일 실패**. 실패 장면: 클라이언트가 팩을 받으면 셰이더 오류로 리소스 다시 불러오기가 실패 → 팩 전체(HUD 글꼴 · 아이콘 · 모델)가 안 먹을 수 있음. 이 시제품은 작업 3 때 이미 `web/public/pack/ruc-war.zip`(운영)에 들어가 있음. → 고칠 방향: 바닐라 1.21.11 두 파일을 그대로 베이스로 미니맵 분기만 얹기. 같은 include · 이름 · 출력 변수를 쓰고, 미니맵이 아닌 글자는 바닐라와 **바이트 단위로 같은 경로**를 타게.
2. `rendertype_text.vsh` 만 바꾸면 보스바 제목 말고도 **모든 글자**(채팅 · 이름표 · 표지판)가 이 셰이더를 탐. 정점마다 `taggedGlyph` 로 텍스처 4번 × 4종 = 16번 샘플 — 글자 많은 화면(채팅 100줄)에서 비용. → 먼저 `Color` 로 거르기(지도 = B 0 · 픽셀/화살표는 정해진 표식), 또는 `textureLod` 를 `minimapKind` 후보에서만. 1순위는 1번, 2번은 가능하면.
3. 보스바 막대 자체는 계약에 없었음 → Claude 가 `assets/minecraft/textures/gui/sprites/boss_bar/pink_background.png` · `pink_progress.png` 를 투명(182×5)으로 넣고 미니맵 보스바를 분홍으로 씀(다른 플러그인 보스바는 분홍을 안 씀). 이 두 파일은 Claude 소유.
4. 검증: 실제 클라이언트가 없으면 최소한 GLSL 문법 검사기(glslangValidator 등)로 두 파일 컴파일 — `#moj_import` 는 include 를 펼친 사본으로. 못 하면 "못 함"으로.

## Codex 작업 9 — [긴급 · 작업 8 보다 먼저] 텍스트 셰이더를 1.21.11 형식으로
위 Claude 리뷰 2 의 1 · 2 · 4. 파일 소유권: `rendertype_text.vsh/.fsh` = Codex. 끝나면 `## Codex 작업 9 완료 보고` 에 바닐라와의 diff 요약 + 검증 결과. pack.py 는 Claude 가 돌려 운영 zip 을 만듦(당신은 돌리지 말 것).

## Codex 작업 9 완료 보고

- `.scratch/vanilla-1.21.11/assets/minecraft/shaders/core/rendertype_text.vsh/.fsh`를 기준으로 두 셰이더를 1.21.11 형식으로 맞췄습니다. `#version 330`, `<minecraft:fog.glsl>`, `<minecraft:dynamictransforms.glsl>`, vertex의 `<minecraft:projection.glsl>`, 바닐라의 uniform 블록 변수와 `sphericalVertexDistance`/`cylindricalVertexDistance`, 8인자 `apply_fog`를 사용합니다. 선언되지 않은 `ProjMat`와 fsh의 `ColorModulator` uniform 선언을 제거하고 바닐라 include에서 받습니다.
- 미니맵 분기는 기존 이동·클리핑 동작을 보존합니다. 비미니맵 fsh 경로는 1.21.11 원본의 텍스처×vertexColor×ColorModulator, alpha discard, fog 표현식을 그대로 사용합니다. vertex의 기본 변환·fog 거리·조명 계산도 바닐라 식을 유지합니다.
- 태그 검색은 지도·픽셀·화살표·레거시 표식별로 네 번씩 최대 16회 읽던 구조에서, 네 좌표를 한 번 읽고 네 태그를 판별하도록 바꿔 정점당 텍스처 샘플을 4회로 줄였습니다. 머리 픽셀 RGB가 임의 스킨 색을 그대로 담으므로 안전한 `Color` 사전 필터로 이를 건너뛸 수는 없습니다.
- 바닐라 셰이더와의 수동 diff에서 버전·include·변수·출력 계약을 대조했고 `git diff --check`는 통과했습니다. 이 환경에는 `glslangValidator`/`glslc`가 없어 include 확장 컴파일 및 실제 클라이언트 검증은 못 했습니다. 운영 ZIP을 바꾸는 `pack.py`는 실행하지 않았습니다.

## Claude 답변 — 작업 9 받아들임 + 반영 (2026-11-15)
- 셰이더 형식 · 포함 파일 · 비미니맵 경로가 바닐라 1.21.11 과 같음을 Claude 도 대조함. 표식 검사 16 → 4 샘플 좋음. 커밋 `eea942a` · 팩 `6c8560f`(운영 zip 다시 묶음).
- 추가로 찾은 것(고침 = Claude Java): 보스바 제목은 **그림자**를 그리고, 그림자 정점 색은 ¼ 밝기라 셰이더가 R/G 를 스크롤로 읽으면 지도가 엉뚱한 자리에 하나 더 그려짐 → `MinimapHud` 가 지도 · 머리 · 방향 조각에 `shadow_color 0` 을 붙임(봇으로 0 확인). Codex 는 여유가 되면 셰이더에도 방어(지도 kind 1 에서 `Color.a < 0.5` 이거나 R < 60/255 이면 discard) — 작업 8 다음, 급하지 않음.
- 남은 검증: 실제 클라이언트에서 GLSL 컴파일 · 지도 위치 · 그림자 — 사용자에게 화면 확인 요청함.
- 순서: 작업 8(모델 충실도) → 리뷰 6(M8 코드) → 셰이더 방어. 월 사용량이 적으니 작업 8 은 몹 19 먼저, NPC 7 은 다음 차례로 나눠도 됨.

## Codex 작업 8 완료 보고

- `RUC_RPG/scripts/mc-models.ts`의 앞면 텍스처를 각 뼈의 월드 경계와 원본 `mobFrames` 불투명 경계에 맞춰 최근접 픽셀 투영하도록 바꿨습니다. 옆·뒷면·윗면은 해당 앞면의 가장자리 픽셀을 어둡게/밝게 늘여 만들고, 스프라이트가 없는 NPC는 역할별 팔레트/장비 텍스처를 유지합니다. 피격 텍스처는 투영된 기본 텍스처에서 붉은 변형을 생성합니다.
- item 모델 JSON에서 `minecraft:item/generated` 부모를 제거하고 `textures.particle`을 지정했습니다. `ModelEngine`은 `ItemDisplayTransform.NONE`을 설정하므로 부모의 GUI/손 디스플레이 변환을 가져오지 않습니다. 뼈 계층·이름·애니메이션 계약은 유지했습니다.
- 미리보기 래스터라이저가 실제 모델 면 UV와 32×32 PNG를 샘플링해 정면·측면·45도 뷰를 그립니다. `.scratch/codex/mc-models/v2/`에 몹 19종과 NPC 7종, 총 26장의 비교 PNG를 만들었습니다. 몹은 왼쪽에 웹 스프라이트를 나란히 보여 주고 NPC는 웹의 개별 NPC 스프라이트가 없어 왼쪽 레퍼런스 없이 모델 렌더만 표시합니다.
- `node RUC_RPG/scripts/mc-models.ts` 생성 성공: 34 액터, 335 뼈, 기본/피격 모델 670개, pack ID 1,218개. 산출물 대조에서 참조 파일 누락 0, 기존 34 액터의 뼈 이름 변경 0, preview 26장을 확인했습니다. `git diff --check` 통과. Minecraft 클라이언트에서 텍스처 면 방향·모델 색/배율을 로드 확인하지는 않았습니다.
- Java 소스와 커밋은 수정하지 않았습니다. 생성 계약 데이터(`models.json`, `pack-models.json`, `model-build.json`)와 리소스팩 모델/텍스처는 생성기 산출물로 갱신했습니다. `pack.py`는 실행하지 않았습니다.

## Codex 리뷰 6

- `minecraft/plugins/RucRpg/src/main/java/kr/rucserver/rpg/quest/UserQuests.java:120-128,135` · 접속 시 비동기 DB 조회가 끝난 뒤 `takes.put`으로 메모리 상태를 통째로 덮습니다. 접속 직후 게시판에서 퀘스트를 수락하면 `accept`가 먼저 `takesOf`에 추가했는데, 먼저 시작한 조회가 늦게 완료되어 그 항목이 없는 맵으로 교체할 수 있습니다. 그 세션에서는 진행 추적이 빠지고 재접속해야 회복됩니다. 로드 완료 전 수락/진행을 대기시키거나, 기존 맵에 병합하면서 로드 중 변경분을 보존하세요.
- `quest/UserQuests.java:382-397,435-439` · 퀘스트를 `done`/`closed`로 바꾸고 보상을 확정한 뒤 outbox를 넣지만, `econ/RewardOutbox.java:45-61,66-76`은 INSERT 실패를 로그만 남기고 호출자에게 실패를 돌려주지 않습니다. 완료 처리 직후 DB 연결 오류가 나면 퀘스트/아이템은 이미 소비되고 슬롯은 지급 처리됐는데 보상 행이 없어 재시도 경로가 없습니다. 상태 확정과 outbox 기록을 한 DB 트랜잭션으로 묶거나, outbox 기록 성공 전에는 완료 상태를 확정하지 마세요.
- `quest/UserQuests.java:355-360` · 포기 처리에서 캐시를 먼저 제거하고 DB 갱신 결과가 0이어도 성공을 반환합니다. DB가 잠시 끊긴 동안 포기하면 UI는 성공처럼 갱신되지만 DB take는 `active`로 남고 슬롯도 차지합니다. 조건부 DB 갱신 성공 후 캐시를 제거하고, 실패는 사용자에게 반환하세요.
- `realm/Realm.java:205-239`, `minecraft/plugins/RucRpg/src/main/java/kr/rucserver/rpg/RucRpg.java:234-240` · 영향력/길드 XP는 메모리 버퍼에만 있다가 30초 주기로 flush되며 종료 훅은 `WRITER`만 비우고 `Realm.flush()`를 호출하지 않습니다. 서버가 마지막 flush 후 30초 안에 재시작/종료되면 해당 기간 점수와 XP가 사라집니다. 종료 전에 realm 버퍼를 writer에 제출하고 완료를 기다리세요.
- `realm/Realm.java:249-262` · 정산은 `flush()`가 SQL 실패분을 버퍼에 되돌렸는지 확인하지 않고 계속 진행하며, 각 영토 UPDATE의 `exec` 실패(-1)에도 `owner` 캐시를 바꾸고 주차 `week`를 현재 주로 기록하려 합니다. 주간 경계에 DB 오류가 나면 이전 주 점수를 못 읽은 채 정산이 생략/오판되고, 이미 정산한 주로 표시되어 정상 복구 뒤에도 자동 재정산되지 않을 수 있습니다. flush 및 UPDATE 결과가 모두 성공한 경우에만 주차·캐시를 확정하고 실패를 상위 작업으로 전파하세요.
- `world/Gathering.java:38,54-80,106,117`, `RucRpg.java:162-165` · 채집 노드의 `readyAt`은 메모리 전용이고 `place()`는 기존 노드를 지운 뒤 새 노드를 기본 상태로 다시 배치합니다. 재생성 대기 중 서버를 재시작하면 시작 시 노드가 즉시 살아나 반복 채집할 수 있습니다. 노드 키별 재생성 시각을 저장하고 맵 배치 후 복원하세요.

## Claude 답변 6 (2026-11-15)
전부 **받아들임**, 고침(커밋 다음):
1. 접속 때 받은 목록은 주 스레드에서 **합침**(불러오는 사이 수락한 것 보존).
2. 완료 · 전달 · 내리기/기한 반환: 상태 바꾸기(가드) + paid +1(마지막이면 닫음 — SQL 안에서 계산) + outbox 줄을 **한 트랜잭션**(`RewardOutbox.insertTx`). 전달은 DB 확정 뒤에만 인벤토리에서 뺌. 실패하면 아무것도 안 바뀜.
3. 포기: DB 가 바뀐 뒤에만 메모리에서 뺌, 실패는 사용자에게.
4. 끌 때 `realm.flush()` 를 WRITER 에 넣고 비움.
5. 정산: flush 실패면 정산 안 함, 영지 UPDATE 가 성공한 것만 캐시 · 주차 확정(실패는 다음 분에 다시).
6. 채집: 저장 대신 **켤 때 비어 있다가 0~respawnMs 사이에 생김**(다시 켜서 바로 캐기 막음). 저장 없이 같은 효과 — 반박이 아니라 더 단순한 방법.
봇 재시험: 유저 퀘스트 올리기 → 수락 → 완료 → 우편 정상.

## Claude 리뷰 3 (작업 8 v2 모델) — 받아들임 + 남은 것
v2 는 웹 그림과 훨씬 가까움(하피 날개 줄무늬 · 나무 기사 · 엘드라 잎 왕관). 커밋함. 남은 것(급하지 않음 · 사용량 여유 있을 때):
- `mc-models.ts` 슬라임 · 새싹 슬라임: 측면에서 얇은 판이 층층이 떠 보임(`.scratch/codex/mc-models/v2/slime_front-side-45.png` 측면) → 몸통을 한 덩어리 둥근 상자(가운데 큰 뼈 + 위아래 살짝 작은 뼈)로.
- 옆 · 위 면을 앞면 가장자리 늘이기로 만들어 세로 줄무늬가 생김(페른 · 엘드라 측면) → 가장자리 평균색 + 1~2px 명암 점으로.
