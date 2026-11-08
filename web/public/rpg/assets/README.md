# 러크 RPG 에셋 교체 (P17 · D104)

게임 그림과 소리는 코드로 그리고 합성한 것입니다. **진짜 그림 · 음원 파일**을 쓰고 싶으면 이 폴더에 파일을 넣고
`manifest.json` 에 "에셋 ID → 파일 이름"을 적은 뒤 배포하세요. 적지 않은 것은 지금처럼 코드 그림 · 합성 소리입니다.

```json
{
  "icons": { "magic_arrow": "icons/magic_arrow.png" },
  "items": { "storm_sword": "items/storm_sword.png" },
  "mobs":  { "slime": "mobs/slime.png" },
  "bgm":   { "field": "audio/field.ogg", "boss": "audio/boss.mp3" },
  "sfx":   { "hit": "audio/hit.ogg" }
}
```

| 종류 | ID | 파일 |
|---|---|---|
| icons | 스킬 · 상태 아이콘 ID (`web/rpg/shared/data/skills.ts` 의 `icon`, 효과의 `icon`) | PNG 32×32 (작은 그림도 늘려서 씀) |
| items | 아이템 템플릿 ID (`web/rpg/shared/data/items.ts`) | PNG 32×32 |
| mobs | 몹 키 (`web/rpg/shared/data/mobs.ts`, 소환수 그림 `pet_spirit` · `turret` …) | PNG 가로 띠: 오른쪽을 보는 프레임 8장(프레임 크기 = 그림 높이, 보통 32×32 → 256×32) |
| bgm | `plaza` · `field` · `highland` · `arena` · `dungeon` · `boss` | ogg · mp3 (반복 재생) |
| sfx | `client/sound.ts` 의 효과음 이름 (`hit` · `crit` · `pickup` · `levelup` …) | ogg · mp3 · wav (짧게) |

- 저작권: 직접 만들었거나 사용 허락(라이선스)을 받은 파일만 넣어 주세요.
- 파일을 못 읽으면 조용히 원래 그림 · 소리로 돌아갑니다.
