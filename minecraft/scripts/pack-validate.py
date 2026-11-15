"""리소스팩 검사 (2026-11-15 — 운영 팩의 글꼴 134개 거부 · 모델 텍스처 1,300여 개 누락 사고 뒤).
마인크래프트 1.21.11 클라이언트가 거부하는 것들을 묶기 전에 잡습니다. pack.py 가 먼저 부르고, 오류가 있으면 묶지 않습니다.
  python minecraft/scripts/pack-validate.py   → 오류 수 출력, 0 이 아니면 종료 코드 1
"""
import json, pathlib, re, sys
sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[1] / "resourcepack"
ASSETS = ROOT / "assets"
VALID = re.compile(r"^[a-z0-9_.\-/]+$")
# 아틀라스에 들어가는 텍스처 폴더 (바닐라 blocks/items + 우리 atlases/*.json 의 directory source)
ATLAS_DIRS = {"block/", "item/"}
errors = []


def err(msg):
    errors.append(msg)


def rl(s):
    ns, _, path = s.partition(":") if ":" in s else ("minecraft", None, s)
    return ns, path


for a in (ASSETS / "minecraft" / "atlases").glob("*.json"):
    for src in json.loads(a.read_text(encoding="utf-8")).get("sources", []):
        if src.get("type", "").endswith("directory"):
            ATLAS_DIRS.add(src["source"].rstrip("/") + "/")

# 1. 경로 문자 · JSON 문법
for f in ASSETS.rglob("*"):
    if f.is_dir():
        continue
    rel = f.relative_to(ASSETS).as_posix()
    if not VALID.match(rel):
        err(f"경로에 쓸 수 없는 글자(소문자 a-z0-9_.-/ 만): {rel}")
    if f.suffix == ".json":
        try:
            json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            err(f"JSON 오류 {rel}: {e}")


def exists(kind, ref, ext):
    ns, path = rl(ref)
    if ns == "minecraft":
        return True  # 바닐라 리소스는 검사하지 않음
    return (ASSETS / ns / kind / (path + ext)).exists()


# 2. items/*.json → 모델
def walk_models(o, rel):
    if isinstance(o, dict):
        if o.get("type", "").endswith("model") and isinstance(o.get("model"), str) and not exists("models", o["model"], ".json"):
            err(f"없는 모델 {o['model']} ← {rel}")
        for v in o.values():
            walk_models(v, rel)
    elif isinstance(o, list):
        for v in o:
            walk_models(v, rel)


for f in ASSETS.glob("*/items/**/*.json"):
    walk_models(json.loads(f.read_text(encoding="utf-8")), f.relative_to(ASSETS).as_posix())

# 3. models → 부모 · 텍스처(있는지 + 아틀라스 폴더 안인지)
for f in ASSETS.glob("*/models/**/*.json"):
    rel = f.relative_to(ASSETS).as_posix()
    m = json.loads(f.read_text(encoding="utf-8"))
    if "parent" in m and not m["parent"].startswith("builtin/") and not exists("models", m["parent"], ".json"):
        err(f"없는 부모 모델 {m['parent']} ← {rel}")
    for key, t in (m.get("textures") or {}).items():
        if not isinstance(t, str) or t.startswith("#"):
            continue
        ns, path = rl(t)
        if ns != "minecraft" and not (ASSETS / ns / "textures" / (path + ".png")).exists():
            err(f"없는 텍스처 {t} ← {rel}")
        if not any(path.startswith(d) for d in ATLAS_DIRS):
            err(f"아틀라스 밖 텍스처 {t} ← {rel} (atlases/*.json 에 폴더를 넣거나 item/ 아래로)")

# 4. 글꼴
for f in ASSETS.glob("*/font/**/*.json"):
    rel = f.relative_to(ASSETS).as_posix()
    for i, p in enumerate(json.loads(f.read_text(encoding="utf-8")).get("providers", [])):
        t = p.get("type", "").replace("minecraft:", "")
        if t == "bitmap":
            ns, path = rl(p["file"])
            if ns != "minecraft" and not (ASSETS / ns / "textures" / path).exists():
                err(f"글꼴 그림 없음 {p['file']} (→ textures/{path}) ← {rel}#{i}")
            h = p.get("height", 8)
            if p.get("ascent", 0) > h:
                err(f"글꼴 ascent {p['ascent']} > height {h} ← {rel}#{i}")
            rows = p.get("chars", [])
            if not rows or not all(isinstance(r, str) and r for r in rows) or len({len(r) for r in rows}) != 1:
                err(f"글꼴 chars 는 같은 길이 문자열 줄이어야 함 ← {rel}#{i}")
        elif t == "ttf":
            ns, path = rl(p["file"])
            if not (ASSETS / ns / "font" / path).exists():
                err(f"ttf 없음 {p['file']} ← {rel}#{i}")

meta = json.loads((ROOT / "pack.mcmeta").read_text(encoding="utf-8"))
print("pack.mcmeta:", json.dumps(meta.get("pack", {}), ensure_ascii=False))
for e in errors[:60]:
    print("✗", e)
print(f"오류 {len(errors)}개")
sys.exit(1 if errors else 0)
