package kr.rucserver.rpg.quest;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.core.storage.Database;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.world.RpgMap;
import kr.rucserver.rpg.world.RpgWorlds;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 퀘스트 (§19 · 웹 server/quests.ts): 진행도는 서버가 직접 본 일(quest(p, 종류, 대상))로만 오름.
 * NPC 퀘스트(튜토리얼 13단계)는 끝나면 경험치는 바로, Gold · 아이템 보상은 **RucCore 우편함**으로(사유 = quest:id, 두 번 가지 않음) → 다음 퀘스트 시작.
 * 추적 = 보스바 한 줄(제목 · 진행도 · 갈 곳 방향 화살표 · 거리). 일지(J) = /퀘스트 창.
 * 유저 퀘스트(게시판)는 M8.
 */
public final class QuestEngine {

    public static final class Q {
        public final String id;
        public String state;
        public int[] prog;
        public boolean tracked = true;
        Q(String id, String state, int[] prog) { this.id = id; this.state = state; this.prog = prog; }
    }

    private final RucRpg plugin;
    private final Database db;
    private final JsonObject quests, npcs;
    private final String first;
    private final JsonArray fountain;
    private final double fountainR;
    private final Map<UUID, Map<String, Q>> byPlayer = new HashMap<>();
    private final Map<UUID, Integer> reach = new HashMap<>();
    private final Map<UUID, BossBar> bars = new HashMap<>();

