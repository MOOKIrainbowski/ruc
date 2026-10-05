const {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField,
    ChannelType, InteractionType, Events, MessageFlags
} = require('discord.js');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// dotenv 이후에 require 해야 합니다 (아래 모듈이 환경변수를 사용)
const { verifyCommand, handleVerify } = require('./verification');
const titles = require('./titles');
const relay = require('./relay');
const roles = require('./roles');
const minecraft = require('./minecraft');
const report = require('./report');
const reputation = require('./reputation');
const sanction = require('./sanction');
const payment = require('./payment');

const REACTION_FILE = path.join(__dirname, 'reaction_roles.json');
const TICKETS_FILE  = path.join(__dirname, 'tickets_data.json');

const GUILD_ID   = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || process.env.CHANNEL_ID; // admin log channel

// ─── 클라이언트 설정 ───────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildPresences
    ]
});

// ─── 전역 오류 처리 ────────────────────────────────────────────────────────────
// discord.js v14는 async 리스너가 reject하면 그 오류를 client의 'error' 이벤트로
// 다시 내보냅니다. 'error' 리스너가 없으면 Node가 프로세스를 종료시킵니다.
// (bot.log의 크래시 원인이 정확히 이것)

client.on('error', err => {
    console.error('[client error]', err);
});

client.on('shardError', err => {
    console.error('[shard error]', err);
});

process.on('unhandledRejection', err => {
    console.error('[unhandledRejection]', err);
});

process.on('uncaughtException', err => {
    console.error('[uncaughtException]', err);
});

// 이벤트 리스너를 감싸서, 어떤 오류가 나도 프로세스가 죽지 않게 합니다.
function safeListener(name, fn) {
    return async (...args) => {
        try {
            await fn(...args);
        } catch (err) {
            console.error(`[${name}]`, err);
        }
    };
}

// ─── 데이터 저장소 ─────────────────────────────────────────────────────────────

const embedBuilders = new Map();
const sendChannels  = new Map();

// ─── 데이터 로드/저장 ──────────────────────────────────────────────────────────

/**
 * 파일이 기본값의 키를 빠뜨려도 기본값으로 채웁니다. tickets_data.json 이 `{}` 로 남아 있어
 * `tickets` · `counter` 가 없었고, 티켓 생성 · 닫기 · 해결이 전부 TypeError 로 실패했습니다.
 */
function loadJSON(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    let data;
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return fallback; }
    const plain = v => v && typeof v === 'object' && !Array.isArray(v);
    return plain(fallback) && plain(data) ? { ...fallback, ...data } : data;
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

let reactionRoles = loadJSON(REACTION_FILE, {});
let ticketsData   = loadJSON(TICKETS_FILE, { tickets: {}, counter: 0 });

function saveTickets() { saveJSON(TICKETS_FILE, ticketsData); }

// ─── 보안 모듈 (Security Module) ───────────────────────────────────────────────

// ⚠️ 여기에 무엇을 넣느냐가 곧 "누가 자동으로 뮤트되느냐" 입니다.
//
// 원래 bit.ly / tinyurl.com / .xyz/ 가 들어 있었는데, 이것들은 정상 멤버가
// 단축 URL 하나만 올려도 **삭제 + 5분 타임아웃**이 되게 만듭니다. 피싱 지표가
// 아니라 "흔한 도메인" 이라서 오탐이 압도적입니다. 뺐습니다.
//
// 남긴 것은 니트로 사칭·계정 탈취·IP 로거처럼 그 자체로 정상 용도가 거의 없는
// 것들입니다. 단축 URL 을 막아야 한다면 뮤트가 아니라 경고로 다루세요.
const SUSPICIOUS_LINK_PATTERNS = [
    /discord\.gift/i, /discordnitro/i, /free-?nitro/i, /nitro-?free/i,
    /steamcommunity\.(ru|top|click)/i, /free-?steam/i,
    /grabify/i, /iplogger/i, /\bip-?logger\b/i,
    /discord(app)?\.(ru|top|click|gift-?nitro)/i,
];

const SPAM_WINDOW_MS = 5000;
const SPAM_THRESHOLD = 4;
const JOIN_WINDOW_MS = 10000;
const JOIN_THRESHOLD = 8;
const MIN_ACCOUNT_AGE_DAYS = 7;
const MAX_MENTION_COUNT = 5;

const userMessageCache = new Map(); // userId -> [timestamps]
const recentJoins = [];             // timestamps of recent joins
const mutedUsers = new Set();

function isSpam(userId) {
    const now = Date.now();
    if (!userMessageCache.has(userId)) userMessageCache.set(userId, []);
    const times = userMessageCache.get(userId).filter(t => now - t < SPAM_WINDOW_MS);
    times.push(now);
    userMessageCache.set(userId, times);
    return times.length >= SPAM_THRESHOLD;
}

function isSuspiciousLink(content) {
    return SUSPICIOUS_LINK_PATTERNS.some(p => p.test(content));
}

function hasMassMention(message) {
    return message.mentions.users.size + message.mentions.roles.size >= MAX_MENTION_COUNT
        || message.mentions.everyone;
}

async function sendSecurityLog(guild, title, description, color = 0xFF4444) {
    try {
        const ch = guild.channels.cache.get(LOG_CHANNEL_ID)
            || await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (!ch) return;
        const embed = new EmbedBuilder()
            .setTitle(`🔒 보안 알림: ${title}`)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();
        await ch.send({ embeds: [embed] });
    } catch { /* log channel unavailable */ }
}

