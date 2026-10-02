// 현금 충전 (docs/payment-design.md — 2026-10-02 승인)
//
// ── 입금 감지: D(관리자 확인) 중심 + A(안드로이드 알림) 자동 매칭 ────────
// 모든 주문은 관리자 채널에 [입금 확인] 버튼과 함께 올라옵니다. 그것만으로
// 시스템이 완결됩니다 (D). 알림 전달 앱이 살아 있으면 코드 · 금액이 정확히
// 맞는 입금을 사람 대신 확인합니다 (A). A 가 죽어도 D 로 돌아갈 뿐 입금이
// 사라지지 않습니다.
//
// ── 기록의 주인은 마크 서버(RucCore)입니다 ───────────────────────────────
// 주문 · 입금 · 지급 기록은 게임 DB 에 있고 봇은 RCON(/rucpay)으로만 만집니다.
// 백업 · MySQL 이전 · 5년 보관을 그대로 따라가게 하려는 것입니다. 봇이 들고
// 있는 것은 "관리자 메시지 ID" 같은 화면 상태뿐입니다 (pay_data.json).
//
// ── 상품표는 web/content/products.json 한 곳 ────────────────────────────
// 웹(/charge)과 같은 파일을 읽습니다. 가격이 두 곳에 적히면 한쪽만 고쳐집니다.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Rcon } = require('rcon-client');
const {
    EmbedBuilder, SlashCommandBuilder, MessageFlags, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, PermissionFlagsBits, ModalBuilder,
    TextInputBuilder, TextInputStyle,
} = require('discord.js');
const roles = require('./roles');

const DATA_FILE = path.join(__dirname, 'pay_data.json');
const PRODUCTS_FILE = process.env.PAY_PRODUCTS_FILE
    || path.join(__dirname, '..', 'web', 'content', 'products.json');

const COLOR = { pending: 0xfacc15, ok: 0x93e93e, review: 0xf97316, bad: 0xef4444, info: 0x60a5fa };

// ── 설정 ──────────────────────────────────────────────────────────────

/** 운영 켜기 (Q5 해결 후). 꺼져 있으면 Manager 이상만 주문할 수 있습니다 — 시험용. */
function enabled() {
    return process.env.PAY_ENABLED === 'true';
}

function account() {
    const bank = process.env.PAY_BANK?.trim();
    const number = process.env.PAY_ACCOUNT?.trim();
    const holder = process.env.PAY_HOLDER?.trim();
    return bank && number && holder ? { bank, number, holder } : null;
}

function adminChannelId() {
    return process.env.PAY_ADMIN_CHANNEL_ID || process.env.LOG_CHANNEL_ID || '';
}

function isAdmin(member) {
    return roles.isSeniorStaff(member);
}

// ── 상품 ──────────────────────────────────────────────────────────────

let catalog = { products: [], orderTtlMinutes: 60 };

function loadProducts() {
    try {
        catalog = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    } catch (e) {
        console.error(`[충전] 상품표를 읽지 못했습니다 (${PRODUCTS_FILE}):`, e.message);
        catalog = { products: [], orderTtlMinutes: 60 };
    }
    return catalog;
}

function product(id) {
    return catalog.products.find(p => p.id === id) || null;
}

function won(n) {
    return `${Number(n).toLocaleString('ko-KR')}원`;
}

// ── 화면 상태 (관리자 메시지 ID 등) ────────────────────────────────────

let data = load();

function load() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return { orderMessages: {}, depositMessages: {}, lastNotifyAt: 0, lastOrderAt: 0, retries: {} };
    }
}

function save() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.warn('[충전] pay_data.json 저장 실패:', e.message);
    }
}

// ── RCON ──────────────────────────────────────────────────────────────

/**
 * 마크 서버 연결 상태. 꺼져 있을 때 5분마다 같은 경고를 찍지 않도록
 * <b>바뀔 때만</b> 로그를 남깁니다 (null = 아직 모름).
 */
let serverUp = null;

/** @returns {Promise<string|null>} 응답 한 줄. 연결 실패면 null. */
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
        const reply = String(await conn.send(command)).trim();
        if (serverUp === false) console.log('[충전] 마크 서버 다시 연결됨');
        serverUp = true;
        return reply;
    } catch (err) {
        if (serverUp !== false) {
            console.warn(err.code === 'ECONNREFUSED'
                ? '[충전] 마크 서버 꺼짐 — 주문 · 지급은 서버가 켜지면 이어집니다'
                : `[충전] RCON 실패: ${err.message}`);
        }
        serverUp = false;
        return null;
    } finally {
        if (conn) {
            try { await conn.end(); } catch { /* 이미 끊김 */ }
        }
    }
}

