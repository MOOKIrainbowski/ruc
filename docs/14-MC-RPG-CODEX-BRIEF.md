# 14. 새 Codex 에게 — 러크 RPG 마인크래프트 이식 안내 (2026-11-15)

당신은 이 프로젝트에 처음 들어왔습니다(앞선 Codex 와 대화 기록이 이어지지 않음). 이 문서만 읽으면 일할 수 있게 적었습니다.
먼저 범용 지침 `C:/Users/hanse/.codex/AGENTS.md` 를 읽어 주세요(역할 · 리뷰 형식 · 완료 보고 규칙).

## 1. 무엇을 만드는가
- **러크 RPG** = 웹 2D 픽셀 RPG(`web/rpg/` 클라이언트 · `RUC_RPG/server/` 서버, TypeScript). 원본 데이터 = `web/rpg/shared/data/*.ts`.
- 이것을 **마인크래프트 서버(Paper 1.21.11)로 옮기는 중**: 플러그인 `minecraft/plugins/RucRpg`(Java 21, Claude 담당). 웹 데이터는 `RUC_RPG/scripts/export-mc.ts` 로 `RucRpg/src/main/resources/data/*.json` 이 됨.
- 리소스팩 원본 `minecraft/resourcepack/` → `python minecraft/scripts/pack.py` 가 `web/public/pack/ruc-war.zip` 으로 묶음(Claude 만 실행).
- 계획 · 진행: `docs/10-MC-RPG-PLAN.md`(1차, M0~M9 완료) · **`docs/13-MC-RPG-FIX-PLAN.md`(지금 하는 2차 수정)**. 공동 기록 `docs/12-MC-RPG-REVIEW.md`(배정 · 리뷰 · 완료 보고가 쌓이는 곳 — 끝에 이어 씀).

## 2. 지금 상황 (사용자가 실제 마크로 확인한 결과)
- HUD · 미니맵이 네모 글자, NPC · 몹이 보라/검정 → 팩 오류(글꼴 경로 · 아틀라스). Claude 가 고치는 중(F0).
- 사용자 결정: **Fabric 클라이언트 모드**를 만들어 키(Q · C · Z · R 스킬, M 지도 …) · HUD · 미니맵을 모드가 직접 그림(F1 · F2). 모드 코드는 Claude.
- **역할(사용자 지시)**: Codex = **간단한 코딩 · 그림(픽셀 아트)만**. 구조 · 서버 · 모드 · 팩 구조 · 검증 · 커밋 = Claude.

## 3. 규칙
- 배정된 파일만 만들고 고침(파일 소유권은 배정 글에). Java · 모드 코드 · `pack.py` · git 커밋은 건드리지 않음.
- 모든 그림은 **웹 RPG 와 같은 느낌의 픽셀 아트**(웹 그림 원본: `web/rpg/client/art/*.ts` — 코드로 그린 스프라이트, `web/rpg/client/CombatHud.tsx` · `Hud.tsx` 의 색 · 아이콘). 색은 웹 팔레트에서 가져오기.
- **경로 규칙(이번 고장의 원인)**: 파일 · 폴더 이름은 소문자 `a-z0-9_./-` 만. PNG 는 RGBA, 크기는 아래 명세 그대로.
- 끝나면 `docs/12-MC-RPG-REVIEW.md` 끝에 `## Codex 작업 N 완료 보고`: 만든 것 · 확인 방법 · 못 한 것(못 했으면 "못 함").

## 4. 첫 작업 = Codex 작업 11: 모드 HUD 픽셀 아트
출력 폴더(당신 소유): `minecraft/client/ruc-rpg-client/src/main/resources/assets/ruc_rpg/textures/gui/hud/` 와 생성기 `RUC_RPG/scripts/mc-hud-art.ts`(다시 돌리면 같은 결과).
바닐라 HUD 와 나란히 놓이므로 **바닐라 하트(9×9)와 같은 크기 · 같은 그림자 느낌**으로.
| 파일 | 크기 | 내용 |
|---|---|---|
| `mana_full.png` · `mana_half.png` · `mana_empty.png` | 9×9 | 마나 구슬 아이콘(파랑 #2F7BFF 계열, 바닐라 하트처럼 테두리 · 하이라이트). half = 왼쪽 절반만 참 |
| `energy_full.png` · `energy_half.png` · `energy_empty.png` | 9×9 | 기력(주황 #FF8A1F, 불꽃 모양) |
| `skill_slot.png` | 22×22 | 스킬 칸 틀(갈색 나무 — 웹 버튼 디자인 `web/rpg/client/rpg.css` 의 `.rpg-btn` 색, 안쪽 18×18 투명) |
| `skill_cooldown.png` | 18×18 | 쿨타임 덮개(검정 반투명 60%) |
| `skill_nores.png` | 18×18 | 자원 부족 덮개(파랑 반투명 + 테두리) |
| `key_q.png` `key_c.png` `key_z.png` `key_r.png` | 7×7 | 칸 아래 키 글자(흰 글자 + 어두운 바탕) |
| `stats_panel.png` | 72×84 | 스탯 상세 판 바탕(어두운 갈색 반투명, 8줄) |
| `stat_<atk·ap·pdef·mdef·atkspeed·movespeed·crit·luck>.png` | 8×8 | 스탯 아이콘(웹 `CombatHud.tsx` statRows 의 아이콘 · 색: sword #E5484D, star #9B5DE5, shield #9AA3AD, rune #B39DDB, bolt #F5C542, wing #3FC8E8, star #F2C94C, clover #2ECC71) |
| `minimap_frame.png` | 70×70 | 미니맵 테두리(안쪽 64×64 투명, 웹 미니맵 테두리 느낌) |
| `minimap_me.png` | 7×7 | 내 위치 삼각형(위쪽을 가리킴 — 모드가 돌림) |
미리보기: 전부 한 장에 4배로 붙인 `.scratch/codex/hud/preview.png`.
파일 소유권: 위 폴더 · 생성기 · `.scratch/codex/hud/` = Codex. 그 밖 = 읽기만.

다음 작업(예고): 스킬 이펙트 스프라이트(웹 `web/rpg/client/fx.ts` 기반) — 배정 글이 따로 올라옴.
