# 러크 서버 웹사이트

Next.js 15 (App Router) + Tailwind v4. 한국어 기본 / 영어 지원.

## 로컬 실행

```bash
cd web
npm install
npm run dev       # http://localhost:3000
```

빌드 확인:

```bash
npm run build && npm run start
```

## URL 규칙 (§7.8)

새 페이지를 추가할 때 **반드시 이 규칙을 따르세요.** 페이지가 늘어나도 구조가 예측 가능해야 합니다.

| 경로 | 내용 |
|---|---|
| `/` | 랜딩 페이지 (한국어) |
| `/en` | 랜딩 페이지 (영어) |
| `/status` | 실시간 서버 상태 (한국어) |
| `/en/status` | 실시간 서버 상태 (영어) |
| `/api/status` | 서버 상태 JSON API |

**규칙: 한국어는 루트에, 영어는 `/en` 접두사.**
새 페이지 `foo`를 추가하면 → `app/foo/page.tsx` + `app/en/foo/page.tsx`, 둘 다 `components/Foo.tsx`에 `lang` prop만 다르게 넘깁니다. 문안은 전부 `lib/content.ts`에 ko/en 쌍으로 넣습니다 (타입이 누락을 막아줍니다).

## 환경변수

`.env.example`을 `.env.local`로 복사해서 채우세요. **값이 없으면 해당 서버는 "준비 중"으로 표시**되고 사이트는 정상 동작합니다.

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_MC_ADDRESS` | 화면에 표시할 접속 주소 |
| `MC_HOST_HOME` / `_RAID` / `_WAR` / `_PEACE` | 상태 조회용 실제 호스트:포트 |

서버 상태는 [mcstatus.io](https://mcstatus.io) 공개 API로 조회합니다.
raw TCP 핑을 쓰지 않는 이유: Vercel 서버리스에서 임의 포트 TCP 소켓은 콜드스타트마다 타임아웃이 나서 불안정합니다.

## Vercel 배포 (§7.7)

1. 이 저장소를 GitHub에 푸시 (**`.env`가 `.gitignore`에 있는지 반드시 확인**)
2. [vercel.com/new](https://vercel.com/new) → GitHub 저장소 import
3. **Root Directory**를 `web`으로 지정 (저장소 루트가 아닙니다 — 중요)
4. Framework Preset: Next.js (자동 감지됨)
5. Environment Variables에 위 변수들 입력
6. Deploy

이후 `git push`하면 자동 재배포됩니다.

## 디자인 시스템

- **폰트**: Galmuri11 (SIL OFL 1.1, © Lee Minseo / quiple) — `public/fonts/`에 자체 호스팅.
  한글을 지원하는 픽셀 폰트라서 선택했습니다. Silkscreen 같은 영문 전용 픽셀 폰트는 한글이 깨집니다.
  큰 숫자는 11의 정수배(22px, 33px)에서 가장 또렷합니다.
- **팔레트**: `--color-ruc-300 (#bad953)` / `--color-ruc-400 (#93e93e)` — §7.1 지정색
- **글래스모피즘**: `.glass`, `.glass-strong`, `.glass-nav` 유틸리티 (`app/globals.css`)
- **배경**: `web_background/candidate_2.png` → 1600px JPEG로 압축(4.59MB → 126KB) 후 CSS blur 적용

## 구조

```
app/
  layout.tsx            폰트 preload, 배경 레이어, 메타데이터
  page.tsx              / (ko 랜딩)
  en/page.tsx           /en
  status/page.tsx       /status
  en/status/page.tsx    /en/status
  api/status/route.ts   상태 API (30초 캐시)
  globals.css           디자인 시스템 전체
components/
  Nav.tsx               상단 프로스티드 네비 + KO/EN 토글
  Landing.tsx           랜딩 11개 섹션 + Footer
  StatusDashboard.tsx   실시간 상태 대시보드
  StatusStrip.tsx       히어로 아래 얇은 상태 띠
  useStatus.ts          /api/status 폴링 훅 (45초)
lib/
  content.ts            ko/en 문안 전체 — 여기만 고치면 됩니다
  servers.ts            서버 상태 조회
```
