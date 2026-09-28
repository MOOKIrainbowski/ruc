// 제재 티어 자동화 (§3.9 + D5) — Phase 6-7
//
// ── 무엇을 한 번에 하는가 ─────────────────────────────────────────────
// /제재 하나로 디스코드 뮤트·밴 + 마크 네트워크 밴 + 재화 몰수 + 평판을 겁니다.
// 마크 쪽은 RCON(/rucsanction)으로 RucCore 에 기록하고, 프록시(RucGate)가
// 그 기록을 보고 로그인을 막습니다. 백엔드별 바닐라 /ban 은 쓰지 않습니다 —
// 약탈에서 밴해도 홈으로 들어오기 때문입니다.
//
// ── D5 표는 여기 한 곳에만 있습니다 ─────────────────────────────────
// 마크 플러그인은 받은 값(몇 분·몇 %)을 그대로 집행만 합니다. 표가 두 군데
// 있으면 디스코드 밴 기간과 마크 밴 기간이 따로 고쳐집니다.
//
// ── 정책 (2026-09-28 소유자 결정) ─────────────────────────────────────
// 1. 1~3단계는 sanctionRoles 가 바로 집행. 4단계 이상은 Manager 이상 승인.
// 2. 단계는 스태프가 고릅니다. 봇은 이력을 보여 주고 다음 단계를 **제안만** 합니다.
// 3. 한쪽이 실패하면 성공한 쪽은 유지하고, 실패한 쪽을 '재시도' 버튼으로 남깁니다.
// 4. 이번 범위: 밴·뮤트·몰수·평판. 길드·홈·인벤토리·IP 는 '수동 처리' 로 안내만.

const fs = require('fs');
const path = require('path');
const { Rcon } = require('rcon-client');
const {
    EmbedBuilder, SlashCommandBuilder, MessageFlags, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, PermissionFlagsBits,
} = require('discord.js');
const roles = require('./roles');

const DATA_FILE = path.join(__dirname, 'sanctions_data.json');

const HOUR = 60;
const DAY = 24 * HOUR;
const PERM = -1;

/**
 * D5 제재 티어 (docs/01-DEFINE-DECISIONS.md).
 *
 * 분 단위입니다. PERM(-1) 은 영구.
 * discordBan 이 있으면 뮤트는 걸지 않습니다 — 밴된 사람은 서버에 없어서
 * 타임아웃이 의미가 없고, 디스코드는 밴과 함께 타임아웃을 지웁니다.
 * (D5 의 2~4단계 "뮤트 N + 밴 N" 은 결과적으로 "밴 N" 과 같습니다.)
 *
 * rep: none | -50 같은 숫자 | down1 (한 티어 강등) | dark (검정으로)
 * manual: 이번 범위에서 자동화하지 않은 부가 처벌. 스태프에게 안내만 합니다.
 */
const TIERS = {
    1:  { discordMute: 6 * HOUR,                          mcBan: 6 * HOUR,   pct: 0,   rep: 'none',  manual: [] },
    2:  { discordMute: 12 * HOUR, discordBan: 12 * HOUR,  mcBan: 1 * DAY,    pct: 0,   rep: 'none',  manual: [] },
    3:  { discordMute: 3 * DAY,   discordBan: 3 * DAY,    mcBan: 3 * DAY,    pct: 10,  rep: 'none',  manual: [] },
    4:  { discordMute: 7 * DAY,   discordBan: 7 * DAY,    mcBan: 7 * DAY,    pct: 20,  rep: '-50',   manual: [] },
    5:  { discordBan: 14 * DAY,                           mcBan: 14 * DAY,   pct: 35,  rep: 'down1', manual: ['길드 직책 박탈'] },
    6:  { discordBan: 30 * DAY,                           mcBan: 30 * DAY,   pct: 50,  rep: 'none',  manual: ['길드 강제 탈퇴', '영토 청구권 상실'] },
    7:  { discordBan: 90 * DAY,                           mcBan: 90 * DAY,   pct: 70,  rep: 'none',  manual: ['모든 /home·클레임 삭제', '후원 혜택 정지'] },
    8:  { discordBan: PERM,                               mcBan: 180 * DAY,  pct: 100, rep: 'dark',  manual: ['약탈/평화 인벤토리 몰수', '평판 검정 고정(상승 차단)'] },
    9:  { discordBan: PERM,                               mcBan: PERM,       pct: 100, rep: 'dark',  manual: ['계정 데이터 아카이브', '소명 1회 한정'] },
    10: { discordBan: PERM,                               mcBan: PERM,       pct: 100, rep: 'dark',  manual: ['IP 차단 (§D5 주의사항 확인)', '부계정 연쇄 차단'] },
};