async function muteUser(member, reason) {
    if (mutedUsers.has(member.id)) return;
    mutedUsers.add(member.id);
    try {
        await member.timeout(5 * 60 * 1000, reason); // 5-minute timeout
        setTimeout(() => mutedUsers.delete(member.id), 5 * 60 * 1000);
    } catch { mutedUsers.delete(member.id); }
}

// ─── 티켓 유틸 ─────────────────────────────────────────────────────────────────

const TICKET_CATEGORY_NAME = '📋 티켓';
const TICKET_TYPES = { inquiry: '📬 문의', report: '🚨 신고', suggestion: '💡 건의' };

async function getOrCreateTicketCategory(guild) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === TICKET_CATEGORY_NAME);
    if (!cat) {
        cat = await guild.channels.create({
            name: TICKET_CATEGORY_NAME,
            type: ChannelType.GuildCategory,
        });
    }
    return cat;
}

async function createTicketChannel(guild, member, type, title, description) {
    ticketsData.counter++;
    const ticketId = ticketsData.counter;
    const channelName = `ticket-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}-${ticketId}`;

    const category = await getOrCreateTicketCategory(guild);

    // 티켓을 볼 역할은 config/roles.json 의 ticketRoles 가 정합니다.
    //
    // 스태프 **전원**이 아닙니다. Designer·Tester 도 스태프이지만 모든 문의와
    // 신고를 볼 이유가 없습니다 — 신고에는 다른 사람의 이름과 사정이 들어갑니다.
    //
    // (예전에는 이름이 'Staff' 이거나 ManageMessages 권한인 역할을 찾았습니다.
    //  이름을 바꾸면 티켓이 안 보이고, 권한만 있는 엉뚱한 역할이 걸렸습니다.)
    const staffRoles = roles.ticketRoles()
        .map(r => guild.roles.cache.get(r.id))
        .filter(Boolean);
    const staffRole = staffRoles[0] || null;

    const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
            { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
            // 스태프 역할 전부에 열어 줍니다. 하나만 열면 나머지 스태프는
            // 티켓을 볼 수 없습니다.
            ...staffRoles.map(r => ({
                id: r.id,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
            })),
        ]
    });

    const typeLabel = TICKET_TYPES[type] || type;
    const embed = new EmbedBuilder()
        .setTitle(`${typeLabel} — ${title}`)
        .setDescription(description || '(내용 없음)')
        .addFields(
            { name: '작성자', value: `<@${member.id}>`, inline: true },
            { name: '유형', value: typeLabel, inline: true },
            { name: '티켓 번호', value: `#${ticketId}`, inline: true }
        )
        .setColor(type === 'report' ? 0xFF4444 : type === 'suggestion' ? 0x44FF44 : 0x4444FF)
        .setTimestamp()
        .setFooter({ text: '스태프가 곧 답변드리겠습니다.' });

    const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`close_ticket_${ticketId}`).setLabel('티켓 닫기').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId(`resolve_ticket_${ticketId}`).setLabel('해결 완료').setStyle(ButtonStyle.Success).setEmoji('✅')
    );

    const msg = await channel.send({ content: `<@${member.id}> ${staffRole ? `<@&${staffRole.id}>` : ''}`, embeds: [embed], components: [controlRow] });

    ticketsData.tickets[ticketId] = {
        channelId: channel.id,
        creatorId: member.id,
        type,
        title,
        description,
        open: true,
        firstMessageId: msg.id,
        createdAt: Date.now(),
        staffReplied: false,
        notifiedUser: false
    };
    saveTickets();

    return { channel, ticketId };
}

async function closeTicket(ticketId, closedBy, guild) {
    const ticket = ticketsData.tickets[ticketId];
    if (!ticket) return;

    ticket.open = false;
    saveTickets();
    await closeTicketChannel(guild.channels.cache.get(ticket.channelId), closedBy);
}

/** 종료 안내를 남기고 3초 뒤 채널을 지웁니다. */
async function closeTicketChannel(channel, closedBy) {
    try {
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('🔒 티켓 종료')
                .setDescription(`이 티켓은 <@${closedBy}>에 의해 종료되었습니다.`)
                .setColor(0x888888)
                .setTimestamp();
            await channel.send({ embeds: [embed] });
            await new Promise(r => setTimeout(r, 3000));
            await channel.delete('Ticket closed').catch(() => {});
        }
    } catch { /* channel already deleted */ }
}

// ─── 임베드 빌더 유틸 ──────────────────────────────────────────────────────────

function createEmbedButtons() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('edit_content').setLabel('내용 수정').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('edit_author').setLabel('작성자 수정').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('edit_footer').setLabel('푸터 수정').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('edit_color').setLabel('색상 수정').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('edit_images').setLabel('이미지 수정').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('send_embed').setLabel('전송 (Send)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cancel_builder').setLabel('취소 (Cancel)').setStyle(ButtonStyle.Danger),
        ),
    ];
}

function createDefaultEmbed(user) {
    return new EmbedBuilder()
        .setTitle('새 임베드 메시지')
        .setDescription('여기에 내용을 입력하세요.')
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setColor(0x0099FF)
        .setFooter({ text: 'Embed Builder' });
}

