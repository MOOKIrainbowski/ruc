# DECISIONS — 지시서와 다르게 정한 것 · 지시서가 비워 둔 것

| # | 지시서 | 결정 | 이유 |
|---|---|---|---|
| D1 | §17-1 RUC 모드 | **RUC_MODE=beta** 만 구현. live 연동 코드는 만들지 않음 | 사용자 확인(2026-11-07). RUC 는 현금 충전 화폐라 베타 버그가 실제 경제로 번지면 안 됨 |
| D2 | §0-2 `apps/rpg-client`, `packages/rpg-shared` | 클라이언트·공유 코드는 `web/rpg/client`, `web/rpg/shared`, 게임 서버는 `RUC_RPG/server` | Vercel 은 Root Directory(`web`) 안만 설치·빌드함. 공유 코드는 의존성 없는 TS 라서 서버가 상대 경로로 그대로 import |
| D3 | §2-1 Colyseus / uWebSockets | `ws` 패키지 + 직접 만든 방(Room) | 의존성 1개. 방 · 채널 · 틱 루프가 수십 줄이라 프레임워크가 필요 없음 |
| D4 | §2-2 바이너리 직렬화 | 베타는 JSON, 정수 좌표 | 디버깅이 쉬움. 대역폭이 §29 목표를 넘으면 P8 에서 MessagePack + 델타로 교체 |
| D5 | §2-1 PostgreSQL | 게임 서버는 Node 24 내장 `node:sqlite` (파일 1개), 테이블 이름은 `rpg_` 접두 그대로 | 설치할 DB 가 없음. 베타는 서버 1대라 충분. 정식 서비스 때 같은 스키마로 PostgreSQL 이전 |
| D6 | §2-3 로그인 | `next dev` 에서만 `/rpg?dev=이름` 개발 로그인 허용. 게임 서버는 `RPG_DEV=1` 일 때만 개발용 티켓 비밀값을 씀 | 로컬 `.env.local` 에 디스코드 OAuth 값이 없음. 운영(NODE_ENV=production)에서는 코드 경로 자체가 막힘 |
| D7 | §2-1 Canvas 폴백 | PixiJS v8 은 Canvas 렌더러가 없음 → WebGL/WebGPU 실패 시 안내 화면 | v8 에서 제거됨 |
| D8 | §25-3 빌드 스크립트로 아틀라스 PNG | 픽셀 아트를 코드로 그려 **실행 중에** 캔버스 아틀라스로 만듦. 에셋 ID 로만 참조 | 빌드 단계 · `pngjs` 의존성이 없어짐. 실제 PNG 가 오면 같은 ID 로 로더만 바꿈 |
| D9 | §2-2 입력 | 클라이언트는 60Hz 고정 스텝으로 입력을 보내고, 서버는 20Hz 틱마다 쌓인 입력을 처리(틱당 크레딧 3, 최대 9) | 20Hz 입력은 체감 지연이 큼. 크레딧으로 속도 핵(입력 과다 전송)을 막음 |
| D10 | §26-1 JSON 데이터 | 밸런스 데이터는 `web/rpg/shared/data/*.ts` (타입 있는 TS 객체), 맵만 Tiled JSON | 브라우저 번들과 Node 양쪽에서 import 방식 차이가 없음. 타입이 zod 검증 역할을 함 |
| D11 | §2-2 "위치는 정수 px" | 타 엔티티 스냅샷은 정수, 내 캐릭터 ack 만 실수 그대로 | 예측 재생은 서버 값과 비트 단위로 같아야 떨림이 없음. JSON 은 double 을 정확히 왕복시킴 |