/** 이 단계부터 Manager 이상 승인이 필요합니다 (D5 운영 원칙). */
const APPROVAL_FROM = 4;
/** 이 단계부터 소명 창구를 반드시 안내합니다 (D5 운영 원칙). */
const APPEAL_FROM = 8;

/** 디스코드 타임아웃 상한 (28일). 이보다 길면 API 가 거절합니다. */
const MAX_TIMEOUT_MIN = 28 * DAY;

// ── 저장 ──────────────────────────────────────────────────────────────

/**
 * 제재 건은 파일에 남깁니다. 임시 밴을 푸는 시각이 여기 있어서, 봇이 재시작해도
 * 밴이 영원히 남지 않아야 합니다. 승인 대기 건도 재시작을 넘어가야 합니다.
 */
let data = load();

function load() {
    try {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return { counter: parsed.counter || 0, cases: parsed.cases || {} };
    } catch {
        return { counter: 0, cases: {} };
    }
}

function save() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** 기안 — 미리보기에서 버튼을 누르기 전까지. 메모리에만 둡니다 (15분). */
const drafts = new Map();
const DRAFT_TTL_MS = 15 * 60 * 1000;

// ── 권한 ──────────────────────────────────────────────────────────────

/**
 * 제재를 걸 수 있는가.
 *
 * roles.json 의 sanctionRoles 에 적힌 역할이거나 Manager 이상입니다. 지금은
 * Helper 역할이 없어서 사실상 Manager 이상만 됩니다 — Helper 를 만들면
 * sanctionRoles 에 키 하나만 추가하세요.
 */
function canIssue(member) {
    if (roles.isSeniorStaff(member)) return true;
    const keys = roles.get().sanctionRoles;
    if (!Array.isArray(keys)) return false;
    return keys.map(roles.byKey).filter(Boolean)
        .some(role => member?.roles?.cache?.has(role.id));
}

/** 4단계 이상을 승인할 수 있는가 — Manager 이상. */
function canApprove(member) {
    return roles.isSeniorStaff(member);
}

// ── RCON ──────────────────────────────────────────────────────────────

/** @returns {Promise<string|null>} 응답. 연결 실패면 null. */
async function rcon(command) {
    const password = process.env.RUC_RCON_PW || '';
    if (!password) return null;

    let conn;
    try {
        conn = await Rcon.connect({
            host: process.env.RUC_RCON_HOST || '127.0.0.1',
            port: parseInt(process.env.RUC_RCON_PORT || '25576', 10),
            password,
            timeout: 5000,
        });
        return String(await conn.send(command));
    } catch (err) {
        console.warn('[제재] RCON 실패:', err.message);
        return null;
    } finally {
        if (conn) {
            try { await conn.end(); } catch { /* 이미 끊긴 경우 */ }
        }
    }
}

/** RCON 인자 한 칸에 들어가도록 — 공백이 있으면 인자가 밀립니다. */
function token(s) {
    return String(s || '-').trim().replace(/\s+/g, '_').slice(0, 64) || '-';
}

