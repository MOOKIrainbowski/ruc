"""러크 RPG 시험 서버 만들기 — servers/war 를 복사해 servers/rpg-test (프록시 없이 127.0.0.1:25599 · 오프라인 · 시험 DB).

    python minecraft/scripts/rpg-test-setup.py          # 처음 한 번 (이미 있으면 설정만 다시 맞춤)
    python minecraft/scripts/rpg-test-setup.py --jars   # 빌드한 RucCore · RucRpg jar 만 다시 넣기

운영 국가전(→RPG) 폴더는 바꾸지 않습니다. 봇(mineflayer) · 사람 모두 127.0.0.1:25599 로 바로 접속.
디스코드 인증 · 약관 · 디스코드 중계 · 신고 웹훅은 꺼서 시험이 밖으로 새지 않게. 비밀값은 출력하지 않습니다.
"""
import pathlib, re, shutil, sys

MC = pathlib.Path(__file__).resolve().parents[1]
SRC, DST = MC / "servers" / "war", MC / "servers" / "rpg-test"
PLUG = MC / "plugins"


def jars():
    (DST / "plugins").mkdir(parents=True, exist_ok=True)
    for name in ["RucCore", "RucRpg"]:
        shutil.copy2(PLUG / name / "build" / "libs" / f"{name}-0.1.0.jar", DST / "plugins" / f"{name}.jar")
    print("jars ok")


def section_flag(text, section, key, value):
    """최상위 section: 아래 첫 번째 '  key:' 값을 바꿈 (yaml 을 통째로 다시 쓰지 않아 주석 유지)"""
    m = re.search(rf"^{section}:\n((?:[ #].*\n|\n)*?)  {key}:.*$", text, flags=re.M)
    assert m, (section, key)
    line_start = m.start() + len(m.group(0)) - len(m.group(0).split("\n")[-1])
    return text[:line_start] + f"  {key}: {value}" + text[m.end():]


if "--jars" in sys.argv:
    jars(); sys.exit()

DST.mkdir(exist_ok=True)
for name in ["paper.jar", "eula.txt", "bukkit.yml", "spigot.yml", "commands.yml", "help.yml", "permissions.yml"]:
    if (SRC / name).exists() and not (DST / name).exists():
        shutil.copy2(SRC / name, DST / name)
for d in ["libraries", "cache", "versions", "config"]:
    if (SRC / d).exists() and not (DST / d).exists():
        shutil.copytree(SRC / d, DST / d)

# server.properties — rcon 비밀번호 등은 시험용으로 새로
props = (SRC / "server.properties").read_text(encoding="utf-8")
for k, v in {"server-port": "25599", "server-ip": "127.0.0.1", "online-mode": "false", "enable-rcon": "false",
             "motd": "Ruc RPG test", "require-resource-pack": "false", "level-name": "world",
             "spawn-protection": "0", "enforce-secure-profile": "false"}.items():
    props, n = re.subn(rf"^{k}=.*$", f"{k}={v}", props, flags=re.M)
    if not n: props += f"\n{k}={v}"
props = re.sub(r"^rcon\.password=.*$", "rcon.password=", props, flags=re.M)
(DST / "server.properties").write_text(props, encoding="utf-8")

# 프록시 포워딩 끄기
pg = DST / "config" / "paper-global.yml"
s = pg.read_text(encoding="utf-8")
s = re.sub(r"(  velocity:\n    enabled: )true", r"\1false", s)
s = re.sub(r"(    secret: ).*", r"\1''", s)
pg.write_text(s, encoding="utf-8")

# RucCore 설정 — 시험 DB · 외부로 나가는 것 끄기
core_dir = DST / "plugins" / "RucCore"
core_dir.mkdir(parents=True, exist_ok=True)
for f in (SRC / "plugins" / "RucCore").glob("messages_*.yml"):
    shutil.copy2(f, core_dir / f.name)
cfg = (SRC / "plugins" / "RucCore" / "config.yml").read_text(encoding="utf-8")
cfg = re.sub(r'^(  h2-file: ).*$', r'\1"rpgtest-ruc"', cfg, flags=re.M)
# 웹훅 주소는 전부 비움 — relay.enabled 가 꺼져도 피드(feed-webhook-url)는 따로 켜짐 (2026-11-15 겪음)
cfg = re.sub(r'^(\s*[a-z-]*webhook[a-z-]*:\s*).*$', r'\1""', cfg, flags=re.M)
for sec in ["verification", "terms", "relay", "report"]:
    try:
        cfg = section_flag(cfg, sec, "enabled", "false")
    except AssertionError:
        print("no enabled key in", sec)
(core_dir / "config.yml").write_text(cfg, encoding="utf-8")

jars()
print("rpg-test ready:", DST)
