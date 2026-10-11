// 사용: node perm.js <MOOKI 폴더> <백업 json> [apply]
const fs = require('fs'), path = require('path');
const env = fs.readFileSync(path.join(process.argv[2], '.env'), 'utf8');
const token = env.match(/^DISCORD_TOKEN\s*=\s*"?([A-Za-z0-9._-]+)/m)[1];
const APPLY = process.argv[4] === 'apply';
const G = '1406632846986051605', RUC = '1554020292739727411';
const SKIP_CATS = ['1412746579701534730', '1556300082985435196', '1556299919390941316']; // 관계자 전용 · 승인 · 로그
const CAT = { chat: '1406770297419600064', help: '1413445615341408356', forum: '1406886744221155388', voice: '1406632847917191169' };
const CH = { verify: '1406645717111673016', general: '1522967997365489827', bot: '1522968032039665694', feed: '1557937323713495101' };
const b = (...n) => n.reduce((a, x) => a | (1n << BigInt(x)), 0n);
const VIEW = b(10), SEND = b(11), HIST = b(16), APPCMD = b(31), CONNECT = b(20);
// 일반 멤버 권한 — Ruc 역할에 주고, 숨김 채널의 @everyone 거부 목록에서는 뺍니다 (보기가 막혀 있어 의미 없음)
const MEMBER = b(11, 16, 6, 14, 15, 18, 37, 31, 20, 21, 25, 9, 38, 46, 39);
const MEMBER_CLEAR = MEMBER & ~SEND;
const reason = encodeURIComponent('Permission audit 2026-10-11');
const call = async (m, p, body) => {
  const r = await fetch('https://discord.com/api/v10' + p, { method: m, headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': reason }, body: body && JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json(); if (r.status >= 300) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + JSON.stringify(j)); return j;
};
(async () => {
  const roles = await call('GET', `/guilds/${G}/roles`);
  const chans = await call('GET', `/guilds/${G}/channels`);
  fs.writeFileSync(process.argv[3], JSON.stringify({ roles, chans }, null, 1));
  const rn = id => (roles.find(r => r.id === id) || {}).name || id;

  // ── 역할
  // @everyone 은 그대로 둡니다 (2026-10-11 소유자: 인증 패널이 있어 /인증 명령은 필요 없음)
  for (const [id, add] of [[RUC, MEMBER]]) {
    const r = roles.find(x => x.id === id), next = BigInt(r.permissions) | add;
    if (next !== BigInt(r.permissions)) { console.log(`ROLE ${r.name}: ${r.permissions} -> ${next}`); if (APPLY) await call('PATCH', `/guilds/${G}/roles/${id}`, { permissions: next.toString() }); }
  }

  // ── 채널
  const byId = Object.fromEntries(chans.map(c => [c.id, c]));
  const plan = new Map();
  const ows = c => plan.get(c.id) || c.permission_overwrites.map(o => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }));
  const get = (list, id, type) => { let o = list.find(x => x.id === id); if (!o) { o = { id, type, allow: 0n, deny: 0n }; list.push(o); } return o; };
  const edit = (c, fn) => { const l = ows(c); fn(l); plan.set(c.id, l); };
  const inScope = c => !SKIP_CATS.includes(c.id) && !SKIP_CATS.includes(c.parent_id);

  for (const c of chans.filter(inScope)) {
    edit(c, l => {
      const ev = get(l, G, 0);
      // 1) @everyone 이 못 보는 채널: 멤버 권한 거부를 걷어냄 → Ruc 역할 권한이 살아남
      if (ev.deny & VIEW) ev.deny &= ~MEMBER_CLEAR;
      // 2) 포럼 · 일반채팅: 글쓰기 허용 (거부 해제)
      if (c.parent_id === CAT.forum || c.id === CAT.forum || c.id === CH.general) {
        ev.deny &= ~SEND; for (const o of l) o.deny &= ~SEND;
      }
      // 2-1) 일반채팅은 누구나 보는 채널이라 1) 이 안 걸립니다. 기록 보기 거부를 풀고, 인증 멤버에게 멤버 권한을 줍니다
      if (c.id === CH.general) { ev.deny &= ~HIST; get(l, RUC, 0).allow |= MEMBER; }
      // 3) 포럼 · 음성 · 봇 채널: 인증 멤버에게 보이게
      if ([CAT.forum, CAT.voice].includes(c.id) || [CAT.forum, CAT.voice].includes(c.parent_id) || c.id === CH.bot) {
        get(l, RUC, 0).allow |= VIEW | (c.type === 2 || c.type === 13 || c.id === CAT.voice ? CONNECT : 0n);
      }
      // 4) 음성 채널: 미인증에게 숨김
      if (c.parent_id === CAT.voice) ev.deny |= VIEW;
      // 5) 피드: 읽기 전용
      if (c.id === CH.feed) ev.deny |= SEND;
      // 6) 인증: 미인증이 /인증 을 쓸 수 있게
      // (인증 채널은 손대지 않음 — 인증 패널 버튼으로 인증)
      // 빈 덮어쓰기 정리 (@everyone 은 유지)
      for (let i = l.length - 1; i >= 0; i--) if (l[i].allow === 0n && l[i].deny === 0n) l.splice(i, 1);
    });
  }

  for (const [id, l] of plan) {
    const c = byId[id];
    const before = JSON.stringify(c.permission_overwrites.map(o => [o.id, o.allow, o.deny]).sort());
    const after = l.map(o => [o.id, o.allow.toString(), o.deny.toString()]).sort();
    if (before === JSON.stringify(after)) continue;
    console.log(`\n${c.type === 4 ? 'CAT' : '#'}${c.name}`);
    const old = Object.fromEntries(c.permission_overwrites.map(o => [o.id, o]));
    for (const o of l) { const p = old[o.id]; if (!p || p.allow !== o.allow.toString() || p.deny !== o.deny.toString()) console.log(`   ${rn(o.id)}: allow ${p ? p.allow : '-'} -> ${o.allow}  deny ${p ? p.deny : '-'} -> ${o.deny}`); }
    if (APPLY) await call('PATCH', `/channels/${id}`, { permission_overwrites: l.map(o => ({ id: o.id, type: o.type, allow: o.allow.toString(), deny: o.deny.toString() })) });
  }
  console.log(APPLY ? '\nAPPLIED' : '\nDRY RUN');
})().catch(e => { console.error(e.message); process.exit(1); });
