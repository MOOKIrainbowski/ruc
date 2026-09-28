// 역할 설정 (config/roles.json) 로더와 판정 도구
//
// ── 왜 JSON 한 곳에 모으는가 ──────────────────────────────────────────
// 역할 ID 가 코드 여기저기 흩어지면, 서버를 새로 만들거나 역할을 다시 만들 때
// 무엇을 고쳐야 하는지 알 수 없게 됩니다. 이 파일은 ID 를 **읽기만** 하고,
// 판정(스태프인가 / 어느 등급인가)을 함수로 제공합니다.
//
// 새 등급을 추가할 때 코드를 고칠 필요가 없습니다 — roles.json 에 항목 하나를
// 넣으면 스태프 판정·등급 비교·마크 칭호 연결이 전부 따라옵니다.

const fs = require('fs');
const path = require('path');
const {
    EmbedBuilder, SlashCommandBuilder, MessageFlags, PermissionFlagsBits,
} = require('discord.js');

const ROLES_FILE = path.join(__dirname, 'config', 'roles.json');

let config = null;

// ── 로드 ──────────────────────────────────────────────────────────────

/**
 * roles.json 을 읽습니다. 형식이 깨져 있으면 던집니다 — 역할 설정이 잘못된 채
 * 봇이 떠 있으면 "권한이 없다" 는 문의만 쌓이고 원인을 찾기 어렵습니다.
 * 기동 때 크게 실패하는 쪽이 낫습니다.
 */
function load() {
    const raw = fs.readFileSync(ROLES_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed.roles || typeof parsed.roles !== 'object') {
        throw new Error('config/roles.json 에 roles 객체가 없습니다.');
    }

    const seen = new Map();
    for (const [key, role] of Object.entries(parsed.roles)) {
        if (!role.id || !/^\d{17,20}$/.test(String(role.id))) {
            throw new Error(`역할 '${key}' 의 id 가 디스코드 ID 형식이 아닙니다: ${role.id}`);
        }
        // 같은 ID 를 두 키에 걸면 등급 판정이 설정 순서에 따라 달라집니다.
        if (seen.has(role.id)) {
            throw new Error(
                `역할 ID ${role.id} 가 '${seen.get(role.id)}' 와 '${key}' 양쪽에 있습니다.`);
        }
        seen.set(role.id, key);

        if (typeof role.priority !== 'number') {
            throw new Error(`역할 '${key}' 에 priority(숫자) 가 없습니다.`);
        }
    }

    config = parsed;
    return config;
}

function get() {
    if (!config) load();
    return config;
}

/** key → 역할 정의. 없으면 null. */
function byKey(key) {
    return get().roles[key] || null;
}

/** 디스코드 역할 ID → 역할 정의(+key). 없으면 null. */
function byId(roleId) {
    for (const [key, role] of Object.entries(get().roles)) {
        if (role.id === String(roleId)) return { key, ...role };
    }
    return null;
}

/** kind 로 거릅니다. priority 내림차순. */
function ofKind(kind) {
    return Object.entries(get().roles)
        .filter(([, role]) => role.kind === kind)
        .map(([key, role]) => ({ key, ...role }))
        .sort((a, b) => b.priority - a.priority);
}

function all() {
    return Object.entries(get().roles)
        .map(([key, role]) => ({ key, ...role }))
        .sort((a, b) => b.priority - a.priority);
}

/** 인증 통과 시 부여할 역할. */
function verifiedRole() {
    const key = get().verifiedRole;
    const role = byKey(key);
    if (!role) throw new Error(`verifiedRole '${key}' 가 roles 에 없습니다.`);
    return { key, ...role };
}

// ── 판정 ──────────────────────────────────────────────────────────────

/**
 * 스태프인가.
 *
 * 역할로 봅니다. 다만 **Administrator 권한은 항상 통과**시킵니다 — 역할 ID 를
 * 잘못 넣었을 때 서버 주인까지 잠기는 상황을 막는 안전장치입니다.
 */
