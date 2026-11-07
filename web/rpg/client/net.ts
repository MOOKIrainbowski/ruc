import { WS_PORT } from "../shared/constants";
import type { C2S, S2C } from "../shared/protocol";

/** 게임 서버 연결. 티켓 발급 → WSS 접속 → hello. 핑은 2초마다, 최근 5회 평균 (§2-2). */
export class Net {
  ws: WebSocket | null = null;
  rtt = 0;
  /** 입력 순번 — 맵 · 채널을 옮겨도 이어짐 (서버 lastSeq 와 맞춤, DECISIONS D12) */
  seq = 0;
  private samples: number[] = [];
  private pingTimer = 0;
  onMessage: (m: S2C) => void = () => {};
  onClose: (code: number) => void = () => {};

  async connect(dev?: string) {
    const res = await fetch(`/api/rpg/ticket${dev ? `?dev=${encodeURIComponent(dev)}` : ""}`, { method: "POST" });
    if (!res.ok) throw new Error(res.status === 401 ? "로그인이 필요합니다" : "입장 티켓을 받지 못했습니다");
    const { ticket } = await res.json();
    const url = process.env.NEXT_PUBLIC_RPG_WS_URL || `ws://${location.hostname}:${WS_PORT}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    await new Promise<void>((ok, fail) => {
      ws.onopen = () => ok();
      ws.onerror = () => fail(new Error("게임 서버에 연결하지 못했습니다"));
    });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as S2C;
      if (m.t === "pong") {
        this.samples = [...this.samples.slice(-4), performance.now() - m.c];
        this.rtt = Math.round(this.samples.reduce((a, b) => a + b, 0) / this.samples.length);
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = (e) => {
      clearInterval(this.pingTimer);
      this.onClose(e.code);
    };
    this.send({ t: "hello", ticket });
    const ping = () => this.send({ t: "ping", c: performance.now(), r: this.rtt });
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }

  send(m: C2S) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