/** RCON 인자 한 칸 — 공백이 있으면 인자가 밀립니다. */
function token(s) {
    return String(s || '-').trim().replace(/\s+/g, '_').slice(0, 64) || '-';
}

/** {@code RUCPAY DEPOSIT id=5 result=MATCHED ...} → { kind: 'DEPOSIT', id: '5', ... } */
function parse(line) {
    if (!line) return null;
    const m = line.match(/^RUCPAY\s+([A-Z_]+)(.*)$/);
    if (!m) return { kind: 'ERROR', raw: line };
    const out = { kind: m[1], raw: line };
    for (const [, k, v] of m[2].matchAll(/(\S+?)=(\S*)/g)) out[k] = v;
    return out;
}

/** {@code items=a:b;c:d} → [['a','b'],['c','d']] */
function items(r) {
    if (!r || !r.items || r.items === '-') return [];
    return r.items.split(';').map(s => s.split(':'));
}

// ── 공용 표시 ─────────────────────────────────────────────────────────

const REASON_TEXT = {
    NO_CODE: '입금자명에 주문 코드가 없음',
    UNKNOWN_CODE: '없는 주문 코드',
    AMOUNT: '금액이 주문과 다름',
    DUPLICATE: '이미 결제된 주문에 또 입금',
    CANCELLED: '취소된 주문에 입금',
    EXPIRED_OLD: '7일 넘게 지난 주문',
};

function orderEmbed(o, state) {
    const p = product(o.product);
    const e = new EmbedBuilder()
        .setTitle(`충전 주문 ${o.code} — ${p ? p.name : o.product}`)
        .addFields(
            { name: '금액', value: won(o.price ?? o.amount), inline: true },
            { name: '받는 사람', value: `${o.name} (<@${o.discord}>)`, inline: true },
            { name: '만료', value: o.expires ? `<t:${Math.floor(o.expires / 1000)}:R>` : '-', inline: true },
        )
        .setFooter({ text: `주문 #${o.order}` })
        .setTimestamp(o.created ? Number(o.created) : Date.now());
    if (state === 'pending') {
        e.setColor(COLOR.pending).setDescription('입금을 기다리는 중입니다. 토스 앱에서 **입금자명이 주문 코드이고 금액이 같은지** 확인한 뒤 눌러 주세요.');
    } else if (state) {
        e.setColor(state.color).setDescription(state.text);
    }
    return e;
}

function pendingButtons(code) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pay_ok_${code}`).setLabel('입금 확인 · 지급').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`pay_cancel_${code}`).setLabel('주문 취소').setStyle(ButtonStyle.Secondary),
    )];
}

function reviewButtons(depositId, orderCode) {
    const row = new ActionRowBuilder();
    if (orderCode) {
        row.addComponents(new ButtonBuilder().setCustomId(`pay_linkto_${depositId}_${orderCode}`)
            .setLabel(`${orderCode} 로 지급`).setStyle(ButtonStyle.Success));
    }
    row.addComponents(
        new ButtonBuilder().setCustomId(`pay_link_${depositId}`).setLabel('다른 주문에 연결').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pay_refund_${depositId}`).setLabel('환불 처리됨').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`pay_ignore_${depositId}`).setLabel('무시').setStyle(ButtonStyle.Secondary),
    );
    return [row];
}

async function adminChannel(guild) {
    const id = adminChannelId();
    if (!id || !guild) return null;
    return guild.channels.fetch(id).catch(() => null);
}

/** 주문의 관리자 메시지를 결과로 바꿉니다 (버튼 제거). */
async function settleOrderMessage(guild, code, o, state) {
    const ref = data.orderMessages[code];
    if (!ref) return;
    const channel = await guild.channels.fetch(ref.channelId).catch(() => null);
    const msg = channel ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
    if (msg) await msg.edit({ embeds: [orderEmbed(o, state)], components: [] }).catch(() => {});
    delete data.orderMessages[code];
    save();
}

async function dm(client, discordId, payload) {
    try {
        const user = await client.users.fetch(discordId);
        await user.send(payload);
        return true;
    } catch {
        return false; // DM 을 막아 둔 사람 — 주문 응답(임시 메시지)에 이미 다 적었습니다.
    }
}

// ── 입금 처리 결과 → 디스코드 ─────────────────────────────────────────

/**
 * RCON 의 DEPOSIT 응답을 받아 사람들에게 알립니다. 자동 매칭 · 버튼 · 웹훅이 전부 여기로.
 * @param by 누가 확인했나 (표시용)
 */
