// 마인크래프트 서버 상태 조회 (Server List Ping)
//
// ── 왜 직접 구현하는가 ────────────────────────────────────────────────
// `minecraft-server-util` 은 유지보수가 멈췄고, 외부 상태 API(mcstatus.io 등)는
// 이 봇이 **같은 기계 안의 127.0.0.1** 을 볼 수 없게 만듭니다. 지금 서버가
// 로컬 테스트 서버이므로 외부 API 로는 아예 조회가 안 됩니다.
//
// SLP 는 TCP 소켓 하나에 패킷 두 개면 끝나는 단순한 규격이라, 의존성을 하나
// 더 들이는 것보다 여기 100줄이 낫습니다. 나중에 호스팅으로 옮겨도 주소만
// 바꾸면 그대로 동작합니다.
//
// ── 주소는 설정에서 옵니다 ────────────────────────────────────────────
// MC_STATUS_HOST / MC_STATUS_PORT. 비워 두면 RUC_RCON_HOST 와 25565 를 씁니다.
// 로컬 테스트 서버 → 호스팅으로 옮길 때 .env 한 줄만 고치면 됩니다.

const net = require('net');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

/** 상태 조회 제한 시간 (ms). 서버가 죽어 있으면 빨리 포기해야 합니다. */
const TIMEOUT_MS = 4000;

// ── 설정 ──────────────────────────────────────────────────────────────

function address() {
    return {
        host: process.env.MC_STATUS_HOST || process.env.RUC_RCON_HOST || '127.0.0.1',
        port: parseInt(process.env.MC_STATUS_PORT || '25565', 10),
        // 사람에게 보여 줄 주소. 내부 IP 를 그대로 보여 주면 안 되는 경우가
        // 많아서 따로 둡니다 (예: play.rucserver.kr).
        display: process.env.MC_PUBLIC_ADDRESS
            || `${process.env.MC_STATUS_HOST || '127.0.0.1'}:${process.env.MC_STATUS_PORT || '25565'}`,
    };
}

// ── 프로토콜 도구 ─────────────────────────────────────────────────────

