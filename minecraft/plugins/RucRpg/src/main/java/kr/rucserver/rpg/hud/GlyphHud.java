package kr.rucserver.rpg.hud;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.engine.EffectDefs;
import kr.rucserver.rpg.engine.Unit;
import kr.rucserver.rpg.skill.Progression;
import kr.rucserver.rpg.skill.SkillDefs;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.TextComponent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 글리프 HUD (계획서 4장 · Codex hud-glyphs.json v2): 액션바 한 줄에 리소스팩 글리프를 커서로 배치.
 * 액션바는 가운데 정렬 → 끝에 "-지금 커서" 간격을 붙여 전체 advance 를 0 으로 만들면 커서 0 = 화면 가운데.
 * 좌표는 layout 그대로(가운데 기준 GUI px). 세로 위치는 글리프마다 다른 글꼴의 ascent 가 정함(Codex).
 * 스탯 표 글자는 다음 글리프 배치(Codex)에서 — 지금은 배경 + 아이콘.
 */
public final class GlyphHud extends Hud {

    private final RucRpg plugin;
    private final JsonObject glyphs, spacing, layout;

    private GlyphHud(RucRpg plugin, JsonObject root) {
        this.plugin = plugin;
        glyphs = root.getAsJsonObject("glyphs");
        spacing = root.getAsJsonObject("spacing");
        layout = root.getAsJsonObject("layout");
    }

    /** hud-glyphs.json v2 가 있으면 글리프 HUD, 없으면 null (글자판 HUD 그대로) */
    public static GlyphHud load(RucRpg plugin) {
        try (var in = plugin.getClass().getClassLoader().getResourceAsStream("hud-glyphs.json")) {
            if (in == null) return null;
            JsonObject root = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
            if (!root.has("version") || root.get("version").getAsInt() < 2 || !root.has("layout")) return null;
            return new GlyphHud(plugin, root);
        } catch (Exception e) {
            plugin.getLogger().warning("hud-glyphs.json 을 읽지 못함 — 글자판 HUD 를 씀: " + e.getMessage());
            return null;
        }
    }

    /** 글자 하나씩 붙이는 커서 */
    private final class Line {
        final TextComponent.Builder b = Component.text();
        int x;

        void moveTo(int target) { space(target - x); }

        void space(int d) {
            if (d == 0) return;
            StringBuilder sb = new StringBuilder();
            int left = d;
            for (int p = 1024; p >= 1; p >>= 1) {
                while (Math.abs(left) >= p) {
                    JsonObject s = spacing.getAsJsonObject((left > 0 ? "+" : "-") + p);
                    sb.append(s.get("char").getAsString());
                    left -= left > 0 ? p : -p;
                }
            }
            b.append(Component.text(sb.toString()).font(Key.key("ruc", "space")));
            x += d;
        }

        /** 글리프를 지금 커서에 — 없는 이름이면 false */
        boolean glyph(String name) { return glyph(name, null); }

        boolean glyph(String name, TextColor color) {
            JsonObject g = glyphs.getAsJsonObject(name);
            if (g == null) return false;
            String[] f = g.get("font").getAsString().split(":");
            Component c = Component.text(g.get("char").getAsString()).font(Key.key(f[0], f[1]));
            b.append(color == null ? c.color(NamedTextColor.WHITE) : c.color(color));
            x += g.get("advance").getAsInt();
            return true;
        }

        /** 겹쳐 그리기: 그리고 커서를 되돌림 */
        void overlay(int at, String name) {
            moveTo(at);
            glyph(name);
        }

        Component done() {
            moveTo(0);
            return b.build();
        }
    }

    /** 바닐라 기본 글꼴 폭 어림 (한글 · 넓은 기호 9px, 좁은 글자 2~4, 나머지 6) — 몇 px 틀려도 토스트가 뜬 동안만 HUD 가 살짝 밀림 */
    static int textWidth(String s) {
        int w = 0;
        for (char c : s.toCharArray()) {
            if (c >= 0xAC00 && c <= 0xD7A3 || c >= 0x3131 && c <= 0x318E || c > 0x2000) w += 9;
            else if ("il!.,:;|'`".indexOf(c) >= 0) w += 2;
            else if (c == ' ' || "tI[]()".indexOf(c) >= 0) w += 4;
            else w += 6;
        }
        return w;
    }

    private int lx(String k) { return layout.getAsJsonObject(k).get("x").getAsInt(); }