async function announce(guild, r, by) {
    if (!r) return;
    if (r.kind === 'DEPOSIT' && r.result === 'MATCHED') {
        const delivered = r.delivered === '1';
        const state = delivered
            ? { color: COLOR.ok, text: `✅ ${by} · 지급 완료${r.late === '1' ? ' (만료 후 입금)' : ''}` }
            : { color: COLOR.bad, text: `⚠️ ${by} · 결제는 확인했지만 **지급 실패** — 5분마다 자동 재시도합니다.` };
        await settleOrderMessage(guild, r.code, r, state);
        if (r.reason && r.reason.startsWith('LINKED')) await settleDepositMessage(guild, r.id, state.text);

        const p = product(r.product);
        await dm(guild.client, r.discord, {
            embeds: [new EmbedBuilder().setColor(delivered ? COLOR.ok : COLOR.pending)
                .setTitle(delivered ? '충전 상품이 지급되었습니다' : '입금이 확인되었습니다')
                .setDescription(delivered
                    ? `**${p ? p.name : r.product}** — 게임에서 \`/칭호\` · \`/우편함\` 으로 확인하세요.`
                    : '지급을 준비하고 있습니다. 잠시 뒤 자동으로 지급됩니다.')
                .setFooter({ text: `주문 ${r.code}` })],
        });
        if (delivered) await grantRoles(guild);
        return;
    }
    if (r.kind === 'DEPOSIT' && r.result === 'REVIEW') {
        await postReview(guild, r);
    }
}

async function postReview(guild, r) {
    const channel = await adminChannel(guild);
    if (!channel) {
        console.warn(`[충전] 관리자 채널이 없습니다 — 확인 대기 입금 #${r.id} 를 올리지 못했습니다.`);
        return;
    }
    const e = new EmbedBuilder().setColor(COLOR.review)
        .setTitle(`확인 필요 — 입금 #${r.id}`)
        .setDescription(`**${REASON_TEXT[r.reason] || r.reason}**\n자동으로 처리하지 않았습니다. 토스 앱에서 확인하고 골라 주세요.`)
        .addFields(
            { name: '입금액', value: won(r.amount), inline: true },
            { name: '입금자명', value: String(r.depositor || '-').replace(/_/g, ' '), inline: true },
        )
        .setTimestamp();
    let orderCode = null;
    if (r.order && r.order !== '-') {
        e.addFields({ name: '관련 주문', value: `${r.code} · ${won(r.price)} · ${r.name} · ${r.status}` });
        if (['PENDING', 'EXPIRED'].includes(r.status)) orderCode = r.code;
    }
    const msg = await channel.send({ embeds: [e], components: reviewButtons(r.id, orderCode) }).catch(() => null);
    if (msg) {
        data.depositMessages[r.id] = { channelId: channel.id, messageId: msg.id };
        save();
    }
}

async function settleDepositMessage(guild, depositId, text) {
    const ref = data.depositMessages[depositId];
    if (!ref) return;
    const channel = await guild.channels.fetch(ref.channelId).catch(() => null);
    const msg = channel ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
    if (msg) {
        const e = EmbedBuilder.from(msg.embeds[0]).setColor(COLOR.info).addFields({ name: '처리', value: text });
        await msg.edit({ embeds: [e], components: [] }).catch(() => {});
    }
    delete data.depositMessages[depositId];
    save();
}

// ── 주기 작업: 역할 · 재지급 · 만료 · 침묵 감시 ────────────────────────

/** 지급 완료됐는데 디스코드 역할을 아직 안 준 주문. 역할 부여는 여러 번 해도 같습니다. */
async function grantRoles(guild) {
    const r = parse(await rcon('rucpay roles'));
    for (const [orderId, discordId, productId] of items(r)) {
        const p = product(productId);
        const keys = p?.discordRoles || [];
        let ok = true;
        if (keys.length > 0) {
            const member = await guild.members.fetch(discordId).catch(() => null);
            if (!member) {
                ok = false; // 서버를 나갔습니다. 다시 들어오면 다음 주기에 줍니다.
            } else {
                for (const key of keys) {
                    const role = roles.byKey(key);
                    if (!role) { console.warn(`[충전] roles.json 에 없는 역할 키: ${key}`); continue; }
                    try {
                        await member.roles.add(role.id, `충전 주문 #${orderId}`);
                    } catch (e) {
                        ok = false;
                        console.warn(`[충전] 역할 부여 실패 #${orderId} ${key}:`, e.message);
                    }
                }
            }
        }
        if (ok) await rcon(`rucpay roles-done ${orderId}`);
    }
}

