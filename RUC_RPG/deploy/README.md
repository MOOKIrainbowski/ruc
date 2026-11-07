# 운영 게임 서버 — 오라클 클라우드 무료 VM

러크 웹사이트(Vercel)는 실시간 게임 서버(웹소켓)를 직접 돌리지 못해서, 게임 서버는 따로 둔 기계에서 돌립니다.
무료로 24시간 켜 둘 수 있는 곳은 **오라클 클라우드 Always Free VM** 뿐이라 이걸 씁니다 (2026-11 조사: Render · Koyeb 무료는
쉬는 동안 잠들고 디스크가 지워짐, Railway · Fly.io 는 무료 등급이 없어짐).

```
브라우저 ─ https ─ ruc-server.vercel.app (웹, Vercel)
        └ wss ─── <IP>.sslip.io (오라클 VM: Caddy 가 HTTPS 인증서 자동 → 게임 서버 :2567)
```

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
