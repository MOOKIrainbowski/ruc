# 배포 가이드 (Vercel)

> 저장소: https://github.com/MOOKIrainbowski/ruc (비공개)
> 사이트 소스: `web/` 폴더

---

## 현재 상태

| 단계 | 상태 |
|---|---|
| git 초기화 + `.gitignore` | ✅ 완료 |
| 첫 커밋 (48개 파일) | ✅ 완료 — `26bdbc1` |
| GitHub 원격 연결 | ✅ 완료 |
| `main` 브랜치 push | ✅ 완료 |
| Vercel 프로젝트 연결 | ⬜ **소유자 계정 필요** |

---

## 이미 겪은 오류: `failed to push some refs`

### 원인

```
fatal: your current branch 'main' does not have any commits yet
```

**커밋이 하나도 없는 상태에서 push했기 때문입니다.** `git remote add` → `git branch -M main` → `git push`는 실행됐지만, 그 사이의 `git add` + `git commit`이 빠져 있었습니다. 보낼 커밋이 없으니 push가 거부된 것입니다.

### 해결

```bash
git add .
git commit -m "커밋 메시지"
git push -u origin main
```

### 같은 오류의 다른 원인들 (참고)

이 메시지는 원인이 여러 개라 헷갈리기 쉽습니다. 앞으로 다시 만나면 아래를 순서대로 확인하세요.

| 원인 | 확인 방법 | 해결 |
|---|---|---|
| **커밋이 없음** (이번 경우) | `git log` → "does not have any commits yet" | `git add .` + `git commit` |
| 원격에 내가 없는 커밋이 있음 | `git ls-remote --heads origin`에 브랜치가 있음 | `git pull --rebase origin main` 후 재시도 |
| 저장소 생성 시 README 체크함 | 위와 동일 | 위와 동일 |
| 브랜치 이름 불일치 | `git branch --show-current` | `git branch -M main` |
| 인증 실패 | 오류에 `Authentication failed` 포함 | GitHub 토큰/자격증명 재설정 |

**핵심: `failed to push some refs`는 증상일 뿐입니다. 바로 윗줄에 나오는 실제 원인 문구를 읽어야 합니다.**

---

## 남은 작업 — Vercel 연결

계정 로그인이 필요해서 직접 하셔야 합니다.

### 1. 프로젝트 import

1. [vercel.com](https://vercel.com) → **Continue with GitHub**
2. **Add New... → Project**
3. `ruc` 저장소 → **Import**
   - 목록에 없으면 **Adjust GitHub App Permissions**에서 `ruc` 접근 권한 부여
     (비공개 저장소라 권한을 따로 줘야 할 수 있습니다)

### 2. ⚠️ Root Directory 설정 — 가장 중요

| 항목 | 값 |
|---|---|
| Framework Preset | Next.js *(자동 감지)* |
| **Root Directory** | **`web`** ← Edit 눌러 직접 변경 |
| Build / Output / Install Command | 전부 비워두기 |

저장소 루트에는 `package.json`이 없습니다. 이걸 안 바꾸면:

```
Error: No Next.js version detected.
```

### 3. Project Name (선택)

기본값은 `ruc` → 주소가 `ruc.vercel.app`이 됩니다.
`ruc-server.vercel.app`을 원하시면 Project Name을 `ruc-server`로 바꾸세요. (저장소 이름과 달라도 무방합니다.)

### 4. 환경변수

| Name | Value |
|---|---|
| `NEXT_PUBLIC_MC_ADDRESS` | `play.rucserver.kr` |
| `MC_HOST_HOME` / `_RAID` / `_WAR` / `_PEACE` | *(지금은 비워둠 — Phase 2 이후)* |

값이 없으면 "서버 준비 중"으로 표시되고 사이트는 정상 동작합니다.

> **환경변수를 나중에 수정하면 반드시 재배포해야 반영됩니다.**
> 특히 `NEXT_PUBLIC_` 접두사 변수는 빌드 시점에 코드로 박히기 때문에, 값만 고치고 재배포를 안 하면 옛 값이 계속 보입니다.

### 5. Deploy

1~2분 소요. 완료 후 아래 경로를 확인하세요.

| 경로 | 내용 |
|---|---|
| `/` | 한국어 랜딩 |
| `/en` | 영어 랜딩 |
| `/status` | 한국어 서버 상태 |
| `/en/status` | 영어 서버 상태 |
| `/api/status` | JSON |

---

## 이후 운영

```bash
git add .
git commit -m "설명"
git push
# → 1~2분 뒤 자동 반영
```

| 브랜치 | 결과 |
|---|---|
| `main` | 운영 배포 (실제 주소 갱신) |
| 그 외 | 미리보기 배포 (임시 URL, 운영 영향 없음) |

**롤백**: Deployments → 이전 배포 → ⋯ → Promote to Production
빌드가 실패하면 배포되지 않고 이전 버전이 유지되므로, 사이트가 깨진 채 남을 일은 없습니다.

---

## ⚠️ 요금제 주의 (Phase 8 관련)

Vercel 무료(Hobby) 플랜은 **약관상 상업적 사용을 금지**합니다.

- 지금처럼 홍보 페이지만 → **문제 없음**
- Phase 8에서 구독·결제를 사이트에 붙이면 → **Pro 플랜 필요 (월 $20 수준)**

결제를 외부 플랫폼(Ko-fi 등)으로 빼고 사이트는 링크만 걸면 계속 무료로 운영 가능합니다. `02-OPEN-QUESTIONS.md` Q5와 연결되는 사항입니다.
