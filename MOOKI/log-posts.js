const fs = require('fs');
const path = require('path');
const { ThreadAutoArchiveDuration } = require('discord.js');

/**
 * 로그 = 포럼 채널 하나 안의 포스트들 (2026-10-18, 로그 카테고리 채널 정리).
 * 포럼 · 포스트 ID 는 config/log-posts.json 에만 있습니다.
 *
 * 포스트 찾는 순서: 저장된 ID → 포럼에서 같은 제목 → 없을 때만 새로 만들고 ID 를 저장.
 * 그래서 재시작해도, 파일이 날아가도 같은 제목 포스트가 또 생기지 않습니다.
 * 보낼 때마다 새로 받아 보관(archive) · 잠금을 풀고 돌려줍니다.
 */

const FILE = path.join(__dirname, 'config', 'log-posts.json');

const load = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const pending = new Map();

/** 저장된 포스트 ID (없으면 ''). 동기 — 채널 비교용. */
function postId(key) {
    try { return load().posts[key]?.id || ''; } catch { return ''; }
}

async function findOrCreate(guild, key) {
    const cfg = load();
    const post = cfg.posts[key];
    if (!post) throw new Error(`log-posts.json 에 ${key} 가 없습니다`);

    let thread = post.id ? await guild.channels.fetch(post.id, { force: true }).catch(() => null) : null;
    if (!thread || thread.parentId !== cfg.forum) {
        const forum = await guild.channels.fetch(cfg.forum);
        const active = await forum.threads.fetchActive();
        const archived = await forum.threads.fetchArchived({ limit: 100 });
        thread = active.threads.find(t => t.parentId === forum.id && t.name === post.name)
            || archived.threads.find(t => t.name === post.name);
        if (!thread) {
            thread = await forum.threads.create({
                name: post.name,
                autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
                message: { content: post.about || post.name },
            });
            console.log(`[로그포스트] ${key} 포스트를 만들었습니다 — ${thread.id}`);
        }
        cfg.posts[key].id = thread.id;
        fs.writeFileSync(FILE, JSON.stringify(cfg, null, 4) + '\n', 'utf8');
    }
    if (thread.archived || thread.locked) await thread.edit({ archived: false, locked: false });
    return thread;
}

/**
 * 보낼 준비가 된 포스트(ThreadChannel). 실패하면 null — 로그 때문에 본 처리를 막지 않습니다.
 * ponytail: 매번 REST 로 새로 받음 (로그가 드물어서). 로그가 잦아지면 캐시 + 실패 시 재시도로.
 */
async function logPost(guild, key) {
    if (!guild) return null;
    // 같은 키를 동시에 찾으면 포스트가 두 개 생길 수 있어 한 번만 돕니다.
    if (!pending.has(key)) pending.set(key, findOrCreate(guild, key).finally(() => pending.delete(key)));
    return pending.get(key).catch(err => {
        console.error(`[로그포스트] ${key} 를 열지 못했습니다:`, err.message);
        return null;
    });
}

/** 시작할 때 모든 포스트를 확인합니다 (없는 것만 생성). 웹 · 다른 봇이 쓰는 포스트도 여기서 만듭니다. */
async function ensureAll(guild) {
    const keys = Object.keys(load().posts);
    for (const key of keys) await logPost(guild, key);
    console.log(`✅ 로그 포스트 — ${keys.map(k => `${k}:${postId(k)}`).join(' · ')}`);
}

module.exports = { logPost, postId, ensureAll };
