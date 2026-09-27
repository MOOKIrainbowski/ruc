// 디스코드 웹훅 흉내. RucCore 의 중계가 실제로 무엇을 보내는지 눈으로 보려고
// 띄우는 것입니다. 받은 본문을 그대로 찍고 204 를 돌려줍니다.
//
// 사용: node fakehook.js [포트]
const http = require('http');

const port = Number(process.argv[2] || 8787);
let count = 0;

http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        count++;
        console.log(`\n───── #${count} ${req.method} ${req.url} ─────`);
        console.log('Content-Type:', req.headers['content-type']);
        console.log('User-Agent:', req.headers['user-agent']);
        try {
            const parsed = JSON.parse(body);
            console.log(JSON.stringify(parsed, null, 2));
            // 검증 포인트를 바로 눈에 보이게 요약합니다.
            console.log('→ username:', JSON.stringify(parsed.username));
            console.log('→ allowed_mentions:', JSON.stringify(parsed.allowed_mentions));
            console.log('→ 모양:', parsed.embeds ? '임베드(시스템)' : '발언(웹훅)');
        } catch (e) {
            console.log('⚠️ JSON 파싱 실패:', e.message);
            console.log(body);
        }
        res.writeHead(204).end();
    });
}).listen(port, '127.0.0.1', () => {
    console.log(`가짜 웹훅이 http://127.0.0.1:${port}/webhook 에서 듣습니다.`);
});
