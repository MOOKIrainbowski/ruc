// 프로필 카드 렌더러 — 경제 미니게임(/프로필)에서 떼어 낸 것 (Phase 6-8, D6)
//
// 미니게임은 지웠지만 카드 그리는 부분은 남겼습니다. 나중에 "인게임 Ruc 잔고 +
// 평판 + XP 레벨" 프로필 카드로 다시 쓸 계획입니다 (D6 권장). 지금은 어떤
// 명령도 이것을 부르지 않습니다.
//
// 값은 호출부가 문자열 줄로 넘깁니다. 무엇을 보여 줄지는 이 파일이 모릅니다 —
// 데이터 출처(마크 서버 RCON)가 정해지면 호출부만 새로 쓰면 됩니다.

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');

/**
 * @param {object} opts
 * @param {string} opts.title       카드 제목 (보통 닉네임)
 * @param {string[]} opts.lines     제목 아래 줄들 (최대 3줄이 보기 좋습니다)
 * @param {string} [opts.avatarUrl] 원형으로 잘라 왼쪽에 그립니다. 실패해도 카드는 나옵니다
 * @param {string} [opts.accent]    테두리 색
 * @returns {Promise<AttachmentBuilder>} profile.png
 */
async function renderProfileCard({ title, lines = [], avatarUrl, accent = '#0099ff' }) {
    const canvas = createCanvas(700, 250);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#23272A'; ctx.fillRect(0, 0, 700, 250);
    ctx.strokeStyle = accent; ctx.lineWidth = 10; ctx.strokeRect(0, 0, 700, 250);
    ctx.font = 'bold 36px sans-serif'; ctx.fillStyle = '#ffffff';
    ctx.fillText(title, 260, 60);
    ctx.font = '28px sans-serif'; ctx.fillStyle = '#dddddd';
    lines.slice(0, 4).forEach((line, i) => ctx.fillText(line, 260, 110 + i * 40));

    if (avatarUrl) {
        try {
            const avatar = await loadImage(avatarUrl);
            ctx.save();
            ctx.beginPath(); ctx.arc(125, 125, 80, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
            ctx.drawImage(avatar, 45, 45, 160, 160);
            ctx.restore();
        } catch { /* 아바타를 못 받아도 카드는 그립니다 */ }
    }

    return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile.png' });
}

module.exports = { renderProfileCard };
