// 신고 폼 (§3.8) — Phase 6-4
//
// ── 기존 티켓과 무엇이 다른가 ─────────────────────────────────────────
// /ticket 의 문의·건의는 "제목 + 내용" 이면 충분합니다. 신고는 아닙니다.
// 스태프가 조사할 수 있으려면 세 가지가 반드시 있어야 합니다:
//
//   가해자 닉네임   — 누구를 볼 것인가
//   발생 시각       — 로그의 어디를 볼 것인가 (hh:mm:ss)
//   사유            — 무엇을 찾을 것인가
//
// 이 셋이 없으면 "누가 욕했어요" 같은 신고가 들어오고, 스태프는 아무것도 할
// 수 없습니다. 그래서 폼으로 받습니다.
//
// ── 가해자 정보를 자동으로 붙입니다 ───────────────────────────────────
// 신고를 받은 스태프가 가장 먼저 하는 일이 "이 사람 누구지" 입니다. 마크
// 서버에 RCON(/rucinfo)으로 물어 레벨·평판·인증 여부를 티켓에 같이 띄웁니다.
// 처음 온 사람인지 오래 한 사람인지가 판단을 크게 바꿉니다.

const { Rcon } = require('rcon-client');
const {
    EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');

// ── 시각 ──────────────────────────────────────────────────────────────

/**
 * 발생 시각을 hh:mm:ss 로 정규화합니다.
 *
 * 사람은 "3:5:2", "15시 30분", "15:30" 처럼 씁니다. 전부 받아 주되 저장은
 * 한 형식으로 합니다 — 스태프가 로그에서 찾을 때 형식이 흔들리면 못 찾습니다.
 *
 * @returns {string|null} 정규화된 hh:mm:ss, 해석 못 하면 null
 */
function normalizeTime(raw) {
    if (!raw) return null;

    // 숫자만 뽑아냅니다. "15시 30분 20초" → [15, 30, 20]
    const parts = String(raw).match(/\d{1,2}/g);
    if (!parts || parts.length < 2) return null;

    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parts.length >= 3 ? parseInt(parts[2], 10) : 0;

    // 오전/오후를 반영합니다. 한국어로 쓰면 "오후 9시 30분" 이 자연스러운데,
    // 그대로 두면 09:30 이 되어 12시간 어긋난 시각이 로그 조사에 쓰입니다.
    const pm = /오후|pm/i.test(raw);
    const am = /오전|am/i.test(raw);
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;

    if (h > 23 || m > 59 || s > 59) return null;

    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ── 마크 서버 조회 ────────────────────────────────────────────────────

/**
 * 가해자의 기록을 마크 서버에서 받아 옵니다.
 *
 * 실패해도 던지지 않습니다 — 서버가 꺼져 있다고 신고를 못 받으면 안 됩니다.
 * 그때는 정보 없이 티켓을 만들고, 스태프가 직접 조사합니다.
 *
 * @returns {Promise<object|null>}
 */
async function lookupPlayer(name) {
    const password = process.env.RUC_RCON_PW || '';
    if (!password) return null;

    let rcon;
    try {
        rcon = await Rcon.connect({
            host: process.env.RUC_RCON_HOST || '127.0.0.1',
            port: parseInt(process.env.RUC_RCON_PORT || '25576', 10),
            password,
            timeout: 5000,
        });

        // 닉네임에 공백이 들어가면 인자가 밀립니다. 마크 닉네임 규칙상
        // 공백은 없지만, 사람이 오타로 넣는 경우가 있습니다.
        const safe = String(name).trim().replace(/\s+/g, '_');
        const response = String(await rcon.send(`rucinfo ${safe}`));

        if (/RUCINFO\s+NOT_FOUND/.test(response)) return { found: false };
        if (!/RUCINFO\s+OK/.test(response)) return null;

        // key=value 로 잇혀 옵니다. name 은 값에 공백이 있을 수 있어 맨 뒤입니다.
        const out = { found: true };
        const body = response.slice(response.indexOf('OK') + 2);
        const nameAt = body.indexOf(' name=');
        if (nameAt >= 0) {
            out.name = body.slice(nameAt + 6).trim();
            for (const pair of body.slice(0, nameAt).trim().split(/\s+/)) {
                const eq = pair.indexOf('=');
                if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
            }
        }
        return out;
    } catch (err) {
        console.warn('[신고] 마크 서버 조회 실패:', err.message);
        return null;
    } finally {
        if (rcon) {
            try { await rcon.end(); } catch { /* 이미 끊긴 경우 */ }
        }
    }
}

/** 평판 티어 key → 사람이 읽는 이름과 색. RucCore 의 7티어와 같습니다. */
const TIERS = {
    green:  { label: '초록 (양호)',   color: 0x55FF55 },
    yellow: { label: '노랑 (주의)',   color: 0xFFFF55 },
    red:    { label: '빨강 (기본)',   color: 0xFF5555 },
    purple: { label: '보라 (경고)',   color: 0xAA00AA },
    blue:   { label: '파랑 (위험)',   color: 0x5555FF },
    indigo: { label: '남색 (심각)',   color: 0x000080 },
    black:  { label: '검정 (최악)',   color: 0x1A1A1A },
};

/** 조회 결과를 임베드 필드로. 조회 실패 시 그 사실을 적습니다. */
function playerFields(info, reportedName) {
    if (info === null) {
        return [{
            name: '🔍 가해자 기록',
            value: '마크 서버에 연결하지 못해 조회하지 못했습니다.\n스태프가 직접 확인해 주세요.',
        }];
    }
    if (!info.found) {
        return [{
            name: '🔍 가해자 기록',
            value: `**${reportedName}** — 서버 기록에 없는 닉네임입니다.\n`
                + '오타이거나, 아직 접속한 적 없는 사람입니다.',
        }];
    }

    const tier = TIERS[info.tier] || { label: info.tier || '알 수 없음' };
    const days = info.first
        ? Math.floor((Date.now() - Number(info.first)) / 86400000)
        : null;
    const lastSeen = info.last
        ? `<t:${Math.floor(Number(info.last) / 1000)}:R>`
        : '알 수 없음';

    return [
        {
            name: '🔍 가해자 기록',
            value: [
                `**${info.name}**`,
                `레벨 **${info.level}** · 평판 **${info.rep}** (${tier.label})`,
                `인증 ${info.verified === 'y' ? '✅ 완료' : '❌ 미인증'}`
                    + (info.discord && info.discord !== '-' ? ` · <@${info.discord}>` : ''),
                `K/D ${info.kills}/${info.deaths}`
                    + (days !== null ? ` · 가입 ${days}일째` : ''),
                `마지막 접속 ${lastSeen}`,
            ].join('\n'),
        },
    ];
}

// ── 폼 ────────────────────────────────────────────────────────────────

/**
 * 신고 모달. §3.8 이 요구하는 세 가지를 필수로 받습니다.
 *
 * 디스코드 모달은 입력칸이 최대 5개입니다. 제목은 받지 않고 가해자 닉네임으로
 * 자동 생성합니다 — 신고에서 제목은 정보를 더하지 않고, 그 칸을 증거 링크에
 * 쓰는 편이 조사에 훨씬 도움이 됩니다.
 */
function buildModal() {
    return new ModalBuilder()
        .setCustomId('modal_report')
        .setTitle('🚨 신고 접수')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('report_target')
                    .setLabel('가해자 마인크래프트 닉네임')
                    .setPlaceholder('정확히 입력해 주세요. 대소문자 구분합니다.')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(16)),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('report_time')
                    .setLabel('발생 시각 (hh:mm:ss)')
                    .setPlaceholder('예: 21:30:15  —  대략이어도 괜찮습니다')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(20)),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('report_server')
                    .setLabel('어느 서버에서 일어났나요?')
                    .setPlaceholder('홈 / 약탈 / 국가전 / 평화')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(20)),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('report_reason')
                    .setLabel('사유 — 무슨 일이 있었나요?')
                    .setPlaceholder('상황을 구체적으로 적어 주실수록 처리가 빨라집니다.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1000)),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('report_evidence')
                    .setLabel('증거 링크 (선택)')
                    .setPlaceholder('스크린샷·영상 링크. 티켓 채널에 직접 올리셔도 됩니다.')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(300)));
}

