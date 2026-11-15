package kr.rucserver.rpg.realm;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.core.model.Guild;
import kr.rucserver.core.model.GuildMember;
import kr.rucserver.core.storage.Database;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.engine.Combat;
import kr.rucserver.rpg.mob.MobUnit;
import kr.rucserver.rpg.ui.Gui;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 영지 · 국가 · 길드 경험치 (웹 server/realm.ts · P14 §21-4 · D96~D98). 길드 = RucCore 길드(id · 길드장 · 길드원) 그대로.
 * 영지 = 햇살 초원 네 구역. 한 주(월 0시 KST) 동안 길드원 처치로 쌓은 영향력 1위 길드가 다음 주 영주.
 * 영주 길드(와 같은 국가)의 길드원은 그 영지에서 "영지의 가호"(경험치 +10% · 이동 속도 +5%). 영지에서 누가 잡든 영주 길드가 길드 경험치 +1(세금).
 * 국가 = 영지를 가진 길드의 길드장이 3000 Gold 로 세우고, 다른 길드를 초대. 국가 채팅 /ㄴ.
 * 마크 타협: RucCore 길드의 "국가" 표시(국가전 입장용 nation 플래그)는 기존 그대로 두고 RPG 국가는 따로 저장. 길드 레벨에 따른 정원 · 금고 칸은
 * RucCore 길드 규칙이 정하므로 RPG 쪽은 레벨 · 경험치 표시만. 이름표 «국가»는 RucCore 스코어보드를 건드리지 않으려 국가 채팅 머리말로.
 */
public final class Realm {

    private record Terr(int id, String name, double x0, double y0, double x1, double y1) {}
    private record Nation(int id, String name, int ruler, String notice) {}

    private static final long H = 3_600_000L, D = 24 * H;
    public static long weekOf(long now) { return Math.floorDiv(now + 9 * H - 4 * D, 7 * D); }
    public static long weekEnd(long week) { return (week + 1) * 7 * D + 4 * D - 9 * H; }

    private final RucRpg plugin;
    private final Database db;
    private final List<Terr> terrs = new ArrayList<>();
    private final JsonObject cfg;
    private final JsonArray guildXpTable;
    /** 영지 id → 영주 길드 id (메모리, DB 원본) */
    private final Map<Integer, Integer> owner = new ConcurrentHashMap<>();
    /** "영지:길드:주" → 쌓인 영향력 · 길드 → 쌓인 경험치 (30초마다 DB 로 — 몹 한 마리마다 쓰지 않게) */
    private final Map<String, Long> infl = new HashMap<>();
    private final Map<Integer, Long> gxp = new HashMap<>();
    /** 국가 id → 초대받은 길드 id (메모리, 웹과 같음) */
    private final Map<Integer, Set<Integer>> invites = new HashMap<>();

    public Realm(RucRpg plugin, Database db) {
        this.plugin = plugin;
        this.db = db;
        JsonObject r = plugin.data().file("realm");
        for (JsonElement e : r.getAsJsonArray("TERRITORIES")) {
            JsonObject o = e.getAsJsonObject();
            terrs.add(new Terr(o.get("id").getAsInt(), o.get("name").getAsString(), o.get("x0").getAsDouble(), o.get("y0").getAsDouble(), o.get("x1").getAsDouble(), o.get("y1").getAsDouble()));
        }
        cfg = r.getAsJsonObject("REALM");
        guildXpTable = r.getAsJsonArray("GUILD_XP");
    }