// ─── 봇 초기화 ─────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async () => {
    console.log(`✅ 로그인 성공: ${client.user.tag}`);

    // 역할 설정을 가장 먼저 검증합니다. 여기가 깨져 있으면 권한 검사와 인증
    // 역할 부여가 통째로 잘못 도는데, 증상은 "권한이 없다" 는 문의로만
    // 나타나서 원인을 찾기 어렵습니다.
    try {
        roles.load();
        console.log(`✅ 역할 설정 — 스태프 ${roles.ofKind('staff').length} · 등급 ${roles.ofKind('rank').length}`
            + ` · 인증 역할 ${roles.verifiedRole().label}`);
    } catch (e) {
        console.error('❌ config/roles.json 을 읽지 못했습니다:', e.message);
        console.error('   권한 검사와 인증 역할 부여가 동작하지 않습니다.');
    }

    const commands = [
        // 기존 명령어
        new SlashCommandBuilder().setName('임베드생성').setDescription('임베드 초안을 생성합니다.'),
        new SlashCommandBuilder().setName('채널설정').setDescription('메시지를 보낼 채널을 설정합니다.')
            .addChannelOption(o => o.setName('채널').setDescription('채널 지정').setRequired(true).addChannelTypes(ChannelType.GuildText)),
        new SlashCommandBuilder().setName('help').setDescription('명령어 목록을 확인합니다.'),
        new SlashCommandBuilder().setName('add').setDescription('반응 역할을 설정합니다.')
            .addStringOption(o => o.setName('message_id').setDescription('메시지 ID').setRequired(true))
            .addStringOption(o => o.setName('emoji').setDescription('이모지').setRequired(true))
            .addRoleOption(o => o.setName('role').setDescription('역할').setRequired(true)),

        // /sendmessage — 모달 기반 다국어/멀티라인 공지
        new SlashCommandBuilder().setName('메시지').setDescription('MOOKI를 통해 메시지를 채널에 전송합니다.'),

        // 티켓 명령어
        new SlashCommandBuilder().setName('ticket').setDescription('문의/신고/건의 티켓을 즉시 생성합니다.'),

        // 디스코드 ↔ 마크 계정 인증 (D10)
        verifyCommand,

        // 디스코드 역할 → 마크 칭호 (Phase 6)
        titles.titleSyncCommand,

        // 마크 서버 상태 · 역할 설정 점검
        minecraft.statusCommand,
        roles.roleAuditCommand,

        // 신고 폼 (§3.8)
        new SlashCommandBuilder().setName('신고')
            .setDescription('플레이어를 신고합니다. 가해자·발생 시각·사유를 입력합니다.'),

        // 평판 티어 → 디스코드 역할 (§3.7)
        reputation.setupCommand,
        reputation.syncCommand,

        // 제재 티어 (§3.9 + D5)
        sanction.sanctionCommand,
        sanction.revokeCommand,
        sanction.historyCommand,

        // 현금 충전 (docs/payment-design.md)
        payment.chargeCommand,
        payment.cancelCommand,
        payment.lookupCommand,
        payment.reviewCommand,
    ];

    try {
        await client.application.commands.set(commands);
        console.log(`✅ 슬래시 명령어 ${commands.length}개 등록`);
    } catch (e) {
        console.error('❌ 슬래시 명령어 등록 실패:', e);
    }

    // ── 칭호 동기화 (Phase 6) ────────────────────────────────────────
    //
    // 역할 ID 전체 목록은 RucCore config.yml 을 채울 때만 필요합니다
    // (설정은 2026-09-30 에 끝났습니다). 평소에는 한 줄 요약만 찍고,
    // 목록이 필요하면 .env 에 RUC_LOG_ROLES=true 를 넣습니다.
    if (GUILD_ID) {
        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) {
            console.warn('⚠️ GUILD_ID 로 서버를 찾지 못했습니다. 칭호 동기화를 건너뜁니다.');
        } else {
            titles.logRoles(guild);
            relay.logConfig();
            reputation.logConfig();
            reputation.startSyncing(guild);
            sanction.start(guild);
            payment.start(guild);

            // 설정한 역할을 실제로 부여할 수 있는 상태인지 확인합니다.
            // 가장 흔한 사고가 "봇 역할이 Ruc 보다 아래에 있어서 부여 실패" 이고,
            // 그건 인증을 끝낸 사람이 역할을 못 받는 형태로만 드러납니다.
            try {
                const audit = await roles.audit(guild);
                const broken = audit.filter(r => !r.ok);
                if (broken.length === 0) {
                    console.log(`✅ 역할 점검 — ${audit.length}개 정상`);
                } else {
                    console.warn(`⚠️ 역할 점검 — 문제 ${broken.length}건: `
                        + broken.map(row => `${row.label}(${row.key}) ${row.problem}`).join(' · '));
                }
            } catch (e) {
                console.warn('⚠️ 역할 점검 실패:', e.message);
            }

            // 기동 직후 한 번 훑습니다. 봇이 꺼져 있는 동안 바뀐 역할이
            // 이벤트로는 오지 않기 때문입니다.
            await titles.sweep(guild, false);
            titles.startSweeping(guild);
        }
    } else {
        console.warn('⚠️ GUILD_ID 가 .env 에 없습니다. 칭호 동기화를 건너뜁니다.');
    }
});

