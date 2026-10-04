const {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, ChannelType, InteractionType, AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// [수정됨] Canvas 모듈 안전하게 불러오기
let Canvas = null;
try {
    Canvas = require('canvas');
} catch (e) {
    console.log("⚠️ 경고: 'canvas' 모듈을 찾을 수 없습니다. /프로필 명령어는 텍스트로만 작동하거나 제한됩니다.");
    console.log("👉 해결법: 터미널에 'npm install canvas'를 입력하여 설치하세요.");
}

// dotenv 로드
require('dotenv').config({ path: path.join(__dirname, '.env') });

const REACTION_FILE = path.join(__dirname, 'reaction_roles.json');
const ECONOMY_FILE = path.join(__dirname, 'economy_data.json');

// 클라이언트 설정
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ]
});

// 데이터 저장소
const embedBuilders = new Map();
const sendChannels = new Map();

// --- 데이터 로드/저장 함수들 ---

function loadReactionRoles() {
    if (fs.existsSync(REACTION_FILE)) {
        try { return JSON.parse(fs.readFileSync(REACTION_FILE, 'utf8')); }
        catch (e) { console.error("❌ 리액션 데이터 로드 오류:", e); return {}; }
    }
    return {};
}

function loadEconomyData() {
    if (fs.existsSync(ECONOMY_FILE)) {
        try { return JSON.parse(fs.readFileSync(ECONOMY_FILE, 'utf8')); }
        catch (e) { console.error("❌ 경제 데이터 로드 오류:", e); return { users: {}, companies: {}, market_index: 100 }; }
    }
    return { users: {}, companies: {}, market_index: 100 };
}

function saveEconomyData(data) {
    fs.writeFileSync(ECONOMY_FILE, JSON.stringify(data, null, 4), 'utf8');
}

let reactionRoles = loadReactionRoles();
let economyData = loadEconomyData();

// --- 유틸리티 함수 (경제 및 차트) ---

function calculateInflationMultiplier() {
    const totalMoney = Object.values(economyData.users).reduce((acc, user) => acc + (user.money || 0), 0);
    let multiplier = 1.0 + (totalMoney / 1000000);
    return Math.max(1.0, multiplier);
}

function generateTextChart(history) {
    if (!history || history.length === 0) return "데이터 없음";
    const max = Math.max(...history);
    const min = Math.min(...history);
    const range = max - min || 1;
    const height = 5;
    let chart = "```\n";
    for (let h = height; h >= 0; h--) {
        let line = "";
        const currentLevel = min + (range * (h / height));
        line += `${Math.floor(currentLevel).toString().padStart(4, ' ')} | `;
        for (let i = 0; i < history.length; i++) {
            const val = history[i];
            const valLevel = ((val - min) / range) * height;
            if (Math.round(valLevel) === h) line += "● ";
            else if (h === 0 && Math.round(valLevel) < 0) line += ". ";
            else line += "  ";
        }
        chart += line + "\n";
    }
    chart += "      └" + "─".repeat(history.length * 2) + "\n```";
    return chart;
}

function updateStockPrice(companyName) {
    const company = economyData.companies[companyName];
    if (!company || !company.history) return;
    const currentPrice = company.stockPrice;
    const changePercent = (Math.random() * 0.1) - 0.05;
    let newPrice = Math.floor(currentPrice * (1 + changePercent));
    if (newPrice < 1) newPrice = 1;
    company.stockPrice = newPrice;
    company.history.push(newPrice);
    if (company.history.length > 10) company.history.shift();
    saveEconomyData(economyData);
    return newPrice;
}

// --- 유틸리티 함수 (임베드 빌더 UI) ---
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

// --- 봇 초기화 ---