/** 기간제 권리가 끝났으면 그 역할을 뗍니다. */
async function clearExpiredRoles(guild) {
    const r = parse(await rcon('rucpay expired'));
    for (const [uuid, discordId, key] of items(r)) {
        const role = roles.byKey(key);
        if (role && discordId !== '-') {
            const member = await guild.members.fetch(discordId).catch(() => null);
            if (member && member.roles.cache.has(role.id)) {
                try {
                    await member.roles.remove(role.id, '충전 기간 만료');
                } catch (e) {
                    console.warn(`[충전] 만료 역할 제거 실패 ${key}:`, e.message);
                    continue;
                }
            }
        }
        await rcon(`rucpay expired-done ${uuid} ${token(key)}`);
        console.log(`[충전] 기간 만료 — ${discordId} ${key}`);
    }
}

/** 지급 실패 주문을 다시 시도합니다. 주문당 3회까지, 그 뒤는 사람이 버튼으로. */
async function retryFailed(guild) {
    const r = parse(await rcon('rucpay failed'));
    for (const [orderId] of items(r)) {
        const n = data.retries[orderId] || 0;
        if (n >= 3) continue;
        data.retries[orderId] = n + 1;
        save();
        const res = parse(await rcon(`rucpay redeliver ${orderId} auto-retry`));
        if (res?.kind === 'DELIVERED') {
            console.log(`[충전] 주문 #${orderId} 재지급 성공`);
            await grantRoles(guild);
        } else if (n + 1 >= 3) {
            const channel = await adminChannel(guild);
            await channel?.send({
                embeds: [new EmbedBuilder().setColor(COLOR.bad).setTitle(`지급 실패 — 주문 #${orderId}`)
                    .setDescription('자동 재시도 3회가 모두 실패했습니다. 서버 로그(`[충전]`)를 확인한 뒤 다시 시도해 주세요.')],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`pay_retry_${orderId}`).setLabel('다시 지급').setStyle(ButtonStyle.Danger))],
            }).catch(() => {});
        }
    }
}

/**
 * 알림 앱이 조용한지. 폰이 꺼지거나 토스 알림 문구가 바뀌면 "에러 없이" 매칭이
 * 0건이 됩니다. 최근에 주문이 있었는데 알림이 오래 없으면 관리자에게 알립니다.
 */
async function watchSilence(guild) {
    const hours = Number(process.env.PAY_SILENCE_HOURS || 6);
    if (!process.env.PAY_WEBHOOK_SECRET || hours <= 0) return; // A 를 안 쓰는 중
    const now = Date.now();
    const silentFor = now - (data.lastNotifyAt || 0);
    const recentOrder = now - (data.lastOrderAt || 0) < hours * 3600_000;
    if (silentFor < hours * 3600_000 || !recentOrder) return;
    if (data.silenceWarnedAt && now - data.silenceWarnedAt < hours * 3600_000) return;
    data.silenceWarnedAt = now;
    save();
    const channel = await adminChannel(guild);
    await channel?.send({
        embeds: [new EmbedBuilder().setColor(COLOR.review).setTitle('입금 알림이 들어오지 않습니다')
            .setDescription(`최근 주문이 있었는데 ${hours}시간 넘게 알림이 한 건도 없습니다. `
                + '알림 전달 폰이 켜져 있는지 확인해 주세요. 그동안 입금은 **[입금 확인]** 버튼으로 처리하면 됩니다.')],
    }).catch(() => {});
}

function start(guild) {
    loadProducts();
    const available = catalog.products.filter(p => p.available).map(p => p.id);
    console.log(`[충전] 판매 중 ${available.join(', ') || '없음'} · `
        + `${enabled() ? '운영' : '시험 모드(Manager 만)'} · 계좌 ${account() ? '✓' : '없음'}`
        + ` · 알림 웹훅 ${process.env.PAY_WEBHOOK_SECRET ? '켜짐' : '꺼짐(버튼 확인만)'}`);

    const tick = async () => {
        try {
            await grantRoles(guild);
            // 첫 RCON 이 실패했으면 서버가 꺼져 있습니다. 나머지는 같은 실패라 건너뜁니다.
            if (serverUp === false) return;
            await retryFailed(guild);
            await clearExpiredRoles(guild);
            await watchSilence(guild);
        } catch (e) {
            console.error('[충전] 주기 작업 실패:', e);
        }
    };
    tick();
    setInterval(tick, 5 * 60 * 1000).unref?.();

    startWebhook(guild);
}

// ── A: 입금 알림 웹훅 ────────────────────────────────────────────────

/**
 * 알림 원문에서 금액을 찾습니다. 입금자명은 따로 찾지 않고 원문을 통째로 넘깁니다 —
 * 마크 서버가 원문 안에서 주문 코드(R0000)를 찾습니다. 알림 문구의 어순이 바뀌어도
 * 코드와 금액만 있으면 매칭이 됩니다.
 */