// ─── 인터랙션 핸들러 ────────────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
    try {

        // ═══════════════════════════════════════════════════════════
        // 1. 슬래시 명령어
        // ═══════════════════════════════════════════════════════════
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            // ── 티켓 명령어 ──────────────────────────────────────────
            if (commandName === '인증') {
                await handleVerify(interaction);
                return;
            }

            if (commandName === '칭호동기화') {
                await titles.handleTitleSync(interaction);
                return;
            }

            if (commandName === '서버상태') {
                await minecraft.handleStatus(interaction);
                return;
            }

            if (commandName === '역할점검') {
                await roles.handleRoleAudit(interaction);
                return;
            }

            if (commandName === '신고') {
                await interaction.showModal(report.buildModal());
                return;
            }

            if (commandName === '평판역할설정') {
                await reputation.handleSetup(interaction);
                return;
            }

            if (commandName === '평판동기화') {
                await reputation.handleSync(interaction);
                return;
            }

            if (commandName === '제재') {
                await sanction.handleSanction(interaction);
                return;
            }

            if (commandName === '제재해제') {
                await sanction.handleRevoke(interaction);
                return;
            }

            if (commandName === '기록') {
                await sanction.handleHistory(interaction);
                return;
            }

            // ── 현금 충전 (docs/payment-design.md) ───────────────────
            if (commandName === '충전') { await payment.handleCharge(interaction); return; }
            if (commandName === '충전취소') { await payment.handleCancel(interaction); return; }
            if (commandName === '결제조회') { await payment.handleLookup(interaction); return; }
            if (commandName === '결제대기') { await payment.handleReview(interaction); return; }

            if (commandName === 'ticket') {
                // /ticket 입력 시 바로 팝업창(모달) 오픈 — 유형 선택 포함
                const modal = new ModalBuilder()
                    .setCustomId('modal_ticket_direct')
                    .setTitle('🎫 티켓 생성');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('ticket_type')
                            .setLabel('유형 선택')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setPlaceholder('문의 / 신고 / 건의 중 하나를 입력하세요')
                            .setMinLength(2)
                            .setMaxLength(10)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('ticket_title')
                            .setLabel('제목')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setMaxLength(100)
                            .setPlaceholder('티켓 제목을 입력하세요')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('ticket_desc')
                            .setLabel('자세한 내용')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                            .setMaxLength(1000)
                            .setPlaceholder('자세한 내용을 입력하세요 (선택사항)')
                    )
                );
                return interaction.showModal(modal);
            }

            // ── sendmessage (모달 기반, 멀티라인 공지) ───────────────
            if (commandName === '메시지') {
                if (!roles.isStaff(interaction.member)) {
                    return interaction.reply({ content: '❌ 스태프 전용 명령어입니다.', flags: MessageFlags.Ephemeral });
                }
                const modal = new ModalBuilder().setCustomId('modal_sendmessage').setTitle('메시지 작성');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('msg_title').setLabel('제목 (Title)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('예) 서버 공지사항')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('msg_content').setLabel('내용 (\\n으로 줄바꿈)').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('여러 줄은 \\n 또는 Enter로 입력하세요.')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('msg_color').setLabel('색상 (Hex, 선택)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('#FF4444')
                    )
                );
                return interaction.showModal(modal);
            }

            // ── 기존 유틸 ─────────────────────────────────────────────
            if (commandName === 'help') {
                const embed = new EmbedBuilder()
                    .setTitle('📋 MOOKI 명령어 목록')
                    .setColor('Red')
                    .addFields(
                        { name: '🎮 러크 서버', value: '`/인증` `/서버상태` `/신고` `/ticket`' },
                        { name: '🛡️ 스태프', value: '`/제재` `/제재해제` `/기록` `/칭호동기화` `/평판동기화` `/평판역할설정` `/역할점검`' },
                        { name: '🛠️ 관리 도구', value: '`/임베드생성` `/채널설정` `/add` `/메시지`' }
                    );
                return interaction.reply({ embeds: [embed] });
            }
            if (commandName === 'channel') {
                if (!roles.isStaff(interaction.member))
                    return interaction.reply({ content: '❌ 스태프 전용 명령어입니다.', flags: MessageFlags.Ephemeral });
                sendChannels.set(interaction.guildId, interaction.options.getChannel('채널').id);
                return interaction.reply({ content: `✅ 채널 설정 완료: **${interaction.options.getChannel('채널').name}**`, flags: MessageFlags.Ephemeral });
            }
            if (commandName === 'add') {
                const msgId = interaction.options.getString('message_id');
                const emoji = interaction.options.getString('emoji');
                const role  = interaction.options.getRole('role');
                if (!reactionRoles[interaction.guildId]) reactionRoles[interaction.guildId] = {};
                if (!reactionRoles[interaction.guildId][msgId]) reactionRoles[interaction.guildId][msgId] = {};
                reactionRoles[interaction.guildId][msgId][emoji] = role.id;
                fs.writeFileSync(REACTION_FILE, JSON.stringify(reactionRoles, null, 4));
                return interaction.reply({ content: `✅ 리액션 롤 설정 완료: ${emoji} → ${role.name}`, flags: MessageFlags.Ephemeral });
            }
            if (commandName === 'embedbuilder') {
                const initialEmbed = createDefaultEmbed(interaction.user);
                // fetchReply 옵션은 폐기됐습니다. 답장을 보낸 뒤 따로 가져옵니다.
                await interaction.reply({ content: `🎨 **${interaction.user.tag}** 님의 임베드 빌더입니다.`, embeds: [initialEmbed], components: createEmbedButtons() });
                const reply = await interaction.fetchReply();
                embedBuilders.set(interaction.user.id, { embed: initialEmbed, originalMessageId: reply.id, channelId: interaction.channelId });
            }
        }

        // ═══════════════════════════════════════════════════════════
        // 2. 버튼 상호작용
        // ═══════════════════════════════════════════════════════════
        else if (interaction.isButton()) {
            const { customId } = interaction;

            // ── 티켓 유형 선택 버튼 ─────────────────────────────────
            if (customId.startsWith('ticket_type_')) {
                const type = customId.replace('ticket_type_', '');

                // 신고는 전용 폼을 씁니다 (§3.8 — 가해자·시각·사유).
                // 제목+내용만 받으면 "누가 욕했어요" 로 끝나서 조사가 안 됩니다.
                if (type === 'report') {
                    return interaction.showModal(report.buildModal());
                }

                const modal = new ModalBuilder().setCustomId(`modal_ticket_${type}`).setTitle(`${TICKET_TYPES[type]} 티켓 생성`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('ticket_title').setLabel('제목').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('ticket_desc').setLabel('자세한 내용').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
                    )
                );
                return interaction.showModal(modal);
            }

            // ── 티켓 닫기/해결 버튼 ─────────────────────────────────
            if (customId.startsWith('close_ticket_') || customId.startsWith('resolve_ticket_')) {
                const parts = customId.split('_');
                const ticketId = parseInt(parts[parts.length - 1]);
                const ticket = ticketsData.tickets[ticketId];
                if (!ticket) {
                    // 기록이 없는 티켓 — 위 loadJSON 버그 동안 만들어진 채널(번호 NaN)입니다.
                    // 작성자를 알 수 없으므로 스태프만, 티켓 분류 안의 채널일 때만 닫습니다.
                    const ch = interaction.channel;
                    if (roles.isStaff(interaction.member) && ch?.parent?.name === TICKET_CATEGORY_NAME) {
                        await interaction.reply({ content: '🔒 기록이 없는 티켓이라 채널만 정리합니다...', flags: MessageFlags.Ephemeral });
                        await closeTicketChannel(ch, interaction.user.id);
                        return;
                    }
                    return interaction.reply({ content: '❌ 티켓 기록이 없습니다. 스태프에게 닫아 달라고 요청해 주세요.', flags: MessageFlags.Ephemeral });
                }
                if (!roles.isStaff(interaction.member) && interaction.user.id !== ticket.creatorId)
                    return interaction.reply({ content: '❌ 권한이 없습니다.', flags: MessageFlags.Ephemeral });
                await interaction.reply({ content: '🔒 티켓을 종료합니다...', flags: MessageFlags.Ephemeral });
                await closeTicket(ticketId, interaction.user.id, interaction.guild);
                return;
            }

            // ── 티켓 읽음 확인 버튼 (DM 내) ─────────────────────────
            if (customId.startsWith('ticket_read_')) {
                const ticketId = parseInt(customId.replace('ticket_read_', ''));
                const ticket = ticketsData.tickets[ticketId];
                if (!ticket) return interaction.reply({ content: '❌ 티켓을 찾을 수 없습니다.', flags: MessageFlags.Ephemeral });
                ticket.notifiedUser = true;
                saveTickets();

                try {
                    const guild = client.guilds.cache.get(GUILD_ID);
                    const ch = guild?.channels.cache.get(ticket.channelId);
                    if (ch) {
                        await ch.send({
                            content: `<@${ticket.creatorId}>`,
                            embeds: [new EmbedBuilder()
                                .setDescription('✅ 사용자가 답변을 확인했습니다. 해결이 완료되었다면 아래 **티켓 닫기** 버튼을 눌러 티켓을 종료해주세요.')
                                .setColor(0x00CC00)]
                        });
                    }
                } catch { /* guild unavailable */ }

                return interaction.update({ content: '✅ 확인 완료! 스태프에게 알렸습니다.', components: [] });
            }

            // ── 제재 버튼 (집행·승인·재시도) ─────────────────────────
            // 임베드 빌더보다 먼저 봐야 합니다. 그쪽은 모르는 버튼을
            // "세션 만료" 로 처리합니다.
            if (await sanction.handleButton(interaction)) return;
            if (await payment.handleButton(interaction)) return;

            // ── 임베드 빌더 버튼 ─────────────────────────────────────
            const draft = embedBuilders.get(interaction.user.id);
            if (!draft) return interaction.reply({ content: '❌ 세션이 만료되었습니다. 다시 명령어를 입력하세요.', flags: MessageFlags.Ephemeral });

            if (customId === 'send_embed') {
                const chId = sendChannels.get(interaction.guildId);
                if (!chId) return interaction.reply({ content: '❌ `/channel`로 채널을 먼저 설정하세요.', flags: MessageFlags.Ephemeral });
                const ch = await client.channels.fetch(chId);
                await ch.send({ embeds: [draft.embed] });
                embedBuilders.delete(interaction.user.id);
                return interaction.reply({ content: '✅ 전송 완료!', flags: MessageFlags.Ephemeral });
            }
            if (customId === 'cancel_builder') {
                embedBuilders.delete(interaction.user.id);
                await interaction.message.delete().catch(() => {});
                return interaction.reply({ content: '🗑️ 취소되었습니다.', flags: MessageFlags.Ephemeral });
            }

            // 수정 버튼 → 모달
            let modal = null;
            if (customId === 'edit_content') {
                modal = new ModalBuilder().setCustomId('modal_content').setTitle('내용 수정');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_title').setLabel('제목').setStyle(TextInputStyle.Short).setRequired(false).setValue(draft.embed.data.title || '')),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_desc').setLabel('설명').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(draft.embed.data.description || ''))
                );
            } else if (customId === 'edit_author') {
                modal = new ModalBuilder().setCustomId('modal_author').setTitle('작성자 수정');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_auth_name').setLabel('이름').setStyle(TextInputStyle.Short).setRequired(false)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_auth_icon').setLabel('아이콘 URL').setStyle(TextInputStyle.Short).setRequired(false))
                );
            } else if (customId === 'edit_footer') {
                modal = new ModalBuilder().setCustomId('modal_footer').setTitle('푸터 수정');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_footer_text').setLabel('텍스트').setStyle(TextInputStyle.Short).setRequired(false)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_footer_icon').setLabel('아이콘 URL').setStyle(TextInputStyle.Short).setRequired(false))
                );
            } else if (customId === 'edit_color') {
                modal = new ModalBuilder().setCustomId('modal_color').setTitle('색상 수정');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_color').setLabel('Hex Color (#FF0000)').setStyle(TextInputStyle.Short).setRequired(true)));
            } else if (customId === 'edit_images') {
                modal = new ModalBuilder().setCustomId('modal_images').setTitle('이미지 수정');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_img').setLabel('이미지 URL').setStyle(TextInputStyle.Short).setRequired(false)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_thumb').setLabel('썸네일 URL').setStyle(TextInputStyle.Short).setRequired(false))
                );
            }
            if (modal) await interaction.showModal(modal);
        }

        // ═══════════════════════════════════════════════════════════
        // 3. 모달 제출
        // ═══════════════════════════════════════════════════════════
        else if (interaction.type === InteractionType.ModalSubmit) {

            if (await payment.handleModal(interaction)) return;

            // ── 티켓 생성 모달 (버튼 경유 방식 — 하위 호환 유지) ────
            if (interaction.customId === 'modal_report') {
                await report.handleSubmit(interaction, createTicketChannel);
                return;
            }

            if (interaction.customId.startsWith('modal_ticket_') && interaction.customId !== 'modal_ticket_direct') {
                const type  = interaction.customId.replace('modal_ticket_', '');
                const title = interaction.fields.getTextInputValue('ticket_title');
                const desc  = interaction.fields.getTextInputValue('ticket_desc');
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const { channel } = await createTicketChannel(interaction.guild, interaction.member, type, title, desc);
                return interaction.editReply({ content: `✅ 티켓이 생성되었습니다: ${channel}` });
            }

            // ── 티켓 생성 모달 (직접 팝업 방식 — /ticket 신규) ──────
            if (interaction.customId === 'modal_ticket_direct') {
                const rawType = interaction.fields.getTextInputValue('ticket_type').trim();
                const title   = interaction.fields.getTextInputValue('ticket_title');
                const desc    = interaction.fields.getTextInputValue('ticket_desc');

                // 한국어 입력 → 내부 타입 변환
                const typeMap = {
                    '문의': 'inquiry', '문의하기': 'inquiry', 'inquiry': 'inquiry',
                    '신고': 'report',  '신고하기': 'report',  'report': 'report',
                    '건의': 'suggestion', '건의하기': 'suggestion', 'suggestion': 'suggestion',
                };
                const type = typeMap[rawType.toLowerCase()] || null;

                if (!type) {
                    return interaction.reply({
                        content: `❌ 올바른 유형을 입력해주세요.\n> 📬 \`문의\` · 🚨 \`신고\` · 💡 \`건의\``,
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const { channel } = await createTicketChannel(interaction.guild, interaction.member, type, title, desc);
                return interaction.editReply({ content: `✅ 티켓이 생성되었습니다: ${channel}` });
            }

            // ── sendmessage 모달 ──────────────────────────────────────
            if (interaction.customId === 'modal_sendmessage') {
                const chId = sendChannels.get(interaction.guildId);
                if (!chId) return interaction.reply({ content: '❌ `/channel`로 채널을 먼저 설정하세요.', flags: MessageFlags.Ephemeral });

                const title   = interaction.fields.getTextInputValue('msg_title');
                const content = interaction.fields.getTextInputValue('msg_content').replace(/\\n/g, '\n');
                const hexColor = interaction.fields.getTextInputValue('msg_color').trim();

                let color = 0xFFAA00;
                if (hexColor) {
                    const parsed = parseInt(hexColor.replace('#', ''), 16);
                    if (!isNaN(parsed)) color = parsed;
                }

                const now = new Date();
                const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;

                const embed = new EmbedBuilder()
                    .setTitle(`📢 ${title}`)
                    .setDescription(content)
                    .setColor(color)
                    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
                    .setFooter({ text: `Rustcraft 공식 공지 • ${dateStr}` })
                    .setTimestamp();

                const ch = await client.channels.fetch(chId);
                await ch.send({ embeds: [embed] });
                return interaction.reply({ content: '✅ 공지 메시지를 전송했습니다.', flags: MessageFlags.Ephemeral });
            }

            // ── 임베드 빌더 모달 ──────────────────────────────────────
            const draft = embedBuilders.get(interaction.user.id);
            if (!draft) return interaction.reply({ content: '❌ 세션 만료.', flags: MessageFlags.Ephemeral });

            const embed = draft.embed;
            if (interaction.customId === 'modal_content') {
                const t = interaction.fields.getTextInputValue('inp_title');
                const d = interaction.fields.getTextInputValue('inp_desc');
                embed.setTitle(t || null); embed.setDescription(d || null);
            } else if (interaction.customId === 'modal_author') {
                const n = interaction.fields.getTextInputValue('inp_auth_name');
                const i = interaction.fields.getTextInputValue('inp_auth_icon');
                embed.setAuthor(n ? { name: n, iconURL: i || undefined } : null);
            } else if (interaction.customId === 'modal_footer') {
                const t = interaction.fields.getTextInputValue('inp_footer_text');
                const i = interaction.fields.getTextInputValue('inp_footer_icon');
                embed.setFooter(t ? { text: t, iconURL: i || undefined } : null);
            } else if (interaction.customId === 'modal_color') {
                try { embed.setColor(interaction.fields.getTextInputValue('inp_color')); } catch { /* invalid color */ }
            } else if (interaction.customId === 'modal_images') {
                const img = interaction.fields.getTextInputValue('inp_img');
                const thumb = interaction.fields.getTextInputValue('inp_thumb');
                embed.setImage(img || null); embed.setThumbnail(thumb || null);
            }

            try {
                const ch = await client.channels.fetch(draft.channelId);
                const msg = await ch.messages.fetch(draft.originalMessageId);
                await msg.edit({ embeds: [embed] });
                await interaction.deferUpdate();
            } catch {
                await interaction.reply({ content: '❌ 메시지 업데이트 실패', flags: MessageFlags.Ephemeral });
            }
        }

    } catch (error) {
        console.error('❌ Interaction Error:', error);
        if (!interaction.replied && !interaction.deferred)
            await interaction.reply({ content: '❌ 오류가 발생했습니다.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
});

// ─── 메시지 이벤트 (보안 + 티켓 응답 감지) ────────────────────────────────────

client.on('messageCreate', safeListener('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // ── 디스코드 → 인게임 중계 (Phase 6-3) ─────────────────────────
    // 위의 author.bot 검사가 무한 루프를 막습니다. 플러그인이 웹훅으로 쓴
    // 글도 bot 이라서 여기서 걸러지고, 그러지 않으면 서버와 디스코드가
    // 같은 문장을 영원히 되돌립니다.
    //
    // await 하지 않습니다 — RCON 왕복을 기다리면 그 채널의 보안 검사와
    // 티켓 감지가 그만큼 늦어집니다.
    relay.onMessage(message).catch(err => console.error('[중계]', err));

    const member = message.guild.members.cache.get(message.author.id);
    // 역할 기준으로 봅니다 (config/roles.json). Administrator 는 roles.isStaff
    // 안에서 항상 통과하므로 서버 주인이 자기 봇에 막히는 일은 없습니다.
    const isStaff = roles.isStaff(member);

    // ── 티켓 채널 응답 감지 ────────────────────────────────────────
    const openTicket = Object.entries(ticketsData.tickets).find(([, t]) =>
        t.channelId === message.channelId && t.open && !t.staffReplied && message.author.id !== t.creatorId
    );
    if (openTicket) {
        const [ticketId, ticket] = openTicket;
        ticket.staffReplied = true;
        saveTickets();

        try {
            const creator = await client.users.fetch(ticket.creatorId);
            const readRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket_read_${ticketId}`).setLabel('✅ 답변 확인 완료').setStyle(ButtonStyle.Success)
            );
            await creator.send({
                embeds: [new EmbedBuilder()
                    .setTitle('📬 티켓 답변 도착')
                    .setDescription(`**${ticket.title}** 티켓에 스태프가 답변했습니다!\n<#${ticket.channelId}>에서 확인하세요.\n\n답변을 모두 읽으셨다면 아래 버튼을 눌러주세요.`)
                    .setColor(0x5865F2)
                    .setTimestamp()],
                components: [readRow]
            });
        } catch { /* DMs closed */ }
    }

    // ── 보안: 의심 링크 감지 ───────────────────────────────────────
    // 스팸·대량멘션과 달리 원래 스태프 예외가 없었습니다. 스태프가 피싱
    // 사례를 공유하려고 링크를 붙이는 순간 본인이 뮤트됐습니다.
    if (!isStaff && isSuspiciousLink(message.content)) {
        await message.delete().catch(() => {});
        await message.channel.send({ content: `⚠️ <@${message.author.id}> 의심스러운 링크가 감지되어 삭제되었습니다.` }).catch(() => {});
        await sendSecurityLog(message.guild, '의심 링크 감지', `**${message.author.tag}**가 의심 링크를 전송했습니다.\n채널: <#${message.channelId}>\n내용: \`${message.content.substring(0, 200)}\``);
        if (member) await muteUser(member, '의심 링크 전송');
        return;
    }

    // ── 보안: 대량 멘션 감지 ───────────────────────────────────────
    if (hasMassMention(message) && !isStaff) {
        await message.delete().catch(() => {});
        await sendSecurityLog(message.guild, '대량 멘션 감지', `**${message.author.tag}**가 대량 멘션을 시도했습니다.\n채널: <#${message.channelId}>`);
        if (member) await muteUser(member, '대량 멘션');
        return;
    }

    // ── 보안: 스팸 감지 ────────────────────────────────────────────
    if (!isStaff && isSpam(message.author.id)) {
        if (member) {
            await muteUser(member, '스팸 감지');
            await sendSecurityLog(message.guild, '스팸 감지', `**${message.author.tag}**가 스팸을 전송하여 타임아웃 처리되었습니다.`, 0xFF8800);
        }
    }
}));

