// 디스코드 → 인게임 채팅 중계 (Phase 6-3)
//
// ── 반쪽만 여기서 합니다 ──────────────────────────────────────────────
// 인게임 → 디스코드는 **플러그인이 웹훅으로 직접** 보냅니다 (RucCore 의
// DiscordRelayService). 봇은 인게임 발언을 알 방법이 로그 파싱뿐이고, 채팅
// 줄에는 이미 칭호가 붙어 있어 어디까지가 칭호인지 모호합니다.
//
// 반대 방향은 봇만 할 수 있습니다 — 디스코드 메시지를 볼 수 있는 것은 봇뿐이고,
// 마크 서버에 말을 거는 통로는 RCON 입니다.
//
// ── 무한 루프를 막는 한 줄 ────────────────────────────────────────────
// 플러그인이 웹훅으로 채널에 글을 쓰면, 봇이 그것을 읽어 다시 게임으로 보내고,
// 그 발언이 또 웹훅으로 나갑니다. 웹훅 메시지는 author.bot === true 라서
// 아래 한 줄이 그 고리를 끊습니다:
//
//     if (message.author.bot) return;
//
// 이 줄을 지우면 서버와 디스코드가 서로에게 같은 문장을 영원히 되돌립니다.

const { Rcon } = require('rcon-client');

/** 인게임에 넣을 최대 길이. 채팅 한 줄이 화면을 덮지 않게 자릅니다. */
const MAX_LENGTH = 256;

// ── 설정 ──────────────────────────────────────────────────────────────

/**
 * `home:채널ID,raid:채널ID,...` 형태를 파싱합니다.
 * 반환: Map<채널ID, 서버이름>
 */
function channelMap() {
    const raw = process.env.RUC_RELAY_CHANNELS || '';
    const map = new Map();

    for (const pair of raw.split(',')) {
        const [server, channelId] = pair.split(':').map(s => (s || '').trim());
        if (server && channelId) map.set(channelId, server);
    }
    return map;
}

/**
 * `home:25576,raid:25577,...` 형태를 파싱합니다.
 * 없으면 러크 서버 기본 포트를 씁니다.
 */
function portMap() {
    const raw = process.env.RUC_RCON_PORTS || '';
    const map = new Map();

    for (const pair of raw.split(',')) {
        const [server, port] = pair.split(':').map(s => (s || '').trim());
        if (server && port) map.set(server, parseInt(port, 10));
    }
    if (map.size === 0) {
        map.set('home', 25576);
        map.set('raid', 25577);
        map.set('war', 25578);
        map.set('peace', 25579);
    }
    return map;
}

// ── 본문 정리 ─────────────────────────────────────────────────────────

/**
 * 디스코드 메시지를 인게임에 넣을 한 줄로 만듭니다.
 *
 * RCON 은 **명령 한 줄**이라 줄바꿈이 들어가면 그 뒤가 잘리거나 다른 명령으로
 * 해석될 수 있습니다. 여러 줄은 공백으로 합칩니다.
 *
 * 멘션은 숫자 ID(`<@123456>`)로 오기 때문에 그대로 넣으면 게임에서 읽을 수
 * 없습니다. 사람이 읽는 형태로 바꿉니다.
 */
function flatten(message) {
    let text = message.cleanContent || message.content || '';

    // 첨부파일은 본문에 안 들어옵니다. 있다는 것만 알려 줍니다.
    if (message.attachments?.size > 0) {
        text += ` [첨부 ${message.attachments.size}개]`;
    }
    if (message.stickers?.size > 0) {
        text += ' [스티커]';
    }

    // 커스텀 이모지 <:이름:123> → :이름:
    text = text.replace(/<a?:(\w+):\d+>/g, ':$1:');

    // 줄바꿈·제어문자 제거. RCON 한 줄에 실어야 합니다.
    text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

    if (text.length > MAX_LENGTH) {
        text = text.slice(0, MAX_LENGTH - 1) + '…';
    }
    return text;
}

