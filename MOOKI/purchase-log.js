// 구매 로그 — 환불 요청이 오면 이 기록을 근거로 처리합니다.
//
// 결제가 확인되는 순간(현금 입금 매칭 · RUC 결제) payment.js 가 record() 를 부릅니다.
// 한 건을 purchase_log.jsonl 에 한 줄로 덧붙이고(지우지 않습니다) 구매 로그 채널에 올립니다.
// 원본 기록은 게임 DB(ruc_pay_*)에도 있습니다 — 이 파일은 마크 서버가 꺼져 있어도
// /구매기록 으로 바로 볼 수 있게 하는 봇 쪽 사본입니다.
//
// Gold 로 사는 VIP · SVIP(게임 안 /등급 구매)는 돈이 오가지 않아 여기 없습니다.

const fs = require('fs');
const path = require('path');
const {
    EmbedBuilder, SlashCommandBuilder, MessageFlags, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, PermissionFlagsBits,
} = require('discord.js');
const roles = require('./roles');

const FILE = process.env.PURCHASE_LOG_FILE || path.join(__dirname, 'purchase_log.jsonl');
const PAGE = 10;

const CATEGORY = {
    member: { label: '멤버 등급', color: 0xa855f7, icon: '👑' },
    ruc: { label: '러크', color: 0x93e93e, icon: '💎' },
    convenience: { label: '편의 기능', color: 0x60a5fa, icon: '🧰' },
};

function channelId() {
    return process.env.PURCHASE_LOG_CHANNEL_ID || '';
}

// ── 저장 ──────────────────────────────────────────────────────────────

function readAll() {
    let text;
    try { text = fs.readFileSync(FILE, 'utf8'); } catch { return []; }
    const out = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch { /* 깨진 줄은 건너뜀 — 나머지는 살립니다 */ }
    }
    return out;
}

function amountText(e) {
    return `${Number(e.amount).toLocaleString('ko-KR')}${e.unit === 'RUC' ? ' RUC' : '원'}`;
}

function entryEmbed(e) {
    const c = CATEGORY[e.category] || { label: e.category || '기타', color: 0x9ca3af, icon: '🛒' };
    return new EmbedBuilder().setColor(c.color)
        .setTitle(`${c.icon} [${c.label}] ${e.productName}`)
        .addFields(
            { name: '마크 닉네임', value: e.name || '-', inline: true },
            { name: 'Discord', value: e.discord ? `<@${e.discord}> (${e.discord})` : '-', inline: true },
            { name: '금액', value: `${amountText(e)} · ${e.unit === 'RUC' ? 'RUC 결제' : '현금'}`, inline: true },
            { name: '주문', value: `${e.code} · #${e.order}`, inline: true },
            { name: '구매 일시', value: `<t:${Math.floor(e.at / 1000)}:F>`, inline: true },
            { name: '지급', value: e.delivered ? '완료' : '대기 (자동 재시도)', inline: true },
        )
        .setFooter({ text: `UUID ${e.uuid || '-'}` })
        .setTimestamp(e.at);
}

/**
 * 구매 한 건을 기록하고 채널에 올립니다. 같은 주문 코드는 한 번만 기록합니다
 * (버튼을 두 번 누르거나 재지급이 다시 알려도 줄이 늘지 않게).
 * 실패해도 결제 처리를 막지 않도록 예외를 던지지 않습니다.
 */
async function record(guild, e) {
    try {
        if (!e || !e.code) return;
        if (readAll().some(x => x.code === e.code)) return;
        const entry = { at: Date.now(), ...e };
        fs.appendFileSync(FILE, JSON.stringify(entry) + '\n', 'utf8');

        const id = channelId();
        const channel = id && guild ? await guild.channels.fetch(id).catch(() => null) : null;
        if (!channel) {
            console.warn(`[구매로그] 채널이 없습니다 (PURCHASE_LOG_CHANNEL_ID) — ${entry.code} 는 파일에만 남겼습니다.`);
            return;
        }
        await channel.send({ embeds: [entryEmbed(entry)] });
    } catch (err) {
        console.error('[구매로그] 기록 실패:', err);
    }
}

// ── /구매기록 ─────────────────────────────────────────────────────────

