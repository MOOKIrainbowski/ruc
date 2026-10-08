// greet.js 점검 — 디스코드 없이 가짜 서버로 환영 · 후원 메시지를 만들어 봅니다.
// node tools/check-greet.js  (announce_channels.json 은 건드리지 않습니다)

const assert = require('assert');
const greet = require('../greet');
const v = require('../verification');

const sent = [];
const guild = {
    id: 'g', premiumTier: 2, premiumSubscriptionCount: 9,
    channels: { fetch: async () => ({ send: async m => sent.push(m) }) },
    client: { users: { fetch: async () => ({ displayAvatarURL: () => 'https://x/a.png' }) } },
};
const reply = async () => {};
const cmd = (name) => ({
    commandName: name, guildId: 'g', reply,
    memberPermissions: { has: () => true },
    options: { getChannel: () => ({ id: 'c' + name, toString: () => '#c' }) },
});

(async () => {
    const fs = require('fs');
    const file = require('path').join(__dirname, '..', 'announce_channels.json');
    const backup = fs.existsSync(file) ? fs.readFileSync(file) : null;
    try {
        // 채널 없으면 조용히 건너뜀
        await greet.thank({ ...guild, id: 'none' }, 'u1', 'cash', 5000);
        assert.strictEqual(sent.length, 0);

        assert.strictEqual(await greet.handleCommand(cmd('welcome')), true);
        assert.strictEqual(await greet.handleCommand(cmd('donation')), true);
        assert.strictEqual(await greet.handleCommand(cmd('help')), false);

        await greet.welcome({ id: 'u1', guild, user: { bot: false } });
        await greet.welcome({ id: 'b1', guild, user: { bot: true } });
        assert.strictEqual(sent.length, 1);
        assert.match(sent[0].content, /^<@u1>님, ./);

        const titleOf = async (kind, amt) => {
            await greet.thank(guild, 'u1', kind, amt);
            const m = sent.at(-1);
            return [m.content, m.embeds[0].toJSON().title];
        };
        assert.deepStrictEqual(await titleOf('cash', 2000), ['<@u1>님, 현금 후원 감사합니다.', '🥉 브론즈 후원']);
        assert.strictEqual((await titleOf('cash', 10000))[1], '🥈 실버 후원');
        assert.strictEqual((await titleOf('cash', 39000))[1], '🥇 골드 후원');
        assert.strictEqual((await titleOf('cash', 59000))[1], '💎 다이아몬드 후원');
        assert.deepStrictEqual(await titleOf('boost'), ['<@u1>님, 부스트 후원 감사합니다.', '🚀 부스트 후원 · 레벨 2']);

        // 패널: 선택 메뉴 값이 버튼 처리 ID 와 맞는지
        const vp = v.buildVerifyPanel().components[0].toJSON().components[0];
        assert.deepStrictEqual(vp.options.map(o => o.value), ['verify_open', 'ticket_type_inquiry']);
        console.log('OK');
    } finally {
        if (backup) fs.writeFileSync(file, backup); else fs.rmSync(file, { force: true });
    }
})().catch(e => { console.error(e); process.exit(1); });