client.once('ready', async () => {
    console.log(`✅ 로그인 성공: ${client.user.tag}`);

    const commands = [
        // 기존 명령어
        new SlashCommandBuilder().setName('embedbuilder').setDescription('대화형 임베드 생성기를 시작합니다.'),
        new SlashCommandBuilder().setName('channel').setDescription('메시지를 보낼 채널을 설정합니다.')
            .addChannelOption(o => o.setName('channel').setDescription('채널 지정').setRequired(true).addChannelTypes(ChannelType.GuildText)),
        new SlashCommandBuilder().setName('help').setDescription('명령어 목록을 확인합니다.'),
        new SlashCommandBuilder().setName('sendmessage').setDescription('설정된 채널로 일반 메시지를 보냅니다.')
            .addStringOption(o => o.setName('contents').setDescription('내용').setRequired(true)),
        new SlashCommandBuilder().setName('add').setDescription('반응 역할을 설정합니다.')
            .addStringOption(o => o.setName('message_id').setDescription('메시지 ID').setRequired(true))
            .addStringOption(o => o.setName('emoji').setDescription('이모지').setRequired(true))
            .addRoleOption(o => o.setName('role').setDescription('역할').setRequired(true)),

        // 경제 시스템 명령어
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

        // [추가된 명령어]
        new SlashCommandBuilder().setName('ruc지급').setDescription('관리자가 특정 유저에게 RUC를 지급합니다.')
            .addUserOption(o => o.setName('유저').setDescription('지급할 유저').setRequired(true))
            .addIntegerOption(o => o.setName('금액').setDescription('지급할 RUC 금액').setRequired(true)),
        new SlashCommandBuilder().setName('프로필').setDescription('자신의 경제 프로필 카드를 생성합니다.')
            .addUserOption(o => o.setName('유저').setDescription('프로필을 볼 유저 (선택)').setRequired(false)),
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ 슬래시 명령어 등록 완료.');
    } catch (error) {
        console.error('❌ 슬래시 명령어 등록 실패:', error);
    }
});

// --- 인터랙션 핸들러 (메인 로직) ---