    @Override
    protected Component compose(PlayerUnit u, long now) {
        String toast = toastOf(u.player.getUniqueId(), now);
        Line l = new Line();
        bar(l, u.shield() > 0 ? "bar.hp" : "bar.hp", u.hp, u.st.get("hp"), lx("bar.hp"));
        if (u.shield() > 0) shieldBar(l, u);
        bar(l, u.exhausted ? "bar.exhaust" : "bar.stamina", u.stamina, u.st.get("stamina"), lx("bar.stamina"));
        skills(l, u, now);
        effects(l, u, now);
        orb(l, "mana", u.mp, u.st.get("mana"), uses(u, "mana"));
        orb(l, "energy", u.en, u.st.get("energy"), uses(u, "energy"));
        stats(l, u);
        if (toast != null) {   // 토스트(스킬 실패 이유 등): 기본 글꼴 — 폭을 어림해 가운데에 두고 커서를 되돌림
            int w = textWidth(toast);
            l.moveTo(-w / 2);
            l.b.append(Component.text(toast, TextColor.color(0xFFD27A)));
            l.x += w;
        }
        return l.done();
    }

    /** 자원을 쓰는 직업인가 (웹: 안 쓰는 자원 구슬은 회색) */
    private boolean uses(PlayerUnit u, String res) {
        if (u.ch.line == null) return true;
        JsonElement jl = plugin.data().get("jobs.LINES." + u.ch.line + ".res");
        String kind = u.ch.job == null ? null : plugin.data().get("jobs.JOBS." + u.ch.job) == null ? null
                : plugin.data().get("jobs.JOBS." + u.ch.job).getAsJsonObject().has("kind") ? plugin.data().get("jobs.JOBS." + u.ch.job + ".kind").getAsString() : null;
        String r = "magic".equals(kind) ? "mana" : "hybrid".equals(kind) ? "both" : jl == null ? "both" : jl.getAsString();
        return r.equals("both") || r.equals(res);
    }

    /** 칸 조각 바: 칸마다 채움 0~3 (pitch 3 = advance 4 + 간격 −1) */
    private void bar(Line l, String key, double cur, double max, int x) {
        JsonObject lay = layout.getAsJsonObject(key);
        int cells = lay.get("cells").getAsInt(), pitch = lay.get("pitch").getAsInt();
        double px = Math.max(0, Math.min(1, cur / Math.max(1, max))) * cells * pitch;
        l.moveTo(x);
        for (int i = 0; i < cells; i++) {
            int fill = (int) Math.max(0, Math.min(pitch, Math.round(px - i * pitch)));
            l.moveTo(x + i * pitch);
            if (!l.glyph(key + "." + i + "." + fill)) l.glyph(key + ".0." + fill);
        }
    }

    /** 보호막: 체력 끝에서부터 흰 덧칠 */
    private void shieldBar(Line l, PlayerUnit u) {
        JsonObject lay = layout.getAsJsonObject("bar.shield");
        int cells = lay.get("cells").getAsInt(), pitch = lay.get("pitch").getAsInt(), x = lay.get("x").getAsInt();
        double max = u.st.get("hp");
        double from = u.hp / max * cells * pitch, to = Math.min(cells * pitch, from + u.shield() / max * cells * pitch);
        for (int i = (int) (from / pitch); i < cells && i * pitch < to; i++) {
            int fill = (int) Math.max(0, Math.min(pitch, Math.round(to - i * pitch)));
            if (fill <= 0) continue;
            l.moveTo(x + i * pitch);
            l.glyph("bar.shield." + i + "." + fill);
        }
    }

    private static final String[] SLOT_KEYS = {"Q", "W", "E", "R"};
    private static final String[] KEY_GLYPH = {"key.P", "key.Q", "key.SQ", "key.F", "key.SR"};

