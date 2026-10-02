// 디스코드 역할 → 마인크래프트 칭호 동기화 (Phase 6)
//
// 요구사항: "디스코드 서버에서 가진 최상위 역할을 마크 닉네임 앞에 표시"
//
// ── 역할 → 칭호 판정은 이쪽이 하지 않습니다 ──────────────────────────
// 이 모듈은 "그 사람이 지금 가진 역할 ID" 를 마크 서버에 그대로 넘기는 일만
// 합니다. 어떤 역할이 어떤 칭호이고 무엇이 더 높은지는 RucCore 의 config.yml
// (titles.definitions) 이 정합니다.
//
// 판정을 양쪽에 두면 우선순위가 두 군데에 적히고, 한쪽만 고쳐졌을 때
// "디스코드에서는 관리자인데 게임에서는 일반" 이 됩니다. 한 군데만 진실이어야
// 합니다.
//
// ── 통로는 RCON ──────────────────────────────────────────────────────
// verification.js 와 같은 이유입니다. 이 봇은 Node 라서 RucCore 의 H2 를 직접
// 읽지 못하고, 운영에서 MySQL 로 바꿔도 RCON 경로는 그대로 동작합니다.

const { Rcon } = require('rcon-client');
const { EmbedBuilder, SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

// ── 설정 ──────────────────────────────────────────────────────────────

// verification.js 와 같은 이유로 호출 시점에 읽습니다 —
// 모듈 최상단에서 process.env 를 읽으면 dotenv.config() 보다 먼저 require 될 때
// 값이 비어 있습니다.
function rconConfig() {
    return {
        host: process.env.RUC_RCON_HOST || '127.0.0.1',
        port: parseInt(process.env.RUC_RCON_PORT || '25576', 10),
        password: process.env.RUC_RCON_PW || '',
    };
}

/** 전체 훑기 주기 (분). 역할 제거를 봇이 꺼진 동안 놓쳤을 때의 보정입니다. */
const SWEEP_INTERVAL_MIN = parseInt(process.env.RUC_TITLE_SWEEP_MIN || '30', 10);

/** 훑을 때 RCON 명령 사이 간격 (ms). 서버 메인 스레드를 막지 않으려는 배려입니다. */
const SWEEP_GAP_MS = 60;

/** 칭호와 연결된 역할 ID. 서버에서 받아 캐시합니다. */
let mappedRoles = new Set();
let lastSweepAt = 0;

// ── RCON ──────────────────────────────────────────────────────────────

async function connect() {
    const cfg = rconConfig();
    if (!cfg.password) {
        throw new Error('RUC_RCON_PW가 .env에 설정되지 않았습니다.');
    }
    return Rcon.connect({
        host: cfg.host,
        port: cfg.port,
        password: cfg.password,
        timeout: 5000,
    });
}

/**
 * 칭호와 연결된 역할 ID 목록을 서버에서 받아 옵니다.
 * @returns {Promise<Set<string>>}
 */
async function fetchMappedRoles(rcon) {
    const response = await rcon.send('ructitle roles');
    const match = String(response).match(/RUCTITLE\s+ROLES\s*(.*)/);
    if (!match) return new Set();

    return new Set(
        String(match[1]).split(',').map(s => s.trim()).filter(Boolean)
    );
}

/**
 * 한 사람의 역할을 서버에 밀어 넣습니다.
 * @returns {Promise<{status: string, player?: string, title?: string}>}
 */
async function pushMember(rcon, member) {
    // 연결된 역할만 보냅니다. 전부 보내도 서버가 걸러 내지만, 역할이 수십 개인
    // 서버에서 RCON 인자가 불필요하게 길어집니다.
    const roles = member.roles.cache
        .filter(role => mappedRoles.size === 0 || mappedRoles.has(role.id))
        .map(role => role.id);

    // 하나도 없으면 '-' 를 보냅니다. 빈 인자를 보내면 RCON 쪽에서 인자가 밀려
    // discordId 만 온 것과 구분되지 않습니다. '-' 는 "역할 없음" 이고,
    // 서버는 이때 디스코드에서 온 칭호를 전부 회수합니다 — 그래야 역할이
    // 빠진 것이 실제로 반영됩니다.
    const payload = roles.length > 0 ? roles.join(',') : '-';

    const response = await rcon.send(`ructitle ${member.id} ${payload}`);
    const match = String(response).match(/RUCTITLE\s+([A-Z_]+)(?:\s+(\S+))?(?:\s+(\S+))?/);
    if (!match) return { status: 'ERROR' };

    return { status: match[1], player: match[2], title: match[3] };
}

// ── 공개 API ──────────────────────────────────────────────────────────

/**
 * 한 사람만 동기화합니다. 역할 변경 이벤트에서 부릅니다.
 * 실패해도 던지지 않습니다 — 역할 변경 하나 때문에 봇이 죽으면 안 됩니다.
 */
async function syncMember(member) {
    let rcon;
    try {
        rcon = await connect();
        if (mappedRoles.size === 0) {
            mappedRoles = await fetchMappedRoles(rcon);
        }
        const result = await pushMember(rcon, member);

        if (result.status === 'OK') {
            console.log(`[칭호] ${member.user.tag} → ${result.player} : ${result.title || '없음'}`);
        } else if (result.status !== 'NOT_LINKED') {
            // NOT_LINKED 는 정상입니다. 디스코드에만 있고 게임에 안 들어온 사람.
            console.warn(`[칭호] ${member.user.tag} → ${result.status}`);
        }
        return result;
    } catch (err) {
        console.error('[칭호] 동기화 실패:', err.message);
        return { status: 'ERROR' };
    } finally {
        if (rcon) {
            try { await rcon.end(); } catch { /* 이미 끊긴 경우 */ }
        }
    }
}

/**
 * 역할이 바뀐 사람을 동기화합니다.
 *
 * <b>연결된 역할이 실제로 바뀐 경우에만</b> 보냅니다. 닉네임 변경·타임아웃·
 * 아바타 변경도 guildMemberUpdate 를 일으키는데, 그때마다 RCON 을 열면
 * 서버가 이유 없이 두드려 맞습니다.
 */
async function onMemberUpdate(oldMember, newMember) {
    // 아직 역할 목록을 받지 못했으면 일단 보냅니다. 첫 이벤트에서
    // fetchMappedRoles 가 돌면서 캐시가 채워집니다.
    if (mappedRoles.size > 0) {
        const before = oldMember.roles.cache.filter(r => mappedRoles.has(r.id)).map(r => r.id).sort();
        const after = newMember.roles.cache.filter(r => mappedRoles.has(r.id)).map(r => r.id).sort();
        if (before.join(',') === after.join(',')) return;
    }
    await syncMember(newMember);
}

/**
 * 서버 전체를 훑습니다.
 *
 * 필요한 이유: 봇이 꺼져 있는 동안 일어난 역할 변경은 이벤트로 오지 않습니다.
 * 특히 <b>역할이 제거된</b> 경우가 문제인데, 그 사람은 관련 역할이 하나도 없어서
 * 평소에는 훑기 대상에서도 빠집니다. 그래서 {@code all} 이 true 면 멤버 전원을
 * 보냅니다 (스태프가 부르는 /칭호동기화).
 *
 * @param {boolean} all false 면 연결된 역할을 가진 사람만
 */
async function sweep(guild, all = false) {
    let rcon;
    let sent = 0;
    let linked = 0;

    try {
        rcon = await connect();
        mappedRoles = await fetchMappedRoles(rcon);

        if (mappedRoles.size === 0) {
            console.log('[칭호] 역할이 연결된 칭호가 없습니다. config.yml 의 titles.definitions '
                + '에서 discord-role 을 채워 주세요.');
            return { sent: 0, linked: 0, roles: 0 };
        }

        const members = await guild.members.fetch();
        for (const member of members.values()) {
            if (member.user.bot) continue;

            const hasMapped = member.roles.cache.some(role => mappedRoles.has(role.id));
            if (!all && !hasMapped) continue;

            const result = await pushMember(rcon, member);
            sent++;
            if (result.status === 'OK') linked++;

            // 마크 서버의 메인 스레드에서 처리되는 명령입니다. 몰아치면
            // 그 순간 게임이 끊기는 것처럼 보입니다.
            await new Promise(resolve => setTimeout(resolve, SWEEP_GAP_MS));
        }

        lastSweepAt = Date.now();
        console.log(`[칭호] 훑기 완료 — ${sent}명 전송, ${linked}명 반영 `
            + `(연결된 역할 ${mappedRoles.size}개)`);
        return { sent, linked, roles: mappedRoles.size };
    } catch (err) {
        // 마크 서버가 꺼져 있는 것은 오류가 아니라 상태입니다. 한 줄로만 알립니다.
        if (err.code === 'ECONNREFUSED') console.warn('[칭호] 마크 서버 꺼짐 — 훑기 건너뜀 (다음 주기에 다시)');
        else console.error('[칭호] 훑기 실패:', err.message);
        return { sent, linked, roles: mappedRoles.size, error: err.message };
    } finally {
        if (rcon) {
            try { await rcon.end(); } catch { /* 이미 끊긴 경우 */ }
        }
    }
}

/**
 * 서버의 역할 ID 를 콘솔에 찍습니다.
 *
 * RucCore 의 config.yml 은 역할 **ID** 를 요구합니다(이름은 바뀌고, 공백·쉼표가
 * 들어가 RCON 인자로 실을 수 없습니다). 그런데 ID 는 디스코드 UI 에서 개발자
 * 모드를 켜야 보입니다. 봇을 켤 때마다 찍어 두면 설정을 채울 때 여기만 보면
 * 됩니다.
 */
function logRoles(guild) {
    const roles = [...guild.roles.cache.values()]
        .filter(role => role.name !== '@everyone')
        .sort((a, b) => b.position - a.position);

    // 설정을 채울 때만 전체 목록이 필요합니다. 평소에는 25줄이 로그를 덮습니다.
    if (process.env.RUC_LOG_ROLES !== 'true') {
        console.log(`[역할] ${guild.name} 역할 ${roles.length}개 (ID 목록: .env 에 RUC_LOG_ROLES=true)`);
        return;
    }
    console.log(`[역할] ${guild.name} — ${roles.length}개 (위에서부터)`);
    for (const role of roles) {
        console.log(`[역할] ${role.name} = ${role.id}`);
    }
    console.log('[역할] 위 ID 를 RucCore config.yml 의 titles.definitions.<칭호>.discord-role '
        + '에 넣으세요.');
}

/** 주기 훑기를 시작합니다. */
function startSweeping(guild) {
    const minutes = Math.max(5, SWEEP_INTERVAL_MIN);
    setInterval(() => {
        sweep(guild, false).catch(err => console.error('[칭호] 주기 훑기 실패:', err));
    }, minutes * 60 * 1000).unref?.();

    console.log(`[칭호] ${minutes}분마다 훑기`);
}

// ── 슬래시 명령어 ─────────────────────────────────────────────────────

const titleSyncCommand = new SlashCommandBuilder()
    .setName('칭호동기화')
    .setDescription('(스태프) 디스코드 역할을 마인크래프트 칭호에 강제로 반영합니다.')
    .addBooleanOption(o =>
        o.setName('전체')
            .setDescription('역할이 없는 사람까지 포함 (역할 제거 반영에 필요)')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

async function handleTitleSync(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) {
        return interaction.editReply('이 명령어는 서버 안에서만 사용할 수 있습니다.');
    }

    const all = interaction.options.getBoolean('전체') ?? false;
    const result = await sweep(interaction.guild, all);

    const embed = new EmbedBuilder()
        .setColor(result.error ? 0xff4444 : 0x93e93e)
        .setTitle(result.error ? '❌ 칭호 동기화 실패' : '✅ 칭호 동기화 완료')
        .setTimestamp();

    if (result.error) {
        embed.setDescription(
            `마인크래프트 서버에 연결하지 못했습니다.\n\`\`\`${result.error}\`\`\``);
    } else if (result.roles === 0) {
        embed.setColor(0xffaa00)
            .setTitle('⚠️ 연결된 역할이 없습니다')
            .setDescription(
                'RucCore 의 `config.yml` 에서 `titles.definitions.<칭호>.discord-role` 에 '
                + '역할 ID 를 넣어야 합니다.\n역할 ID 는 봇 콘솔에 찍혀 있습니다.');
    } else {
        embed.setDescription(
            `전송 **${result.sent}명** · 게임 계정 반영 **${result.linked}명**\n`
            + `연결된 역할 **${result.roles}개**`
            + (all ? '\n\n`전체: 예` — 역할이 없는 사람까지 포함했습니다.' : ''));
    }

    return interaction.editReply({ embeds: [embed] });
}

module.exports = {
    titleSyncCommand,
    handleTitleSync,
    syncMember,
    onMemberUpdate,
    sweep,
    logRoles,
    startSweeping,
    // 점검용
    _internals: { fetchMappedRoles, pushMember, get mappedRoles() { return mappedRoles; },
        get lastSweepAt() { return lastSweepAt; } },
};