/** 사유는 맨 뒤 인자라 공백은 되지만 줄바꿈은 안 됩니다 (명령 한 줄). */
function oneLine(s, max = 300) {
    return String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

/**
 * 누범 판단 재료. 마크 서버가 주인입니다.
 *
 * @returns {Promise<object|null>} NOT_FOUND 면 { found:false }, 연결 실패면 null
 */
async function fetchHistory(name) {
    const response = await rcon(`rucsanction history ${token(name)}`);
    if (response === null) return null;
    if (/RUCSANCTION\s+NOT_FOUND/.test(response)) return { found: false };
    if (!/RUCSANCTION\s+HISTORY/.test(response)) return null;

    const out = { found: true };
    const nameAt = response.indexOf(' name=');
    const head = nameAt >= 0 ? response.slice(0, nameAt) : response;
    if (nameAt >= 0) out.name = response.slice(nameAt + 6).trim();
    for (const pair of head.split(/\s+/)) {
        const eq = pair.indexOf('=');
        if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    for (const k of ['count', 'max', 'last', 'lastAt', 'confirmed']) {
        out[k] = parseInt(out[k] || '0', 10) || 0;
    }
    return out;
}

/**
 * 다음 단계 제안. **자동 상향이 아니라 제안입니다** — 단계는 스태프가 고릅니다.
 *
 * 이전 제재가 있으면 그중 가장 무거운 것 + 1. 없으면 1단계.
 * 해제된 제재는 마크 서버가 이미 빼고 셉니다 (오판을 누범으로 치지 않습니다).
 */
function suggestTier(history) {
    if (!history || !history.found || history.count === 0) return 1;
    return Math.min(10, history.max + 1);
}

// ── 표시 ──────────────────────────────────────────────────────────────

function duration(min) {
    if (!min) return '—';
    if (min === PERM) return '영구';
    if (min % DAY === 0) return `${min / DAY}일`;
    if (min % HOUR === 0) return `${min / HOUR}시간`;
    return `${min}분`;
}

function repText(rep) {
    switch (rep) {
        case 'none': return '—';
        case 'down1': return '1티어 강등';
        case 'dark': return '검정 티어로';
        default: return `평판 ${rep}`;
    }
}

function tierSummary(n) {
    const t = TIERS[n];
    const discord = t.discordBan ? `밴 ${duration(t.discordBan)}` : `뮤트 ${duration(t.discordMute)}`;
    return [
        `디스코드 **${discord}**`,
        `마크 **밴 ${duration(t.mcBan)}**`,
        `몰수 **${t.pct}%**`,
        `평판 **${repText(t.rep)}**`,
    ].join(' · ');
}

function historyText(h) {
    if (!h) return '마크 서버에 연결하지 못했습니다.';
    const lines = [
        `이전 제재 **${h.count}건**` + (h.count ? ` (최고 ${h.max}단계 · 최근 ${h.last}단계`
            + (h.lastAt ? ` <t:${Math.floor(h.lastAt / 1000)}:R>` : '') + ')' : ''),
        `확정 신고 **${h.confirmed}건**`,
    ];
    if (h.active && h.active !== '-') {
        const [id, until] = h.active.split(':');
        lines.push(`⚠️ **지금 밴 중** (#${id}, `
            + (until === 'perm' ? '영구' : `<t:${Math.floor(Number(until) / 1000)}:f> 까지`) + ')');
    }
    return lines.join('\n');
}

function statusMark(part) {
    if (!part) return '➖';
    if (part.ok) return '✅';
    if (part.skipped) return '➖';
    return '❌';
}

function caseEmbed(c) {
    const t = TIERS[c.tier];
    const color = c.status === 'done' ? 0xff5555
        : c.status === 'partial' ? 0xffaa00
        : c.status === 'revoked' ? 0x8a8a8a
        : c.status === 'rejected' ? 0x8a8a8a
        : 0x5865f2;

    const title = {
        pending: `⏳ 제재 승인 대기 — ${c.tier}단계`,
        done: `🔨 제재 집행 — ${c.tier}단계`,
        partial: `⚠️ 제재 일부 실패 — ${c.tier}단계`,
        revoked: `↩️ 제재 해제됨 — ${c.tier}단계`,
        rejected: `🚫 제재 반려 — ${c.tier}단계`,
    }[c.status] || `제재 — ${c.tier}단계`;

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${title} · 사건 #${c.no}`)
        .addFields(
            { name: '대상', value: `\`${c.targetName}\``
                + (c.discordId ? ` · <@${c.discordId}>` : ' · 디스코드 미연동'), inline: false },
            { name: '처분', value: tierSummary(c.tier) },
            { name: '사유', value: c.reason.slice(0, 1000) },
            { name: '증거', value: c.evidence.slice(0, 1000) },
            { name: '집행', value: `<@${c.issuerId}>`
                + (c.approverId ? ` · 승인 <@${c.approverId}>` : ''), inline: true },
        )
        .setFooter({ text: `ref ${c.ref}` + (c.mcId ? ` · 마크 제재 #${c.mcId}` : '') })
        .setTimestamp(c.createdAt);

    if (c.results) {
        const r = c.results;
        embed.addFields({
            name: '집행 결과',
            value: [
                `${statusMark(r.mc)} 마크 — ${r.mc?.note || '미실행'}`,
                `${statusMark(r.discord)} 디스코드 — ${r.discord?.note || '미실행'}`,
                `${statusMark(r.dm)} 대상 DM — ${r.dm?.note || '미실행'}`,
            ].join('\n'),
        });
    }
    if (t.manual.length && c.status !== 'rejected') {
        embed.addFields({ name: '수동 처리 필요 (자동화 범위 밖)',
            value: t.manual.map(m => `• ${m}`).join('\n') });
    }
    if (c.revokedBy) {
        embed.addFields({ name: '해제', value: `<@${c.revokedBy}> · <t:${Math.floor(c.revokedAt / 1000)}:f>` });
    }
    return embed;
}

// ── 집행 ──────────────────────────────────────────────────────────────

/**
 * 제재 한 건을 집행합니다. 이미 성공한 부분은 다시 하지 않습니다 — 재시도 버튼이
 * 같은 함수를 부릅니다.
 *
 * 순서: DM → 마크 → 디스코드.
 * DM 이 먼저인 이유는 밴된 뒤에는 공통 서버가 없어 DM 이 막히기 때문입니다.
 */
async function execute(guild, c) {
    const t = TIERS[c.tier];
    c.results = c.results || {};
    const r = c.results;

    // 1) 대상에게 알림 — 실패해도 집행은 계속합니다 (DM 을 막아 둔 사람이 많습니다).
    if (!r.dm && c.discordId) {
        try {
            const user = await guild.client.users.fetch(c.discordId);
            const lines = [
                `**러크 서버** 에서 제재 **${c.tier}단계** 가 집행되었습니다. (사건 #${c.no})`,
                '',
                tierSummary(c.tier),
                '',
                `**사유** ${c.reason}`,
            ];
            if (c.tier >= APPEAL_FROM) {
                lines.push('', `**소명 창구** ${process.env.RUC_APPEAL_CONTACT
                    || '(설정되지 않음 — 스태프에게 문의)'}`);
            } else {
                lines.push('', '이의가 있으면 기간이 끝난 뒤 `/ticket` 으로 문의해 주세요.');
            }
            await user.send(lines.join('\n'));
            r.dm = { ok: true, note: '보냄' };
        } catch {
            r.dm = { ok: false, skipped: true, note: 'DM 차단 또는 실패 (집행과 무관)' };
        }
    } else if (!r.dm) {
        r.dm = { ok: false, skipped: true, note: '디스코드 미연동' };
    }

    // 2) 마크 — 네트워크 밴 + 몰수 + 평판. ref 가 같으면 서버가 중복을 막습니다.
    if (!r.mc?.ok) {
        const ban = t.mcBan === PERM ? 'perm' : String(t.mcBan);
        const response = await rcon(['rucsanction', 'apply', c.ref, token(c.targetName),
            c.tier, ban, t.pct, t.rep, token(c.issuerName), oneLine(c.reason)].join(' '));

        const m = response && response.match(/RUCSANCTION\s+(OK|DUP)\s+id=(\d+)(?:.*applied=(\w+))?/);
        if (m) {
            c.mcId = parseInt(m[2], 10);
            const when = m[3] === 'now' ? '몰수·평판 즉시 적용'
                : m[1] === 'DUP' ? '이미 기록됨 (재시도)'
                : '몰수·평판은 다음 접속 때 적용';
            r.mc = { ok: true, note: `네트워크 밴 ${duration(t.mcBan)} · #${c.mcId} · ${when}` };
        } else if (response && /NOT_FOUND/.test(response)) {
            r.mc = { ok: false, note: '마크 서버 기록에 없는 닉네임' };
        } else {
            r.mc = { ok: false, note: response === null
                ? '마크 서버에 연결하지 못함' : `오류: ${oneLine(response, 100)}` };
        }
    }

    // 3) 디스코드 — 밴 또는 타임아웃.
    if (!r.discord?.ok && !r.discord?.skipped) {
        if (!c.discordId) {
            r.discord = { ok: false, skipped: true, note: '디스코드 미연동 — 건너뜀' };
        } else if (t.discordBan) {
            try {
                await guild.bans.create(c.discordId, {
                    reason: `[제재 #${c.no} ${c.tier}단계] ${oneLine(c.reason, 400)}`,
                    deleteMessageSeconds: 0,
                });
                if (t.discordBan !== PERM) {
                    c.unbanAt = Date.now() + t.discordBan * 60_000;
                }
                r.discord = { ok: true, note: `밴 ${duration(t.discordBan)}` };
            } catch (err) {
                r.discord = { ok: false, note: discordError(err, '밴') };
            }
        } else if (t.discordMute) {
            const member = await guild.members.fetch(c.discordId).catch(() => null);
            if (!member) {
                r.discord = { ok: false, skipped: true, note: '서버에 없음 — 뮤트 건너뜀' };
            } else {
                try {
                    await member.timeout(Math.min(t.discordMute, MAX_TIMEOUT_MIN) * 60_000,
                        `[제재 #${c.no} ${c.tier}단계] ${oneLine(c.reason, 400)}`);
                    r.discord = { ok: true, note: `뮤트 ${duration(t.discordMute)}` };
                } catch (err) {
                    r.discord = { ok: false, note: discordError(err, '뮤트') };
                }
            }
        }
    }

    const failed = !r.mc.ok || (!r.discord.ok && !r.discord.skipped);
    c.status = failed ? 'partial' : 'done';
    c.executedAt = c.executedAt || Date.now();
    save();
    return c;
}

function discordError(err, what) {
    // 50013 — 봇 역할이 대상보다 낮거나 권한(밴/타임아웃)이 없습니다.
    if (err?.code === 50013) return `${what} 권한 없음 (봇 역할 위치·권한 확인)`;
    return `${what} 실패: ${err?.message || err}`;
}

/** 결과를 로그 채널에 남깁니다. D5 — 모든 제재는 기록을 보존합니다. */
async function postLog(guild, c) {
    const id = process.env.SANCTION_LOG_CHANNEL_ID || process.env.LOG_CHANNEL_ID;
    if (!id) return;
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel) return;
    await channel.send({ embeds: [caseEmbed(c)], components: resultButtons(c) }).catch(() => {});
}

function resultButtons(c) {
    if (c.status !== 'partial') return [];
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sanction_retry_${c.no}`)
            .setLabel('실패한 부분 재시도').setStyle(ButtonStyle.Danger))];
}

// ── 임시 밴 풀기 ──────────────────────────────────────────────────────

/**
 * 디스코드에는 기간제 밴이 없습니다. 풀 시각을 파일에 적어 두고 1분마다
 * 확인합니다. 봇이 꺼져 있던 동안 지난 것은 켜지자마자 풉니다.
 */
async function sweepUnbans(guild) {
    const now = Date.now();
    for (const c of Object.values(data.cases)) {
        if (!c.unbanAt || c.unbanned || c.unbanAt > now) continue;
        try {
            await guild.bans.remove(c.discordId, `제재 #${c.no} 기간 만료`);
            c.unbanned = true;
            console.log(`[제재] #${c.no} 디스코드 밴 만료 해제 — ${c.targetName}`);
        } catch (err) {
            // 10026 Unknown Ban — 이미 누가 손으로 풀었습니다.
            if (err?.code === 10026) c.unbanned = true;
            else console.warn(`[제재] #${c.no} 밴 해제 실패:`, err.message);
        }
        save();
    }
}