    private void skills(Line l, PlayerUnit u, long now) {
        JsonObject slots = layout.getAsJsonObject("skill.slots");
        int sx = slots.get("x").getAsInt(), step = slots.get("slotGlyph") != null ? 22 : 22;
        JsonObject icons = layout.getAsJsonObject("skill.icons");
        int ix = icons.get("x").getAsInt();
        JsonObject keys = layout.getAsJsonObject("skill.keys");
        int kx = keys.get("x").getAsInt();
        SkillDefs defs = plugin.progression().defs();
        for (int i = 0; i < 5; i++) {
            l.moveTo(sx + i * step);
            l.glyph("skill.slot");
            l.moveTo(kx + i * step + 8);
            l.glyph(KEY_GLYPH[i]);
            l.moveTo(ix + i * step);
            if (i == 0) {   // 패시브 (2차 전직 뒤)
                if (u.ch.job != null) l.glyph("skill.passive");
                continue;
            }
            String id = Progression.slotSkill(u.ch, SLOT_KEYS[i - 1]);
            if (id == null) continue;
            JsonObject sk = defs.get(id);
            boolean drawn = SkillDefs.bool(sk, "elementInherit") && l.glyph("skill." + id + ".element." + u.el);
            if (!drawn) l.glyph("skill." + id);
            long left = u.cd.getOrDefault(id, 0L) - now;
            if (left > 0) {
                RpgCharLearned lv = RpgCharLearned.of(u, id);
                double total = Math.max(1, defs.nums(sk, lv.grade, lv.lv, u.st.get("cdr")).cooldownMs());
                int stage = (int) Math.min(7, Math.floor(left / total * 8));
                l.moveTo(ix + i * step);
                l.glyph("skill.cd." + stage);
            } else {
                JsonObject cost = sk.getAsJsonObject("cost");
                boolean poor = (cost.has("mana") && u.mp < cost.get("mana").getAsDouble() * 0.7) || (cost.has("energy") && u.en < cost.get("energy").getAsDouble() * 0.7);
                if (poor && !u.gmNoCost) { l.moveTo(ix + i * step); l.glyph("skill.nores"); }
            }
        }
    }

    /** 스킬 레벨 · 등급 (쿨 덮개 비율용) */
    private record RpgCharLearned(String grade, int lv) {
        static RpgCharLearned of(PlayerUnit u, String id) {
            var l = Progression.learned(u.ch, id);
            return l == null ? new RpgCharLearned("low", 1) : new RpgCharLearned(l.grade(), l.lv());
        }
    }

    private void effects(Line l, PlayerUnit u, long now) {
        JsonObject lay = layout.getAsJsonObject("effects");
        int max = lay.get("max").getAsInt(), w = lay.get("iconW").getAsInt(), gap = lay.get("gap").getAsInt();
        List<Unit.Effect> list = new ArrayList<>();
        EffectDefs defs = plugin.combat().defs();
        for (Unit.Effect e : u.fx) if (defs.get(e.id) != null && list.size() < max) list.add(e);
        if (list.isEmpty()) return;
        int total = list.size() * (w + gap) - gap, x0 = -total / 2;
        for (int i = 0; i < list.size(); i++) {
            Unit.Effect e = list.get(i);
            int x = x0 + i * (w + gap);
            l.moveTo(x);
            l.glyph("effect." + e.id, defs.get(e.id).buff() ? null : TextColor.color(0xFFB0B0));
            if (e.dur < defs.foreverMs) {
                long s = Math.max(0, (e.until - now + 999) / 1000);
                String digits = s > 99 ? "99" : String.valueOf(s);
                l.moveTo(x + w - digits.length() * 4 + 1);
                for (char ch : digits.toCharArray()) l.glyph("num.small." + ch);
            }
        }
    }

    private void orb(Line l, String kind, double cur, double max, boolean used) {
        JsonObject lay = layout.getAsJsonObject("orb." + kind);
        l.moveTo(lay.get("x").getAsInt());
        if (!used) l.glyph("orb." + kind + ".unused");
        else l.glyph("orb." + kind + "." + (int) Math.round(Math.max(0, Math.min(1, cur / Math.max(1, max))) * 32));
        String n = String.valueOf((long) Math.floor(cur));
        int ax = lay.getAsJsonArray("numberAnchor").get(0).getAsInt();
        int w = n.length() * 4 - 1;
        l.moveTo(ax - w / 2);
        for (char c : n.toCharArray()) l.glyph("num.orb." + c);
    }

    private static final String[][] STAT_ROWS = {{"attack", "sword"}, {"spell", "star"}, {"pdef", "shield"}, {"mdef", "shield"}, {"attack_speed", "bolt"}, {"move_speed", "wing"}, {"crit", "target"}, {"luck", "clover"}};

    private void stats(Line l, PlayerUnit u) {
        if (!u.showStats) return;
        l.moveTo(lx("stats.panel"));
        l.glyph("stats.bg.panel");
        for (int i = 0; i < STAT_ROWS.length; i++) {
            l.moveTo(lx("stats.icon." + STAT_ROWS[i][0]));
            l.glyph("stats.icon." + i + "." + STAT_ROWS[i][1]);
        }
    }
}
