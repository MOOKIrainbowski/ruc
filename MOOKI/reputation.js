// 평판 티어 → 디스코드 역할 (§3.7) — Phase 6-6
//
// ── 6-1(칭호)과 반대 방향입니다 ───────────────────────────────────────
// 칭호는 디스코드가 주인이고 마크가 비춥니다.
// 평판은 **마크가 주인**입니다 — 신고(6-5)와 제재로 움직입니다. 디스코드
// 역할은 그것을 비추는 쪽입니다.
//
// 그래서 통로가 다릅니다. RCON 은 봇 → 서버 한 방향이라 서버가 봇에게 말을
// 걸 수 없습니다. **봇이 주기적으로 물어봅니다** (/rucreps).
//
// ── 역할은 이 봇이 만듭니다 ───────────────────────────────────────────
// 7티어 역할을 손으로 만들고 ID 7개를 옮겨 적는 것은 실수하기 좋은 일입니다.
// /평판역할설정 한 번이면 없는 것만 만들고 ID 를 config/roles.json 에
// 적어 둡니다. 이미 있으면 건드리지 않습니다.

const fs = require('fs');
const { Rcon } = require('rcon-client');
const {
    EmbedBuilder, SlashCommandBuilder, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const roles = require('./roles');

/**
 * 7티어. key 는 RucCore 의 ScoreboardService.ReputationTier 와 같아야 합니다.
 * 색과 최소 점수도 그쪽과 맞춰 둡니다 — 사람이 게임과 디스코드에서 같은 것을
 * 봐야 같은 것으로 읽습니다.
 */
const TIERS = [
    { key: 'green',  label: '평판 · 초록', color: 0x55FF55, min: 300 },
    { key: 'yellow', label: '평판 · 노랑', color: 0xFFFF55, min: 150 },
    { key: 'red',    label: '평판 · 빨강', color: 0xFF5555, min: 50 },
    { key: 'purple', label: '평판 · 보라', color: 0xAA00AA, min: 0 },
    { key: 'blue',   label: '평판 · 파랑', color: 0x5555FF, min: -100 },
    { key: 'indigo', label: '평판 · 남색', color: 0x000080, min: -300 },
    { key: 'dark',   label: '평판 · 검정', color: 0x1A1A1A, min: null },
];

const TIER_KEYS = TIERS.map(t => t.key);

/** 전체 훑기 주기 (분). */
const SWEEP_INTERVAL_MIN = parseInt(process.env.RUC_REPUTATION_SWEEP_MIN || '15', 10);

// ── 설정 읽고 쓰기 ────────────────────────────────────────────────────

/** key → 역할 ID. 설정에 없으면 빈 객체. */
function configured() {
    const map = roles.get().reputationRoles;
    return (map && typeof map === 'object') ? map : {};
}

/**
 * roles.json 에 평판 역할 ID 를 적습니다.
 *
 * 파일을 다시 읽어서 쓰는 이유: 메모리의 설정 객체를 그대로 직렬화하면
 * 주석(_readme 등)과 키 순서가 흐트러집니다. 사람이 읽는 파일입니다.
 */
function saveRoleIds(mapping) {
    const raw = JSON.parse(fs.readFileSync(roles.ROLES_FILE, 'utf8'));
    raw.reputationRoles = { ...(raw.reputationRoles || {}), ...mapping };
    if (!raw._reputationRoles) {
        raw._reputationRoles = '평판 티어 → 디스코드 역할. /평판역할설정 이 채웁니다. '
            + '마크의 평판이 주인이고 이 역할은 그것을 비춥니다.';
    }
    fs.writeFileSync(roles.ROLES_FILE, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    roles.load();      // 메모리에도 반영
}

// ── 마크 서버 조회 ────────────────────────────────────────────────────

/**
 * 연동자들의 평판 티어를 전부 받아 옵니다.
 *
 * @returns {Promise<Map<string,{tier:string,score:number}>|null>} discordId → 티어
 */
async function fetchTiers() {
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

        const out = new Map();
        let offset = 0;

        // 한 응답에 다 담기지 않습니다. next 가 '-' 일 때까지 받습니다.
        // 무한 루프를 막으려고 장 수에 상한을 둡니다 (50장 = 2500명).
        for (let page = 0; page < 50; page++) {
            const response = String(await rcon.send(`rucreps ${offset} 50`));
            if (!/RUCREPS\s+OK/.test(response)) break;

            const next = (response.match(/next=(\S+)/) || [])[1];
            for (const token of response.split(/\s+/)) {
                const m = token.match(/^(\d{17,20}):([a-z]+):(-?\d+)$/);
                if (m) out.set(m[1], { tier: m[2], score: parseInt(m[3], 10) });
            }

            if (!next || next === '-') break;
            offset = parseInt(next, 10);
            if (!Number.isFinite(offset)) break;
        }
        return out;
    } catch (err) {
        console.error('[평판] 마크 서버 조회 실패:', err.message);
        return null;
    } finally {
        if (rcon) {
            try { await rcon.end(); } catch { /* 이미 끊긴 경우 */ }
        }
    }
}

// ── 동기화 ────────────────────────────────────────────────────────────

/**
 * 평판 역할을 맞춥니다.
 *
 * 한 사람에게 티어 역할은 **하나만** 있어야 합니다. 평판이 움직이면 옛 티어를
 * 떼고 새 티어를 붙입니다 — 떼지 않으면 "초록이면서 검정" 인 사람이 생기고,
 * 그건 평판을 한눈에 보려는 목적 자체를 무너뜨립니다.
 *
 * @returns {Promise<{checked:number, changed:number, skipped:number, error?:string}>}
 */
async function sync(guild) {
    const map = configured();
    const known = TIER_KEYS.filter(k => map[k]);
    if (known.length === 0) {
        return { checked: 0, changed: 0, skipped: 0,
                 error: '평판 역할이 설정되지 않았습니다. /평판역할설정 을 먼저 실행하세요.' };
    }

    const tiers = await fetchTiers();
    if (!tiers) {
        return { checked: 0, changed: 0, skipped: 0,
                 error: '마인크래프트 서버에 연결하지 못했습니다.' };
    }

    // 이 봇이 부여할 수 있는 역할인지 먼저 봅니다. 서열이 위면 조용히 실패해서
    // "왜 안 붙지" 가 됩니다.
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    const myTop = me ? me.roles.highest.position : -1;

    const managed = [];
    for (const key of known) {
        const role = guild.roles.cache.get(map[key])
            || await guild.roles.fetch(map[key]).catch(() => null);
        if (!role) continue;
        if (role.position >= myTop) {
            return { checked: 0, changed: 0, skipped: 0,
                     error: `봇 역할이 **${role.name}** 보다 아래에 있어 부여할 수 없습니다. `
                          + '서버 설정 → 역할에서 봇을 위로 올려 주세요.' };
        }
        managed.push({ key, role });
    }

    const members = await guild.members.fetch();
    let checked = 0;
    let changed = 0;
    let skipped = 0;

    for (const member of members.values()) {
        if (member.user.bot) continue;

        const info = tiers.get(member.id);
        if (!info) {
            // 마크 계정을 연동하지 않은 사람입니다. 평판이 없으므로 역할도
            // 없어야 합니다 — 예전에 연동했다가 푼 경우를 위해 정리합니다.
            const stale = managed.filter(m => member.roles.cache.has(m.role.id));
            for (const m of stale) {
                await member.roles.remove(m.role.id, '마크 계정 연동 없음').catch(() => {});
                changed++;
            }
            continue;
        }

        checked++;
        const target = managed.find(m => m.key === info.tier);
        if (!target) { skipped++; continue; }   // 그 티어 역할이 설정에 없음

        const toRemove = managed.filter(m =>
            m.key !== info.tier && member.roles.cache.has(m.role.id));
        const needsAdd = !member.roles.cache.has(target.role.id);

        if (!needsAdd && toRemove.length === 0) continue;

        try {
            // 붙이고 나서 뗍니다. 순서를 반대로 하면 그 사이에 평판 역할이
            // 하나도 없는 순간이 생깁니다.
            if (needsAdd) await member.roles.add(target.role.id, `평판 ${info.score}`);
            for (const m of toRemove) {
                await member.roles.remove(m.role.id, `평판 티어 변경 → ${info.tier}`);
            }
            changed++;
        } catch (err) {
            console.warn(`[평판] ${member.user.tag} 역할 적용 실패:`, err.message);
            skipped++;
        }
    }

    return { checked, changed, skipped };
}

// ── 역할 만들기 ───────────────────────────────────────────────────────

/**
 * 없는 티어 역할을 만들고 ID 를 저장합니다.
 *
 * 이미 있는 것은 건드리지 않습니다 — 색이나 이름을 바꿔 두셨을 수 있습니다.
 */
async function ensureRoles(guild) {
    const map = configured();
    const created = [];
    const kept = [];

    for (const tier of TIERS) {
        const existingId = map[tier.key];
        if (existingId) {
            const role = guild.roles.cache.get(existingId)
                || await guild.roles.fetch(existingId).catch(() => null);
            if (role) { kept.push(role.name); continue; }
        }

        // 이름이 같은 역할이 이미 있으면 그것을 씁니다. 두 번 만들지 않습니다.
        const byName = guild.roles.cache.find(r => r.name === tier.label);
        if (byName) {
            map[tier.key] = byName.id;
            kept.push(byName.name);
            continue;
        }

        const role = await guild.roles.create({
            name: tier.label,
            color: tier.color,
            hoist: false,
            mentionable: false,
            reason: '평판 티어 역할 (§3.7)',
        });
        map[tier.key] = role.id;
        created.push(role.name);
    }

    saveRoleIds(map);
    return { created, kept };
}

// ── 슬래시 명령어 ─────────────────────────────────────────────────────

const setupCommand = new SlashCommandBuilder()
    .setName('평판역할설정')
    .setDescription('(스태프) 평판 7티어 역할을 만들고 설정에 연결합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

const syncCommand = new SlashCommandBuilder()
    .setName('평판동기화')
    .setDescription('(스태프) 마인크래프트 평판을 디스코드 역할에 지금 반영합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

async function handleSetup(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) return interaction.editReply('서버 안에서만 됩니다.');
    if (!roles.isStaff(interaction.member)) {
        return interaction.editReply('<:minecraft_barrier:1557947126024245328> 스태프 전용 명령어입니다.');
    }

    let result;
    try {
        result = await ensureRoles(interaction.guild);
    } catch (err) {
        return interaction.editReply(`<:minecraft_barrier:1557947126024245328> 역할을 만들지 못했습니다: ${err.message}\n`
            + '봇에게 "역할 관리" 권한이 있는지 확인해 주세요.');
    }

    const embed = new EmbedBuilder()
        .setColor(0x93e93e)
        .setTitle('<:minecraft_emerald_block:1557947122802757673> 평판 역할 설정 완료')
        .setDescription(
            (result.created.length ? `**새로 만듦 (${result.created.length})**\n`
                + result.created.join('\n') + '\n\n' : '')
            + (result.kept.length ? `**이미 있음 (${result.kept.length})**\n`
                + result.kept.join('\n') : ''))
        .addFields({
            name: '다음 할 일',
            value: '서버 설정 → 역할에서 **봇 역할을 평판 역할들보다 위로** 올려 주세요.\n'
                + '그다음 `/평판동기화` 를 실행하면 반영됩니다.',
        })
        .setFooter({ text: 'ID 는 config/roles.json 에 저장됐습니다' })
        .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
}

async function handleSync(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) return interaction.editReply('서버 안에서만 됩니다.');
    if (!roles.isStaff(interaction.member)) {
        return interaction.editReply('<:minecraft_barrier:1557947126024245328> 스태프 전용 명령어입니다.');
    }

    const result = await sync(interaction.guild);

    if (result.error) {
        return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0xff4444)
                .setTitle('⚠️ 평판 동기화 실패')
                .setDescription(result.error)],
        });
    }

    return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x93e93e)
            .setTitle('<:minecraft_emerald_block:1557947122802757673> 평판 동기화 완료')
            .setDescription(`연동자 **${result.checked}명** 확인 · `
                + `역할 변경 **${result.changed}건**`
                + (result.skipped ? ` · 건너뜀 ${result.skipped}건` : ''))
            .setTimestamp()],
    });
}