function start(guild) {
    sweepUnbans(guild).catch(err => console.error('[제재] 만료 확인 실패:', err));
    setInterval(() => {
        sweepUnbans(guild).catch(err => console.error('[제재] 만료 확인 실패:', err));
    }, 60 * 1000).unref?.();

    const waiting = Object.values(data.cases).filter(c => c.unbanAt && !c.unbanned).length;
    const pending = Object.values(data.cases).filter(c => c.status === 'pending').length;
    console.log(`[제재] 임시 밴 ${waiting}건 대기 · 승인 대기 ${pending}건`);
}

// ── 슬래시 명령 ───────────────────────────────────────────────────────

const sanctionCommand = new SlashCommandBuilder()
    .setName('제재')
    .setDescription('(스태프) D5 제재 티어를 집행합니다. 디스코드·마크에 동시에 걸립니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(o => o.setName('닉네임').setDescription('마인크래프트 닉네임')
        .setRequired(true).setMaxLength(16))
    .addIntegerOption(o => o.setName('단계').setDescription('1~10 (4 이상은 Manager 승인)')
        .setRequired(true).setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName('사유').setDescription('무엇을 했는가')
        .setRequired(true).setMaxLength(300))
    .addStringOption(o => o.setName('증거').setDescription('스크린샷·로그·티켓 링크 (D5 — 필수)')
        .setRequired(true).setMaxLength(500));