    public void start() throws SQLException {
        try (Connection c = db.getConnection(); Statement s = c.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS rpg_territories (id INT PRIMARY KEY, name VARCHAR(32) NOT NULL, owner_guild INT, week BIGINT NOT NULL DEFAULT 0)");
            s.execute("CREATE TABLE IF NOT EXISTS rpg_influence (terr INT NOT NULL, guild INT NOT NULL, week BIGINT NOT NULL, points BIGINT NOT NULL, PRIMARY KEY (terr, guild, week))");
            s.execute("CREATE TABLE IF NOT EXISTS rpg_guild_xp (guild INT PRIMARY KEY, xp BIGINT NOT NULL)");
            s.execute("CREATE TABLE IF NOT EXISTS rpg_nations (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(16) NOT NULL UNIQUE, ruler_guild INT NOT NULL, notice VARCHAR(160) NOT NULL DEFAULT '', created BIGINT NOT NULL)");
            s.execute("CREATE TABLE IF NOT EXISTS rpg_guild_nation (guild INT PRIMARY KEY, nation INT NOT NULL)");
            for (Terr t : terrs) s.execute("MERGE INTO rpg_territories (id, name) KEY (id) VALUES (" + t.id() + ", '" + t.name().replace("'", "''") + "')");
            try (ResultSet rs = s.executeQuery("SELECT id, owner_guild FROM rpg_territories")) { while (rs.next()) if (rs.getObject(2) != null) owner.put(rs.getInt(1), rs.getInt(2)); }
        }
        Bukkit.getScheduler().runTaskTimer(plugin, this::sec, 40L, 20L);
        Bukkit.getScheduler().runTaskTimer(plugin, () -> RucRpg.WRITER.execute(this::flush), 20L * 30, 20L * 30);
        Bukkit.getScheduler().runTaskTimer(plugin, () -> RucRpg.WRITER.execute(() -> settle(false)), 20L * 5, 20L * 60);
    }

    // ── 길드 · 국가 조회 ─────────────────────────────────────────────

    private Guild guildOf(UUID id) { return plugin.core().getGuilds().of(id); }
    private Guild guild(int id) { return plugin.core().getGuilds().byId(id); }