/** 마크 프로토콜의 VarInt 인코딩. */
function varInt(value) {
    const bytes = [];
    let v = value;
    do {
        let byte = v & 0x7f;
        v >>>= 7;
        if (v !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (v !== 0);
    return Buffer.from(bytes);
}

/** 버퍼에서 VarInt 를 읽습니다. @returns {{value, size}|null} */
function readVarInt(buffer, offset = 0) {
    let value = 0;
    let size = 0;

    while (true) {
        if (offset + size >= buffer.length) return null;   // 아직 덜 왔습니다
        const byte = buffer[offset + size];
        value |= (byte & 0x7f) << (7 * size);
        size++;
        if ((byte & 0x80) === 0) break;
        if (size > 5) throw new Error('VarInt 가 너무 깁니다');
    }
    return { value, size };
}

function packet(id, ...payloads) {
    const body = Buffer.concat([varInt(id), ...payloads]);
    return Buffer.concat([varInt(body.length), body]);
}

function mcString(text) {
    const buf = Buffer.from(text, 'utf8');
    return Buffer.concat([varInt(buf.length), buf]);
}

// ── 조회 ──────────────────────────────────────────────────────────────

/**
 * 서버 상태를 묻습니다.
 *
 * @returns {Promise<{online: boolean, players?, max?, version?, motd?, latency?, error?}>}
 */
function status() {
    const { host, port } = address();

    return new Promise(resolve => {
        const startedAt = Date.now();
        let settled = false;
        let received = Buffer.alloc(0);

        const finish = result => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };

        const socket = net.createConnection({ host, port });
        socket.setTimeout(TIMEOUT_MS);

        socket.on('timeout', () => finish({ online: false, error: '응답 없음 (시간 초과)' }));
        socket.on('error', err => finish({ online: false, error: err.code || err.message }));

        socket.on('connect', () => {
            // 핸드셰이크: 프로토콜 -1 = "버전을 묻지 않는다". 서버가 어떤
            // 버전이든 상태를 돌려주게 하는 관례적인 값입니다.
            const handshake = packet(0x00,
                varInt(-1),
                mcString(host),
                Buffer.from([(port >> 8) & 0xff, port & 0xff]),
                varInt(1));                       // next state = status

            socket.write(handshake);
            socket.write(packet(0x00));           // status request
        });

        socket.on('data', chunk => {
            received = Buffer.concat([received, chunk]);

            // 길이 → 패킷 id → JSON 문자열 순서입니다. 한 번에 다 오지 않을 수
            // 있어서 모일 때까지 기다립니다.
            const length = readVarInt(received, 0);
            if (!length) return;
            if (received.length < length.size + length.value) return;

            let offset = length.size;
            const id = readVarInt(received, offset);
            if (!id) return;
            offset += id.size;

            const jsonLength = readVarInt(received, offset);
            if (!jsonLength) return;
            offset += jsonLength.size;

            if (received.length < offset + jsonLength.value) return;

            const json = received.subarray(offset, offset + jsonLength.value).toString('utf8');

            try {
                const parsed = JSON.parse(json);
                finish({
                    online: true,
                    players: parsed.players?.online ?? 0,
                    max: parsed.players?.max ?? 0,
                    sample: (parsed.players?.sample || []).map(p => p.name),
                    version: parsed.version?.name || '알 수 없음',
                    motd: flattenMotd(parsed.description),
                    latency: Date.now() - startedAt,
                });
            } catch (err) {
                finish({ online: false, error: '응답을 해석하지 못했습니다' });
            }
        });
    });
}

/**
 * MOTD 를 평문으로.
 *
 * 서버마다 문자열이거나, {text}, {extra:[...]}, 혹은 셋이 섞여 옵니다.
 * 색코드(§)는 디스코드에서 의미가 없으므로 지웁니다.
 */
function flattenMotd(description) {
    return strip(walk(description));
}

/**
 * 재귀로 문자열만 모읍니다. 여기서 trim 하면 안 됩니다 — MOTD 두 줄은
 * 조각마다 줄바꿈이 붙어 오는데, 조각마다 trim 하면 그 줄바꿈이 사라져
 * "러크 서버4개의 세계" 처럼 붙어 버립니다.
 */
function walk(node) {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(walk).join('');

    let out = node.text || '';
    if (Array.isArray(node.extra)) out += node.extra.map(walk).join('');
    return out;
}

function strip(text) {
    return String(text).replace(/§[0-9a-fk-or]/gi, '').trim();
}

// ── 슬래시 명령 ───────────────────────────────────────────────────────

const statusCommand = new SlashCommandBuilder()
    .setName('서버상태')
    .setDescription('마인크래프트 서버의 접속 상태와 인원을 확인합니다.');

async function handleStatus(interaction) {
    await interaction.deferReply();

    const info = await status();
    const { display } = address();

    if (!info.online) {
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle('🔴 서버 오프라인')
                .setDescription('지금 서버에 접속할 수 없습니다.')
                .addFields(
                    { name: '주소', value: '`' + display + '`', inline: true },
                    { name: '사유', value: info.error || '알 수 없음', inline: true })
                .setFooter({ text: '점검 중이거나 재시작 중일 수 있습니다.' })
                .setTimestamp()],
        });
    }

    const embed = new EmbedBuilder()
        .setColor(0x93e93e)
        .setTitle('🟢 서버 온라인')
        .addFields(
            { name: '접속 인원', value: `**${info.players}** / ${info.max}`, inline: true },
            { name: '응답 속도', value: `${info.latency}ms`, inline: true },
            { name: '버전', value: info.version, inline: true },
            { name: '주소', value: '`' + display + '`', inline: false })
        .setTimestamp();

    if (info.motd) embed.setDescription(info.motd);

    // 접속자 목록은 서버가 줄 때만 있습니다 (표본이라 전원이 아닐 수 있습니다).
    if (info.sample && info.sample.length > 0) {
        embed.addFields({ name: '접속 중', value: info.sample.join(', ').slice(0, 1024) });
    }

    return interaction.editReply({ embeds: [embed] });
}

module.exports = {
    status, address,
    statusCommand, handleStatus,
    _internals: { varInt, readVarInt, flattenMotd },
};