function parseNotification(text) {
    const filter = new RegExp(process.env.PAY_NOTIFY_FILTER || '입금|보냈|받았', 'i');
    if (!filter.test(text)) return null;
    const custom = process.env.PAY_NOTIFY_REGEX;
    if (custom) {
        const m = text.match(new RegExp(custom));
        if (!m?.groups?.amount) return null;
        return { amount: Number(m.groups.amount.replace(/[^\d]/g, '')), depositor: m.groups.name || text };
    }
    const m = text.match(/([\d,]+)\s*원/);
    if (!m) return null;
    return { amount: Number(m[1].replace(/,/g, '')), depositor: text };
}

const hits = new Map(); // ip → [시각...]

function rateLimited(ip) {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
    list.push(now);
    hits.set(ip, list);
    return list.length > 30;
}

function verifySignature(secret, timestamp, body, signature) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return 'timestamp';
    // 초 단위 · 밀리초 단위 둘 다 받습니다 (자동화 앱마다 다릅니다).
    const ms = ts > 1e12 ? ts : ts * 1000;
    if (Math.abs(Date.now() - ms) > 5 * 60 * 1000) return 'stale';
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(String(signature || ''), 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'signature';
    return null;
}

function startWebhook(guild) {
    const secret = process.env.PAY_WEBHOOK_SECRET;
    if (!secret) return; // 시작 줄에 "알림 웹훅 꺼짐" 으로 이미 찍었습니다.
    const port = parseInt(process.env.PAY_WEBHOOK_PORT || '8790', 10);
    const host = process.env.PAY_WEBHOOK_HOST || '127.0.0.1';

    const server = http.createServer((req, res) => {
        const reply = (code, obj) => {
            res.writeHead(code, { 'content-type': 'application/json' });
            res.end(JSON.stringify(obj));
        };
        // 이 경로 하나만 엽니다.
        if (req.method !== 'POST' || req.url !== '/pay/notify') return reply(404, { error: 'not found' });
        const ip = req.socket.remoteAddress || '-';
        if (rateLimited(ip)) return reply(429, { error: 'rate' });

        let body = '';
        let tooBig = false;
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 8192) { tooBig = true; req.destroy(); }
        });
        req.on('end', async () => {
            if (tooBig) return;
            const bad = verifySignature(secret, req.headers['x-ruc-timestamp'], body, req.headers['x-ruc-signature']);
            if (bad) {
                console.warn(`[충전] 웹훅 거부 (${bad}) from ${ip}`);
                return reply(401, { error: bad });
            }
            let payload;
            try { payload = JSON.parse(body); } catch { return reply(400, { error: 'json' }); }
            const text = String(payload.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
            data.lastNotifyAt = Date.now();
            save();

            const parsed = parseNotification(text);
            if (!parsed || !parsed.amount) {
                console.log(`[충전] 입금이 아닌 알림 무시: ${text.slice(0, 60)}`);
                return reply(200, { result: 'ignored' });
            }
            // 소스가 ID 를 주지 않으면 원문 + 시각으로 만듭니다. 같은 알림을 다시 보내도 같은 값입니다.
            const externalId = token(payload.id
                || crypto.createHash('sha256').update(`${text}|${payload.postedAt || ''}`).digest('hex').slice(0, 40));
            const line = await rcon(['rucpay', 'deposit', 'notify', externalId, parsed.amount,
                parsed.depositor.replace(/\s+/g, ' ').slice(0, 64)].join(' '));
            const r = parse(line);
            if (!r || r.kind === 'ERROR') {
                // 마크 서버가 꺼져 있습니다. 503 이면 알림 앱이 다시 보냅니다 (외부 ID 로 멱등).
                return reply(503, { error: 'server' });
            }
            await announce(guild, r, '알림 자동 확인').catch(e => console.error('[충전] 알림 처리 실패:', e));
            reply(200, { result: r.kind === 'DEPOSIT' ? r.result : r.kind, id: r.id });
        });
    });
    server.on('error', e => console.error('[충전] 웹훅 서버 오류:', e.message));
    server.listen(port, host, () => console.log(`[충전] 입금 알림 웹훅 http://${host}:${port}/pay/notify`));
}

// ── 슬래시 명령 ───────────────────────────────────────────────────────

function buildChargeCommand() {
    loadProducts();
    const cmd = new SlashCommandBuilder().setName('충전').setDescription('러크 서버 후원 상품을 주문합니다. 토스 계좌 입금으로 결제합니다.');
    const choices = catalog.products.filter(p => p.available).slice(0, 25)
        .map(p => ({ name: `${p.name} — ${won(p.price)} / ${p.period}`.slice(0, 100), value: p.id }));
    cmd.addStringOption(o => {
        o.setName('상품').setDescription('살 상품').setRequired(true);
        if (choices.length > 0) o.addChoices(...choices);
        return o;
    });
    return cmd;
}

