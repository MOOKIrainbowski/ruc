#!/usr/bin/env bash
# 게임 서버 코드를 오라클 VM 에 올리고 다시 시작합니다 (Git Bash 에서). 각 개발 단계를 확인한 뒤 웹 배포와 함께 씀.
#   bash RUC_RPG/deploy/deploy.sh            코드 올리기 + 재시작 + 상태 확인
#   bash RUC_RPG/deploy/deploy.sh --setup    처음 한 번: VM 준비(setup.sh) + 비밀값(live.env) 올리기
# 접속 정보는 RUC_RPG/deploy/vm.env (커밋 안 됨): RUC_RPG_VM=ubuntu@<공인 IP>
set -euo pipefail
cd "$(dirname "$0")/../.."
source RUC_RPG/deploy/vm.env
KEY="${RUC_RPG_KEY:-$HOME/.ssh/ruc_rpg_oracle}"
IP="${RUC_RPG_VM#*@}"
HOST="${IP//./-}.sslip.io"
ssh_vm() { ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$RUC_RPG_VM" "$@"; }

if [[ "${1:-}" == "--setup" ]]; then
  ssh_vm 'bash -s' -- "$HOST" < RUC_RPG/deploy/setup.sh
  ssh_vm 'mkdir -p /opt/ruc/RUC_RPG/server && cat > /opt/ruc/RUC_RPG/server/.env && chmod 600 /opt/ruc/RUC_RPG/server/.env' < RUC_RPG/deploy/live.env
fi

# 서버가 쓰는 것만: 서버 코드 + 공용 코드 (DB · 비밀값 · node_modules 는 VM 에 그대로 둠)
tar --exclude=node_modules --exclude=data --exclude=.env --exclude='*.sqlite*' --exclude='test' -czf - RUC_RPG/server web/rpg/shared |
  ssh_vm 'tar -xzf - -C /opt/ruc && cd /opt/ruc/RUC_RPG/server && npm ci --omit=dev --no-audit --no-fund --loglevel=error && sudo systemctl restart ruc-rpg && sleep 3 && systemctl is-active ruc-rpg'
curl -fsS --max-time 20 "https://$HOST/" && echo && echo "게임 서버: wss://$HOST"
