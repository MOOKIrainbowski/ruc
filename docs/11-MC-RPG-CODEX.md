# Codex 에게 — 마크 RPG 서버 공동 작업 안내 (Claude Code 작성, 2026-11-15)

지난번 러크 RPG(웹) 베타 피드백 2차를 같이 했던 것과 같은 방식입니다. 이번엔 **그 웹 RPG 를 마인크래프트 서버로 옮기는** 일입니다.
계획서 `docs/10-MC-RPG-PLAN.md` 를 먼저 끝까지 읽어 주세요. 이 문서는 그 계획서를 읽는 데 필요한 배경 + 당신 몫입니다.

## 1. 프로젝트 배경 (처음이라 자세히)

- 저장소 루트 = 러크 서버 네트워크 전체. 마인크래프트 쪽은 `minecraft/`.
  - Velocity 프록시(25565) 뒤에 Paper 1.21.11 백엔드 4개: home 25566 · raid 25567 · **war 25568 (= 이번에 RPG 로 바꿀 "구 국가전 서버")** · peace 25569.
  - 플러그인 소스 `minecraft/plugins/` (Gradle 멀티 모듈, Java 21). `RucCore` = 4서버 공용(RUC 화폐 · 자체 경험치/레벨 · 우측 스코어보드 · 길드 · 우편함 · 칭호 · /tpa · 디스코드 인증 · Shift+F 메뉴). `RucWar` = 국가전 전용(영토 · 코어 · 전쟁 시간 · 국가창고 · 강화대). `RucGate` = 프록시 플러그인(국가 소속만 war 입장).
  - 빌드: `cd minecraft/plugins && java -classpath "gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain build`
  - 리소스팩 `minecraft/resourcepack/` → `python minecraft/scripts/pack.py` 가 `web/public/pack/ruc-war.zip` 으로 묶고 war `server.properties` 의 sha1 갱신. 1.21.4+ 아이템 모델 방식(`assets/ruc/items/*.json` + `item_model` 컴포넌트) 예시가 이미 있음(`upgrade_stone`).
  - 지금 마크 서버는 전부 꺼져 있음(마지막 실행 10-25). 운영은 사용자 PC 에서 사용자가 켬.
- 웹 RPG = `web/rpg/`(공용 TS `shared/` + PixiJS 클라 `client/`) + 게임 서버 `RUC_RPG/server/`(Node 24). 인수인계 `RUC_RPG/docs/HANDOFF.md`, 원본 설계 `RUC_RPG/RUC_RPG_PROMPT.md`.

## 2. 사용자 지시 요약 (원문 그대로의 핵심)

- 국가전 서버의 시스템은 모두 삭제하고 RPG 시스템 · 개념을 적용. **아이템 · 스킬 아이콘 · 모든 디자인 = RPG 게임과 동일**.
- HUD: 핫바 = 마크 9칸. 스킬과 적용효과는 핫바 위에 순서대로. 마력 구슬 = 핫바 왼쪽, 기력 구슬 = 핫바 오른쪽(픽셀). 스탯 상세 칸 = 마력 구슬 왼쪽. 겹치지 않게.
- 미니맵: RPG 와 같은 위치(오른쪽 위). 방향 화살표 대신 **플레이어 머리**, 다른 플레이어도 머리로.
- 검 · 방어구: 바닐라 방어구만. 상급 이상 몹 처치 시 상급 방어구 드롭.
- 마법부여 책: 지금 것 + RPG 개념 책 추가, 텍스처는 바닐라 마법부여 책과 동일.
- 팝업창: 최대한 같은 시스템.
- 기존 구현(스코어보드의 RUC 등 RucCore 기능)은 그대로 둠.
- 언급 안 한 RPG 시스템은 전부 완벽하게 마크로.
- **Claude Code 와 Codex 가 경쟁하듯 만들고, 서로 비판적으로 평가 · 토의해서 최고 품질로.**

## 3. 당신 몫 — 지금 할 것 (M0)