const revokeCommand = new SlashCommandBuilder()
    .setName('제재해제')
    .setDescription('(Manager) 제재를 해제합니다. 몰수·평판은 되돌리지 않습니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption(o => o.setName('사건').setDescription('사건 번호 (#)')
        .setRequired(true).setMinValue(1));

const historyCommand = new SlashCommandBuilder()
    .setName('기록')
    .setDescription('(스태프) 플레이어의 제재·신고 이력을 봅니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(o => o.setName('닉네임').setDescription('마인크래프트 닉네임')
        .setRequired(true).setMaxLength(16));

/** /제재 — 바로 집행하지 않고 미리보기를 띄웁니다. 이력과 제안을 먼저 봐야 합니다. */
async function handleSanction(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) return interaction.editReply('서버 안에서만 됩니다.');
    if (!canIssue(interaction.member)) {
        return interaction.editReply('❌ 제재 권한이 없습니다. (roles.json 의 sanctionRoles 또는 Manager 이상)');
    }

    const name = interaction.options.getString('닉네임').trim();
    const tier = interaction.options.getInteger('단계');
    const reason = oneLine(interaction.options.getString('사유'));
    const evidence = oneLine(interaction.options.getString('증거'), 500);

    const history = await fetchHistory(name);
    if (history === null) {
        // 대상의 디스코드 연동을 마크 서버가 알고 있습니다. 모르는 채로 걸면
        // 디스코드 쪽이 통째로 빠지므로 여기서 멈춥니다 (아직 아무것도 안 걸림).
        return interaction.editReply('❌ 마크 서버에 연결하지 못했습니다. 서버 상태를 확인해 주세요.\n'
            + '아직 아무것도 집행되지 않았습니다.');
    }
    if (!history.found) {
        return interaction.editReply(`❌ \`${name}\` — 서버 기록에 없는 닉네임입니다.`);
    }

    const discordId = history.discord && history.discord !== '-' ? history.discord : null;
    if (discordId) {
        const member = await interaction.guild.members.fetch(discordId).catch(() => null);
        if (member && roles.isStaff(member)) {
            return interaction.editReply('❌ 스태프는 제재할 수 없습니다. 역할을 먼저 내려 주세요.');
        }
    }

    const suggestion = suggestTier(history);
    const needsApproval = tier >= APPROVAL_FROM && !canApprove(interaction.member);

    const draftId = `${interaction.id}`;
    drafts.set(draftId, {
        issuerId: interaction.user.id,
        issuerName: interaction.user.username,
        targetName: history.name || name,
        discordId, tier, reason, evidence, needsApproval,
        expiresAt: Date.now() + DRAFT_TTL_MS,
    });

    const embed = new EmbedBuilder()
        .setColor(needsApproval ? 0x5865f2 : 0xff5555)
        .setTitle(`제재 미리보기 — ${tier}단계`)
        .addFields(
            { name: '대상', value: `\`${history.name || name}\``
                + (discordId ? ` · <@${discordId}>` : ' · 디스코드 미연동') },
            { name: '처분', value: tierSummary(tier) },
            { name: '이력', value: historyText(history) },
            { name: '제안 단계', value: suggestion === tier ? `**${suggestion}단계** (선택과 같음)`
                : `**${suggestion}단계**` + (tier < suggestion
                    ? ' — ⚠️ 선택한 단계가 누범 기준보다 낮습니다' : '') },
            { name: '사유', value: reason },
            { name: '증거', value: evidence },
        )
        .setFooter({ text: needsApproval
            ? '4단계 이상 — Manager 이상 승인 후 집행됩니다'
            : '집행하면 디스코드와 마크에 동시에 걸립니다' });

    if (TIERS[tier].manual.length) {
        embed.addFields({ name: '수동 처리 필요 (자동화 범위 밖)',
            value: TIERS[tier].manual.map(m => `• ${m}`).join('\n') });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sanction_go_${draftId}`)
            .setLabel(needsApproval ? '승인 요청' : '집행').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`sanction_cancel_${draftId}`)
            .setLabel('취소').setStyle(ButtonStyle.Secondary));

    return interaction.editReply({ embeds: [embed], components: [row] });
}

function newCase(draft) {
    data.counter += 1;
    const no = data.counter;
    const c = {
        no,
        // 마크 쪽 중복 방지 키. 봇 데이터가 날아가 번호가 다시 1부터 시작해도
        // 겹치지 않게 시각을 섞습니다.
        ref: `d${Date.now().toString(36)}n${no}`,
        targetName: draft.targetName,
        discordId: draft.discordId,
        tier: draft.tier,
        reason: draft.reason,
        evidence: draft.evidence,
        issuerId: draft.issuerId,
        issuerName: draft.issuerName,
        approverId: null,
        status: draft.needsApproval ? 'pending' : 'executing',
        createdAt: Date.now(),
    };
    data.cases[no] = c;
    save();
    return c;
}

async function handleRevoke(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!canApprove(interaction.member)) {
        return interaction.editReply('❌ 제재 해제는 Manager 이상만 할 수 있습니다.');
    }

    const no = interaction.options.getInteger('사건');
    const c = data.cases[no];
    if (!c) return interaction.editReply(`❌ 사건 #${no} 을 찾지 못했습니다.`);
    if (c.status === 'revoked') return interaction.editReply(`사건 #${no} 은 이미 해제되었습니다.`);
    if (c.status === 'pending' || c.status === 'rejected') {
        return interaction.editReply(`사건 #${no} 은 집행되지 않았습니다 (${c.status}).`);
    }

    const notes = [];
    if (c.mcId) {
        const response = await rcon(`rucsanction revoke ${c.mcId} ${token(interaction.user.username)}`);
        if (response && /REVOKED|ALREADY/.test(response)) notes.push('✅ 마크 밴 해제');
        else {
            notes.push('❌ 마크 밴 해제 실패 — 서버 연결 확인 후 다시 실행하세요');
            await interaction.editReply(notes.join('\n'));
            return;   // 상태를 바꾸지 않습니다. 다시 실행하면 이어서 합니다.
        }
    }
    if (c.discordId && c.results?.discord?.ok) {
        if (TIERS[c.tier].discordBan) {
            try {
                await interaction.guild.bans.remove(c.discordId, `제재 #${no} 해제`);
                notes.push('✅ 디스코드 밴 해제');
            } catch (err) {
                notes.push(err?.code === 10026 ? '➖ 디스코드 밴 이미 없음'
                    : `❌ 디스코드 밴 해제 실패: ${err.message}`);
            }
            c.unbanned = true;
        } else {
            const member = await interaction.guild.members.fetch(c.discordId).catch(() => null);
            if (member) {
                await member.timeout(null, `제재 #${no} 해제`)
                    .then(() => notes.push('✅ 뮤트 해제'))
                    .catch(err => notes.push(`❌ 뮤트 해제 실패: ${err.message}`));
            }
        }
    }

    c.status = 'revoked';
    c.revokedBy = interaction.user.id;
    c.revokedAt = Date.now();
    save();
    await postLog(interaction.guild, c);

    notes.push('', '몰수·평판은 되돌리지 않았습니다. 오판이면 `/ruc give` 로 보상하세요.');
    return interaction.editReply(notes.join('\n'));
}

async function handleHistory(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!roles.isStaff(interaction.member)) {
        return interaction.editReply('❌ 스태프 전용 명령어입니다.');
    }

    const name = interaction.options.getString('닉네임').trim();
    const history = await fetchHistory(name);
    if (history && !history.found) {
        return interaction.editReply(`\`${name}\` — 서버 기록에 없는 닉네임입니다.`);
    }

    const lower = name.toLowerCase();
    const local = Object.values(data.cases)
        .filter(c => c.targetName.toLowerCase() === lower)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10);

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`기록 — ${history?.name || name}`)
        .addFields(
            { name: '마크 서버', value: historyText(history) },
            { name: `사건 (최근 ${local.length}건)`, value: local.length
                ? local.map(c => `#${c.no} · **${c.tier}단계** · ${c.status}`
                    + ` · <t:${Math.floor(c.createdAt / 1000)}:d> — ${c.reason.slice(0, 60)}`).join('\n')
                : '없음' },
            { name: '다음 제안', value: `${suggestTier(history)}단계` },
        );
    return interaction.editReply({ embeds: [embed] });
}

