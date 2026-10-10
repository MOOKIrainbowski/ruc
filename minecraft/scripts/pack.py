"""리소스팩 묶기: minecraft/resourcepack → web/public/pack/ruc-war.zip, 그리고 war server.properties 에 주소 · sha1.

    python minecraft/scripts/pack.py

텍스처를 바꾸면 다시 돌리고, 웹을 배포한 뒤 국가전 서버를 재시작하세요 (sha1 이 바뀌어야 클라이언트가 새로 받습니다).
"""
import hashlib, json, pathlib, re, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "minecraft" / "resourcepack"
OUT = ROOT / "web" / "public" / "pack" / "ruc-war.zip"
URL = "https://ruc-server.vercel.app/pack/ruc-war.zip"
PROPS = ROOT / "minecraft" / "servers" / "war" / "server.properties"

OUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(SRC.rglob("*")):
        if f.is_file():
            # 고정 시각 — 내용이 같으면 sha1 도 같게
            info = zipfile.ZipInfo(f.relative_to(SRC).as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, f.read_bytes())
sha1 = hashlib.sha1(OUT.read_bytes()).hexdigest()

props = PROPS.read_text(encoding="utf-8")
for key, value in {"resource-pack": URL.replace(":", r"\:"), "resource-pack-sha1": sha1,
                   "resource-pack-prompt": json.dumps("강화대 · 러크 강화석 텍스처")}.items():
    props = re.sub(rf"^{key}=.*$", lambda _: f"{key}={value}", props, flags=re.M)   # lambda: 값의 역슬래시를 정규식이 해석하지 않게
PROPS.write_text(props, encoding="utf-8")
print(OUT, sha1)