client.on('interactionCreate', async interaction => {
    try {
        // 1. 슬래시 명령어 처리
        if (interaction.isChatInputCommand()) {
            const { commandName, user } = interaction;
            const userId = user.id;

            // --- 경제 명령어 로직 ---
            const economyCmds = ['출석체크', '주식', '랭크', '인벤토리', '재화', '창업', '상장', '인수', '프로필'];
            // RUC지급은 관리자 명령어라 여기서 체크하지 않고 개별 로직에서 체크
            if (economyCmds.includes(commandName)) {
                if (!economyData.users[userId]) {
                    return interaction.reply({ content: '❌ 경제 시스템에 가입되어 있지 않습니다. `/가입`을 먼저 해주세요.', ephemeral: true });
                }
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
                return interaction.reply({ content: `✅ 탈퇴 완료. 데이터가 삭제되었습니다.` });
            }
            if (commandName === '출석체크') {
                const u = economyData.users[userId];
                const now = Date.now();
                if (now - u.lastCheckIn < 86400000) return interaction.reply({ content: '⏳ 아직 출석 가능 시간이 아닙니다. (24시간 1회)', ephemeral: true });

                if (now - u.lastCheckIn < 172800000) u.streak++; else u.streak = 1;
                u.lastCheckIn = now;
                const infl = calculateInflationMultiplier();
                const reward = Math.floor(100 * infl * (1 + Math.min(u.streak * 0.1, 2)));
                u.money += reward;
                saveEconomyData(economyData);
                return interaction.reply({ content: `📅 출석 완료! +${reward} RUC (연속 ${u.streak}일)` });
            }

            // [디자인 수정] 재화: TXT 형식 DM 전송
            if (commandName === '재화') {
                const m = economyData.users[userId].money;
                const msgContent = `\`\`\`txt\n[ ${user.username}님의 자산 정보 ]\n\n💵 보유 RUC: ${m.toLocaleString()} RUC\n\`\`\``;
                try {
                    await user.send(msgContent);
                    return interaction.reply({ content: '✅ DM으로 재화 정보를 보냈습니다.', ephemeral: true });
                } catch {
                    return interaction.reply({ content: '❌ DM을 보낼 수 없습니다. 설정에서 DM을 열어주세요.', ephemeral: true });
                }
            }

            // [디자인 수정] 인벤토리: TXT 형식 DM 전송
            if (commandName === '인벤토리') {
                const i = economyData.users[userId].inventory;
                const invList = i.length > 0 ? i.join('\n- ') : '(비어있음)';
                const msgContent = `\`\`\`txt\n[ ${user.username}님의 인벤토리 ]\n\n- ${invList}\n\`\`\``;
                try {
                    await user.send(msgContent);
                    return interaction.reply({ content: '✅ DM으로 인벤토리 정보를 보냈습니다.', ephemeral: true });
                } catch {
                    return interaction.reply({ content: '❌ DM을 보낼 수 없습니다.', ephemeral: true });
                }
            }

            // [디자인 수정] 랭크: 임베드 출력
            if (commandName === '랭크') {
                const list = Object.entries(economyData.users).sort(([, a], [, b]) => b.money - a.money);
                const top10 = list.slice(0, 10);

                // 내 등수 찾기
                const myRankIdx = list.findIndex(([id]) => id === userId);
                const myRank = myRankIdx !== -1 ? `${myRankIdx + 1}위` : '순위권 외';

                const embed = new EmbedBuilder()
                    .setTitle(`🏆 MOOKI 서버 부자 랭킹 (TOP 10)`)
                    .setColor('Gold')
                    .setDescription(top10.map(([id, d], i) => {
                        return `**#${i + 1}** <@${id}> : \`${d.money.toLocaleString()} RUC\``;
                    }).join('\n') || '데이터 없음')
                    .setFooter({ text: `${user.username}님의 순위: ${myRank}`, iconURL: user.displayAvatarURL() });

                return interaction.reply({ embeds: [embed] });
            }

            if (commandName === '창업') {
                const name = interaction.options.getString('기업명');
                if (economyData.companies[name]) return interaction.reply({ content: '❌ 이미 존재하는 이름입니다.', ephemeral: true });
                if (economyData.users[userId].money < 5000) return interaction.reply({ content: '❌ 5,000 RUC이 필요합니다.', ephemeral: true });
                economyData.users[userId].money -= 5000;
                economyData.companies[name] = { owner: userId, stockPrice: 100, history: [100], isPublic: false };
                if (!economyData.users[userId].companies) economyData.users[userId].companies = [];
                economyData.users[userId].companies.push(name);
                saveEconomyData(economyData);
                return interaction.reply({ content: `🏢 **${name}** 창업 완료!` });
            }
            if (commandName === '상장') {
                const name = interaction.options.getString('기업명');
                const comp = economyData.companies[name];
                if (!comp || comp.owner !== userId) return interaction.reply({ content: '❌ 권한이 없거나 기업이 없습니다.', ephemeral: true });
                comp.isPublic = true;
                saveEconomyData(economyData);
                return interaction.reply({ content: `📈 **${name}** 상장 완료!` });
            }
            if (commandName === '주식') {
                const name = interaction.options.getString('기업명');
                const comp = economyData.companies[name];
                if (!comp || !comp.isPublic) return interaction.reply({ content: '❌ 찾을 수 없거나 비상장 기업입니다.', ephemeral: true });
                const price = updateStockPrice(name);
                return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${name} 주가`).setDescription(`가격: ${price} RUC\n${generateTextChart(comp.history)}`)] });
            }
            if (commandName === '인수') {
                const name = interaction.options.getString('기업명');
                const comp = economyData.companies[name];
                if (!comp || comp.owner === userId) return interaction.reply({ content: '❌ 불가: 본인 소유거나 기업 없음.', ephemeral: true });
                const price = comp.stockPrice * 100;
                if (economyData.users[userId].money < price) return interaction.reply({ content: `❌ 자금 부족 (${price} 필요)`, ephemeral: true });

                // 거래 처리
                if (economyData.users[comp.owner]) economyData.users[comp.owner].money += price;
                economyData.users[userId].money -= price;
                comp.owner = userId;
                saveEconomyData(economyData);
                return interaction.reply({ content: `🤝 **${name}** 인수 완료! (${price} RUC)` });
            }

            // [추가 기능] RUC 지급 (관리자 전용)
            if (commandName === 'ruc지급') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: '❌ 이 명령어는 관리자만 사용할 수 있습니다.', ephemeral: true });
                }

                const targetUser = interaction.options.getUser('유저');
                const amount = interaction.options.getInteger('금액');

                if (!economyData.users[targetUser.id]) {
                    return interaction.reply({ content: `❌ **${targetUser.username}**님은 경제 시스템에 가입되어 있지 않습니다.`, ephemeral: true });
                }

                economyData.users[targetUser.id].money += amount;
                saveEconomyData(economyData);

                return interaction.reply({ content: `✅ **${targetUser.username}**님에게 **${amount.toLocaleString()} RUC**를 지급했습니다.\n현재 잔액: ${economyData.users[targetUser.id].money.toLocaleString()} RUC` });
            }

            // [추가 기능] 프로필 (이미지 생성) - Canvas 체크 로직 추가됨
            if (commandName === '프로필') {
                // Canvas 모듈 설치 여부 확인
                if (!Canvas) {
                    return interaction.reply({
                        content: '⚠️ **시스템 오류**: 이미지 처리 모듈(`canvas`)이 설치되지 않아 프로필 이미지를 생성할 수 없습니다.\n봇 관리자에게 `npm install canvas` 설치를 요청하세요.',
                        ephemeral: true
                    });
                }

                const targetUser = interaction.options.getUser('유저') || user;
                const targetId = targetUser.id;
                const targetData = economyData.users[targetId];

                if (!targetData) {
                    return interaction.reply({ content: `❌ **${targetUser.username}**님은 경제 시스템에 가입되어 있지 않습니다.`, ephemeral: true });
                }

                await interaction.deferReply();

                // 랭킹 계산
                const list = Object.entries(economyData.users).sort(([, a], [, b]) => b.money - a.money);
                const rankIdx = list.findIndex(([id]) => id === targetId);
                const rankText = rankIdx !== -1 ? `#${rankIdx + 1}` : 'Unranked';

                // Canvas 생성
                const canvas = Canvas.createCanvas(700, 250);
                const ctx = canvas.getContext('2d');

                // 배경 (어두운 회색)
                ctx.fillStyle = '#23272A';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // 테두리 장식
                ctx.strokeStyle = '#0099ff';
                ctx.lineWidth = 10;
                ctx.strokeRect(0, 0, canvas.width, canvas.height);

                // 텍스트 설정
                ctx.font = 'bold 36px sans-serif';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(`${targetUser.username}`, 260, 60);

                ctx.font = '28px sans-serif';
                ctx.fillStyle = '#dddddd';
                ctx.fillText(`💰 자산: ${targetData.money.toLocaleString()} RUC`, 260, 110);
                ctx.fillText(`🏆 랭킹: ${rankText}`, 260, 150);
                ctx.fillText(`🔥 연속 출석: ${targetData.streak}일`, 260, 190);

                // 프로필 사진 (원형)
                const avatarURL = targetUser.displayAvatarURL({ extension: 'png', forceStatic: true });
                try {
                    const avatar = await Canvas.loadImage(avatarURL);
                    ctx.beginPath();
                    ctx.arc(125, 125, 80, 0, Math.PI * 2, true);
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(avatar, 45, 45, 160, 160);
                } catch (e) {
                    console.error("이미지 로드 실패:", e);
                }

                const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile.png' });
                return interaction.editReply({ files: [attachment] });
            }

            // --- 기존 유틸리티 명령어 로직 ---
            if (commandName === 'help') {
                const embed = new EmbedBuilder()
                    .setTitle('MOOKI의 명령어')
                    .setDescription(`**기본 명령어:**\n\`/embedbuilder\`: 임베드 생성\n\`/channel\`: 채널 설정\n\`/add\`: 반응 역할 설정\n\`/sendmessage\`: 지정된 채널로 메시지 전송\n
                        **경제 시스템:**\n\`/가입\`, \`/탈퇴\`: 경제 시스템 가입/탈퇴\n\`/출석체크\`: RUC 획득\n\`/재화\`, \`/인벤토리\`: 자산 확인 (DM)\n \`/랭크\`: 자산순위 확인\n\`/창업\`, \`/상장\`, \`/인수\`, \`/주식\`: 기업 및 주식 활동\n\`/프로필\`: 프로필 카드 생성\n\`/ruc지급\`: (관리자) RUC 지급`)
                    .setColor('Red');
                return interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'channel') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
                    return interaction.reply({ content: '❌ 권한 부족', ephemeral: true });
                sendChannels.set(interaction.guildId, interaction.options.getChannel('channel').id);
                return interaction.reply({ content: `✅ 채널 설정 완료: ${interaction.options.getChannel('channel').name}`, ephemeral: true });
            }

            if (commandName === 'sendmessage') {
                const chId = sendChannels.get(interaction.guildId);
                if (!chId) return interaction.reply({ content: '❌ 채널 설정 필요 (/channel)', ephemeral: true });
                const ch = await client.channels.fetch(chId);
                await ch.send(interaction.options.getString('contents'));
                return interaction.reply({ content: '✅ 전송 완료', ephemeral: true });
            }

            if (commandName === 'add') {
                // 리액션 롤 등록 (로직 간소화, 기존 기능 유지)
                const msgId = interaction.options.getString('message_id');
                const emoji = interaction.options.getString('emoji');
                const role = interaction.options.getRole('role');

                if (!reactionRoles[interaction.guildId]) reactionRoles[interaction.guildId] = {};
                if (!reactionRoles[interaction.guildId][msgId]) reactionRoles[interaction.guildId][msgId] = {};

                reactionRoles[interaction.guildId][msgId][emoji] = role.id;
                fs.writeFileSync(REACTION_FILE, JSON.stringify(reactionRoles, null, 4));
                return interaction.reply({ content: `✅ 리액션 롤 설정 완료: ${emoji} -> ${role.name}`, ephemeral: true });
            }

            if (commandName === 'embedbuilder') {
                const initialEmbed = createDefaultEmbed(interaction.user);
                const components = createEmbedButtons();

                // 먼저 응답을 보낸 후 해당 메시지를 세션에 저장
                const reply = await interaction.reply({
                    content: `🎨 **${interaction.user.tag}** 님의 임베드 빌더입니다.`,
                    embeds: [initialEmbed],
                    components: components,
                    fetchReply: true
                });

                embedBuilders.set(interaction.user.id, {
                    embed: initialEmbed,
                    originalMessageId: reply.id,
                    channelId: interaction.channelId
                });
            }
        }

        // 2. 버튼 상호작용 처리 (Embed Builder)
        else if (interaction.isButton()) {
            const draft = embedBuilders.get(interaction.user.id);
            if (!draft) return interaction.reply({ content: '❌ 세션이 만료되었습니다. 다시 명령어를 입력하세요.', ephemeral: true });

            const { customId } = interaction;

            if (customId === 'send_embed') {
                const targetChId = sendChannels.get(interaction.guildId);
                if (!targetChId) return interaction.reply({ content: '❌ 전송할 채널이 설정되지 않았습니다. `/channel`로 설정하세요.', ephemeral: true });
                const ch = await client.channels.fetch(targetChId);
                await ch.send({ embeds: [draft.embed] });
                embedBuilders.delete(interaction.user.id); // 전송 후 세션 종료
                return interaction.reply({ content: `✅ 성공적으로 전송되었습니다!`, ephemeral: true });
            }

            if (customId === 'cancel_builder') {
                embedBuilders.delete(interaction.user.id);
                await interaction.message.delete().catch(() => { });
                return interaction.reply({ content: '🗑️ 취소되었습니다.', ephemeral: true });
            }

            // 수정 버튼들 -> 모달 띄우기 (이 부분은 deferUpdate를 하면 안 됩니다. showModal은 즉시 해야 함)
            let modal, inputId, label, style = TextInputStyle.Short;

            if (customId === 'edit_content') {
                modal = new ModalBuilder().setCustomId('modal_content').setTitle('내용 수정');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_title').setLabel('제목').setStyle(TextInputStyle.Short).setRequired(false).setValue(draft.embed.data.title || "")),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('inp_desc').setLabel('설명').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(draft.embed.data.description || ""))
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

        // 3. 모달 제출 처리 (Embed Builder)
        else if (interaction.type === InteractionType.ModalSubmit) {
            const draft = embedBuilders.get(interaction.user.id);
            if (!draft) return interaction.reply({ content: '❌ 세션 만료.', ephemeral: true });

            const embed = draft.embed;

            // 모달 데이터 적용
            if (interaction.customId === 'modal_content') {
                const t = interaction.fields.getTextInputValue('inp_title');
                const d = interaction.fields.getTextInputValue('inp_desc');
                if (t) embed.setTitle(t); else embed.setTitle(null);
                if (d) embed.setDescription(d); else embed.setDescription(null);
            } else if (interaction.customId === 'modal_author') {
                const n = interaction.fields.getTextInputValue('inp_auth_name');
                const i = interaction.fields.getTextInputValue('inp_auth_icon');
                if (n) embed.setAuthor({ name: n, iconURL: i || undefined }); else embed.setAuthor(null);
            } else if (interaction.customId === 'modal_footer') {
                const t = interaction.fields.getTextInputValue('inp_footer_text');
                const i = interaction.fields.getTextInputValue('inp_footer_icon');
                if (t) embed.setFooter({ text: t, iconURL: i || undefined }); else embed.setFooter(null);
            } else if (interaction.customId === 'modal_color') {
                try { embed.setColor(interaction.fields.getTextInputValue('inp_color')); } catch { }
            } else if (interaction.customId === 'modal_images') {
                const img = interaction.fields.getTextInputValue('inp_img');
                const thumb = interaction.fields.getTextInputValue('inp_thumb');
                if (img) embed.setImage(img); else embed.setImage(null);
                if (thumb) embed.setThumbnail(thumb); else embed.setThumbnail(null);
            }

            // 원본 메시지 업데이트
            try {
                const ch = await client.channels.fetch(draft.channelId);
                const msg = await ch.messages.fetch(draft.originalMessageId);
                await msg.edit({ embeds: [embed] });
                await interaction.deferUpdate(); // 모달 닫기 처리를 위해 필수
            } catch (e) {
                console.error("메시지 수정 실패:", e);
                await interaction.reply({ content: '❌ 메시지 업데이트 실패', ephemeral: true });
            }
        }

    } catch (error) {
        console.error('❌ Interaction Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ 오류가 발생했습니다.', ephemeral: true }).catch(() => { });
        }
    }
});

// --- 리액션 롤 이벤트 ---
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => { });
    const rData = reactionRoles[reaction.message.guildId]?.[reaction.message.id]?.[reaction.emoji.name] || reactionRoles[reaction.message.guildId]?.[reaction.message.id]?.[`<:${reaction.emoji.name}:${reaction.emoji.id}>`];
    if (rData) {
        const member = await reaction.message.guild.members.fetch(user.id);
        member.roles.add(rData).catch(() => { });
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => { });
    const rData = reactionRoles[reaction.message.guildId]?.[reaction.message.id]?.[reaction.emoji.name] || reactionRoles[reaction.message.guildId]?.[reaction.message.id]?.[`<:${reaction.emoji.name}:${reaction.emoji.id}>`];
    if (rData) {
        const member = await reaction.message.guild.members.fetch(user.id);
        member.roles.remove(rData).catch(() => { });
    }
});

const token = process.env.DISCORD_TOKEN;
if (token) client.login(token);
else console.log("❌ DISCORD_TOKEN 없음");
