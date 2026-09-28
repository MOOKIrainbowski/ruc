// Source RCON 클라이언트. 사용법: node rcon.js <포트> "<명령>" ["<명령>" ...]
// 비밀번호는 로컬 개발 규칙(ruc-<서버>-local-dev)에서 포트로 역산합니다.
const net = require('net');

const PORT_TO_NAME = {
  25576: 'home',
  25577: 'raid',
  25578: 'war',
  25579: 'peace',
};

const port = Number(process.argv[2]);
const commands = process.argv.slice(3);
const name = PORT_TO_NAME[port];
if (!name || commands.length === 0) {
  console.error('사용법: node rcon.js <25576|25577|25578|25579> "<명령>" ...');
  process.exit(2);
}
const password = `ruc-${name}-local-dev`;

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;

function packet(id, type, body) {
  const payload = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + payload.length);
  buf.writeInt32LE(10 + payload.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  payload.copy(buf, 12);
  return buf;
}

const socket = net.connect(port, '127.0.0.1');
let pending = Buffer.alloc(0);
let step = -1; // -1 = 인증 대기

socket.on('connect', () => socket.write(packet(0, SERVERDATA_AUTH, password)));

socket.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const size = pending.readInt32LE(0);
    if (pending.length < 4 + size) break;
    const id = pending.readInt32LE(4);
    const body = pending.slice(12, 4 + size - 2).toString('utf8');
    pending = pending.slice(4 + size);

    if (step === -1) {
      if (id === -1) {
        console.error('인증 실패 — 비밀번호를 확인하세요.');
        process.exit(1);
      }
      step = 0;
      next();
      continue;
    }
    console.log(`[${commands[step]}]`);
    console.log(body.length ? body : '(빈 응답)');
    step += 1;
    next();
  }
});

function next() {
  if (step >= commands.length) {
    socket.end();
    return;
  }
  socket.write(packet(step + 1, SERVERDATA_EXECCOMMAND, commands[step]));
}

socket.on('error', (e) => {
  console.error('연결 실패:', e.message);
  process.exit(1);
});