// ── 버튼 ──────────────────────────────────────────────────────────────

/** @returns {Promise<boolean>} 이 모듈의 버튼이었는가 */
async function handleButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('sanction_')) return false;

    if (id.startsWith('sanction_cancel_')) {
        drafts.delete(id.slice('sanction_cancel_'.length));
        await interaction.update({ content: '취소했습니다. 아무것도 집행되지 않았습니다.',
            embeds: [], components: [] });
        return true;
    }

    if (id.startsWith('sanction_go_')) {
        const draftId = id.slice('sanction_go_'.length);
        const draft = drafts.get(draftId);
        if (!draft || draft.expiresAt < Date.now()) {
            drafts.delete(draftId);
            await interaction.update({ content: '⌛ 미리보기가 만료되었습니다. `/제재` 를 다시 실행해 주세요.',
                embeds: [], components: [] });
            return true;
        }
        if (draft.issuerId !== interaction.user.id) {
            await interaction.reply({ content: '❌ 미리보기를 연 사람만 누를 수 있습니다.',
                flags: MessageFlags.Ephemeral });
            return true;
        }
        drafts.delete(draftId);
        const c = newCase(draft);

        if (c.status === 'pending') {
            await interaction.update({ content: `⏳ 사건 #${c.no} — Manager 승인을 요청했습니다.`,
                embeds: [], components: [] });
            await postApproval(interaction.guild, c);
            return true;
        }

        await interaction.update({ content: `🔨 사건 #${c.no} 집행 중…`, embeds: [], components: [] });
        await execute(interaction.guild, c);
        await interaction.editReply({ content: '', embeds: [caseEmbed(c)], components: resultButtons(c) });
        await postLog(interaction.guild, c);
        return true;
    }

    if (id.startsWith('sanction_approve_') || id.startsWith('sanction_reject_')) {
        const approve = id.startsWith('sanction_approve_');
        const no = parseInt(id.split('_').pop(), 10);
        const c = data.cases[no];
        if (!canApprove(interaction.member)) {
            await interaction.reply({ content: '❌ 승인은 Manager 이상만 할 수 있습니다.',
                flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!c || c.status !== 'pending') {
            await interaction.reply({ content: '이미 처리된 요청입니다.', flags: MessageFlags.Ephemeral });
            return true;
        }

        // 두 사람이 동시에 누르면 두 번 집행됩니다. 상태를 먼저 바꿔 막습니다
        // (Node 는 단일 스레드라 여기까지 await 없이 오면 경쟁이 없습니다).
        c.status = approve ? 'executing' : 'rejected';
        c.approverId = interaction.user.id;
        save();

        if (!approve) {
            await interaction.update({ embeds: [caseEmbed(c)], components: [] });
            return true;
        }

        await interaction.deferUpdate();
        await execute(interaction.guild, c);
        await interaction.editReply({ embeds: [caseEmbed(c)], components: resultButtons(c) });
        await postLog(interaction.guild, c);
        return true;
    }

    if (id.startsWith('sanction_retry_')) {
        const no = parseInt(id.split('_').pop(), 10);
        const c = data.cases[no];
        if (!c) {
            await interaction.reply({ content: '사건을 찾지 못했습니다.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const allowed = c.tier >= APPROVAL_FROM ? canApprove(interaction.member) : canIssue(interaction.member);
        if (!allowed) {
            await interaction.reply({ content: '❌ 권한이 없습니다.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (c.status !== 'partial') {
            await interaction.update({ embeds: [caseEmbed(c)], components: [] });
            return true;
        }

        await interaction.deferUpdate();
        await execute(interaction.guild, c);
        await interaction.editReply({ embeds: [caseEmbed(c)], components: resultButtons(c) });
        return true;
    }

    return false;
}

/** 승인 요청을 로그 채널(또는 SANCTION_APPROVAL_CHANNEL_ID)에 올립니다. */
async function postApproval(guild, c) {
    const id = process.env.SANCTION_APPROVAL_CHANNEL_ID
        || process.env.SANCTION_LOG_CHANNEL_ID || process.env.LOG_CHANNEL_ID;
    const channel = id ? await guild.channels.fetch(id).catch(() => null) : null;
    if (!channel) {
        console.warn(`[제재] 승인 채널이 없습니다 — 사건 #${c.no} 승인 요청을 올리지 못했습니다.`);
        return;
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sanction_approve_${c.no}`)
            .setLabel('승인하고 집행').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`sanction_reject_${c.no}`)
            .setLabel('반려').setStyle(ButtonStyle.Secondary));
    await channel.send({ embeds: [caseEmbed(c)], components: [row] });
}

module.exports = {
    sanctionCommand, revokeCommand, historyCommand,
    handleSanction, handleRevoke, handleHistory, handleButton, start,
    _internals: { TIERS, suggestTier, fetchHistory, execute, canIssue, canApprove, tierSummary },
};