/**
 * 발신자 이름. 인게임 한 줄에 들어가므로 짧고 공백 없이 만듭니다.
 *
 * 공백을 밑줄로 바꾸는 이유: `/rucrelay <발신자> <내용...>` 에서 발신자는
 * **한 인자**입니다. 공백이 들어가면 이름의 뒷부분이 본문의 첫 단어가 됩니다.
 */
function authorName(message) {
    const raw = message.member?.displayName || message.author.username || '알 수 없음';
    return raw.replace(/\s+/g, '_').slice(0, 24);
}

// ── RCON ──────────────────────────────────────────────────────────────

async function send(server, port, author, text) {
    const password = process.env.RUC_RCON_PW || '';
    if (!password) throw new Error('RUC_RCON_PW가 .env에 설정되지 않았습니다.');

    let rcon;
    try {
        rcon = await Rcon.connect({
            host: process.env.RUC_RCON_HOST || '127.0.0.1',
            port,
            password,
            timeout: 5000,
        });
        const response = await rcon.send(`rucrelay ${author} ${text}`);
        const match = String(response).match(/RUCRELAY\s+([A-Z_]+)/);
        return match ? match[1] : 'ERROR';
    } finally {
        if (rcon) {
            try { await rcon.end(); } catch { /* 이미 끊긴 경우 */ }
        }
    }
}

// ── 공개 API ──────────────────────────────────────────────────────────

/**
 * 채널에 올라온 메시지를 해당 마크 서버로 보냅니다.
 *
 * 매핑되지 않은 채널, 봇·웹훅 메시지, 빈 메시지, 명령어(`/`, `!` 로 시작)는
 * 흘려보냅니다.
 */
async function onMessage(message) {
    // 루프 차단. 플러그인이 웹훅으로 쓴 글도 여기서 걸립니다 (§주석 상단).
    if (message.author?.bot) return;
    if (!message.guild) return;

    const channels = channelMap();
    const server = channels.get(message.channelId);
    if (!server) return;

    // 봇 명령을 중계하면 게임에 "!help" 같은 줄이 그대로 뿌려집니다.
    const content = message.content || '';
    if (content.startsWith('/') || content.startsWith('!')) return;

    const text = flatten(message);
    if (!text) return;

    const ports = portMap();
    const port = ports.get(server);
    if (!port) {
        console.warn(`[중계] 서버 '${server}' 의 RCON 포트를 모릅니다. `
            + 'RUC_RCON_PORTS 를 확인하세요.');
        return;
    }

    try {
        const result = await send(server, port, authorName(message), text);
        if (result !== 'OK') {
            console.warn(`[중계] ${server} → ${result}`);
        }
    } catch (err) {
        console.error(`[중계] ${server} 전송 실패:`, err.message);
    }
}

/** 기동 시 설정 상태를 알려 줍니다. 조용히 안 되는 것이 가장 나쁩니다. */
function logConfig() {
    const channels = channelMap();
    const ports = portMap();

    if (channels.size === 0) {
        // 2026-09-29 결정으로 일부러 꺼 둔 상태입니다 — 경고가 아니라 상태 한 줄.
        console.log('[중계] 디스코드 → 인게임 꺼짐 (인게임 → 디스코드는 플러그인 웹훅)');
        return;
    }

    console.log(`[중계] 디스코드 → 인게임 채널 ${channels.size}개:`);
    for (const [channelId, server] of channels) {
        const port = ports.get(server);
        console.log(`[중계]   #${channelId} → ${server}`
            + (port ? ` (RCON ${port})` : ' ⚠️ 포트 모름'));
    }
    console.log('[중계] 인게임 → 디스코드는 플러그인이 웹훅으로 직접 보냅니다 '
        + '(RucCore config.yml 의 relay.webhook-url).');
}

module.exports = {
    onMessage,
    logConfig,
    // 점검용
    _internals: { channelMap, portMap, flatten, authorName },
};