function isStaff(member) {
    if (!member) return false;
    if (member.permissions?.has?.(require('discord.js').PermissionsBitField.Flags.Administrator)) {
        return true;
    }
    return ofKind('staff').some(role => member.roles.cache.has(role.id));
}

/**
 * 상위 스태프인가 (Owner / Manager).
 *
 * 화폐 지급처럼 되돌리기 어려운 명령에 씁니다. "스태프면 다 된다" 로 두면
 * 테스터가 잔고를 만들 수 있게 됩니다.
 *
 * @param {number} minPriority 이 값 이상인 스태프 역할만 통과 (기본 950 = Manager)
 */
function isSeniorStaff(member, minPriority = 950) {
    if (!member) return false;
    if (member.permissions?.has?.(require('discord.js').PermissionsBitField.Flags.Administrator)) {
        return true;
    }
    return ofKind('staff')
        .filter(role => role.priority >= minPriority)
        .some(role => member.roles.cache.has(role.id));
}

/** 그 사람이 가진 것 중 가장 높은 역할. 없으면 null. */
function highest(member) {
    if (!member) return null;
    return all().find(role => member.roles.cache.has(role.id)) || null;
}

/** 그 사람이 가진 등급(rank) 중 가장 높은 것. 없으면 null. */
function highestRank(member) {
    if (!member) return null;
    return ofKind('rank').find(role => member.roles.cache.has(role.id)) || null;
}

// ── 부여 ──────────────────────────────────────────────────────────────

/**
 * 인증 통과 역할(Ruc)을 줍니다.
 *
 * 이미 가지고 있으면 아무것도 하지 않고 'already' 를 돌려줍니다 — 재인증이나
 * 중복 호출로 감사 로그가 지저분해지지 않게 합니다.
 *
 * @returns {Promise<'granted'|'already'|'missing'|'forbidden'|'error'>}
 */
async function grantVerified(member, reason = '인증 완료') {
    if (!member) return 'error';

    let role;
    try {
        role = verifiedRole();
    } catch {
        return 'missing';
    }

    if (member.roles.cache.has(role.id)) return 'already';

    // 서버에 그 역할이 실제로 있는지 확인합니다. 없는 ID 로 add 를 부르면
    // 그냥 실패하는데, 원인이 "설정이 틀렸다" 인지 "권한이 없다" 인지
    // 구분되지 않습니다.
    const exists = member.guild.roles.cache.get(role.id)
        || await member.guild.roles.fetch(role.id).catch(() => null);
    if (!exists) return 'missing';

    try {
        await member.roles.add(role.id, reason);
        return 'granted';
    } catch (err) {
        // 50013 Missing Permissions — 봇 역할이 대상 역할보다 아래에 있을 때가
        // 대부분입니다. 역할 목록에서 봇을 Ruc 위로 올려야 합니다.
        if (err?.code === 50013) return 'forbidden';
        return 'error';
    }
}

// ── 점검 ──────────────────────────────────────────────────────────────

/**
 * 설정된 역할이 쓸 수 있는 상태인지 확인합니다.
 *
 * <h2>"부여할 수 있는가" 와 "읽을 수 있는가" 는 다릅니다</h2>
 * 봇이 실제로 <b>부여</b>하는 역할은 인증 역할(Ruc) 하나뿐입니다. 그것만
 * 봇 역할보다 아래에 있으면 됩니다.
 *
 * 스태프·등급 역할은 봇이 주지 않습니다 — 사람이 주고, 봇은 <b>읽기만</b>
 * 합니다(권한 검사, 마크 칭호 동기화). 읽기는 역할 서열과 무관하므로, 그것들이
 * 봇보다 위에 있는 것은 <b>정상이고 오히려 안전합니다</b>. 여기를 오류로
 * 표시하면 고칠 필요 없는 것을 고치려다 봇에게 과한 권한을 주게 됩니다.
 *
 * @returns {Promise<Array<{key, label, id, ok, problem, assignable}>>}
 */
