# 운영 게임 서버 — 이 PC 에서 (2026-11-09 사용자 결정, P18 · D105)

러크 웹사이트(Vercel)는 실시간 게임 서버(웹소켓)를 직접 돌리지 못해서, 게임 서버는 **운영자 PC** 에서 돌립니다.
PC 가 켜져 있고 "서버 켜기"를 눌렀을 때만 열리고, 꺼져 있으면 `/rpg` 가 "게임 서버가 꺼져 있어요"를 보여 줍니다.

```
브라우저 ─ https ─ ruc-server.vercel.app (웹, Vercel)
        └ wss ─── <PC 이름>.<tailnet>.ts.net (Tailscale Funnel: 인증서 · 공개) → 이 PC 127.0.0.1:2580 (게임 서버)
```

## 소유자가 할 일 (처음 한 번 — 계정 · 비밀값이 필요해서)

1. **Tailscale 로그인** — 이 PC 에는 이미 설치돼 있음(1.102). `RUC_RPG/deploy/pc/setup-pc.ps1` 을 우클릭 → "PowerShell 에서 실행"
   (또는 터미널에서 `powershell -ExecutionPolicy Bypass -File RUC_RPG\deploy\pc\setup-pc.ps1`)
   - 브라우저가 열리면 Tailscale 에 로그인(구글 · MS · 깃허브 계정, 무료)
   - **Funnel 허용** 링크가 나오면 열어서 허용 → 스크립트를 한 번 더 실행
2. 스크립트가 알려 주는 값을 **Vercel → Settings → Environment Variables (Production)** 에 넣기
   - `NEXT_PUBLIC_RPG_WS_URL` = `wss://<PC 이름>.<tailnet>.ts.net` (화면에 나옴)
   - `RPG_TICKET_SECRET` = 스크립트가 **클립보드에 복사**해 둔 값(화면에는 안 나옴) — 값 칸에 Ctrl+V
   - 넣은 뒤 Vercel 에서 **Redeploy** → `/rpg` 가 "오픈 준비 중"에서 입장으로 바뀜
3. (선택) 운영자 GM 권한: `RUC_RPG/deploy/live.env` 의 `RPG_GM_IDS=` 에 본인 디스코드 ID

## 평소 운영

- **켜기**: 바탕화면 **"러크 RPG 서버 켜기"** — 창이 하나 열리고, 그 창이 열려 있는 동안 서버가 돎. 오류로 멈추면 5초 뒤 자동으로 다시 켬
- **끄기**: 바탕화면 **"러크 RPG 서버 끄기"** — 접속자를 내보내고 저장 · 백업한 뒤 종료(Funnel 도 끔). 창을 그냥 닫아도 꺼지지만 마지막 30초 사이 진행은 잃을 수 있음
- PC 를 끄면 서버도 꺼짐 → `/rpg` 는 "게임 서버가 꺼져 있어요 — 운영자의 PC 가 켜져 있을 때만 열립니다"
- 데이터: `C:\RucRpg\data\live.sqlite` (OneDrive 밖 — 동기화가 DB 를 건드리지 않게) · 백업 `C:\RucRpg\backups\` (끌 때 + 6시간마다, 최근 28개) · 로그 `C:\RucRpg\logs\`
- 포트: 운영 2580(127.0.0.1 에서만, 공개는 Funnel 이), 개발 서버 2567 은 그대로 따로 씀
- 코드를 바꾼 뒤: 서버를 껐다 켜면 새 코드 (웹은 `git push` 로 Vercel 이 배포)

## 문제가 생기면
- `/rpg` 가 계속 "꺼져 있어요": 서버 창이 열려 있는지 → 브라우저로 `https://<PC 이름>.<tailnet>.ts.net/` 을 열어 `{"ok":true,…}` 가 나오는지 → 안 나오면 `tailscale funnel status`
- 로그: `C:\RucRpg\logs\server-날짜.log`

---

## (예전 계획) 오라클 클라우드 무료 VM

24시간 켜 두고 싶어지면 이쪽 — 아래는 이전에 준비해 둔 방법입니다(`deploy.sh` · `setup.sh`).

## 소유자가 할 일 (계정 · 결제 정보가 필요해서)

1. **가입** — https://www.oracle.com/kr/cloud/free/ → "무료로 시작하기"
   - 카드 인증이 있지만 Always Free 자원만 쓰면 청구되지 않습니다
   - **홈 리전: South Korea Central (Seoul)** — 가입 뒤에는 바꿀 수 없고, 무료 VM 은 홈 리전에서만 만들어집니다
2. **VM 만들기** — 메뉴 → 컴퓨트 → 인스턴스 → 인스턴스 생성
   - 이미지: **Canonical Ubuntu 24.04**
   - 구성(Shape): **Ampere · VM.Standard.A1.Flex, 1 OCPU · 6GB** ("Always Free 적격" 표시).
     "용량 부족"이 뜨면 **AMD · VM.Standard.E2.1.Micro** (역시 Always Free, 이 게임 서버엔 충분)
   - 네트워킹: 새 VCN · 공용 서브넷, **공용 IPv4 주소 지정** 켜기
   - SSH 키: **공개 키 붙여넣기** → `C:\Users\hanse\.ssh\ruc_rpg_oracle.pub` 를 메모장으로 열어 한 줄 전체를 붙여넣기
     (개인 키는 이 PC 에만 있음 — 배포할 때 씀)
3. **포트 열기** — 만든 인스턴스 → 서브넷 → 보안 목록(Default Security List) → 수신 규칙 추가 2개:
   소스 `0.0.0.0/0`, IP 프로토콜 TCP, 대상 포트 `80` / `443`
4. **공용 IP 주소**(인스턴스 상세 화면)를 알려 주세요
5. **Vercel 환경변수** (Settings → Environment Variables, Production)
   - `RPG_TICKET_SECRET` = `RUC_RPG/deploy/live.env` 의 `RPG_TICKET_SECRET=` 뒤 값 그대로
   - `NEXT_PUBLIC_RPG_WS_URL` = `wss://<공용 IP 의 점을 - 로 바꾼 것>.sslip.io` (예: IP 140.238.1.2 → `wss://140-238-1-2.sslip.io`)

## 그다음 (Claude 가 함)

```bash
echo "RUC_RPG_VM=ubuntu@<공용 IP>" > RUC_RPG/deploy/vm.env   # 커밋 안 됨
bash RUC_RPG/deploy/deploy.sh --setup    # 처음 한 번: Node 24 · Caddy · 방화벽 · 서비스 · 비밀값
bash RUC_RPG/deploy/deploy.sh            # 그 뒤 단계마다: 코드 올리기 → 재시작 → https://<호스트>/ 상태 확인
```
- 웹은 `git push origin main` 으로 Vercel 이 배포. 두 환경변수가 들어간 뒤 첫 배포부터 `/rpg` 가 "오픈 준비 중"에서 입장으로 바뀝니다 (`web/lib/rpg.ts`)
- 게임 DB(`RUC_RPG/server/data/rpg.sqlite`)는 VM 에 남고 배포 때 덮어쓰지 않습니다. 로컬 개발 DB 와는 별개
- 서버 상태: `ssh -i ~/.ssh/ruc_rpg_oracle ubuntu@<IP> 'systemctl status ruc-rpg; journalctl -u ruc-rpg -n 50'`
