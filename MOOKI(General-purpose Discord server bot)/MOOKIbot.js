const {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField,
    ChannelType, InteractionType, AttachmentBuilder, Events
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// dotenv 이후에 require 해야 합니다 (아래 모듈이 환경변수를 사용)
const { verifyCommand, handleVerify } = require('./verification');

const REACTION_FILE = path.join(__dirname, 'reaction_roles.json');
const ECONOMY_FILE  = path.join(__dirname, 'economy_data.json');
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

function loadJSON(filePath, fallback) {
    if (fs.existsSync(filePath)) {
        try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
        catch { return fallback; }
    }
    return fallback;
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

let reactionRoles = loadJSON(REACTION_FILE, {});
let economyData   = loadJSON(ECONOMY_FILE, { users: {}, companies: {}, market_index: 100 });
let ticketsData   = loadJSON(TICKETS_FILE, { tickets: {}, counter: 0 });

function saveTickets() { saveJSON(TICKETS_FILE, ticketsData); }
function saveEconomyData(data) { saveJSON(ECONOMY_FILE, data); }

// ─── 보안 모듈 (Security Module) ───────────────────────────────────────────────

const SUSPICIOUS_LINK_PATTERNS = [
    /discord\.gift/i, /discordnitro/i, /free-nitro/i, /steamcommunity\.ru/i,
    /bit\.ly/i, /tinyurl\.com/i, /grabify/i, /iplogger/i, /\.xyz\//i,
    /phishing/i, /free-steam/i
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

    const staffRole = guild.roles.cache.find(r => r.name === 'Staff' || r.name === '스태프' || r.permissions.has(PermissionsBitField.Flags.ManageMessages));

    const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
            { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
            ...(staffRole ? [{ id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }] : []),
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

    try {
        const channel = guild.channels.cache.get(ticket.channelId);
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

// ─── 경제 유틸 ─────────────────────────────────────────────────────────────────

function calculateInflationMultiplier() {
    const total = Object.values(economyData.users).reduce((acc, u) => acc + (u.money || 0), 0);
    return Math.max(1.0, 1.0 + total / 1000000);
}

function generateTextChart(history) {
    if (!history || history.length === 0) return '데이터 없음';
    const max = Math.max(...history);
    const min = Math.min(...history);
    const range = max - min || 1;
    const height = 5;
    let chart = '```\n';
    for (let h = height; h >= 0; h--) {
        let line = `${Math.floor(min + range * h / height).toString().padStart(6)} | `;
        for (const val of history) {
            const level = Math.round(((val - min) / range) * height);
            line += level === h ? '● ' : '  ';
        }
        chart += line + '\n';
    }
    chart += '       └' + '─'.repeat(history.length * 2) + '\n```';
    return chart;
}

function updateStockPrice(companyName) {
    const company = economyData.companies[companyName];
    if (!company?.history) return null;
    const change = (Math.random() * 0.1) - 0.05;
    company.stockPrice = Math.max(1, Math.floor(company.stockPrice * (1 + change)));
    company.history.push(company.stockPrice);
    if (company.history.length > 10) company.history.shift();
    saveEconomyData(economyData);
    return company.stockPrice;
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

client.once('ready', async () => {
    console.log(`✅ 로그인 성공: ${client.user.tag}`);

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

        // 경제 명령어
        new SlashCommandBuilder().setName('가입').setDescription('경제 시스템에 가입합니다.'),
        new SlashCommandBuilder().setName('탈퇴').setDescription('경제 시스템에서 탈퇴합니다.'),
        new SlashCommandBuilder().setName('출석체크').setDescription('일일 보상을 받습니다.'),
        new SlashCommandBuilder().setName('주식').setDescription('기업 주가 정보를 확인합니다.')
            .addStringOption(o => o.setName('기업명').setDescription('기업 이름').setRequired(true)),
        new SlashCommandBuilder().setName('랭크').setDescription('자산 순위를 확인합니다.'),
        new SlashCommandBuilder().setName('인벤토리').setDescription('보유 아이템을 확인합니다.'),
        new SlashCommandBuilder().setName('재화').setDescription('보유 자산을 확인합니다.'),
        new SlashCommandBuilder().setName('창업').setDescription('새로운 기업을 창업합니다.')
            .addStringOption(o => o.setName('기업명').setDescription('기업 이름').setRequired(true)),
        new SlashCommandBuilder().setName('상장').setDescription('기업을 주식 시장에 상장합니다.')
            .addStringOption(o => o.setName('기업명').setDescription('기업 이름').setRequired(true)),
        new SlashCommandBuilder().setName('인수').setDescription('타 기업을 인수합니다.')
            .addStringOption(o => o.setName('기업명').setDescription('기업 이름').setRequired(true)),
        new SlashCommandBuilder().setName('ruc지급').setDescription('관리자가 특정 유저에게 RUC를 지급합니다.')
            .addUserOption(o => o.setName('유저').setDescription('지급할 유저').setRequired(true))
            .addIntegerOption(o => o.setName('금액').setDescription('지급할 RUC 금액').setRequired(true)),
        new SlashCommandBuilder().setName('프로필').setDescription('경제 프로필 카드를 생성합니다.')
            .addUserOption(o => o.setName('유저').setDescription('프로필을 볼 유저 (선택)').setRequired(false)),

        // 디스코드 ↔ 마크 계정 인증 (D10)
        verifyCommand,
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ 슬래시 명령어 등록 완료.');
    } catch (e) {
        console.error('❌ 슬래시 명령어 등록 실패:', e);
    }
});

// ─── 인터랙션 핸들러 ────────────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
    try {

        // ═══════════════════════════════════════════════════════════
        // 1. 슬래시 명령어
        // ═══════════════════════════════════════════════════════════
        if (interaction.isChatInputCommand()) {
            const { commandName, user } = interaction;
            const userId = user.id;

            // ── 티켓 명령어 ──────────────────────────────────────────
            if (commandName === '인증') {
                await handleVerify(interaction);
                return;
            }

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
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                    return interaction.reply({ content: '❌ 권한이 부족합니다.', ephemeral: true });
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

            // ── 경제 시스템 명령어 ────────────────────────────────────
            const requiresJoin = ['출석체크','주식','랭크','인벤토리','재화','창업','상장','인수','프로필'];
            if (requiresJoin.includes(commandName) && !economyData.users[userId]) {
                return interaction.reply({ content: '❌ `/가입` 먼저 해주세요.', ephemeral: true });
            }

            if (commandName === '가입') {
                if (economyData.users[userId]) return interaction.reply({ content: '❌ 이미 가입되어 있습니다.', ephemeral: true });
                economyData.users[userId] = { money: 1000, inventory: [], companies: [], lastCheckIn: 0, streak: 0 };
                saveEconomyData(economyData);
                return interaction.reply({ content: `✅ **${user.username}**님 가입 완료! (지원금: 1,000 RUC)` });
            }
            if (commandName === '탈퇴') {
                if (!economyData.users[userId]) return interaction.reply({ content: '❌ 가입 정보가 없습니다.', ephemeral: true });
                delete economyData.users[userId];
                saveEconomyData(economyData);
                return interaction.reply({ content: '✅ 탈퇴 완료.' });
            }
            if (commandName === '출석체크') {
                const u = economyData.users[userId];
                const now = Date.now();
                if (now - u.lastCheckIn < 86400000) return interaction.reply({ content: '⏳ 24시간 후에 다시 출석해주세요.', ephemeral: true });
                u.streak = (now - u.lastCheckIn < 172800000) ? u.streak + 1 : 1;
                u.lastCheckIn = now;
                const reward = Math.floor(100 * calculateInflationMultiplier() * (1 + Math.min(u.streak * 0.1, 2)));
                u.money += reward;
                saveEconomyData(economyData);
                return interaction.reply({ content: `📅 출석 완료! **+${reward} RUC** (연속 ${u.streak}일)` });
            }
            if (commandName === '재화') {
                const m = economyData.users[userId].money;
                try {
                    await user.send(`\`\`\`txt\n[ ${user.username}님의 자산 정보 ]\n\n💵 보유 RUC: ${m.toLocaleString()} RUC\n\`\`\``);
                    return interaction.reply({ content: '✅ DM으로 재화 정보를 보냈습니다.', ephemeral: true });
                } catch { return interaction.reply({ content: '❌ DM을 보낼 수 없습니다. DM을 열어주세요.', ephemeral: true }); }
            }
            if (commandName === '인벤토리') {
                const items = economyData.users[userId].inventory;
                const invText = items.length > 0 ? items.map(i => `- ${i}`).join('\n') : '(비어있음)';
                try {
                    await user.send(`\`\`\`txt\n[ ${user.username}님의 인벤토리 ]\n\n${invText}\n\`\`\``);
                    return interaction.reply({ content: '✅ DM으로 인벤토리를 보냈습니다.', ephemeral: true });
                } catch { return interaction.reply({ content: '❌ DM을 보낼 수 없습니다.', ephemeral: true }); }
            }
            if (commandName === '랭크') {
                const list = Object.entries(economyData.users).sort(([, a], [, b]) => b.money - a.money);
                const top10 = list.slice(0, 10);
                const myRank = list.findIndex(([id]) => id === userId);
                const embed = new EmbedBuilder()
                    .setTitle('🏆 MOOKI 서버 부자 랭킹 (TOP 10)')
                    .setColor('Gold')
                    .setDescription(top10.map(([id, d], i) => `**#${i + 1}** <@${id}> : \`${d.money.toLocaleString()} RUC\``).join('\n') || '데이터 없음')
                    .setFooter({ text: `${user.username}님의 순위: ${myRank >= 0 ? myRank + 1 : '?'}위`, iconURL: user.displayAvatarURL() });
                return interaction.reply({ embeds: [embed] });
            }
            if (commandName === '창업') {
                const name = interaction.options.getString('기업명');
                if (economyData.companies[name]) return interaction.reply({ content: '❌ 이미 존재하는 기업명입니다.', ephemeral: true });
                if (economyData.users[userId].money < 5000) return interaction.reply({ content: '❌ 5,000 RUC이 필요합니다.', ephemeral: true });
                economyData.users[userId].money -= 5000;
                economyData.companies[name] = { owner: userId, stockPrice: 100, history: [100], isPublic: false };
                economyData.users[userId].companies = economyData.users[userId].companies || [];
                economyData.users[userId].companies.push(name);
                saveEconomyData(economyData);
                return interaction.reply({ content: `🏢 **${name}** 창업 완료! (-5,000 RUC)` });
            }
            if (commandName === '상장') {
                const name = interaction.options.getString('기업명');
                const comp = economyData.companies[name];
                if (!comp || comp.owner !== userId) return interaction.reply({ content: '❌ 권한이 없거나 존재하지 않는 기업입니다.', ephemeral: true });
                comp.isPublic = true;
                saveEconomyData(economyData);
                return interaction.reply({ content: `📈 **${name}** 상장 완료!` });
            }
            if (commandName === '주식') {
                const name = interaction.options.getString('기업명');
                const comp = economyData.companies[name];
                if (!comp?.isPublic) return interaction.reply({ content: '❌ 찾을 수 없거나 비상장 기업입니다.', ephemeral: true });
                const price = updateStockPrice(name);
                return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`📊 ${name} 주가`).setDescription(`현재 가격: **${price} RUC**\n${generateTextChart(comp.history)}`).setColor(0x00CC88)] });
            }
            if (commandName === '인수') {
                const name = interaction.options.getString('기업명');
                const comp = economyData.companies[name];
                if (!comp || comp.owner === userId) return interaction.reply({ content: '❌ 본인 소유이거나 기업이 없습니다.', ephemeral: true });
                const price = comp.stockPrice * 100;
                if (economyData.users[userId].money < price) return interaction.reply({ content: `❌ 자금 부족 (필요: ${price.toLocaleString()} RUC)`, ephemeral: true });
                if (economyData.users[comp.owner]) economyData.users[comp.owner].money += price;
                economyData.users[userId].money -= price;
                comp.owner = userId;
                saveEconomyData(economyData);
                return interaction.reply({ content: `🤝 **${name}** 인수 완료! (-${price.toLocaleString()} RUC)` });
            }
            if (commandName === 'ruc지급') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                    return interaction.reply({ content: '❌ 관리자 전용 명령어입니다.', ephemeral: true });
                const target = interaction.options.getUser('유저');
                const amount = interaction.options.getInteger('금액');
                if (!economyData.users[target.id]) return interaction.reply({ content: `❌ ${target.username}님은 경제 시스템에 가입되어 있지 않습니다.`, ephemeral: true });
                economyData.users[target.id].money += amount;
                saveEconomyData(economyData);
                return interaction.reply({ content: `✅ **${target.username}**님에게 **${amount.toLocaleString()} RUC** 지급 완료.\n현재 잔액: ${economyData.users[target.id].money.toLocaleString()} RUC` });
            }
            if (commandName === '프로필') {
                const target = interaction.options.getUser('유저') || user;
                const tData = economyData.users[target.id];
                if (!tData) return interaction.reply({ content: `❌ ${target.username}님은 경제 시스템에 가입되어 있지 않습니다.`, ephemeral: true });
                await interaction.deferReply();

                const list = Object.entries(economyData.users).sort(([, a], [, b]) => b.money - a.money);
                const rankIdx = list.findIndex(([id]) => id === target.id);
                const rankText = rankIdx >= 0 ? `#${rankIdx + 1}` : 'Unranked';

                const canvas = createCanvas(700, 250);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#23272A'; ctx.fillRect(0, 0, 700, 250);
                ctx.strokeStyle = '#0099ff'; ctx.lineWidth = 10; ctx.strokeRect(0, 0, 700, 250);
                ctx.font = 'bold 36px sans-serif'; ctx.fillStyle = '#ffffff';
                ctx.fillText(target.username, 260, 60);
                ctx.font = '28px sans-serif'; ctx.fillStyle = '#dddddd';
                ctx.fillText(`자산: ${tData.money.toLocaleString()} RUC`, 260, 110);
                ctx.fillText(`랭킹: ${rankText}`, 260, 150);
                ctx.fillText(`연속 출석: ${tData.streak}일`, 260, 190);

                try {
                    const avatar = await loadImage(target.displayAvatarURL({ extension: 'png', forceStatic: true }));
                    ctx.save();
                    ctx.beginPath(); ctx.arc(125, 125, 80, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
                    ctx.drawImage(avatar, 45, 45, 160, 160);
                    ctx.restore();
                } catch { /* avatar unavailable */ }

                const buf = canvas.toBuffer('image/png');
                return interaction.editReply({ files: [new AttachmentBuilder(buf, { name: 'profile.png' })] });
            }

            // ── 기존 유틸 ─────────────────────────────────────────────
            if (commandName === 'help') {
                const embed = new EmbedBuilder()
                    .setTitle('📋 MOOKI 명령어 목록')
                    .setColor('Red')
                    .addFields(
                        { name: '🛠️ 기본', value: '`/임베드생성` `/채널설정` `/add` `/메시지` `/ticket`' },
                        { name: '💰 경제', value: '`/가입` `/탈퇴` `/출석체크` `/재화` `/인벤토리` `/랭크` `/창업` `/상장` `/인수` `/주식` `/프로필`' },
                        { name: '🔑 관리자', value: '`/ruc지급`' }
                    );
                return interaction.reply({ embeds: [embed] });
            }
            if (commandName === 'channel') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
                    return interaction.reply({ content: '❌ 권한 부족', ephemeral: true });
                sendChannels.set(interaction.guildId, interaction.options.getChannel('채널').id);
                return interaction.reply({ content: `✅ 채널 설정 완료: **${interaction.options.getChannel('채널').name}**`, ephemeral: true });
            }
            if (commandName === 'add') {
                const msgId = interaction.options.getString('message_id');
                const emoji = interaction.options.getString('emoji');
                const role  = interaction.options.getRole('role');
                if (!reactionRoles[interaction.guildId]) reactionRoles[interaction.guildId] = {};
                if (!reactionRoles[interaction.guildId][msgId]) reactionRoles[interaction.guildId][msgId] = {};
                reactionRoles[interaction.guildId][msgId][emoji] = role.id;
                fs.writeFileSync(REACTION_FILE, JSON.stringify(reactionRoles, null, 4));
                return interaction.reply({ content: `✅ 리액션 롤 설정 완료: ${emoji} → ${role.name}`, ephemeral: true });
            }
            if (commandName === 'embedbuilder') {
                const initialEmbed = createDefaultEmbed(interaction.user);
                const reply = await interaction.reply({ content: `🎨 **${interaction.user.tag}** 님의 임베드 빌더입니다.`, embeds: [initialEmbed], components: createEmbedButtons(), fetchReply: true });
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
                if (!ticket) return interaction.reply({ content: '❌ 티켓을 찾을 수 없습니다.', ephemeral: true });
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages) && interaction.user.id !== ticket.creatorId)
                    return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });
                await interaction.reply({ content: '🔒 티켓을 종료합니다...', ephemeral: true });
                await closeTicket(ticketId, interaction.user.id, interaction.guild);
                return;
            }

            // ── 티켓 읽음 확인 버튼 (DM 내) ─────────────────────────
            if (customId.startsWith('ticket_read_')) {
                const ticketId = parseInt(customId.replace('ticket_read_', ''));
                const ticket = ticketsData.tickets[ticketId];
                if (!ticket) return interaction.reply({ content: '❌ 티켓을 찾을 수 없습니다.', ephemeral: true });
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

            // ── 임베드 빌더 버튼 ─────────────────────────────────────
            const draft = embedBuilders.get(interaction.user.id);
            if (!draft) return interaction.reply({ content: '❌ 세션이 만료되었습니다. 다시 명령어를 입력하세요.', ephemeral: true });

            if (customId === 'send_embed') {
                const chId = sendChannels.get(interaction.guildId);
                if (!chId) return interaction.reply({ content: '❌ `/channel`로 채널을 먼저 설정하세요.', ephemeral: true });
                const ch = await client.channels.fetch(chId);
                await ch.send({ embeds: [draft.embed] });
                embedBuilders.delete(interaction.user.id);
                return interaction.reply({ content: '✅ 전송 완료!', ephemeral: true });
            }
            if (customId === 'cancel_builder') {
                embedBuilders.delete(interaction.user.id);
                await interaction.message.delete().catch(() => {});
                return interaction.reply({ content: '🗑️ 취소되었습니다.', ephemeral: true });
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

            // ── 티켓 생성 모달 (버튼 경유 방식 — 하위 호환 유지) ────
            if (interaction.customId.startsWith('modal_ticket_') && interaction.customId !== 'modal_ticket_direct') {
                const type  = interaction.customId.replace('modal_ticket_', '');
                const title = interaction.fields.getTextInputValue('ticket_title');
                const desc  = interaction.fields.getTextInputValue('ticket_desc');
                await interaction.deferReply({ ephemeral: true });
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
                        ephemeral: true
                    });
                }

                await interaction.deferReply({ ephemeral: true });
                const { channel } = await createTicketChannel(interaction.guild, interaction.member, type, title, desc);
                return interaction.editReply({ content: `✅ 티켓이 생성되었습니다: ${channel}` });
            }

            // ── sendmessage 모달 ──────────────────────────────────────
            if (interaction.customId === 'modal_sendmessage') {
                const chId = sendChannels.get(interaction.guildId);
                if (!chId) return interaction.reply({ content: '❌ `/channel`로 채널을 먼저 설정하세요.', ephemeral: true });

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
                return interaction.reply({ content: '✅ 공지 메시지를 전송했습니다.', ephemeral: true });
            }

            // ── 임베드 빌더 모달 ──────────────────────────────────────
            const draft = embedBuilders.get(interaction.user.id);
            if (!draft) return interaction.reply({ content: '❌ 세션 만료.', ephemeral: true });

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
                await interaction.reply({ content: '❌ 메시지 업데이트 실패', ephemeral: true });
            }
        }

    } catch (error) {
        console.error('❌ Interaction Error:', error);
        if (!interaction.replied && !interaction.deferred)
            await interaction.reply({ content: '❌ 오류가 발생했습니다.', ephemeral: true }).catch(() => {});
    }
});

// ─── 메시지 이벤트 (보안 + 티켓 응답 감지) ────────────────────────────────────

client.on('messageCreate', safeListener('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const member = message.guild.members.cache.get(message.author.id);
    const isStaff = member?.permissions.has(PermissionsBitField.Flags.ManageMessages);

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
    if (isSuspiciousLink(message.content)) {
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

// ─── 로그인 ────────────────────────────────────────────────────────────────────

const token = process.env.DISCORD_TOKEN;
if (token) client.login(token);
else console.error('❌ DISCORD_TOKEN이 .env에 없습니다.');