const chargeCommand = buildChargeCommand();

const cancelCommand = new SlashCommandBuilder()
    .setName('충전취소').setDescription('입금 전인 내 충전 주문을 취소합니다.')
    .addStringOption(o => o.setName('코드').setDescription('주문 코드 (예: R4821)').setRequired(true).setMaxLength(8));

const lookupCommand = new SlashCommandBuilder()
    .setName('결제조회').setDescription('(Manager) 주문 · 입금 · 지급 기록을 봅니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('대상').setDescription('주문 코드 · 닉네임 · 디스코드 ID').setRequired(true).setMaxLength(32));

const reviewCommand = new SlashCommandBuilder()
    .setName('결제대기').setDescription('(Manager) 자동으로 처리되지 않은 입금 목록을 다시 올립니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function handleCharge(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    loadProducts(); // 가격을 고쳤으면 재시작 없이 반영됩니다 (선택지 목록만 재시작 필요).

    if (!enabled() && !isAdmin(interaction.member)) {
        return interaction.editReply('충전은 아직 준비 중입니다. 열리면 공지로 알려 드릴게요.');
    }
    const acct = account();
    if (!acct) return interaction.editReply('⚠️ 입금 계좌가 설정되지 않았습니다. 운영진에게 알려 주세요.');

    const p = product(interaction.options.getString('상품'));
    if (!p || !p.available) return interaction.editReply('지금은 살 수 없는 상품입니다.');

    const line = await rcon(['rucpay', 'order', interaction.user.id, token(p.id), p.price,
        catalog.orderTtlMinutes || 60, String(p.grants || '-').replace(/\s+/g, '')].join(' '));
    const r = parse(line);
    if (!r) return interaction.editReply('⚠️ 마크 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');

    const fail = {
        NOT_VERIFIED: '마인크래프트 계정 인증이 먼저 필요합니다. 게임에서 코드를 받아 `/인증` 을 해 주세요.',
        LIMIT: '입금하지 않은 주문이 이미 있습니다. 먼저 입금하거나 `/충전취소` 로 취소해 주세요.',
        COOLDOWN: '조금 전에 주문하셨습니다. 1분 뒤에 다시 시도해 주세요.',
        BAD_GRANTS: '⚠️ 상품 설정에 문제가 있습니다. 운영진에게 알려 주세요.',
    };
    if (r.kind !== 'ORDER') return interaction.editReply(fail[r.kind] || '⚠️ 주문을 만들지 못했습니다.');

    data.lastOrderAt = Date.now();
    save();

    const guide = new EmbedBuilder().setColor(COLOR.pending)
        .setTitle(`주문 ${r.code} — ${p.name}`)
        .setDescription([
            `아래 계좌로 **${won(r.amount)}** 을 보내 주세요.`,
            `**입금자명(받는 분에게 표시)을 \`${r.code}\` 로** 바꿔야 자동으로 확인됩니다.`,
            '',
            `> ${acct.bank} **${acct.number}** (${acct.holder})`,
            '',
            `⏰ <t:${Math.floor(Number(r.expires) / 1000)}:R> 까지 입금해 주세요.`,
            `🎁 받는 계정: **${r.name}** — 입금이 확인되면 게임 안에서 바로 지급됩니다.`,
        ].join('\n'))
        .setFooter({ text: '취소: /충전취소 · 문제가 생기면 /ticket 에 주문 코드를 적어 주세요' });

    await interaction.editReply({ embeds: [guide] });
    await dm(interaction.client, interaction.user.id, { embeds: [guide] });

    // D: 관리자 채널에 확인 버튼
    const channel = await adminChannel(interaction.guild);
    if (channel) {
        const o = { ...r, order: r.id, product: p.id, price: r.amount, discord: interaction.user.id, created: Date.now() };
        const msg = await channel.send({ embeds: [orderEmbed(o, 'pending')], components: pendingButtons(r.code) }).catch(() => null);
        if (msg) {
            data.orderMessages[r.code] = { channelId: channel.id, messageId: msg.id };
            save();
        }
    } else {
        console.warn(`[충전] 관리자 채널이 없습니다 — 주문 ${r.code} 확인 버튼을 올리지 못했습니다.`);
    }
}

async function handleCancel(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const code = interaction.options.getString('코드').trim().toUpperCase();
    const r = parse(await rcon(`rucpay cancel ${token(code)} ${interaction.user.id} ${interaction.user.id}`));
    if (!r) return interaction.editReply('⚠️ 마크 서버에 연결하지 못했습니다.');
    if (r.kind === 'CANCELLED') {
        const status = parse(await rcon(`rucpay status ${token(code)}`));
        if (status?.kind === 'STATUS') {
            await settleOrderMessage(interaction.guild, code, status, { color: COLOR.info, text: '유저가 취소했습니다.' });
        }
        return interaction.editReply(`주문 ${code} 을 취소했습니다.`);
    }
    if (r.kind === 'NOT_PENDING') return interaction.editReply('이미 입금이 확인됐거나 만료된 주문입니다.');
    return interaction.editReply('내 주문 중에 그 코드가 없습니다.');
}

async function handleLookup(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!isAdmin(interaction.member)) return interaction.editReply('❌ Manager 이상만 볼 수 있습니다.');
    const q = interaction.options.getString('대상').trim();

    if (/^R\d{4}$/i.test(q)) {
        const r = parse(await rcon(`rucpay status ${token(q.toUpperCase())}`));
        if (!r) return interaction.editReply('⚠️ 마크 서버에 연결하지 못했습니다.');
        if (r.kind !== 'STATUS') return interaction.editReply('그 코드의 주문이 없습니다.');
        return interaction.editReply({ embeds: [orderEmbed(r, { color: COLOR.info, text: `상태: **${r.status}**\n지급 명세: \`${r.grants}\`` })] });
    }
    const r = parse(await rcon(`rucpay lookup ${token(q)}`));
    if (!r) return interaction.editReply('⚠️ 마크 서버에 연결하지 못했습니다.');
    const rows = items(r);
    if (rows.length === 0) return interaction.editReply('주문 기록이 없습니다.');
    const lines = rows.map(([id, code, status, pid, amount, created]) =>
        `\`#${id}\` **${code}** ${status} · ${product(pid)?.name || pid} · ${won(amount)} · <t:${Math.floor(created / 1000)}:d>`);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLOR.info).setTitle(`주문 기록 — ${q}`).setDescription(lines.join('\n'))] });
}

