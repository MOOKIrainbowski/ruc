// purchase-log.js 점검 — 디스코드 없이 가짜 채널로 기록 · 중복 방지 · 조회(닉네임 변경 · 분류 · 페이지)를 봅니다.
// node tools/check-purchase-log.js  (실제 purchase_log.jsonl 은 건드리지 않습니다)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.PURCHASE_LOG_FILE = path.join(os.tmpdir(), `plog-check-${process.pid}.jsonl`);
const log = require('../purchase-log');

const sent = [];
// 구매로그 포스트 = config/log-posts.json 의 포럼 안 스레드
const forum = require('../config/log-posts.json').forum;
const guild = { channels: { fetch: async () => ({ parentId: forum, send: async m => sent.push(m) }) } };
const base = { uuid: 'u-1', discord: 'd1', unit: 'won', delivered: true };

(async () => {
    try {
        await log.record(guild, { ...base, order: 1, code: 'R1000', name: 'Steve', category: 'member', productName: 'MVP', amount: 15000 });
        await log.record(guild, { ...base, order: 1, code: 'R1000', name: 'Steve', category: 'member', productName: 'MVP', amount: 15000 });
        assert.strictEqual(sent.length, 1, '같은 주문 코드는 한 번만');
        assert.match(sent[0].embeds[0].data.title, /멤버 등급/);

        // 닉네임을 바꾼 뒤의 구매도 같은 UUID 로 묶임
        await log.record(guild, { ...base, order: 2, code: 'R1001', name: 'Alex', category: 'ruc', productName: 'RUC 500', amount: 5000 });
        await log.record(guild, { ...base, order: 3, code: 'U1002', name: 'Alex', category: 'convenience', productName: '엔더상자 확장', amount: 200, unit: 'RUC' });
        await log.record(guild, { ...base, uuid: 'u-2', order: 4, code: 'R1003', name: 'Other', category: 'ruc', productName: 'RUC 500', amount: 5000 });

        assert.strictEqual(log._internals.find('steve').length, 3);
        assert.strictEqual(log._internals.find('Alex', 'ruc').length, 1);
        assert.strictEqual(log._internals.find('nobody').length, 0);
        const t = log._internals.totals(log._internals.find('Alex'));
        assert.match(t, /멤버 등급\*\* 1건 · 15,000원/);
        assert.match(t, /편의 기능\*\* 1건 · 200 RUC/);

        // 11건이면 2페이지, 버튼이 붙음
        for (let i = 0; i < 9; i++) {
            await log.record(guild, { ...base, order: 10 + i, code: `R2${i}00`, name: 'Alex', category: 'ruc', productName: 'RUC 500', amount: 5000 });
        }
        const p0 = log._internals.page('Alex', null, 0);
        assert.strictEqual(p0.components.length, 1);
        assert.match(p0.embeds[0].data.footer.text, /12건 · 1\/2/);
        assert.match(log._internals.page('Alex', null, 5).embeds[0].data.footer.text, /2\/2/);
        console.log('purchase-log OK');
    } finally {
        fs.rmSync(process.env.PURCHASE_LOG_FILE, { force: true });
    }
})().catch(e => { console.error(e); process.exit(1); });