/** 주기 동기화. 평판은 신고 처리로 움직이므로 늦어도 몇 분 안에 반영돼야 합니다. */
function startSyncing(guild) {
    const minutes = Math.max(5, SWEEP_INTERVAL_MIN);
    setInterval(() => {
        sync(guild)
            .then(r => {
                if (r.error) console.warn('[평판] 주기 동기화:', r.error);
                else if (r.changed > 0) {
                    console.log(`[평판] 주기 동기화 — ${r.checked}명 확인, ${r.changed}건 변경`);
                }
            })
            .catch(err => console.error('[평판] 주기 동기화 실패:', err));
    }, minutes * 60 * 1000).unref?.();

    // 시작 줄은 logConfig 가 주기까지 함께 찍습니다.
}

/** 기동 시 설정 상태를 알려 줍니다. */
function logConfig() {
    const map = configured();
    const set = TIER_KEYS.filter(k => map[k]);
    if (set.length === 0) {
        console.log('[평판] 평판 역할이 설정되지 않았습니다. '
            + '디스코드에서 /평판역할설정 을 한 번 실행하세요.');
    } else {
        console.log(`[평판] 티어 역할 ${set.length}/${TIER_KEYS.length}개 · ${Math.max(5, SWEEP_INTERVAL_MIN)}분마다 동기화`);
    }
}

module.exports = {
    setupCommand, handleSetup, syncCommand, handleSync,
    sync, startSyncing, logConfig, fetchTiers,
    _internals: { TIERS, TIER_KEYS, configured },
};