async function handleReview(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!isAdmin(interaction.member)) return interaction.editReply('❌ Manager 이상만 볼 수 있습니다.');
    const r = parse(await rcon('rucpay review'));
    if (!r) return interaction.editReply('⚠️ 마크 서버에 연결하지 못했습니다.');
    const rows = items(r);
    if (rows.length === 0) return interaction.editReply('✅ 확인을 기다리는 입금이 없습니다.');
    for (const [id, amount, depositor, reason] of rows) {
        await postReview(interaction.guild, { id, amount, depositor, reason, order: '-' });
    }
    return interaction.editReply(`확인 대기 ${rows.length}건을 관리자 채널에 다시 올렸습니다.`);
}

// ── 버튼 · 모달 ───────────────────────────────────────────────────────

/** @returns {Promise<boolean>} 이 모듈의 상호작용이었는가 */
async function handleButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('pay_')) return false;

    if (!isAdmin(interaction.member)) {
        await interaction.reply({ content: '❌ Manager 이상만 누를 수 있습니다.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const admin = token(interaction.user.username);

    if (id.startsWith('pay_ok_')) {
        const code = id.slice('pay_ok_'.length);
        await interaction.deferUpdate();
        const r = parse(await rcon(`rucpay approve ${token(code)} ${admin}`));
        if (!r) return replyLater(interaction, '⚠️ 마크 서버에 연결하지 못했습니다. 다시 눌러 주세요.');
        if (r.kind === 'DEPOSIT' || r.kind === 'DUP') {
            if (r.kind === 'DUP') return replyLater(interaction, '이미 확인된 주문입니다.');
            await announce(interaction.guild, r, `${interaction.user.username} 확인`);
            return true;
        }
        if (r.kind === 'NOT_PENDING') {
            const status = parse(await rcon(`rucpay status ${token(code)}`));
            if (status?.kind === 'STATUS') {
                await settleOrderMessage(interaction.guild, code, status,
                    { color: COLOR.info, text: `이미 처리된 주문입니다 (${status.status}).` });
            }
            return true;
        }
        return replyLater(interaction, `처리하지 못했습니다: ${r.raw}`);
    }

    if (id.startsWith('pay_cancel_')) {
        const code = id.slice('pay_cancel_'.length);
        await interaction.deferUpdate();
        const r = parse(await rcon(`rucpay cancel ${token(code)} ${admin}`));
        if (r?.kind === 'CANCELLED' || r?.kind === 'NOT_PENDING') {
            const status = parse(await rcon(`rucpay status ${token(code)}`));
            if (status?.kind === 'STATUS') {
                await settleOrderMessage(interaction.guild, code, status, {
                    color: COLOR.info,
                    text: r.kind === 'CANCELLED' ? `${interaction.user.username} 이(가) 취소했습니다.` : `이미 처리됨 (${status.status})`,
                });
            }
            return true;
        }
        return replyLater(interaction, '⚠️ 취소하지 못했습니다.');
    }

    if (id.startsWith('pay_linkto_')) {
        const [depositId, code] = id.slice('pay_linkto_'.length).split('_');
        await interaction.deferUpdate();
        return linkDeposit(interaction, depositId, code, admin);
    }

    if (id.startsWith('pay_link_')) {
        const depositId = id.slice('pay_link_'.length);
        const modal = new ModalBuilder().setCustomId(`pay_linkmodal_${depositId}`).setTitle(`입금 #${depositId} 연결`);
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('code').setLabel('주문 코드 (예: R4821)')
                .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8)));
        await interaction.showModal(modal);
        return true;
    }

    if (id.startsWith('pay_refund_') || id.startsWith('pay_ignore_')) {
        const refund = id.startsWith('pay_refund_');
        const depositId = id.slice(refund ? 'pay_refund_'.length : 'pay_ignore_'.length);
        await interaction.deferUpdate();
        const r = parse(await rcon(`rucpay ${refund ? 'refund' : 'ignore'} ${token(depositId)} ${admin}`));
        if (!r) return replyLater(interaction, '⚠️ 마크 서버에 연결하지 못했습니다.');
        if (r.kind === 'REFUNDED' || r.kind === 'IGNORED') {
            const text = refund
                ? `💸 ${interaction.user.username} — 환불 처리됨${r.revoked > 0 ? ` · 지급 ${r.revoked}건 회수` : ''}${r.manual === '1' ? ' · ⚠️ 우편 아이템은 수동 회수' : ''}\n**토스로 돈을 돌려보냈는지 다시 확인하세요.**`
                : `🙈 ${interaction.user.username} — 무시함`;
            await settleDepositMessage(interaction.guild, depositId, text);
            return true;
        }
        return replyLater(interaction, `처리하지 못했습니다: ${r.raw}`);
    }

    if (id.startsWith('pay_retry_')) {
        const orderId = id.slice('pay_retry_'.length);
        await interaction.deferUpdate();
        const r = parse(await rcon(`rucpay redeliver ${token(orderId)} ${admin}`));
        if (r?.kind === 'DELIVERED') {
            delete data.retries[orderId];
            save();
            await grantRoles(interaction.guild);
            await interaction.editReply({ components: [], content: `✅ ${interaction.user.username} — 재지급 성공` }).catch(() => {});
            return true;
        }
        return replyLater(interaction, `재지급 실패: ${r ? r.raw : '서버 연결 실패'}`);
    }
    return true;
}