/**
 * 제출된 신고를 티켓으로 만듭니다.
 *
 * @param interaction 모달 제출 상호작용
 * @param createTicketChannel MOOKIbot.js 의 티켓 생성 함수
 */
async function handleSubmit(interaction, createTicketChannel) {
    const target = interaction.fields.getTextInputValue('report_target').trim();
    const rawTime = interaction.fields.getTextInputValue('report_time').trim();
    const server = (interaction.fields.getTextInputValue('report_server') || '').trim();
    const reason = interaction.fields.getTextInputValue('report_reason').trim();
    const evidence = (interaction.fields.getTextInputValue('report_evidence') || '').trim();

    const time = normalizeTime(rawTime);
    if (!time) {
        // 폼을 다시 받는 것보다 왜 안 되는지 알려 주는 쪽이 낫습니다.
        return interaction.reply({
            content: `❌ 발생 시각을 이해하지 못했습니다: \`${rawTime}\`\n`
                + '`21:30:15` 처럼 시:분:초로 적어 주세요. (`21:30` 도 됩니다)',
            flags: require('discord.js').MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: require('discord.js').MessageFlags.Ephemeral });

    // 마크 서버 조회는 느릴 수 있어 defer 뒤에 합니다.
    const info = await lookupPlayer(target);

    const lines = [
        `**가해자** \`${target}\``,
        `**발생 시각** \`${time}\``,
    ];
    if (server) lines.push(`**서버** ${server}`);
    lines.push('', reason);
    if (evidence) lines.push('', `**증거** ${evidence}`);

    // createTicketChannel 은 { channel, ticketId } 를 돌려줍니다.
    const created = await createTicketChannel(
        interaction.guild, interaction.member, 'report',
        `${target} 신고`, lines.join('\n'));
    const channel = created && created.channel;

    // 가해자 기록은 별도 임베드로 붙입니다 — 신고 본문과 섞이면 누가 쓴
    // 내용이고 누가 조회한 사실인지 구분이 안 됩니다.
    if (channel) {
        const tier = info && info.found ? TIERS[info.tier] : null;
        await channel.send({
            embeds: [new EmbedBuilder()
                .setColor(tier ? tier.color : 0x8a8a8a)
                .setTitle('신고 대상 자동 조회')
                .addFields(playerFields(info, target))
                .setFooter({ text: '마인크래프트 서버 기록 · 신고 내용과 별개입니다' })
                .setTimestamp()],
        });
    }

    return interaction.editReply(
        `✅ 신고가 접수되었습니다.${channel ? ` <#${channel.id}>` : ''}\n`
        + '스태프가 확인 후 처리합니다. 결과는 티켓에서 알려드립니다.');
}

module.exports = {
    buildModal, handleSubmit, normalizeTime, lookupPlayer,
    _internals: { playerFields, TIERS },
};
