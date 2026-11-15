# MC RPG 텍스처 심층 리서치 (2026-11-16)

작업 14를 시작하기 전, 저장소 생성기·리소스팩·제공된 1.21.11 바닐라 에셋을 확인하고 외부 형식 자료를 대조했다. 링크된 BetterHud 글은 텍스처 자체 복제 대상이 아니라 레이어링/체력 비율 표시 방식 참고로만 사용한다.

## 확인된 문제

- `RUC_RPG/scripts/mc-models.ts`의 `textureFor()`는 모든 뼈 텍스처를 32×32로 고정하고 16×16 네 구역에 앞/옆/뒤/윗면을 넣는다. `centeredElement()`은 크기와 무관하게 모든 면에 동일한 8×8 UV 구역을 적용하고, `parts`도 부모 뼈 텍스처를 공유한다. 즉 큰 몸통과 작은 눈/장식이 같은 픽셀 밀도와 같은 그림을 공유하지 않아 형태에 따라 눌림·반복 줄무늬·면 혼합이 발생한다.
- 현재 웹 전투 몹 원화는 `web/rpg/client/art/mobs.ts`의 32px 프레임이다. 기존 렌더 비교 `.scratch/codex/mc-models/v2/wolf_front-side-45.png`에서 원화는 단순한 옆모습인데 모델 정면은 몸통 띠와 다리 블록이 강하게 드러난다. 제공 원본 `.scratch/vanilla-1.21.11/assets/minecraft/textures/entity/wolf/wolf.png`도 전용 UV 시트이며, 의도적인 면 경계와 큰 색 덩어리가 일관된다.
- 각 뼈의 `_hurt.png`는 기본 그림의 RGB를 매 픽셀 빨갛게 바꾼 별도 그림이다. 이 방식은 프레임마다 같은 실루엣을 재생성하고, 색 디테일을 손실시키며, 기본/피격 전환에서 서로 다른 자산을 교체하게 한다.

## 조사 결론

1. **픽셀 밀도는 모델 단위로 고정한다.** Blockbench 스타일 안내는 Minecraft에서 texture pixel과 model unit을 1:1로 보존해 늘이거나 눌러 그리지 말라고 설명한다. 이 프로젝트에서는 Item Model 좌표계의 1 model unit당 1 texel을 기준으로 삼는다. 각 직육면체의 각 면에 실제 폭·높이에 맞춘 별도 UV 직사각형을 주고, 정수 격자에 최근접 매핑한다. 모델의 크기 변화는 UV 해상도를 바꾸지 않는다. 작은 눈/장식은 해당 part의 전용 작은 텍스처를 써서 몸통 그림이 반복되지 않게 한다.
2. **Minecraft식 명암을 단순하게 유지한다.** Fresh Animations는 16x 스타일을 유지하며, Blockbench는 서로 다른 밀도의 디테일을 한 모델에 섞는 “mixels”를 피하라고 권한다. 이 RPG 자산도 웹 원화의 외곽선·제한 팔레트·좌상단 하이라이트·하단/옆면의 한 단계 그늘을 쓰고, 절차적 무작위 점을 빼며, 얼굴·장식은 실제 해당 뼈 영역에서 그린다. 반투명은 필요할 때 가장자리만 쓰고 면 내부와 시트 패딩은 불투명하게 두어 mipmap의 투명 색 번짐을 줄인다.
3. **피격은 geometry/texture 교체가 아닌 모델 tint로 표시한다.** Mojang의 1.21.4 item model 형식에서 `tints[0]`은 `tintindex: 0` 면에 적용되고, `minecraft:custom_model_data` tint는 item의 `custom_model_data.colors[0]`을 읽는다. 따라서 같은 base PNG를 유지하고 모든 모델 면에 `tintindex: 0`을 둔다. 기존 Java 계약의 `hurtModel` ID는 남겨 호환하고 `_hurt` 아이템 정의에 붉은 기본 tint(예: `0xFF6666`)를 지정한다. Claude 측 ItemDisplay는 피격 중 그 ID를 선택하고, 색 배열을 쓰는 경우 같은 RGB를 `custom_model_data.colors[0]`에 전달해야 한다. 1.21.11의 실제 데이터 컴포넌트·렌더는 Claude가 로컬 클라이언트로 최종 확인한다. 참고로 바닐라 living entity의 red hurt overlay는 별도 hurt texture가 아니라 render overlay 상태로 처리된다.
4. **체력바는 바탕 위에 왼쪽부터 채워지는 두 레이어로 만든다.** 사용자 참고 게시물은 빈 바를 아래 레이어에 두고, 현재 체력 이미지를 위에 얹으며, 20칸 분할·왼쪽 방향 채움을 설명한다. 이를 그대로 구조 참고로 삼아 `hpbar_back`(어두운 홈/외곽) + `hpbar_frame`(픽셀 테두리) + 흰색 명암 `hpbar_fill`로 분리한다. Fill은 가로 확대에 견디도록 반복 타일/9-slice 대신 1px 높이의 가로 막대 텍셀을 좌→우로 표시하는 용도다. 원본 이미지 파일은 브라우저의 첨부 다운로드 링크가 Cache miss를 반환해 열지 못했으므로, 색·픽셀을 복제하지 않고 본문 설명의 레이어/방향/분할 아이디어만 참고한다.
5. **장신구 회색은 제공된 1.21.11 클라이언트 PNG의 픽셀값에서 가져온다.** `.scratch/vanilla-1.21.11/assets/minecraft/textures/gui/sprites/container/slot/helmet.png` 등이 빈 방어구 칸의 현재 vanilla 에셋이다. `helmet.png`의 빈 픽셀을 제외한 주 잉크는 RGB `#555555`, alpha `255`로 측정됐다. 반지·목걸이 아이콘은 이 정확한 값으로 재생성했다.

