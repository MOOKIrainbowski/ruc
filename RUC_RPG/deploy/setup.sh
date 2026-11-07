#!/usr/bin/env bash
# 오라클 클라우드 무료 VM(Ubuntu, x86 또는 ARM)에서 한 번만 실행: Node 24 · Caddy(자동 HTTPS) · 방화벽 · 게임 서버 서비스.
#   bash setup.sh <호스트 이름>      예: bash setup.sh 140-238-1-2.sslip.io
# deploy.sh --setup 이 이 파일을 올려서 대신 실행합니다.
set -euo pipefail
HOST="${1:?호스트 이름 (예: 140-238-1-2.sslip.io)}"
NODE_VERSION=24.14.0

# Node 24 (nodejs.org 공식 배포본)
if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) echo "모르는 CPU $(uname -m)"; exit 1 ;; esac
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz" -o /tmp/node.tar.xz
  sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
fi

# Caddy (공식 저장소) — 인증서를 자동으로 받아 wss 를 열어 줌
if ! command -v caddy >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi
printf '%s {\n\treverse_proxy 127.0.0.1:2567\n}\n' "$HOST" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy || sudo systemctl restart caddy

# 오라클 우분투 이미지는 iptables 가 80 · 443 을 막아 둠 → 열기 (콘솔의 보안 목록도 따로 열어야 함, README)
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null ||
    sudo iptables -I INPUT 5 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
command -v netfilter-persistent >/dev/null && sudo netfilter-persistent save || true

# 게임 서버 서비스 — 꺼지면 3초 뒤 다시 켜짐, 부팅 때 자동 시작
sudo mkdir -p /opt/ruc && sudo chown "$USER" /opt/ruc
sudo tee /etc/systemd/system/ruc-rpg.service >/dev/null <<EOF
[Unit]
Description=Ruc RPG game server
After=network-online.target

[Service]
User=$USER
WorkingDirectory=/opt/ruc/RUC_RPG/server
ExecStart=/usr/local/bin/node --env-file-if-exists=.env src/main.ts
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable ruc-rpg
echo "준비 끝: https://$HOST"