// ─── 멤버 입장 이벤트 (보안) ───────────────────────────────────────────────────

client.on('guildMemberAdd', safeListener('guildMemberAdd', async member => {
    const now = Date.now();

    // 레이드 감지 (10초 내 8명 이상 입장)
    recentJoins.push(now);
    while (recentJoins.length && now - recentJoins[0] > JOIN_WINDOW_MS) recentJoins.shift();
    if (recentJoins.length >= JOIN_THRESHOLD) {
        await sendSecurityLog(member.guild, '🚨 레이드 경고',
            `10초 내 **${recentJoins.length}명**이 입장했습니다! 레이드 가능성이 있습니다.\n최근 입장: <@${member.id}>`,
            0xFF0000);
    }

    // 신규 계정 경고 (7일 미만)
    const accountAge = now - member.user.createdTimestamp;
    const ageDays = Math.floor(accountAge / 86400000);
    if (ageDays < MIN_ACCOUNT_AGE_DAYS) {
        await sendSecurityLog(member.guild, '신규 계정 감지',
            `<@${member.id}> (**${member.user.tag}**)의 계정이 생성된 지 **${ageDays}일**밖에 되지 않았습니다.`,
            0xFFAA00);
    }
}));

// ─── 역할 변경 → 마크 칭호 동기화 (Phase 6) ───────────────────────────────────
//
// guildMemberUpdate 는 닉네임 변경·타임아웃·아바타 변경으로도 옵니다.
// titles.onMemberUpdate 가 "칭호와 연결된 역할이 실제로 바뀐 경우" 만 걸러서
// RCON 을 엽니다 — 그러지 않으면 마크 서버가 이유 없이 두드려 맞습니다.

