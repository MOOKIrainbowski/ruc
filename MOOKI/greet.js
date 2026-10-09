// 환영 인사 · 후원 감사 알림
//
// 채널은 관리자가 /welcome channel · /donation channel 로 정하고 announce_channels.json 에 남깁니다
// (봇을 재시작해도 유지). 채널이 정해지지 않았으면 조용히 건너뜁니다.

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');

const FILE = path.join(__dirname, 'announce_channels.json');

let channels = {};
try { channels = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* 처음 — 빈 설정 */ }

function channelCommand(name, what) {
    return new SlashCommandBuilder()
        .setName(name)
        .setDescription(`${what} 채널 설정 (관리자)`)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(s => s.setName('channel').setDescription(`${what} 메시지를 보낼 채널을 정합니다.`)
            .addChannelOption(o => o.setName('채널').setDescription('보낼 채널').setRequired(true)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));
}

const welcomeCommand = channelCommand('welcome', '환영 인사');
const donationCommand = channelCommand('donation', '후원 감사');

/** /welcome channel · /donation channel. 처리했으면 true */
async function handleCommand(interaction) {
    const key = { welcome: 'welcome', donation: 'donation' }[interaction.commandName];
    if (!key) return false;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '<:minecraft_barrier:1557947126024245328> 관리자 전용 명령어입니다.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const ch = interaction.options.getChannel('채널');
    channels[`${interaction.guildId}:${key}`] = ch.id;
    fs.writeFileSync(FILE, JSON.stringify(channels, null, 4));
    await interaction.reply({ content: `<:minecraft_emerald_block:1557947122802757673> ${key === 'welcome' ? '환영 인사' : '후원 감사'} 채널: ${ch}`, flags: MessageFlags.Ephemeral });
    return true;
}

async function channelOf(guild, key) {
    const id = channels[`${guild.id}:${key}`];
    return id ? guild.channels.fetch(id).catch(() => null) : null;
}

// ── 환영 인사 ─────────────────────────────────────────────────────────

const WELCOME = [
    '러크 서버에 착지 완료! 낙하 데미지는 없었길 바라요 🪂',
    '어서 오세요! 크리퍼는 저희가 미리 치워 뒀습니다… 아마도요 <:minecraft_tnt_minecart:1557947115337154732>',
    '새로운 모험가 등장! 인벤토리는 비었어도 기대는 가득 🎒',
    '환영합니다! 다이아는 못 드려도 환영 인사는 무한 제공 💎',
    '스폰 지점에 새 얼굴이 생겼어요. 침대부터 꼭 설치하세요 🛏️',
    '접속 성공! 이제 밤새 "한 판만 더" 할 준비 되셨죠? 🌙',
    '오셨군요! 엔더맨이랑 눈만 안 마주치면 다 잘될 거예요 👀',
    '드디어 오셨네요. 마을 주민들이 벌써 비싼 거래를 준비 중입니다 🧑‍🌾',
    '반가워요! 여기선 돌을 캐도, 친구를 캐도 됩니다 ⛏️',
    '환영합니다! 용암 앞에서는 늘 한 칸 떨어져 계세요 🔥',
    '새 플레이어 합류! 서버 TPS 가 기뻐서 1 올랐습니다 (기분상) 📈',
    '어서 오세요! 첫 번째 미션: 채널 구경하고 `/인증` 하기 <:minecraft_emerald_block:1557947122802757673>',
];

async function welcome(member) {
    if (member.user.bot) return;
    const ch = await channelOf(member.guild, 'welcome');
    if (!ch) return;
    const line = WELCOME[Math.floor(Math.random() * WELCOME.length)];
    await ch.send({ content: `<@${member.id}>님, ${line}` });
}

// ── 후원 감사 ─────────────────────────────────────────────────────────

// 현금: 금액(원) 기준. 상품 가격대(2천~5만 9천 원)에 맞춰 나눴습니다.
const CASH_TIERS = [
    { min: 50000, name: '💎 다이아몬드 후원', color: 0x4ee6f5, note: '서버의 전설로 기록됩니다. 진심으로 감사드립니다!' },
    { min: 30000, name: '🥇 골드 후원', color: 0xf5c542, note: '러크 서버를 든든하게 받쳐 주셨어요!' },
    { min: 10000, name: '🥈 실버 후원', color: 0xc0c7d0, note: '덕분에 서버가 한층 더 반짝입니다!' },
    { min: 0, name: '🥉 브론즈 후원', color: 0xcd7f32, note: '작은 정성이 서버를 움직입니다!' },
];

// 부스트: 회원 한 명이 몇 번 부스트했는지는 디스코드가 알려 주지 않으므로 서버 부스트 레벨 기준입니다.
const BOOST_TIERS = [
    { name: '🚀 부스트 후원', color: 0xf47fff, note: '서버에 보랏빛 날개를 달아 주셨어요!' },
    { name: '🚀 부스트 후원 · 레벨 1', color: 0xf47fff, note: '레벨 1 혜택이 유지됩니다!' },
    { name: '🚀 부스트 후원 · 레벨 2', color: 0xd34cff, note: '레벨 2 — 더 선명한 화질과 이모지가 함께합니다!' },
    { name: '🌌 부스트 후원 · 레벨 3', color: 0x9b30ff, note: '최고 레벨 3! 서버가 은하 끝까지 빛납니다!' },
];

/**
 * @param kind 'cash' | 'boost'
 * @param amount 현금 금액(원) — cash 일 때만
 */
async function thank(guild, userId, kind, amount = 0) {
    const ch = await channelOf(guild, 'donation');
    if (!ch) return;
    const user = await guild.client.users.fetch(userId).catch(() => null);
    const tier = kind === 'cash'
        ? CASH_TIERS.find(t => amount >= t.min)
        : BOOST_TIERS[guild.premiumTier] || BOOST_TIERS[0];

    const embed = new EmbedBuilder()
        .setColor(tier.color)
        .setTitle(tier.name)
        .setDescription(tier.note)
        .setThumbnail(user?.displayAvatarURL() ?? null)
        .setTimestamp();
    if (kind === 'boost') embed.addFields({ name: '서버 부스트', value: `${guild.premiumSubscriptionCount ?? 0}회`, inline: true });

    await ch.send({
        content: `<@${userId}>님, ${kind === 'cash' ? '현금' : '부스트'} 후원 감사합니다.`,
        embeds: [embed],
    });
}

module.exports = { welcomeCommand, donationCommand, handleCommand, welcome, thank, _internals: { CASH_TIERS } };