async function audit(guild) {
    const me = guild.members.me
        || await guild.members.fetchMe().catch(() => null);
    const myTop = me ? me.roles.highest.position : -1;

    const verifiedKey = get().verifiedRole;

    const rows = [];
    for (const role of all()) {
        const found = guild.roles.cache.get(role.id)
            || await guild.roles.fetch(role.id).catch(() => null);

        // 이것만은 무조건 오류입니다. ID 가 틀리면 권한 검사도 칭호 연결도
        // 조용히 어긋납니다.
        if (!found) {
            rows.push({ ...role, ok: false, assignable: false, problem: '서버에 없는 역할 ID' });
            continue;
        }

        // 봇이 부여해야 하는 역할인가 — 지금은 인증 역할 하나뿐입니다.
        const mustAssign = role.key === verifiedKey;

        if (role.managed) {
            rows.push({ ...role, ok: true, assignable: false,
                problem: '디스코드 관리 역할 (봇이 부여하지 않음)' });
            continue;
        }

        const canAssign = found.position < myTop;

        if (mustAssign && !canAssign) {
            rows.push({ ...role, ok: false, assignable: false,
                problem: `봇 역할보다 위에 있어 부여 불가 (${found.position} ≥ ${myTop}) `
                    + '— 인증 시 이 역할을 주지 못합니다' });
            continue;
        }

        rows.push({
            ...role, ok: true, assignable: canAssign,
            problem: canAssign ? '' : '읽기 전용 (봇보다 위 — 정상)',
        });
    }
    return rows;
}

/**
 * 마크 칭호 설정에 넣을 매핑. RucCore config.yml 의
 * titles.definitions.<키>.discord-role 에 들어갈 값입니다.
 */
function titleMapping() {
    const out = {};
    for (const role of all()) {
        if (role.titleKey) out[role.titleKey] = role.id;
    }
    return out;
}

// ── 슬래시 명령 ───────────────────────────────────────────────────────

const roleAuditCommand = new SlashCommandBuilder()
    .setName('역할점검')
    .setDescription('(스태프) 설정된 역할 ID 가 실제로 쓸 수 있는 상태인지 확인합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

async function handleRoleAudit(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) {
        return interaction.editReply('이 명령어는 서버 안에서만 사용할 수 있습니다.');
    }
    if (!isStaff(interaction.member)) {
        return interaction.editReply('❌ 스태프 전용 명령어입니다.');
    }

    let rows;
    try {
        rows = await audit(interaction.guild);
    } catch (err) {
        return interaction.editReply(`❌ 역할 설정을 읽지 못했습니다: ${err.message}`);
    }

    const broken = rows.filter(r => !r.ok);
    const lines = rows.map(r => {
        const mark = r.ok ? (r.problem ? '➖' : '✅') : '❌';
        const note = r.problem ? ` — ${r.problem}` : '';
        return `${mark} **${r.label}** \`${r.key}\` (${r.kind}, ${r.priority})${note}`;
    });

    const embed = new EmbedBuilder()
        .setColor(broken.length > 0 ? 0xff4444 : 0x93e93e)
        .setTitle(broken.length > 0
            ? `⚠️ 역할 점검 — 문제 ${broken.length}건`
            : '✅ 역할 점검 — 전부 정상')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: '설정 파일: config/roles.json' })
        .setTimestamp();

    if (broken.length > 0) {
        embed.addFields({
            name: '고치는 법',
            value: '• `서버에 없는 역할 ID` → config/roles.json 의 id 를 확인하세요.\n'
                + '• `부여 불가` → 서버 설정 → 역할에서 **봇 역할을 그 역할 위로** 올리세요.\n'
                + '\u200b\n`읽기 전용 (봇보다 위)` 은 오류가 아닙니다. 봇이 주지 않는 '
                + '역할이라 그대로 두는 것이 맞습니다.',
        });
    }

    return interaction.editReply({ embeds: [embed] });
}

module.exports = {
    load, get, byKey, byId, ofKind, all,
    roleAuditCommand, handleRoleAudit,
    verifiedRole, isStaff, isSeniorStaff, highest, highestRank,
    grantVerified, audit, titleMapping,
    ROLES_FILE,
};