### 3-1. 계획서 비판 리뷰 (먼저, 짧게)
`docs/10-MC-RPG-PLAN.md` 를 읽고 **틀린 가정 · 빠진 RPG 시스템 · 마크에서 더 나은 방법 · 위험**을 `docs/12-MC-RPG-REVIEW.md` 에 "Codex 리뷰 1" 로 적어 주세요. 특히:
- 글꼴 HUD(액션바 + space/ascent 글꼴) 방식의 실제 한계(1.21.11 에서 ascent 음수 · 글리프 높이 제한 · ttf shift)
- 미니맵 오른쪽 위 고정의 현실적 방법(코어 셰이더 1.21.11 형식)과 대안
- 스킬 키 배치(5장)의 문제점

### 3-2. `RUC_RPG/scripts/export-mc.ts` (당신이 만드는 파일, Claude 는 안 건드림)
`node RUC_RPG/scripts/export-mc.ts` (Node 24 는 TS 를 바로 실행 — 기존 스크립트들처럼) 로:
1. `minecraft/plugins/RucRpg/src/main/resources/data/` 에 JSON:
   `items.json`(ITEMS · RARITY · SETS · 특수효과 표 · TIERS), `skills.json`(SKILLS 전부), `jobs.json`(LINES · JOBS · STAT_GRADE · AWAKEN · SPIRIT_BUFF), `mobs.json`(MOBS · GRADES · 보스 타임라인), `effects.json`, `elements.json`(ELEMENTS · 상성 · ELEMENT_PROC · REACTIONS), `stats.json`(BASE_STATS · LEVEL_GROWTH · MOVE · STAMINA · SECONDARY · CAPS · COMBAT · ROLL), `economy.json`(ENHANCE · ENCH_* · RARITY_VALUE · SHOP · SHOP_GOODS · BREW · MARKET · MAIL …), `quests.json`, `dungeons.json`, `party.json`, `pets.json`, `realm.json`, `progress.json`(GRADE · MASTERY · MASTERY_MOB · POT_GAIN).
   함수는 JSON 이 안 되니 **값 표만**. 함수로만 있는 규칙(예: `mobStats`, `itemValue`)은 3번 golden 으로.
2. 같은 폴더가 아니라 `minecraft/plugins/RucRpg/src/test/resources/golden.json` 에 **TS 공식의 기준값**(Java 이식 검증용):
   - `baseStats(lv)` lv 1·10·30·60·100 / `expToNext(lv)` 1~100
   - `finalStats(base, mods)` 몇 가지(직업 등급 배율 포함)
   - `computeDamage(a, d, hit, defEl, crit)` 20가지 조합(물리/마법/속성 상성/관통/치명) — 입력과 결과 둘 다
   - `mitigation` · `elementMul` 12×12 표 · `castMs` · `healAmount` · `mentalResist`
   - `needMastery` 1~100 · `startLevel` · `skillNums(sk, l, cdr)` 스킬 10개 × 등급 4 × 레벨 1·10·50
   - `mobStats(def, lv, grade)` 몹 5종 × 등급 7 · `mobExp`
   - `itemValue` · `enhanceCost` · `enchantCost` · `repairCost` · `disassembleRuc` 표본 · `rollEnhance` 경계값 · `rollShop("user", cycle, luck)` 2개(seeded 결정적이므로)
3. 실행해서 파일이 나오게 하고, 숫자가 아닌 값(NaN · Infinity) 없는지 검사하는 짧은 assert.

### 3-3. 하지 말 것
- `minecraft/plugins/RucRpg/src/main/java/**` · `RucCore` · `RucWar` · 서버 폴더(`minecraft/servers/**`)는 Claude 가 지금 고침 — 건드리지 마세요.
- 웹 RPG 코드(`web/rpg/**`)는 **읽기만**. export 에 필요한 값이 함수 안에 숨어 있으면 고치지 말고 golden 으로 뽑거나 저에게 알려 주세요.
- 비밀값(`.env*`, `live.env`, `forwarding.secret`) 출력 · 커밋 금지. 커밋은 Claude 가 묶어서 함.

끝나면 `docs/12-MC-RPG-REVIEW.md` 에 "Codex 작업 1 완료 — 만든 파일 · 확인 방법 · 남은 문제" 를 적어 주세요. 그다음 Claude 가 리뷰하고 M1 분담(HUD 글리프 생성기 `mc-art.ts`)을 드립니다.
