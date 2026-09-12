// 디스코드 ↔ 마인크래프트 계정 인증 (D10)
//
// 왜 RCON인가:
// RucCore는 자바 임베디드 DB(H2)를 쓰고, 이 봇은 Node.js입니다. Node는 H2 파일을
// 읽을 수 없습니다. 이미 .env에 RCON 설정이 있었으므로 그걸 연동 통로로 씁니다.
// 운영에서 MySQL로 바꿔도 이 경로는 그대로 동작합니다.
//
// 실제 그리핑 차단력은 코드 자체가 아니라 "디스코드 1 : 마크 1" 제약에서 나옵니다.
// 부계정을 만들려면 전화번호 인증된 새 디스코드 계정이 필요해집니다.

const { Rcon } = require('rcon-client');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

// ── 설정 ──────────────────────────────────────────────────────────────

const RCON_HOST = process.env.RUC_RCON_HOST || '127.0.0.1';
const RCON_PORT = parseInt(process.env.RUC_RCON_PORT || '25576', 10);
const RCON_PW = process.env.RUC_RCON_PW || '';

/** 디스코드 계정 최소 나이 (D10) — MOOKI 보안 모듈의 기존 기준과 동일 */
const MIN_ACCOUNT_AGE_DAYS = 7;

/** 무차별 대입 차단 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

// userId -> { count, firstAt, lockedUntil }
const attempts = new Map();

// ── 시도 제한 ─────────────────────────────────────────────────────────

function checkRateLimit(userId) {
    const now = Date.now();
    const entry = attempts.get(userId);

    if (!entry) return { allowed: true };

    if (entry.lockedUntil && now < entry.lockedUntil) {
        return {
            allowed: false,
            retryInSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
        };
    }

    // 창이 지났으면 초기화
    if (now - entry.firstAt > ATTEMPT_WINDOW_MS) {
        attempts.delete(userId);
        return { allowed: true };
    }

    return { allowed: true };
}

function recordFailure(userId) {
    const now = Date.now();
    const entry = attempts.get(userId) || { count: 0, firstAt: now };

    entry.count++;
    if (entry.count >= MAX_ATTEMPTS) {
        entry.lockedUntil = now + LOCKOUT_MS;
        entry.count = 0;
        entry.firstAt = now;
    }
    attempts.set(userId, entry);
}

function clearAttempts(userId) {
    attempts.delete(userId);
}

// ── RCON ──────────────────────────────────────────────────────────────

/**
 * 마크 서버에 인증 요청을 보냅니다.
 * @returns {Promise<string>} RucCore가 돌려준 결과 코드
 */
async function callServer(code, discordId, discordName) {
    if (!RCON_PW) {
        throw new Error('RUC_RCON_PW가 .env에 설정되지 않았습니다.');
    }

    let rcon;
    try {
        rcon = await Rcon.connect({
            host: RCON_HOST,
            port: RCON_PORT,
            password: RCON_PW,
            timeout: 5000,
        });

        // 닉네임에 공백이 들어가면 인자가 밀리므로 치환합니다.
        const safeName = String(discordName).replace(/\s+/g, '_');
        const response = await rcon.send(`rucverify ${code} ${discordId} ${safeName}`);

        // 기대 형식: "RUCVERIFY <RESULT>"
        const match = String(response).match(/RUCVERIFY\s+([A-Z_]+)/);
        return match ? match[1] : 'ERROR';
    } finally {
        if (rcon) {
            try { await rcon.end(); } catch { /* 이미 끊긴 경우 무시 */ }
        }
    }
}

// ── 결과 문구 ─────────────────────────────────────────────────────────

