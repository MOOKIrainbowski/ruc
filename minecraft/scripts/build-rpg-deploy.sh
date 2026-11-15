#!/usr/bin/env bash
# 운영 배포용 RucRpg jar: Codex 가 작업 중인(커밋 안 된) 리소스가 jar 에 섞이지 않게,
# 리소스 폴더의 커밋 안 된 변경을 잠시 커밋본으로 바꿔 빌드한 뒤 작업본을 되돌려 놓음. (2026-11-15 hud-glyphs.json 섞임 사고)
set -euo pipefail
cd "$(dirname "$0")/../.."
RES=minecraft/plugins/RucRpg/src/main/resources
TMP=$(mktemp -d)
mapfile -t CHANGED < <(git diff --name-only -- "$RES")
for f in "${CHANGED[@]}"; do mkdir -p "$TMP/$(dirname "$f")"; cp "$f" "$TMP/$f"; git checkout -- "$f"; done
(cd minecraft/plugins && java -classpath gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain :RucRpg:jar -q) || BUILD_FAIL=1
for f in "${CHANGED[@]}"; do cp "$TMP/$f" "$f"; done
rm -rf "$TMP"
[ -z "${BUILD_FAIL:-}" ] || { echo "빌드 실패"; exit 1; }
# 플러그인이 쓰는 모델(pack-models.json)이 운영 팩 zip 에 다 있는지 — 없으면 클라이언트에 보라 · 검정 네모 (2026-11-15 사용자 확인 사고)
python - <<'PY'
import json, zipfile, sys
sys.stdout.reconfigure(encoding="utf-8")
ids = json.loads(open("minecraft/plugins/RucRpg/src/main/resources/pack-models.json", encoding="utf-8").read())
names = set(zipfile.ZipFile("web/public/pack/ruc-war.zip").namelist())
miss = [i for i in ids if f"assets/ruc/items/{i}.json" not in names]
if miss:
    print("팩에 없는 모델 %d개 (예: %s) — pack.py 로 팩을 먼저 다시 묶고 커밋하세요" % (len(miss), ", ".join(miss[:5])))
    sys.exit(1)
PY
cp minecraft/servers/war/plugins/RucRpg.jar "minecraft/servers/war/plugins/RucRpg.jar.bak-$(date +%Y%m%d-%H%M)" 2>/dev/null || true
cp minecraft/plugins/RucRpg/build/libs/RucRpg-0.1.0.jar minecraft/servers/war/plugins/RucRpg.jar
echo "배포 jar (작업 중 리소스 제외: ${#CHANGED[@]}개)"
