# RPG_RECON — 기존 저장소 탐색 결과 (P0, 2026-11-07)

## 웹 (web/)
| 항목 | 내용 |
|---|---|
| 프레임워크 | Next.js 15 App Router + React 19 + Tailwind v4, TypeScript |
| 배포 | 로컬 → `git push` → Vercel (Root Directory = `web`). 서버리스라 상시 WebSocket 불가 |
| 라우팅 | `app/<경로>/page.tsx`. 한국어 루트, 영어 `/en`. `/` → `/landing` 임시 리디렉트 |
| `/home` | `app/home/page.tsx` 의 `CARDS` 배열 → 카드 그리드 (`glass` 클래스, `PageShell`) |
| 디자인 | 폰트 **Galmuri11**(OFL, `public/fonts/`, 라이선스 포함) · 브랜드 `--color-ruc-300 #bad953` / `--color-ruc-400 #93e93e` · 어두운 초록 배경 `#0a1207` · 글래스 패널 |

## 디스코드 로그인
- 자체 OAuth (NextAuth 아님). `GET /api/auth/login?next=/경로` → 디스코드 → `/api/auth/callback`
- 세션 = HMAC 서명 쿠키 `ruc_session` 하나 (`lib/session.ts`, 7일). 서버 저장소 없음
- `getSession()` → `{ id(디스코드 ID), name, avatar, admin, exp }`
- 비밀값: `SESSION_SECRET`, 없으면 `DISCORD_BOT_TOKEN` 에서 파생. 로컬 `.env.local` 에는 디스코드 값이 없어 **로컬에서는 실제 로그인 불가** → RPG 는 `next dev` 전용 개발 로그인을 둠 (DECISIONS D6)

## RUC · 우편함 · 계정 매핑 (MC 플러그인 RucCore)
- DB: 운영 **MySQL**, 로컬 H2(MySQL 모드). 4개 MC 서버가 같은 DB 공유 (`storage/Database.java`)
- `ruc_player(uuid, name, ruc, xp, level, reputation, discord_id, …)` — **RUC 잔액과 디스코드 ID ↔ MC UUID 매핑이 여기 있음**
- RUC 는 **실제 현금 충전 화폐** (10원 = 1 RUC, `web/content/wiki/economy.md`, MOOKI `/충전`)
- `ruc_mail(id, recipient, item(Base64), ruc, sender, reason, sent_at, expires_at, claimed_at)`
  - **행 하나 = 아이템 한 뭉치 또는 RUC 한 덩이**. 30일 만료. "모두 받기". 인벤 빈 칸 없으면 우편 유지
  - 수령은 `claimed_at IS NULL` 조건부 UPDATE 의 갱신 행 수로 판정 (이중 수령 방지)
- 디스코드 봇 MOOKI(`MOOKI/`)는 RCON 으로 MC 에 명령을 보냄. 자체 DB 없음(JSON 파일)

## 결론
- RPG 는 RUC_MODE=**beta** (사용자 확인 2026-11-07). 실제 `ruc_player.ruc` 는 건드리지 않음
- 우편함은 MC 와 같은 UX(30일 · 모두 받기 · 빈 칸 부족 시 유지 · 조건부 UPDATE 수령)로 맞추되,
  지시서 §15-5 의 "첨부 N개"는 MC 의 "행 하나 = 한 뭉치"와 다름 → P5 에서 rpg_mail + rpg_mail_items 로 하되 수령은 우편 단위 트랜잭션
- 게임 서버·DB 는 Vercel 밖 (운영자 PC + 터널 또는 서울 VPS — docs/05-HOSTING.md 의 iwinv VPS 와 같은 기계에 올릴 수 있음)
