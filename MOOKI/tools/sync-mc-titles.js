#!/usr/bin/env node
// config/roles.json → RucCore config.yml 의 titles.definitions.<칭호>.discord-role
//
// ── 왜 이 도구가 있는가 ───────────────────────────────────────────────
// 역할 ID 는 config/roles.json 한 곳에만 있어야 합니다. 그런데 마인크래프트
// 플러그인(RucCore)도 "어떤 디스코드 역할이 어떤 칭호인가" 를 알아야 하고,
// 그건 자기 config.yml 에서 읽습니다. 서버가 4개라 손으로 넣으면 네 번 쓰게
// 되고, 한 곳만 빠뜨리면 그 서버에서만 칭호가 다르게 나옵니다.
//
// 그래서 **roles.json 이 원본이고 config.yml 은 생성물**로 둡니다.
// 새 등급을 추가할 때: roles.json 에 항목 하나 추가 → 이 스크립트 실행.
//
// 사용:
//   node tools/sync-mc-titles.js           확인만 (아무것도 쓰지 않음)
//   node tools/sync-mc-titles.js --write   실제로 씁니다

const fs = require('fs');
const path = require('path');
const roles = require('../roles');

const WRITE = process.argv.includes('--write');

// 러크서버 저장소 기준 상대 경로.
const REPO = path.resolve(__dirname, '..', '..');
const TARGETS = [
    path.join(REPO, 'minecraft', 'plugins', 'RucCore', 'src', 'main', 'resources', 'config.yml'),
    ...['home', 'raid', 'war', 'peace'].map(s =>
        path.join(REPO, 'minecraft', 'servers', s, 'plugins', 'RucCore', 'config.yml')),
];

/**
 * titles.definitions.<key>.discord-role 한 줄을 바꿉니다.
 *
 * YAML 파서를 쓰지 않는 이유: 파싱 후 다시 쓰면 주석이 전부 사라집니다.
 * 그 파일의 주석은 "왜 이렇게 했는가" 가 적힌 문서이기도 해서, 값 한 줄만
 * 정확히 갈아 끼우는 쪽이 맞습니다.
 */
function setRole(yaml, titleKey, roleId) {
    // "    <키>:" 로 시작하는 블록 안의 discord-role 줄을 찾습니다.
    const block = new RegExp(
        `(^[ \\t]{4}${titleKey}:[ \\t]*\\r?\\n(?:[ \\t]{6}.*\\r?\\n)*?[ \\t]{6}discord-role:[ \\t]*)"[^"]*"`,
        'm');

    if (!block.test(yaml)) return { yaml, changed: false, found: false };

    const next = yaml.replace(block, `$1"${roleId}"`);
    return { yaml: next, changed: next !== yaml, found: true };
}

function main() {
    roles.load();
    const mapping = roles.titleMapping();

    console.log(`역할 → 칭호 매핑 ${Object.keys(mapping).length}개`);
    for (const [titleKey, roleId] of Object.entries(mapping)) {
        console.log(`  ${titleKey.padEnd(10)} ← ${roleId}`);
    }
    console.log();

    let totalChanged = 0;
    const missingKeys = new Set();

    for (const file of TARGETS) {
        if (!fs.existsSync(file)) {
            console.log(`⚠️ 없음: ${path.relative(REPO, file)}`);
            continue;
        }

        let yaml = fs.readFileSync(file, 'utf8');
        let changed = 0;

        for (const [titleKey, roleId] of Object.entries(mapping)) {
            const result = setRole(yaml, titleKey, roleId);
            if (!result.found) {
                missingKeys.add(titleKey);
                continue;
            }
            if (result.changed) changed++;
            yaml = result.yaml;
        }

        if (changed > 0 && WRITE) {
            fs.writeFileSync(file, yaml, 'utf8');
        }
        totalChanged += changed;
        console.log(`${changed > 0 ? '✏️ ' : '   '} ${path.relative(REPO, file)} — ${changed}개 ${WRITE ? '반영' : '변경 예정'}`);
    }

    if (missingKeys.size > 0) {
        console.log();
        console.log(`⚠️ RucCore config.yml 에 정의가 없는 칭호 키: ${[...missingKeys].join(', ')}`);
        console.log('   titles.definitions 에 그 키를 먼저 추가해야 합니다.');
    }

    console.log();
    if (!WRITE) {
        console.log(`확인만 했습니다. 실제로 쓰려면: node tools/sync-mc-titles.js --write`);
    } else {
        console.log(`완료 — ${totalChanged}곳 반영. 마크 서버를 재시작하면 적용됩니다.`);
    }
}

main();