    public QuestEngine(RucRpg plugin, Database db) {
        this.plugin = plugin;
        this.db = db;
        JsonObject q = plugin.data().file("quests");
        quests = q.getAsJsonObject("QUESTS");
        npcs = q.getAsJsonObject("NPCS");
        first = q.get("FIRST_QUEST").getAsString();
        fountain = q.getAsJsonArray("FOUNTAIN_SPOTS");
        fountainR = q.get("FOUNTAIN_R").getAsDouble();
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 5L);
    }

    public void createSchema() throws SQLException {
        try (Connection c = db.getConnection(); Statement s = c.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS rpg_quests (uuid VARCHAR(36) NOT NULL, quest_id VARCHAR(48) NOT NULL, state VARCHAR(8) NOT NULL, prog VARCHAR(64) NOT NULL, tracked BOOLEAN NOT NULL, PRIMARY KEY (uuid, quest_id))");
        }
    }

    public JsonObject def(String id) { return quests.getAsJsonObject(id); }
    public Map<String, Q> of(Player p) { return byPlayer.getOrDefault(p.getUniqueId(), Map.of()); }

    // ── 불러오기 · 저장 ─────────────────────────────────────────────

    /** 접속 · 캐릭터 생성 뒤 (비동기로 읽고 주 스레드에서 붙임) */
    public void load(Player p) {
        UUID id = p.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            Map<String, Q> m = new LinkedHashMap<>();
            try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT quest_id, state, prog, tracked FROM rpg_quests WHERE uuid = ?")) {
                ps.setString(1, id.toString());
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        String[] parts = rs.getString(3).isEmpty() ? new String[0] : rs.getString(3).split(",");
                        int[] prog = new int[parts.length];
                        for (int i = 0; i < parts.length; i++) prog[i] = Integer.parseInt(parts[i]);
                        Q q = new Q(rs.getString(1), rs.getString(2), prog);
                        q.tracked = rs.getBoolean(4);
                        m.put(q.id, q);
                    }
                }
            } catch (SQLException e) { plugin.getLogger().warning("퀘스트 읽기 실패: " + e.getMessage()); return; }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!p.isOnline()) return;
                byPlayer.put(id, m);
                Q fq = m.get("tut_fountain");
                reach.put(id, fq != null && "active".equals(fq.state) ? (1 << Math.min(4, fq.prog.length > 0 ? fq.prog[0] : 0)) - 1 : 0);
                if (m.isEmpty()) start(p, first, true);
                else for (Q q : m.values()) if ("active".equals(q.state)) syncLevel(p, q);
            });
        });
    }

    public void forget(Player p) {
        byPlayer.remove(p.getUniqueId());
        reach.remove(p.getUniqueId());
        BossBar b = bars.remove(p.getUniqueId());
        if (b != null) p.hideBossBar(b);
    }

    private void save(Player p, Q q) {
        UUID id = p.getUniqueId();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q.prog.length; i++) { if (i > 0) sb.append(','); sb.append(q.prog[i]); }
        String prog = sb.toString(), state = q.state;
        boolean tracked = q.tracked;
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try (Connection c = db.getConnection()) {
                try (PreparedStatement d = c.prepareStatement("DELETE FROM rpg_quests WHERE uuid = ? AND quest_id = ?")) { d.setString(1, id.toString()); d.setString(2, q.id); d.executeUpdate(); }
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO rpg_quests (uuid, quest_id, state, prog, tracked) VALUES (?,?,?,?,?)")) {
                    ps.setString(1, id.toString()); ps.setString(2, q.id); ps.setString(3, state); ps.setString(4, prog); ps.setBoolean(5, tracked); ps.executeUpdate();
                }
            } catch (SQLException e) { plugin.getLogger().warning("퀘스트 저장 실패: " + e.getMessage()); }
        });
    }

    // ── 진행 ────────────────────────────────────────────────────────

    private void start(Player p, String id, boolean announce) {
        JsonObject d = def(id);
        Map<String, Q> m = byPlayer.computeIfAbsent(p.getUniqueId(), k -> new LinkedHashMap<>());
        if (d == null || m.containsKey(id)) return;
        Q q = new Q(id, "active", new int[d.getAsJsonArray("obj").size()]);
        m.put(id, q);
        syncLevel(p, q);
        save(p, q);
        if (announce) {
            p.showTitle(Title.title(Component.text("새 퀘스트", TextColor.color(0xF2C94C)), Component.text(d.get("title").getAsString(), NamedTextColor.WHITE),
                    Title.Times.times(Duration.ofMillis(200), Duration.ofMillis(2500), Duration.ofMillis(500))));
            p.sendMessage(Component.text("[퀘스트] ", TextColor.color(0xF2C94C)).append(Component.text(d.get("title").getAsString() + " — " + hint(d), NamedTextColor.WHITE)));
            p.playSound(p.getLocation(), Sound.UI_TOAST_IN, 0.8f, 1.2f);
        }
    }

    /** 웹 안내 문구의 "F 키 · 마우스" 같은 웹 조작을 마크 조작으로 */
    private static String hint(JsonObject d) { return mc(d.has("hint") ? d.get("hint").getAsString() : d.get("desc").getAsString()); }

    /** 웹 조작 문구 → 마크 조작 (사용자 결정 Q1) */
    public static String mc(String s) {
        String[][] r = {{"F 키로 말을 걸어", "우클릭으로 말을 걸어"}, {"F 키", "우클릭"}, {"Shift로 달려요", "Ctrl(달리기)로 달려요"}, {"Shift로 달리", "Ctrl(달리기)로 달리"},
                {"Space 키로 구릅니다", "공중에서 Space 를 한 번 더 눌러 구릅니다"}, {"Space", "공중 Space"}, {"WASD로", "WASD 로"}, {"J 키", "/퀘스트"},
                {"K 키", "/스킬"}, {"V 키", "/창 → 장비"}, {"B 키", "/창 → 창고"}, {"P 키", "/파티"}, {"M으로 큰", "큰"}, {"M 키", "/창 → 지도"},
                {"마우스 쪽", "바라보는 쪽"}, {"마우스", "시선"}, {"Q 키", "Q"}, {"E 키", "F"}, {"R 키", "웅크리고 우클릭"}, {"C 키", "웅크리고 Q"}};
        for (String[] x : r) s = s.replace(x[0], x[1]);
        return s;
    }

    private void syncLevel(Player p, Q q) {
        JsonArray obj = def(q.id).getAsJsonArray("obj");
        PlayerUnit u = plugin.runtime().unit(p);
        for (int i = 0; i < obj.size(); i++) {
            JsonObject o = obj.get(i).getAsJsonObject();
            if ("level".equals(o.get("type").getAsString()) && u != null) q.prog[i] = Math.min(o.get("n").getAsInt(), u.ch.level);
            if ("party".equals(o.get("type").getAsString()) && plugin.inParty(p)) q.prog[i] = o.get("n").getAsInt();
        }
        check(p, q);
    }

    /** 서버가 본 일 (talk · reach · roll · claim · buy · cast · kill · enhance · equip · party · stage · level · collect) */
    public void quest(Player p, String type, String target, int n) {
        for (Q q : new ArrayList<>(of(p).values())) {
            if (!"active".equals(q.state)) continue;
            JsonArray obj = def(q.id).getAsJsonArray("obj");
            boolean touched = false;
            for (int i = 0; i < obj.size(); i++) {
                JsonObject o = obj.get(i).getAsJsonObject();
                int need = o.get("n").getAsInt();
                if (!type.equals(o.get("type").getAsString()) || q.prog[i] >= need) continue;
                String ot = o.has("target") ? o.get("target").getAsString() : null;
                if (type.equals("level")) { PlayerUnit u = plugin.runtime().unit(p); q.prog[i] = Math.min(need, u == null ? 0 : u.ch.level); }
                else if (type.equals("stage")) { if ((ot != null && !ot.equals(target)) || n <= q.prog[i]) continue; q.prog[i] = Math.min(need, n); }
                else if (ot == null || ot.equals("*") || ot.equals(target)) q.prog[i] = Math.min(need, q.prog[i] + n);
                else continue;
                touched = true;
            }
            if (touched) { save(p, q); check(p, q); }
        }
    }

    public void quest(Player p, String type, String target) { quest(p, type, target, 1); }

    private void check(Player p, Q q) {
        JsonObject d = def(q.id);
        JsonArray obj = d.getAsJsonArray("obj");
        if (!"active".equals(q.state)) return;
        for (int i = 0; i < obj.size(); i++) if (q.prog[i] < obj.get(i).getAsJsonObject().get("n").getAsInt()) return;
        q.state = "done";
        save(p, q);
        JsonObject r = d.getAsJsonObject("reward");
        String sender = npcs.has(d.get("npc").getAsString()) ? npcs.getAsJsonObject(d.get("npc").getAsString()).get("name").getAsString() : "퀘스트";
        List<String> got = new ArrayList<>();
        if (r.has("exp") && r.get("exp").getAsLong() > 0) got.add("경험치 " + r.get("exp").getAsLong());
        long gold = r.has("ruc") ? r.get("ruc").getAsLong() : 0;
        if (gold > 0) got.add(gold + " " + plugin.core().getEconomy().symbol());
        if (r.has("items")) for (JsonElement e : r.getAsJsonArray("items")) {
            JsonArray it = e.getAsJsonArray();
            if (plugin.items().tpl(it.get(0).getAsString()) != null) got.add(plugin.items().tpl(it.get(0).getAsString()).get("name").getAsString() + " ×" + it.get(1).getAsInt());
        }
        UUID id = p.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {   // 우편 보상 (블로킹 API — 비동기에서, 사유로 한 번만)
            var mail = plugin.core().getMailbox();
            if (gold > 0) mail.sendRucOnce(id, gold, sender, "rpgq:" + q.id + ":g");
            if (r.has("items")) {
                int k = 0;
                for (JsonElement e : r.getAsJsonArray("items")) {
                    JsonArray it = e.getAsJsonArray();
                    String tpl = it.get(0).getAsString();
                    if (plugin.items().tpl(tpl) == null) continue;
                    int qty = it.get(1).getAsInt();
                    var stack = Bukkit.getScheduler().callSyncMethod(plugin, () -> plugin.items().create(tpl, null, qty));
                    try { mail.sendItemOnce(id, stack.get(), sender, "rpgq:" + q.id + ":" + k++); } catch (Exception ex) { plugin.getLogger().warning("퀘스트 보상 우편 실패: " + ex.getMessage()); }
                }
            }
        });
        p.showTitle(Title.title(Component.text("퀘스트 완료!", TextColor.color(0x7CFC7C), TextDecoration.BOLD), Component.text(d.get("title").getAsString(), NamedTextColor.WHITE)));
        p.sendMessage(Component.text("[퀘스트 완료] ", TextColor.color(0x7CFC7C)).append(Component.text(d.get("title").getAsString()
                + (got.isEmpty() ? "" : " — 보상: " + String.join(", ", got) + (gold > 0 || r.has("items") ? " (우편함)" : "")), NamedTextColor.WHITE)));
        p.playSound(p.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 0.7f, 1.3f);
        if (r.has("exp") && r.get("exp").getAsLong() > 0) plugin.runtime().gainExp(p, r.get("exp").getAsLong());
        if (d.has("next") && !d.get("next").isJsonNull()) start(p, d.get("next").getAsString(), true);
    }

    // ── 추적 (보스바) · 분수 지점 ─────────────────────────────────────

    private void tick() {
        for (Player p : Bukkit.getOnlinePlayers()) {
            Map<String, Q> m = byPlayer.get(p.getUniqueId());
            if (m == null) continue;
            fountainReach(p, m);
            Q q = null;
            for (Q x : m.values()) if ("active".equals(x.state) && x.tracked) { q = x; break; }
            BossBar bar = bars.get(p.getUniqueId());
            if (q == null) { if (bar != null) { p.hideBossBar(bar); bars.remove(p.getUniqueId()); } continue; }
            Component title = trackerText(p, q);
            if (bar == null) {
                bar = BossBar.bossBar(title, 1f, BossBar.Color.YELLOW, BossBar.Overlay.PROGRESS);
                bars.put(p.getUniqueId(), bar);
                p.showBossBar(bar);
            } else bar.name(title);
            bar.progress(progressOf(q));
        }
    }

    private float progressOf(Q q) {
        JsonArray obj = def(q.id).getAsJsonArray("obj");
        double done = 0, total = 0;
        for (int i = 0; i < obj.size(); i++) { int n = obj.get(i).getAsJsonObject().get("n").getAsInt(); done += Math.min(n, q.prog[i]); total += n; }
        return (float) Math.max(0, Math.min(1, total == 0 ? 1 : done / total));
    }

    private Component trackerText(Player p, Q q) {
        JsonObject d = def(q.id);
        JsonArray obj = d.getAsJsonArray("obj");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < obj.size(); i++) {
            int n = obj.get(i).getAsJsonObject().get("n").getAsInt();
            if (sb.length() > 0) sb.append(" · ");
            sb.append(Math.min(n, q.prog[i])).append('/').append(n);
        }
        Component c = Component.text("◆ " + d.get("title").getAsString() + "  ", TextColor.color(0xF2C94C)).append(Component.text(sb.toString(), NamedTextColor.WHITE));
        Location goal = goal(p, q);
        if (goal != null && goal.getWorld() == p.getWorld()) {
            double dx = goal.getX() - p.getLocation().getX(), dz = goal.getZ() - p.getLocation().getZ();
            double dist = Math.hypot(dx, dz);
            if (dist > 2) {
                double ang = Math.toDegrees(Math.atan2(-dx, dz)) - p.getLocation().getYaw();
                c = c.append(Component.text("   " + arrow(ang) + " " + Math.round(dist) + "칸", TextColor.color(0x7FD3FF)));
            } else c = c.append(Component.text("   ● 여기", TextColor.color(0x7CFC7C)));
        } else if (goal != null) c = c.append(Component.text("   ↗ " + RpgWorlds.NAMES.getOrDefault(plugin.worlds().kindOf(goal.getWorld()), "다른 곳") + "(포털)", TextColor.color(0x7FD3FF)));
        return c;
    }

    private static String arrow(double deg) {
        double a = ((deg % 360) + 360) % 360;
        String[] arrows = {"↑", "↗", "→", "↘", "↓", "↙", "←", "↖"};
        return arrows[(int) Math.round(a / 45) % 8];
    }

    /** 지금 퀘스트의 갈 곳 (웹 questGoal: 목표 종류 → 장소) */
    private Location goal(Player p, Q q) {
        JsonArray obj = def(q.id).getAsJsonArray("obj");
        RpgWorlds ws = plugin.worlds();
        for (int i = 0; i < obj.size(); i++) {
            JsonObject o = obj.get(i).getAsJsonObject();
            if (q.prog[i] >= o.get("n").getAsInt()) continue;
            String type = o.get("type").getAsString(), target = o.has("target") ? o.get("target").getAsString() : null;
            switch (type) {
                case "talk" -> { return npcAt(target); }
                case "reach" -> {
                    int r = reach.getOrDefault(p.getUniqueId(), 0);
                    for (int k = 0; k < fountain.size(); k++) if ((r & (1 << k)) == 0) {
                        JsonObject s = fountain.get(k).getAsJsonObject();
                        return ws.at("plaza", s.get("x").getAsDouble(), s.get("y").getAsDouble());
                    }
                }
                case "buy" -> { return objAt("plaza", "tent_shop"); }
                case "enhance" -> { return objAt("plaza", "anvil"); }
                case "claim" -> { return objAt("plaza", "mailbox"); }
                case "equip" -> { return npcAt("owen"); }
                case "party", "stage" -> { return npcAt("dario"); }
                case "kill" -> {
                    if (ws.isPlaza(p.getLocation())) return objAt("plaza", "portal", "field");
                    return zoneAt(target);
                }
                default -> {}
            }
        }
        return null;
    }

    private Location npcAt(String id) {
        for (RpgMap.Obj o : plugin.worlds().npcs.getOrDefault("plaza", List.of())) if (id != null && id.equals(o.prop("npc"))) return plugin.worlds().at("plaza", o.cx(), o.cy());
        return null;
    }

    private Location objAt(String kind, String type) { return objAt(kind, type, null); }

    private Location objAt(String kind, String type, String portalTarget) {
        RpgMap m = plugin.worlds().map(kind);
        if (m == null) return null;
        for (RpgMap.Obj o : m.objects) if (o.type().equals(type) && (portalTarget == null || portalTarget.equals(o.prop("target")))) return plugin.worlds().at(kind, o.cx(), o.cy());
        return null;
    }

    private Location zoneAt(String mob) {
        for (String k : List.of("field", "highland")) {
            RpgMap m = plugin.worlds().map(k);
            if (m == null) continue;
            for (RpgMap.Obj o : m.objects) if ("spawn_zone".equals(o.type()) && mob != null && mob.equals(o.prop("mob"))) return plugin.worlds().at(k, o.cx(), o.cy());
        }
        return null;
    }

    /** 분수 둘레 네 곳 (tut_fountain) */
    private void fountainReach(Player p, Map<String, Q> m) {
        Q q = m.get("tut_fountain");
        if (q == null || !"active".equals(q.state) || !plugin.worlds().isPlaza(p.getLocation())) return;
        int was = reach.getOrDefault(p.getUniqueId(), 0), r = was;
        for (int i = 0; i < fountain.size(); i++) {
            JsonObject s = fountain.get(i).getAsJsonObject();
            double sx = s.get("x").getAsDouble() / 8, sz = s.get("y").getAsDouble() / 8;   // 맵 px → 블록
            if (Math.hypot(p.getLocation().getX() - sx, p.getLocation().getZ() - sz) <= fountainR / 8 + 1) r |= 1 << i;
        }
        if (r == was) return;
        reach.put(p.getUniqueId(), r);
        int count = Integer.bitCount(r);
        p.playSound(p.getLocation(), Sound.BLOCK_NOTE_BLOCK_CHIME, 0.7f, 1.2f + count * 0.15f);
        if (count > q.prog[0]) { q.prog[0] = count; save(p, q); check(p, q); }
    }

    // ── 일지 (J) ────────────────────────────────────────────────────

    public void journal(Player p) {
        kr.rucserver.rpg.ui.Gui g = new kr.rucserver.rpg.ui.Gui(3, Component.text("퀘스트 일지", NamedTextColor.DARK_GRAY));
        g.onBack = () -> plugin.menus().main(p);
        for (int i = 0; i < 27; i++) g.set(i, kr.rucserver.rpg.ui.Gui.filler(), null);
        int pos = 0;
        for (Q q : of(p).values()) {
            if (pos >= 27) break;
            JsonObject d = def(q.id);
            boolean done = "done".equals(q.state);
            List<Component> lore = new ArrayList<>();
            lore.add(kr.rucserver.rpg.ui.Gui.line(d.get("desc").getAsString(), NamedTextColor.WHITE));
            if (!done) {
                lore.add(kr.rucserver.rpg.ui.Gui.gray(hint(d)));
                lore.add(kr.rucserver.rpg.ui.Gui.line(q.tracked ? "추적 중 — 클릭: 추적 끄기" : "클릭: 추적하기", NamedTextColor.YELLOW));
            }
            g.set(pos++, kr.rucserver.rpg.ui.Gui.icon(done ? org.bukkit.Material.MAP : org.bukkit.Material.WRITABLE_BOOK, null,
                    Component.text((done ? "✔ " : "◆ ") + d.get("title").getAsString(), done ? NamedTextColor.GRAY : TextColor.color(0xF2C94C), TextDecoration.BOLD), lore),
                    done ? null : (pl, t) -> { q.tracked = !q.tracked; save(pl, q); journal(pl); });
        }
        g.open(p);
    }
}