async function handleModal(interaction) {
    if (!interaction.customId.startsWith('pay_linkmodal_')) return false;
    if (!isAdmin(interaction.member)) {
        await interaction.reply({ content: '❌ Manager 이상만 할 수 있습니다.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const depositId = interaction.customId.slice('pay_linkmodal_'.length);
    const code = interaction.fields.getTextInputValue('code').trim().toUpperCase();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await linkDeposit(interaction, depositId, code, token(interaction.user.username));
    return true;
}

async function linkDeposit(interaction, depositId, code, admin) {
    const r = parse(await rcon(`rucpay link ${token(depositId)} ${token(code)} ${admin}`));
    if (!r) return replyLater(interaction, '⚠️ 마크 서버에 연결하지 못했습니다.');
    if (r.kind === 'DEPOSIT' && r.result === 'MATCHED') {
        await announce(interaction.guild, r, `${interaction.user.username} 연결`);
        if (interaction.deferred && !interaction.isButton()) await interaction.editReply(`✅ ${code} 에 연결하고 지급했습니다.`);
        return true;
    }
    const why = { NOT_FOUND: '입금이나 주문을 찾지 못했습니다.', NOT_PENDING: `그 주문은 이미 처리됐습니다 (${r.status}).`, NOT_REVIEW: `이미 처리된 입금입니다 (${r.status}).` };
    return replyLater(interaction, why[r.kind] || `처리하지 못했습니다: ${r.raw}`);
}

async function replyLater(interaction, content) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
}

module.exports = {
    chargeCommand, cancelCommand, lookupCommand, reviewCommand,
    handleCharge, handleCancel, handleLookup, handleReview, handleButton, handleModal, start,
    _internals: { parse, items, parseNotification, verifySignature, token, loadProducts,
        grantRoles, clearExpiredRoles, retryFailed },
};
