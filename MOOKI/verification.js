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
const {
    EmbedBuilder, SlashCommandBuilder, MessageFlags, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const roles = require('./roles');

// ── 설정 ──────────────────────────────────────────────────────────────

// ⚠️ 모듈 최상단에서 process.env 를 읽으면 안 됩니다.
// 이 파일이 dotenv.config() 보다 먼저 require 되면 값이 비어 있게 되고,
// "RUC_RCON_PW가 설정되지 않았습니다" 로 오인하게 됩니다.
// 호출 시점에 읽어서 require 순서에 의존하지 않도록 합니다.
function rconConfig() {
    return {
        host: process.env.RUC_RCON_HOST || '127.0.0.1',
        port: parseInt(process.env.RUC_RCON_PORT || '25576', 10),
        password: process.env.RUC_RCON_PW || '',
    };
}

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
    const cfg = rconConfig();
    if (!cfg.password) {
        throw new Error('RUC_RCON_PW가 .env에 설정되지 않았습니다.');
    }

    let rcon;
    try {
        rcon = await Rcon.connect({
            host: cfg.host,
            port: cfg.port,
            password: cfg.password,
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
        title: '<:minecraft_emerald_block:1557947122802757673> 인증 완료',
        body: '마인크래프트 계정이 연동되었습니다.\n게임으로 돌아가시면 잠시 후 자동으로 이동됩니다.',
    },
    INVALID_CODE: {
        color: 0xff4444,
        title: '<:minecraft_barrier:1557947126024245328> 잘못된 코드',
        body: '해당 코드를 찾을 수 없습니다.\n게임에서 `/인증` 을 입력해 코드를 다시 확인해 주세요.',
    },
    EXPIRED: {
        color: 0xffaa00,
        title: '⏰ 코드 만료',
        body: '코드가 만료되었습니다.\n게임에서 `/인증` 을 입력해 새 코드를 받아 주세요.',
    },
    DISCORD_ALREADY_LINKED: {
        color: 0xff4444,
        title: '<:minecraft_barrier:1557947126024245328> 이미 연동된 디스코드 계정',
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
        title: '<:minecraft_barrier:1557947126024245328> 처리 실패',
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

// 패널 메뉴의 [인증하기] 는 이 모달을 띄웁니다. 제출은 handleVerify 로 갑니다.
const verifyPanelCommand = new SlashCommandBuilder()
    .setName('verify')
    .setDescription('인증 안내 패널 (관리자)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('panel').setDescription('이 채널에 인증 안내 패널을 올립니다.'));

function buildVerifyPanel() {
    const embed = new EmbedBuilder()
        .setColor(0x93e93e)
        .setTitle('마인크래프트 계정 인증')
        .setDescription('디스코드 계정 1개에 마인크래프트 계정 1개를 연결합니다.\n\n'
            + '**1.** 마인크래프트로 러크 서버에 접속\n'
            + '**2.** 화면에 뜨는 **6자리 코드** 확인\n'
            + '**3.** 아래 **인증하기** 를 눌러 코드 입력')
        .addFields({
            name: '안 될 때',
            value: `<:minecraft_clock:1557947961382670396> 코드는 **10분** 동안만 — 게임에서 \`/인증\` 으로 새로 받기\n`
                + `<:minecraft_barrier:1557947126024245328> 디스코드 가입 **${MIN_ACCOUNT_AGE_DAYS}일** 이후부터 · **${MAX_ATTEMPTS}번** 틀리면 **${LOCKOUT_MS / 60000}분** 잠김\n`
                + `<:minecraft_chest:1557947110668902521> 그래도 안 되면 **문의하기**`,
        })
        .setFooter({ text: '코드는 다른 사람에게 알려 주지 마세요' });

    // 버튼 ID 는 MOOKIbot.js 의 버튼 처리로 그대로 갑니다 (문의는 티켓 패널의 문의와 같은 ID)
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify_open').setLabel('인증하기').setStyle(ButtonStyle.Success).setEmoji('<:minecraft_emerald_block:1557947122802757673>'),
        new ButtonBuilder().setCustomId('ticket_type_inquiry').setLabel('문의하기').setStyle(ButtonStyle.Secondary).setEmoji('<:minecraft_chest:1557947110668902521>'),
    );
    return { embeds: [embed], components: [row] };
}

function buildCodeModal() {
    return new ModalBuilder()
        .setCustomId('modal_verify')
        .setTitle('마인크래프트 계정 인증')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('verify_code')
                .setLabel('게임 화면에 표시된 코드')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('예) 123456')
                .setRequired(true)
                .setMinLength(4)
                .setMaxLength(8)));
}

/** @param code 생략하면 /인증 의 '코드' 옵션을 읽습니다 (모달 제출은 직접 넘김) */
async function handleVerify(interaction, code = interaction.options.getString('코드')) {
    // 본인에게만 보이게 — 코드가 채널에 남지 않도록
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
                .setTitle('<:minecraft_barrier:1557947126024245328> 서버에서 실행해 주세요')
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
                .setTitle('<:minecraft_barrier:1557947126024245328> 계정 생성 후 기간 부족')
                .setDescription(
                    `디스코드 계정 생성 후 **${MIN_ACCOUNT_AGE_DAYS}일** 이상 지나야 인증할 수 있습니다.\n`
                    + `현재 계정 나이: **${ageDays}일**\n\n`
                    + '부계정을 이용한 공격을 막기 위한 조치입니다. 스태프에게 문의하면 예외 처리가 가능합니다.')],
        });
    }

    // 4) 서버에 검증 요청
    code = code.trim();

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

    // 6) 인증 통과 → Ruc 역할 부여
    //
    // 역할 ID 는 config/roles.json 에만 있습니다. 여기서는 "인증용 역할" 이라고만
    // 알고, 어떤 역할인지는 설정이 정합니다.
    //
    // 역할 부여가 실패해도 **인증 자체는 이미 성공**입니다 (마크 서버 DB 에
    // 기록됐습니다). 그래서 실패를 던지지 않고 안내 문구만 덧붙입니다 —
    // 여기서 오류를 내면 인증이 안 된 것으로 오해하고 코드를 다시 받습니다.
    if (result === 'SUCCESS') {
        const outcome = await roles.grantVerified(
            interaction.member, `마인크래프트 계정 인증 (${interaction.user.tag})`);

        if (outcome === 'granted') {
            embed.addFields({
                name: '역할 지급',
                value: `**${roles.verifiedRole().label}** 역할을 받았습니다.`,
            });
        } else if (outcome === 'already') {
            // 재인증입니다. 굳이 알릴 필요 없습니다.
        } else {
            const reason = outcome === 'forbidden'
                ? '봇의 역할이 지급할 역할보다 아래에 있습니다.'
                : outcome === 'missing'
                    ? '설정된 역할 ID 를 서버에서 찾지 못했습니다.'
                    : '알 수 없는 오류입니다.';

            console.warn(`[인증] 역할 지급 실패 (${outcome}) — ${interaction.user.tag}: ${reason}`);
            embed.addFields({
                name: '⚠️ 역할 지급 실패',
                value: '인증은 정상 처리됐지만 역할을 드리지 못했습니다.\n'
                    + '스태프에게 문의해 주세요. (다시 인증하실 필요는 없습니다.)',
            });
        }
    }

    return interaction.editReply({ embeds: [embed] });
}

module.exports = {
    verifyCommand,
    handleVerify,
    verifyPanelCommand,
    buildVerifyPanel,
    buildCodeModal,
    // 테스트/점검용
    _internals: { callServer, checkRateLimit, recordFailure },
};
