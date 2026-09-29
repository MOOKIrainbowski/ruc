// Source RCON 클라이언트. 사용법: node rcon.js <포트> "<명령>" ["<명령>" ...]
//
// 비밀번호는 그 서버의 server.properties(rcon.password)에서 읽습니다.
// 예전에는 "ruc-<서버>-local-dev" 규칙으로 역산했는데, 그 규칙이 문서와 이
// 파일에 적혀 공개 저장소에 올라가 있었습니다 — 비밀번호가 아니라 공지였습니다.
// server.properties 는 gitignore 라 여기서 읽으면 저장소에 비밀이 남지 않습니다.
//
// 환경변수 RCON_PASSWORD 가 있으면 그것을 씁니다 (비밀번호 교체 중처럼 파일과
// 실행 중인 서버가 다를 때).
const fs = require('fs');
const net = require('net');
const path = require('path');

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

function readPassword(server) {
  if (process.env.RCON_PASSWORD) return process.env.RCON_PASSWORD;
  const file = path.join(__dirname, '..', 'servers', server, 'server.properties');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`server.properties 를 읽지 못했습니다: ${file}`);
    process.exit(2);
  }
  // CRLF 입니다 — 줄 끝의 \r 은 trim() 이 지웁니다 (인수인계 §5.2).
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*rcon\.password\s*=(.*)$/);
    if (m) return m[1].trim();
  }
  console.error(`${file} 에 rcon.password 가 없습니다.`);
  process.exit(2);
}
const password = readPassword(name);

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