const RESULT_MESSAGES = {
    SUCCESS: {
        color: 0x93e93e,
        title: '✅ 인증 완료',
        body: '마인크래프트 계정이 연동되었습니다.\n게임으로 돌아가시면 잠시 후 자동으로 이동됩니다.',
    },
    INVALID_CODE: {
        color: 0xff4444,
        title: '❌ 잘못된 코드',
        body: '해당 코드를 찾을 수 없습니다.\n게임에서 `/인증` 을 입력해 코드를 다시 확인해 주세요.',
    },
    EXPIRED: {
        color: 0xffaa00,
        title: '⏰ 코드 만료',
        body: '코드가 만료되었습니다.\n게임에서 `/인증` 을 입력해 새 코드를 받아 주세요.',
    },
    DISCORD_ALREADY_LINKED: {
        color: 0xff4444,
        title: '❌ 이미 연동된 디스코드 계정',
        body: '이 디스코드 계정은 이미 다른 마인크래프트 계정에 연동되어 있습니다.\n'
            + '한 디스코드 계정당 마인크래프트 계정 하나만 연동할 수 있습니다.\n'
            + '연동 해제가 필요하면 스태프에게 문의해 주세요.',
    },
    MC_ALREADY_LINKED: {
        color: 0xffaa00,
        title: '⚠️ 이미 인증된 계정',
        body: '이 마인크래프트 계정은 이미 인증되어 있습니다.',
    },
    ERROR: {
        color: 0xff4444,
        title: '❌ 처리 실패',
        body: '인증 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    },
};

// ── 슬래시 명령어 정의 ────────────────────────────────────────────────

const verifyCommand = new SlashCommandBuilder()
    .setName('인증')
    .setDescription('마인크래프트 계정을 연동합니다.')
    .addStringOption(o =>
        o.setName('코드')
            .setDescription('게임 화면에 표시된 6자리 코드')
            .setRequired(true)
            .setMinLength(4)
            .setMaxLength(8));

// ── 처리 ──────────────────────────────────────────────────────────────

async function handleVerify(interaction) {
    // 본인에게만 보이게 — 코드가 채널에 남지 않도록
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;

    // 1) 시도 제한
    const limit = checkRateLimit(userId);
    if (!limit.allowed) {
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle('🔒 시도 횟수 초과')
                .setDescription(
                    `너무 많이 실패했습니다. **${limit.retryInSeconds}초** 후에 다시 시도해 주세요.`)],
        });
    }

    // 2) 서버 멤버여야 함 (D10)
    if (!interaction.guild) {
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle('❌ 서버에서 실행해 주세요')
                .setDescription('이 명령어는 러크 서버 디스코드 안에서만 사용할 수 있습니다.')],
        });
    }

    // 3) 계정 나이 (D10) — 부계정 대량 생성 차단
    const ageDays = Math.floor(
        (Date.now() - interaction.user.createdTimestamp) / 86400000);

    if (ageDays < MIN_ACCOUNT_AGE_DAYS) {
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0xff4444)
                .setTitle('❌ 계정 생성 후 기간 부족')
                .setDescription(
                    `디스코드 계정 생성 후 **${MIN_ACCOUNT_AGE_DAYS}일** 이상 지나야 인증할 수 있습니다.\n`
                    + `현재 계정 나이: **${ageDays}일**\n\n`
                    + '부계정을 이용한 공격을 막기 위한 조치입니다. 스태프에게 문의하면 예외 처리가 가능합니다.')],
        });
    }

    // 4) 서버에 검증 요청
    const code = interaction.options.getString('코드').trim();

    let result;
    try {
        result = await callServer(code, userId, interaction.user.username);
    } catch (err) {
        console.error('[인증] RCON 실패:', err.message);
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0xffaa00)
                .setTitle('⚠️ 서버 연결 실패')
                .setDescription(
                    '마인크래프트 서버에 연결할 수 없습니다.\n'
                    + '서버가 점검 중일 수 있습니다. 잠시 후 다시 시도하거나 스태프에게 문의해 주세요.')],
        });
    }

    // 5) 결과 처리
    if (result === 'SUCCESS') {
        clearAttempts(userId);
    } else if (result === 'INVALID_CODE' || result === 'EXPIRED') {
        recordFailure(userId);
    }

    const message = RESULT_MESSAGES[result] || RESULT_MESSAGES.ERROR;

    const embed = new EmbedBuilder()
        .setColor(message.color)
        .setTitle(message.title)
        .setDescription(message.body)
        .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
}

module.exports = {
    verifyCommand,
    handleVerify,
    // 테스트/점검용
    _internals: { callServer, checkRateLimit, recordFailure },
};