const historyCommand = new SlashCommandBuilder()
    .setName('구매기록').setDescription('(관리자) 마인크래프트 닉네임의 구매 기록을 봅니다. 구매 로그 채널 전용.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('닉네임').setDescription('마인크래프트 닉네임').setRequired(true).setMaxLength(16))
    .addStringOption(o => o.setName('분류').setDescription('이 분류만 보기')
        .addChoices(...Object.entries(CATEGORY).map(([value, c]) => ({ name: c.label, value }))));

/** 닉네임으로 찾되, 닉네임을 바꾼 사람도 놓치지 않게 UUID 로 묶어 전부 가져옵니다. */
function find(name, category) {
    const all = readAll();
    const lower = name.toLowerCase();
    const uuids = new Set(all.filter(e => String(e.name).toLowerCase() === lower).map(e => e.uuid || `name:${lower}`));
    return all
        .filter(e => uuids.has(e.uuid) || uuids.has(`name:${String(e.name).toLowerCase()}`))
        .filter(e => !category || e.category === category)
        .sort((a, b) => b.at - a.at);
}

function totals(list) {
    const out = [];
    for (const [key, c] of Object.entries(CATEGORY)) {
        const rows = list.filter(e => e.category === key);
        if (rows.length === 0) continue;
        const won = rows.filter(e => e.unit !== 'RUC').reduce((s, e) => s + Number(e.amount), 0);
        const ruc = rows.filter(e => e.unit === 'RUC').reduce((s, e) => s + Number(e.amount), 0);
        const sum = [won && `${won.toLocaleString('ko-KR')}원`, ruc && `${ruc.toLocaleString('ko-KR')} RUC`].filter(Boolean).join(' + ');
        out.push(`${c.icon} **${c.label}** ${rows.length}건 · ${sum}`);
    }
    return out.join('\n');
}

function page(name, category, n) {
    const list = find(name, category);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    n = Math.min(Math.max(0, n), pages - 1);
    const label = category ? ` · ${CATEGORY[category].label}` : '';
    const e = new EmbedBuilder().setColor(category ? CATEGORY[category].color : 0x60a5fa)
        .setTitle(`구매 기록 — ${name}${label}`);
    if (list.length === 0) {
        e.setDescription('기록이 없습니다.');
        return { embeds: [e], components: [] };
    }
    const rows = list.slice(n * PAGE, n * PAGE + PAGE).map(x => {
        const c = CATEGORY[x.category];
        return `${c ? c.icon : '🛒'} <t:${Math.floor(x.at / 1000)}:d> **${x.productName}** · ${amountText(x)} · \`${x.code}\` #${x.order}`
            + (x.name.toLowerCase() !== name.toLowerCase() ? ` (당시 ${x.name})` : '');
    });
    e.setDescription(`${totals(list)}\n\n${rows.join('\n')}`)
        .setFooter({ text: `${list.length}건 · ${n + 1}/${pages} 페이지 · Discord ${[...new Set(list.map(x => x.discord))].join(', ')}` });
    const components = pages > 1 ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`plog_${n - 1}_${category || '-'}_${name}`).setLabel('◀ 이전').setStyle(ButtonStyle.Secondary).setDisabled(n === 0),
        new ButtonBuilder().setCustomId(`plog_${n + 1}_${category || '-'}_${name}`).setLabel('다음 ▶').setStyle(ButtonStyle.Secondary).setDisabled(n >= pages - 1),
    )] : [];
    return { embeds: [e], components };
}

function denied(interaction) {
    if (!roles.isSeniorStaff(interaction.member)) return '<:minecraft_barrier:1557947126024245328> Manager 이상만 볼 수 있습니다.';
    if (interaction.channelId !== channelId()) return `구매 로그 채널(<#${channelId()}>)에서만 쓸 수 있습니다.`;
    return null;
}

async function handleHistory(interaction) {
    const why = denied(interaction);
    if (why) return interaction.reply({ content: why, flags: MessageFlags.Ephemeral });
    const name = interaction.options.getString('닉네임').trim();
    const category = interaction.options.getString('분류');
    return interaction.reply({ ...page(name, category, 0), flags: MessageFlags.Ephemeral });
}

/** @returns {Promise<boolean>} 이 모듈의 버튼이었는가 */
async function handleButton(interaction) {
    if (!interaction.customId.startsWith('plog_')) return false;
    const why = denied(interaction);
    if (why) {
        await interaction.reply({ content: why, flags: MessageFlags.Ephemeral });
        return true;
    }
    const [, n, category, ...rest] = interaction.customId.split('_');
    await interaction.update(page(rest.join('_'), category === '-' ? null : category, Number(n)));
    return true;
}

module.exports = { record, historyCommand, handleHistory, handleButton, CATEGORY, _internals: { find, totals, page, FILE } };