## 모델 JSON과 렌더 경계

- `elements[*].faces[*].uv`는 각 면의 사각형을 명시한다. 다시 그릴 때 북/남은 X×Y, 동/서는 Z×Y, 위/아래는 X×Z 치수를 바탕으로 face 전용 영역을 할당한다. 얇은 면은 얇은 UV로 만들어 전체 그림을 스트레치하지 않는다.
- `minecraft:item/generated`는 아이템 2D 레이어의 부모다. 여기에 3D `elements`를 섞지 말고, 현재처럼 raw item model JSON의 `elements`를 유지한다. `ItemDisplayTransform.NONE`은 display transform preset을 선택하지 않으므로 생성 모델 변환에 기대지 말고, Java가 현재 기록한 origin/pivot/scale 계약을 사용한다.
- 알파 텍스처는 작은 mipmap 단계에서 옆 픽셀 색이 가장자리에 섞일 수 있다. 모델 UV 경계에는 투명 픽셀을 직접 걸치지 않고 동일 면 색으로 패딩하며, 생성 이미지의 알파·크기 검사를 둔다.

## 참고 자료

- [Blockbench — Minecraft Style Guide](https://blockbench.net/wiki/guides/minecraft-style-guide/): 1 pixel ↔ 1 model unit 원칙, box/per-face UV, mixel 주의.
- [Fresh Animations 공식 사이트](https://fresh-animations.com/): 16x 리소스팩 사례와 모델 기능 의존성. 이 작업에서는 애니메이션/모델 코드를 가져오지 않는다.
- [Mojang — Minecraft Java Edition 1.21.4 변경점](https://www.minecraft.net/ja-jp/article/minecraft-java-edition-1-21-4): item model 정의, `tintindex`와 custom model data tint 데이터 구조.
- [Minecraft Wiki — Model](https://minecraft.wiki/w/Model): raw model의 `elements`, face UV 및 tintindex 설명.
- [Minecraft Wiki — Items model definition](https://minecraft.wiki/w/Items_model_definition): 모델 정의의 tint source와 custom model data 색 배열.
- [Minecraft Wiki — Entity data](https://minecraft.wiki/w/Entity_data): `HurtTime`은 피격 뒤 붉게 보이는 지속 시간.
- [BetterHud 사용법 3 — 이미지 레이아웃으로 체력바 만들기](https://gall.dcinside.com/mgallery/board/view/?id=steve&no=325777): 빈 바와 채움 레이어, 좌측에서 줄어드는 20분할 구성. 첨부 이미지는 다운로드하지 않았다.

## 구현 계획

- `mc-models.ts`에서 본체와 part별 텍스처/face UV 밀도를 고정하고, 기본/피격 모델이 같은 픽셀 텍스처를 사용하도록 한다. `_hurt`는 기존 모델 ID를 유지하고 `items` tint 계약만 추가해 Java가 피격 색을 지정할 수 있게 한다.
- 웹 원화가 있는 몹은 원화 실루엣·팔레트를 우선 보존한다. NPC는 전신 원화가 없으므로 제한된 팔레트와 해부학적 면 구분(머리/몸통/옷/장식)을 안정적인 픽셀 패턴으로 만든다.
- `fx/hpbar_frame`, `fx/hpbar_fill`, `fx/hpbar_back`을 생성한다. 또한 `ui/slot_ring1`, `ui/slot_necklace`를 바닐라 빈 방어구 슬롯 PNG에서 추출한 정확한 grayscale/alpha 기준으로 다시 만든다.
- 전체 몹/NPC 생성, 패키지 검사, 비교 PNG를 확인한다. 실제 게임 hit overlay와 체력바 길이/배치는 Java 소유 단계라 Codex는 확인하지 않는다.
