// 가짜 입금 알림 — payment.js 의 웹훅(A)을 실제 폰 없이 시험합니다.
//
//   node tools/mock-deposit.js "<알림 원문>" [--id <외부ID>] [--bad-sig] [--stale] [--url <주소>]
//
// 예)
//   node tools/mock-deposit.js "토스뱅크 입금 3,000원 R4821"          정상 → 자동 매칭
//   node tools/mock-deposit.js "토스뱅크 입금 2,000원 R4821"          금액 불일치 → 확인 대기
//   node tools/mock-deposit.js "토스뱅크 입금 3,000원 홍길동"         코드 없음 → 확인 대기
//   node tools/mock-deposit.js "토스뱅크 입금 3,000원 R4821" --id a1  두 번 보내면 두 번째는 DUP
//   node tools/mock-deposit.js "..." --bad-sig                       401 signature
//   node tools/mock-deposit.js "..." --stale                         401 stale (10분 전 타임스탬프)
//
// .env 의 PAY_WEBHOOK_SECRET · PAY_WEBHOOK_HOST · PAY_WEBHOOK_PORT 를 그대로 씁니다.

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const text = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--id'
    && args[args.indexOf(a) - 1] !== '--url');
const flag = name => args.includes(name);
const opt = name => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};

if (!text) {
    console.error('사용법: node tools/mock-deposit.js "<알림 원문>" [--id X] [--bad-sig] [--stale]');
    process.exit(1);
}
const secret = process.env.PAY_WEBHOOK_SECRET;
if (!secret) {
    console.error('PAY_WEBHOOK_SECRET 이 .env 에 없습니다.');
    process.exit(1);
}

const url = opt('--url') || `http://${process.env.PAY_WEBHOOK_HOST || '127.0.0.1'}:${process.env.PAY_WEBHOOK_PORT || '8790'}/pay/notify`;
const body = JSON.stringify({ id: opt('--id'), text, postedAt: Date.now() });
const ts = String(Math.floor(Date.now() / 1000) - (flag('--stale') ? 600 : 0));
let sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
if (flag('--bad-sig')) sig = sig.replace(/^./, c => (c === '0' ? '1' : '0'));

fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ruc-timestamp': ts, 'x-ruc-signature': sig },
    body,
}).then(async res => {
    console.log(res.status, await res.text());
}).catch(e => {
    console.error('보내지 못했습니다:', e.message);
    process.exit(1);
});