    private Integer nationIdOf(int guild) {
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT nation FROM rpg_guild_nation WHERE guild = ?")) {
            ps.setInt(1, guild);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? rs.getInt(1) : null; }
        } catch (SQLException e) { return null; }
    }

    private Nation nation(int id) {
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT id, name, ruler_guild, notice FROM rpg_nations WHERE id = ?")) {
            ps.setInt(1, id);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? new Nation(rs.getInt(1), rs.getString(2), rs.getInt(3), rs.getString(4)) : null; }
        } catch (SQLException e) { return null; }
    }

    private List<Integer> nationGuilds(int nid) {
        List<Integer> out = new ArrayList<>();
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT guild FROM rpg_guild_nation WHERE nation = ? ORDER BY guild")) {
            ps.setInt(1, nid);
            try (ResultSet rs = ps.executeQuery()) { while (rs.next()) out.add(rs.getInt(1)); }
        } catch (SQLException ignored) {}
        return out;
    }

    private int exec(String sql, Object... args) {
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            return ps.executeUpdate();
        } catch (SQLException e) { plugin.getLogger().warning("영지 저장 실패: " + e.getMessage()); return -1; }
    }

    public long guildXp(int gid) {
        long x = gxp.getOrDefault(gid, 0L);
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT xp FROM rpg_guild_xp WHERE guild = ?")) {
            ps.setInt(1, gid);
            try (ResultSet rs = ps.executeQuery()) { if (rs.next()) x += rs.getLong(1); }
        } catch (SQLException ignored) {}
        return x;
    }

    public int guildLevel(long xp) { int n = 0; for (JsonElement e : guildXpTable) if (xp >= e.getAsLong()) n++; return n; }

    // ── 처치 · 가호 ─────────────────────────────────────────────────

    private Terr terrAt(String worldName, double cx, double cy) {
        if (!worldName.equals("rpg_field")) return null;
        var m = plugin.worlds().map("field");
        if (m == null) return null;
        double wpx = m.w * 16, hpx = m.h * 16, x = cx / 2, y = cy / 2;   // 전투 px → 맵 px
        for (Terr t : terrs) if (x >= t.x0() * wpx && x < t.x1() * wpx && y >= t.y0() * hpx && y < t.y1() * hpx) return t;
        return null;
    }

    /** 몹 처치 (RucRpg.mobKilled): 처치한 사람 길드 경험치(등급 배율) · 필드면 그 영지 영향력 · 영주 길드 세금 */
    public void kill(MobUnit m, PlayerUnit best) {
        int gi = plugin.mobs().defs().gradeIndex(m.grade) + 1;
        Guild g = best == null ? null : guildOf(best.player.getUniqueId());
        synchronized (this) {
            if (g != null) gxp.merge(g.getId(), (long) gi, Long::sum);
            if (m.body == null) return;
            Terr t = terrAt(m.body.getWorld().getName(), m.x, m.y);
            if (t == null) return;
            if (g != null) infl.merge(t.id() + ":" + g.getId() + ":" + weekOf(System.currentTimeMillis()), gi * 10L, Long::sum);
            Integer o = owner.get(t.id());
            if (o != null) gxp.merge(o, 1L, Long::sum);
        }
    }

    /** 이 사람이 이 영지의 가호를 받는가: 영주 길드이거나 영주와 같은 국가 */
    private final Map<Integer, Integer> nationCache = new ConcurrentHashMap<>();

    private boolean blessed(UUID id, int terr) {
        Integer o = owner.get(terr);
        Guild g = guildOf(id);
        if (o == null || g == null) return false;
        if (o == g.getId()) return true;
        Integer a = nationCache.get(o), b = nationCache.get(g.getId());
        return a != null && a.equals(b) && a != 0;
    }

    private int tickN;

    /** 매초: 필드에서 영지의 가호 켜고 끔 */
    private void sec() {
        if (tickN++ % 30 == 0) RucRpg.WRITER.execute(() -> {   // 국가 소속은 30초마다 읽어 둠
            Map<Integer, Integer> m = new HashMap<>();
            try (Connection c = db.getConnection(); Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SELECT guild, nation FROM rpg_guild_nation")) {
                while (rs.next()) m.put(rs.getInt(1), rs.getInt(2));
            } catch (SQLException ignored) {}
            nationCache.clear();
            nationCache.putAll(m);
        });
        var w = plugin.worlds().world("field");
        if (w == null) return;
        Combat c = plugin.combat();
        for (Player p : w.getPlayers()) {
            PlayerUnit u = plugin.runtime().unit(p);
            if (u == null || u.dead) continue;
            Terr t = terrAt(w.getName(), u.x, u.y);
            boolean on = t != null && blessed(p.getUniqueId(), t.id());
            if (on && !u.has("terr_bless")) {
                c.addEffect(plugin.world(), u, Combat.FxSpec.of("terr_bless", 1e12), u);
                p.sendActionBar(Component.text("영지의 가호 — 「" + t.name() + "」 경험치 +10% · 이동 속도 +5%", TextColor.color(0xB5F07A)));
            } else if (!on && u.has("terr_bless")) c.removeEffect(plugin.world(), u, "terr_bless");
        }
    }

    /** 영향력 · 길드 경험치를 DB 로 (WRITER 에서) */
    private void flush() {
        Map<String, Long> fi;
        Map<Integer, Long> fg;
        synchronized (this) {
            if (infl.isEmpty() && gxp.isEmpty()) return;
            fi = new HashMap<>(infl); fg = new HashMap<>(gxp);
            infl.clear(); gxp.clear();
        }
        try (Connection c = db.getConnection()) {
            c.setAutoCommit(false);
            for (var e : fi.entrySet()) {
                String[] k = e.getKey().split(":");
                try (PreparedStatement u = c.prepareStatement("UPDATE rpg_influence SET points = points + ? WHERE terr = ? AND guild = ? AND week = ?")) {
                    u.setLong(1, e.getValue()); u.setInt(2, Integer.parseInt(k[0])); u.setInt(3, Integer.parseInt(k[1])); u.setLong(4, Long.parseLong(k[2]));
                    if (u.executeUpdate() == 0) try (PreparedStatement i = c.prepareStatement("INSERT INTO rpg_influence (terr, guild, week, points) VALUES (?,?,?,?)")) {
                        i.setInt(1, Integer.parseInt(k[0])); i.setInt(2, Integer.parseInt(k[1])); i.setLong(3, Long.parseLong(k[2])); i.setLong(4, e.getValue()); i.executeUpdate();
                    }
                }
            }
            for (var e : fg.entrySet()) {
                try (PreparedStatement u = c.prepareStatement("UPDATE rpg_guild_xp SET xp = xp + ? WHERE guild = ?")) {
                    u.setLong(1, e.getValue()); u.setInt(2, e.getKey());
                    if (u.executeUpdate() == 0) try (PreparedStatement i = c.prepareStatement("INSERT INTO rpg_guild_xp (guild, xp) VALUES (?,?)")) { i.setInt(1, e.getKey()); i.setLong(2, e.getValue()); i.executeUpdate(); }
                }
            }
            c.commit();
        } catch (SQLException ex) {
            plugin.getLogger().warning("영지 영향력 저장 실패 — 다음에 다시: " + ex.getMessage());
            synchronized (this) { fi.forEach((k, v) -> infl.merge(k, v, Long::sum)); fg.forEach((k, v) -> gxp.merge(k, v, Long::sum)); }
        }
    }

    private record Top(int guild, long points) {}

    private List<Top> top(int terr, long week, int n) {
        List<Top> out = new ArrayList<>();
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT guild, points FROM rpg_influence WHERE terr = ? AND week = ? ORDER BY points DESC, guild LIMIT ?")) {
            ps.setInt(1, terr); ps.setLong(2, week); ps.setInt(3, n);
            try (ResultSet rs = ps.executeQuery()) { while (rs.next()) out.add(new Top(rs.getInt(1), rs.getLong(2))); }
        } catch (SQLException ignored) {}
        return out;
    }

    /** 주간 정산 (WRITER 에서): 지난주 영향력 1위가 이번 주 영주 (없으면 그대로). 사라진 길드의 영지 · 국가도 정리. force = 이번 주 영향력으로 바로(GM) */
    public void settle(boolean force) {
        flush();
        long cur = weekOf(System.currentTimeMillis());
        List<String> notices = new ArrayList<>();
        try (Connection c = db.getConnection(); Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SELECT id, name, owner_guild, week FROM rpg_territories")) {
            while (rs.next()) {
                int id = rs.getInt(1);
                Integer was = rs.getObject(3) == null ? null : rs.getInt(3);
                if (was != null && guild(was) == null) { exec("UPDATE rpg_territories SET owner_guild = NULL WHERE id = ?", id); owner.remove(id); was = null; }
                if (!force && rs.getLong(4) >= cur) continue;
                List<Top> t = top(id, force ? cur : cur - 1, 1);
                Integer now = t.isEmpty() || guild(t.get(0).guild()) == null ? was : Integer.valueOf(t.get(0).guild());
                exec("UPDATE rpg_territories SET owner_guild = ?, week = ? WHERE id = ?", now, cur, id);
                if (now != null) owner.put(id, now); else owner.remove(id);
                if (now != null && !now.equals(was)) notices.add("‹" + guild(now).getName() + "› 길드가 「" + rs.getString(2) + "」의 새 영주가 되었습니다!");
            }
        } catch (SQLException e) { plugin.getLogger().warning("영지 정산 실패: " + e.getMessage()); }
        // 군주 길드가 사라진 국가: 가장 오래된 다른 길드에게 넘기거나 해산 (웹 guildGone)
        try (Connection c = db.getConnection(); Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SELECT id, ruler_guild FROM rpg_nations")) {
            while (rs.next()) {
                int nid = rs.getInt(1);
                for (int gid : nationGuilds(nid)) if (guild(gid) == null) exec("DELETE FROM rpg_guild_nation WHERE guild = ?", gid);
                if (guild(rs.getInt(2)) != null) continue;
                List<Integer> rest = nationGuilds(nid);
                if (rest.isEmpty()) exec("DELETE FROM rpg_nations WHERE id = ?", nid);
                else exec("UPDATE rpg_nations SET ruler_guild = ? WHERE id = ?", rest.get(0), nid);
            }
        } catch (SQLException ignored) {}
        if (!notices.isEmpty()) Bukkit.getScheduler().runTask(plugin, () -> {
            for (String n : notices) Bukkit.broadcast(Component.text("[영지] " + n, TextColor.color(0xF2C94C), TextDecoration.BOLD));
        });
    }

    // ── 창 ──────────────────────────────────────────────────────────

    public void open(Player p) {
        long week = weekOf(System.currentTimeMillis()), left = (weekEnd(week) - System.currentTimeMillis()) / H;
        Guild g = guildOf(p.getUniqueId());
        Gui gui = new Gui(4, Component.text("영지 · 국가 — 정산까지 " + left / 24 + "일 " + left % 24 + "시간", NamedTextColor.DARK_GRAY));
        for (int i = 0; i < 36; i++) gui.set(i, Gui.filler(), null);
        RucRpg.WRITER.execute(this::flush);
        int[] at = {10, 12, 14, 16};
        for (int i = 0; i < terrs.size() && i < 4; i++) {
            Terr t = terrs.get(i);
            Integer o = owner.get(t.id());
            List<Component> lore = new ArrayList<>();
            lore.add(Gui.line("영주: " + (o != null && guild(o) != null ? "‹" + guild(o).getName() + "›" : "없음"), TextColor.color(0xF2C94C)));
            lore.add(Gui.gray("이번 주 영향력"));
            int rank = 1;
            for (Top x : top(t.id(), week, 3)) lore.add(Gui.line(" " + rank++ + ". " + (guild(x.guild()) == null ? "?" : guild(x.guild()).getName()) + " — " + x.points(), NamedTextColor.WHITE));
            if (g != null) {
                long mine = top(t.id(), week, 100).stream().filter(x -> x.guild() == g.getId()).mapToLong(Top::points).sum();
                lore.add(Gui.line("우리 길드: " + mine, NamedTextColor.AQUA));
            }
            lore.add(Gui.gray("햇살 초원에서 길드원이 몹을 잡으면 영향력(등급 × 10)"));
            gui.set(at[i], Gui.icon(o != null && g != null && o == g.getId() ? Material.LIME_BANNER : Material.WHITE_BANNER, null, Component.text(t.name(), TextColor.color(0xB5F07A), TextDecoration.BOLD), lore), null);
        }
        // 길드 · 국가
        if (g == null) {
            gui.set(31, Gui.icon(Material.BARRIER, null, Component.text("길드에 들어 있지 않아요", NamedTextColor.GRAY), List.of(Gui.gray("/길드 로 길드를 만들거나 들어가세요 (러크 길드 그대로)"))), null);
        } else {
            long xp = guildXp(g.getId());
            int lv = guildLevel(xp);
            Long next = lv < guildXpTable.size() ? guildXpTable.get(lv).getAsLong() : null;
            gui.set(29, Gui.icon(Material.SHIELD, null, Component.text("‹" + g.getName() + "› 길드 Lv." + lv, NamedTextColor.WHITE, TextDecoration.BOLD),
                    List.of(Gui.gray("길드 경험치 " + xp + (next == null ? " (최대)" : " / " + next)), Gui.gray("길드원 몹 처치(등급 배율) · 영지 세금으로 오름"))), null);
            Integer nid = nationIdOf(g.getId());
            Nation n = nid == null ? null : nation(nid);
            if (n == null) {
                gui.set(31, Gui.button("국가 세우기", false, List.of(Gui.gray("영지를 가진 길드의 길드장만"), Gui.gray(cfg.get("nationRuc").getAsLong() + " " + plugin.core().getEconomy().symbol()),
                        Gui.gray("/나라 세우기 <이름>"))), (pl, t) -> { pl.closeInventory(); pl.sendMessage(Component.text("/나라 세우기 <이름> (한글 · 영문 · 숫자 2~10자)", NamedTextColor.YELLOW)); });
            } else {
                List<Component> lore = new ArrayList<>();
                lore.add(Gui.line("군주: ‹" + (guild(n.ruler()) == null ? "?" : guild(n.ruler()).getName()) + "›", TextColor.color(0xF2C94C)));
                for (int gid : nationGuilds(n.id())) {
                    Guild x = guild(gid);
                    if (x == null) continue;
                    long lands = owner.values().stream().filter(v -> v == gid).count();
                    lore.add(Gui.line(" · " + x.getName() + (lands > 0 ? " (영지 " + lands + ")" : ""), NamedTextColor.WHITE));
                }
                if (!n.notice().isEmpty()) lore.add(Gui.line("공지: " + n.notice(), NamedTextColor.AQUA));
                lore.add(Gui.gray("/ㄴ <말> 국가 채팅 · /나라 <초대|추방|공지|나가기|해산>"));
                gui.set(31, Gui.icon(Material.GOLDEN_HELMET, null, Component.text("«" + n.name() + "»", NamedTextColor.GOLD, TextDecoration.BOLD), lore), null);
            }
        }
        gui.open(p);
    }

    // ── 국가 명령 (/나라 · 웹 nationOp) ──────────────────────────────

    public String command(Player p, String[] args) {
        if (args.length == 0) { open(p); return null; }
        Guild g = guildOf(p.getUniqueId());
        if (g == null) return "길드에 들어 있어야 합니다";
        boolean master = p.getUniqueId().equals(g.getMaster());
        Integer nid = nationIdOf(g.getId());
        Nation n = nid == null ? null : nation(nid);
        boolean ruler = n != null && n.ruler() == g.getId() && master;
        String arg = args.length > 1 ? String.join(" ", java.util.Arrays.copyOfRange(args, 1, args.length)).trim() : "";
        switch (args[0]) {
            case "세우기" -> {
                if (!master) return "길드장만 국가를 세울 수 있습니다";
                if (n != null) return "이미 국가에 속해 있습니다";
                if (!owner.containsValue(g.getId())) return "영지를 가진 길드만 국가를 세울 수 있습니다";
                if (!arg.matches("^[가-힣a-zA-Z0-9]{2,10}$")) return "국가 이름은 한글 · 영문 · 숫자 2~10자입니다";
                String err = plugin.economy().charge(p, cfg.get("nationRuc").getAsLong(), "nation_found", arg, () -> {
                    try (Connection c = db.getConnection()) {
                        c.setAutoCommit(false);
                        int id;
                        try (PreparedStatement ps = c.prepareStatement("INSERT INTO rpg_nations (name, ruler_guild, created) VALUES (?,?,?)", Statement.RETURN_GENERATED_KEYS)) {
                            ps.setString(1, arg); ps.setInt(2, g.getId()); ps.setLong(3, System.currentTimeMillis()); ps.executeUpdate();
                            try (ResultSet k = ps.getGeneratedKeys()) { k.next(); id = k.getInt(1); }
                        }
                        try (PreparedStatement ps = c.prepareStatement("MERGE INTO rpg_guild_nation (guild, nation) KEY (guild) VALUES (?,?)")) { ps.setInt(1, g.getId()); ps.setInt(2, id); ps.executeUpdate(); }
                        c.commit();
                    } catch (SQLException e) { throw new kr.rucserver.rpg.econ.Economy.Fail("이미 있는 국가 이름입니다"); }
                });
                if (err != null) return err;
                nationCache.clear();
                Bukkit.broadcast(Component.text("[국가] ‹" + g.getName() + "› 길드가 국가 «" + arg + "»을(를) 세웠습니다!", NamedTextColor.GOLD, TextDecoration.BOLD));
                return null;
            }
            case "초대" -> {
                if (!ruler) return "국가의 군주(군주 길드의 길드장)만 초대할 수 있습니다";
                Guild to = plugin.core().getGuilds().byName(arg);
                if (to == null) return "없는 길드입니다";
                if (nationIdOf(to.getId()) != null) return "이미 국가에 속한 길드입니다";
                invites.computeIfAbsent(n.id(), k -> new HashSet<>()).add(to.getId());
                Player m = Bukkit.getPlayer(to.getMaster());
                if (m != null) m.sendMessage(Component.text("[국가] 국가 «" + n.name() + "»이(가) 길드 ‹" + to.getName() + "›을(를) 초대했어요 — /나라 수락 " + n.name(), NamedTextColor.GOLD));
                p.sendMessage(Component.text("길드 ‹" + to.getName() + "›에 국가 초대를 보냈어요", NamedTextColor.GREEN));
                return null;
            }
            case "수락", "거절" -> {
                if (!master) return "길드장만 할 수 있습니다";
                Integer target = null;
                try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT id FROM rpg_nations WHERE name = ?")) {
                    ps.setString(1, arg);
                    try (ResultSet rs = ps.executeQuery()) { if (rs.next()) target = rs.getInt(1); }
                } catch (SQLException ignored) {}
                if (target == null || !invites.getOrDefault(target, Set.of()).contains(g.getId())) return "받은 국가 초대가 없거나 기한이 지났습니다";
                invites.get(target).remove(g.getId());
                if (args[0].equals("거절")) return null;
                if (n != null) return "이미 국가에 속해 있습니다";
                exec("MERGE INTO rpg_guild_nation (guild, nation) KEY (guild) VALUES (?,?)", g.getId(), target);
                nationCache.clear();
                say(target, "길드 ‹" + g.getName() + "›이(가) 국가에 들어왔어요");
                return null;
            }
            case "나가기" -> {
                if (n == null) return "국가에 속해 있지 않습니다";
                if (!master) return "길드장만 할 수 있습니다";
                if (n.ruler() == g.getId()) return "군주 길드는 국가를 해산해야 나갈 수 있습니다";
                exec("DELETE FROM rpg_guild_nation WHERE guild = ?", g.getId());
                nationCache.clear();
                say(n.id(), "길드 ‹" + g.getName() + "›이(가) 국가를 떠났어요");
                return null;
            }
            case "추방" -> {
                if (!ruler) return "군주만 할 수 있습니다";
                Guild to = plugin.core().getGuilds().byName(arg);
                if (to == null || !n.equals(nation(nationIdOf(to.getId()) == null ? -1 : nationIdOf(to.getId()))) || to.getId() == g.getId()) return "우리 국가의 다른 길드가 아닙니다";
                exec("DELETE FROM rpg_guild_nation WHERE guild = ?", to.getId());
                nationCache.clear();
                say(n.id(), "길드 ‹" + to.getName() + "›이(가) 국가에서 추방되었어요");
                return null;
            }
            case "공지" -> {
                if (!ruler) return "군주만 할 수 있습니다";
                String text = arg.replaceAll("\\s+", " ");
                int max = cfg.get("nationNoticeMax").getAsInt();
                exec("UPDATE rpg_nations SET notice = ? WHERE id = ?", text.length() > max ? text.substring(0, max) : text, n.id());
                say(n.id(), "공지: " + text);
                return null;
            }
            case "해산" -> {
                if (!ruler) return "군주만 해산할 수 있습니다";
                say(n.id(), "국가 «" + n.name() + "»이(가) 해산되었습니다");
                exec("DELETE FROM rpg_guild_nation WHERE nation = ?", n.id());
                exec("DELETE FROM rpg_nations WHERE id = ?", n.id());
                invites.remove(n.id());
                nationCache.clear();
                return null;
            }
            case "정산" -> {   // GM: 이번 주 영향력으로 바로 영주 정하기 (시험)
                if (!p.hasPermission("rucrpg.admin")) return "권한이 없습니다";
                RucRpg.WRITER.execute(() -> settle(true));
                return null;
            }
            default -> { return "/나라 <세우기|초대|수락|거절|나가기|추방|공지|해산> · /ㄴ <말>"; }
        }
    }

    /** 국가의 모든 길드의 접속한 길드원에게 */
    private void say(int nid, String text) {
        Nation n = nation(nid);
        if (n == null) return;
        Component msg = Component.text("[국가 «" + n.name() + "»] ", NamedTextColor.GOLD).append(Component.text(text, NamedTextColor.WHITE));
        for (int gid : nationGuilds(nid)) {
            Guild g = guild(gid);
            if (g == null) continue;
            for (GuildMember m : g.members()) { Player q = Bukkit.getPlayer(m.getUuid()); if (q != null) q.sendMessage(msg); }
        }
    }

    /** 국가 채팅 (/ㄴ) */
    public String chat(Player p, String text) {
        Guild g = guildOf(p.getUniqueId());
        Integer nid = g == null ? null : nationIdOf(g.getId());
        if (nid == null) return "국가에 속해 있지 않습니다 (/영지)";
        say(nid, p.getName() + ": " + text);
        plugin.getLogger().info("[국가채팅 " + nid + "] " + p.getName() + ": " + text);
        return null;
    }
}