client.on('guildMemberUpdate', safeListener('guildMemberUpdate', async (oldMember, newMember) => {
    await titles.onMemberUpdate(oldMember, newMember);
}));

// ─── 리액션 롤 이벤트 ──────────────────────────────────────────────────────────

client.on('messageReactionAdd', safeListener('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    const gData = reactionRoles[reaction.message.guildId];
    const roleId = gData?.[reaction.message.id]?.[reaction.emoji.name]
        || gData?.[reaction.message.id]?.[`<:${reaction.emoji.name}:${reaction.emoji.id}>`];
    if (roleId) {
        const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
        member?.roles.add(roleId).catch(() => {});
    }
}));

client.on('messageReactionRemove', safeListener('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    const gData = reactionRoles[reaction.message.guildId];
    const roleId = gData?.[reaction.message.id]?.[reaction.emoji.name]
        || gData?.[reaction.message.id]?.[`<:${reaction.emoji.name}:${reaction.emoji.id}>`];
    if (roleId) {
        const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
        member?.roles.remove(roleId).catch(() => {});
    }
}));

// ─── 종료 처리 ─────────────────────────────────────────────────────────────────
//
// 티켓 데이터는 변경 시점마다 파일에 쓰지만, 마지막 쓰기 직후 Ctrl+C 가
// 들어오면 디스코드 연결이 끊기지 않은 채 프로세스가 사라집니다. 그러면 봇이
// 몇 분간 "온라인" 으로 남아 있고 그동안의 명령이 전부 응답 없이 실패합니다.
// destroy() 로 게이트웨이를 정상 종료하면 즉시 오프라인으로 바뀝니다.

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n⏹️  ${signal} — 종료합니다…`);
    try {
        saveJSON(TICKETS_FILE, ticketsData);
        saveJSON(REACTION_FILE, reactionRoles);
        console.log('   데이터 저장 완료');
    } catch (e) {
        console.error('   데이터 저장 실패:', e.message);
    }

    try {
        await client.destroy();
        console.log('   디스코드 연결 종료');
    } catch { /* 이미 끊긴 경우 */ }

    process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { shutdown(signal); });
}

// ─── 로그인 ────────────────────────────────────────────────────────────────────

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ DISCORD_TOKEN이 .env에 없습니다.');
    process.exit(1);
}

client.login(token).catch(err => {
    // 토큰이 틀리면 discord.js 가 조용히 재시도하지 않고 던집니다.
    // 여기서 잡지 않으면 스택트레이스만 남고 원인이 안 보입니다.
    console.error('❌ 디스코드 로그인 실패:', err.message);
    console.error('   .env 의 DISCORD_TOKEN 을 확인하세요 (재발급했다면 새 값으로 교체).');
    process.exit(1);
});
