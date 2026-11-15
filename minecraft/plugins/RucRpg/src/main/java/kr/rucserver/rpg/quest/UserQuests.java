package kr.rucserver.rpg.quest;

import com.google.gson.JsonObject;
import io.papermc.paper.event.player.AsyncChatEvent;
import kr.rucserver.core.storage.Database;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.econ.Economy;
import kr.rucserver.rpg.item.ItemService;
import kr.rucserver.rpg.ui.Gui;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 유저 퀘스트 게시판 (웹 server/quests.ts uq* · §19-3).
 * 등록: 보상 Gold × 인원 + 수수료 3% 를 먼저 내고(Economy.charge — op 원장), 보상 아이템(1명 한정 · 손에 든 것 하나)은 DB 행에 보관(에스크로).
 * 진행: 서버가 본 일만 — kill · stage(최고 스테이지) · duel(결투 승리) · collect(채집), deliver 는 게시판에서 [전달]로 물건을 냄.
 * 지급 · 반환은 전부 RewardOutbox(사유 키 멱등 · 재시도)로 RucCore 우편.
 * 마크 타협: 웹은 보상 아이템 3개까지 → 마크는 손에 든 한 묶음(창에서 칸을 고르는 대신). 제목은 채팅으로 입력.
 */
public final class UserQuests implements Listener {

    private record Row(long id, UUID owner, String ownerName, String title, String kind, String target, int n, long gold, int slots, int taken, int paid,
                       long expires, String status, byte[] item) {
        int left() { return slots - taken; }
    }

    /** 등록 창의 상태 */
    private static final class Draft {
        String kind = "kill", target, title;
        int n = 10, slots = 1, days = 7;
        long gold = 100;
        boolean hand;
    }

    private static final String[][] KINDS = {{"kill", "처치"}, {"collect", "채집"}, {"deliver", "전달"}, {"stage", "던전 스테이지"}, {"duel", "결투 승리"}};

    private final RucRpg plugin;
    private final Database db;
    private final JsonObject cfg;
    private final Map<UUID, Map<Long, Integer>> takes = new ConcurrentHashMap<>();
    private final Map<UUID, Draft> drafts = new HashMap<>();
    private final Map<UUID, Boolean> askingTitle = new ConcurrentHashMap<>();

    public UserQuests(RucRpg plugin, Database db) {
        this.plugin = plugin;
        this.db = db;
        this.cfg = plugin.data().file("quests").getAsJsonObject("USER_QUEST");
        Bukkit.getScheduler().runTaskTimer(plugin, this::sweep, 20L * 60, 20L * 60);
    }

    public void createSchema() throws SQLException {
        try (Connection c = db.getConnection(); Statement s = c.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS rpg_uquests (id BIGINT AUTO_INCREMENT PRIMARY KEY, owner VARCHAR(36) NOT NULL, owner_name VARCHAR(32) NOT NULL, title VARCHAR(48) NOT NULL, "
                    + "kind VARCHAR(12) NOT NULL, target VARCHAR(48) NOT NULL, n INT NOT NULL, gold BIGINT NOT NULL, slots INT NOT NULL, taken INT NOT NULL DEFAULT 0, paid INT NOT NULL DEFAULT 0, "
                    + "expires BIGINT NOT NULL, status VARCHAR(8) NOT NULL DEFAULT 'open', item BLOB, created BIGINT NOT NULL)");
            s.execute("CREATE TABLE IF NOT EXISTS rpg_uquest_takes (qid BIGINT NOT NULL, uuid VARCHAR(36) NOT NULL, prog INT NOT NULL DEFAULT 0, state VARCHAR(8) NOT NULL DEFAULT 'active', PRIMARY KEY (qid, uuid))");
        }
    }

    private int ci(String k) { return cfg.get(k).getAsInt(); }
    private long fee(long gold, int slots) { return (long) Math.ceil(gold * slots * cfg.get("feeRate").getAsDouble()); }
    private String sym() { return plugin.core().getEconomy().symbol(); }

    // ── DB ──────────────────────────────────────────────────────────

    private Row read(ResultSet rs) throws SQLException {
        return new Row(rs.getLong("id"), UUID.fromString(rs.getString("owner")), rs.getString("owner_name"), rs.getString("title"), rs.getString("kind"), rs.getString("target"),
                rs.getInt("n"), rs.getLong("gold"), rs.getInt("slots"), rs.getInt("taken"), rs.getInt("paid"), rs.getLong("expires"), rs.getString("status"), rs.getBytes("item"));
    }

    private Row row(long id) {
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT * FROM rpg_uquests WHERE id = ?")) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? read(rs) : null; }
        } catch (SQLException e) { plugin.getLogger().warning("유저 퀘스트 읽기 실패: " + e.getMessage()); return null; }
    }

    private List<Row> rows(String where, Object... args) {
        List<Row> out = new ArrayList<>();
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT * FROM rpg_uquests WHERE " + where + " ORDER BY id DESC")) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            try (ResultSet rs = ps.executeQuery()) { while (rs.next()) out.add(read(rs)); }
        } catch (SQLException e) { plugin.getLogger().warning("유저 퀘스트 목록 실패: " + e.getMessage()); }
        return out;
    }

    private int update(String sql, Object... args) {
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            return ps.executeUpdate();
        } catch (SQLException e) { plugin.getLogger().warning("유저 퀘스트 저장 실패: " + e.getMessage()); return 0; }
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        UUID id = e.getPlayer().getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            Map<Long, Integer> m = new LinkedHashMap<>();
            try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT qid, prog FROM rpg_uquest_takes WHERE uuid = ? AND state = 'active'")) {
                ps.setString(1, id.toString());
                try (ResultSet rs = ps.executeQuery()) { while (rs.next()) m.put(rs.getLong(1), rs.getInt(2)); }
            } catch (SQLException ex) { plugin.getLogger().warning("유저 퀘스트 받은 목록 실패: " + ex.getMessage()); }
            Bukkit.getScheduler().runTask(plugin, () -> {   // 주 스레드에서 합침 — 불러오는 사이 수락한 것은 지우지 않음 (Codex 리뷰 6)
                Map<Long, Integer> cur = takes.computeIfAbsent(id, k -> new LinkedHashMap<>());
                m.forEach(cur::putIfAbsent);
            });
        });
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) { takes.remove(e.getPlayer().getUniqueId()); drafts.remove(e.getPlayer().getUniqueId()); askingTitle.remove(e.getPlayer().getUniqueId()); }

    private Map<Long, Integer> takesOf(Player p) { return takes.computeIfAbsent(p.getUniqueId(), k -> new LinkedHashMap<>()); }

    // ── 표시 ────────────────────────────────────────────────────────

    private String targetName(String kind, String target) {
        return switch (kind) {
            case "kill" -> plugin.data().file("mobs").getAsJsonObject("MOBS").has(target) ? plugin.data().file("mobs").getAsJsonObject("MOBS").getAsJsonObject(target).get("name").getAsString() : target;
            case "collect", "deliver" -> plugin.items().tpl(target) != null ? plugin.items().tpl(target).get("name").getAsString() : target;
            case "stage" -> "고목의 유적";
            default -> "결투";
        };
    }

    private String goal(String kind, String target, int n) {
        return switch (kind) {
            case "kill" -> targetName(kind, target) + " " + n + "마리 처치";
            case "collect" -> targetName(kind, target) + " " + n + "개 채집";
            case "deliver" -> targetName(kind, target) + " " + n + "개 전달";
            case "stage" -> "고목의 유적 " + n + "단계 도달";
            default -> "결투 " + n + "번 승리";
        };
    }

    // ── 게시판 ──────────────────────────────────────────────────────

    public void board(Player p) {
        long now = System.currentTimeMillis();
        List<Row> open = rows("status = 'open' AND expires > ?", now);
        Map<Long, Integer> mine = takesOf(p);
        Gui g = new Gui(6, Component.text("유저 퀘스트 게시판", NamedTextColor.DARK_GRAY));
        g.onBack = () -> plugin.quests().journal(p);
        for (int i = 0; i < 54; i++) g.set(i, Gui.filler(), null);
        int pos = 0;
        for (Row r : open) {
            if (pos >= 45) break;
            boolean own = r.owner().equals(p.getUniqueId()), joined = mine.containsKey(r.id());
            List<Component> lore = new ArrayList<>();
            lore.add(Gui.line(goal(r.kind(), r.target(), r.n()), NamedTextColor.WHITE));
            lore.add(Gui.gray("올린 사람 " + r.ownerName() + " · 남은 자리 " + r.left() + "/" + r.slots() + " · " + Math.max(1, (r.expires() - now) / 3_600_000) + "시간 남음"));
            String reward = (r.gold() > 0 ? r.gold() + " " + sym() : "") + (r.item() != null ? (r.gold() > 0 ? " + " : "") + itemName(r.item()) : "");
            lore.add(Gui.line("보상: " + reward, TextColor.color(0xF2C94C)));
            Gui.Click click;
            if (own) {
                lore.add(Gui.line("내가 올린 퀘스트 — 웅크리고(Shift) 클릭: 내리기(남은 보상 반환)", NamedTextColor.YELLOW));
                click = (pl, t) -> { if (t.isShiftClick()) say(pl, cancel(pl, r.id())); board(pl); };
            } else if (joined) {
                lore.add(Gui.line("진행 " + mine.get(r.id()) + "/" + r.n(), NamedTextColor.GREEN));
                lore.add(Gui.line(r.kind().equals("deliver") ? "클릭: 전달하기 · Shift 클릭: 포기" : "Shift 클릭: 포기", NamedTextColor.YELLOW));
                click = (pl, t) -> { say(pl, t.isShiftClick() ? abandon(pl, r.id()) : r.kind().equals("deliver") ? deliver(pl, r.id()) : null); board(pl); };
            } else {
                lore.add(Gui.line("클릭: 수락", NamedTextColor.YELLOW));
                click = (pl, t) -> { say(pl, accept(pl, r.id())); board(pl); };
            }
            Material icon = own ? Material.WRITABLE_BOOK : joined ? Material.ENCHANTED_BOOK : Material.PAPER;
            g.set(pos++, Gui.icon(icon, "ui/quest", Component.text((joined ? "◆ " : "") + r.title(), joined ? NamedTextColor.GREEN : TextColor.color(0xF3D9A4), TextDecoration.BOLD), lore), click);
        }
        if (open.isEmpty()) g.set(22, Gui.icon(Material.MAP, null, Component.text("아직 올라온 퀘스트가 없어요", NamedTextColor.GRAY), List.of(Gui.gray("아래 [퀘스트 올리기]로 첫 의뢰를 올려 보세요"))), null);
        g.set(49, Gui.button("퀘스트 올리기", false, List.of(Gui.gray("보상 " + sym() + " × 인원 + 수수료 3%"), Gui.gray("동시에 " + ci("maxActive") + "건까지"))), (pl, t) -> create(pl));
        g.open(p);
    }

    private String itemName(byte[] b) {
        try {
            ItemStack it = ItemStack.deserializeBytes(b);
            Component n = it.getItemMeta() != null && it.getItemMeta().hasDisplayName() ? it.getItemMeta().displayName() : Component.translatable(it.translationKey());
            return PlainTextComponentSerializer.plainText().serialize(n) + (it.getAmount() > 1 ? " ×" + it.getAmount() : "");
        } catch (Exception e) { return "아이템"; }
    }

    private static void say(Player p, String err) {
        if (err != null) p.sendMessage(Component.text(err, NamedTextColor.RED));
    }

    // ── 올리기 (마법사 창) ───────────────────────────────────────────

    private List<String> targets(String kind) {
        List<String> out = new ArrayList<>();
        switch (kind) {
            case "kill" -> out.addAll(plugin.data().file("mobs").getAsJsonObject("MOBS").keySet());
            case "collect" -> { for (var e : plugin.data().file("quests").getAsJsonArray("COLLECT_CHOICES")) out.add(e.getAsJsonArray().get(0).getAsString()); }
            case "deliver" -> { for (String id : plugin.items().templateIds()) if (ItemService.stackable(plugin.items().tpl(id))) out.add(id); }
            case "stage" -> out.add("ruins");
            default -> out.add("duel");
        }
        return out;
    }

    public void create(Player p) {
        Draft d = drafts.computeIfAbsent(p.getUniqueId(), k -> new Draft());
        List<String> ts = targets(d.kind);
        if (d.target == null || !ts.contains(d.target)) d.target = ts.get(0);
        Gui g = new Gui(6, Component.text("퀘스트 올리기", NamedTextColor.DARK_GRAY));
        g.onBack = () -> board(p);
        for (int i = 0; i < 54; i++) g.set(i, Gui.filler(), null);
        for (int i = 0; i < KINDS.length; i++) {
            String k = KINDS[i][0];
            g.set(1 + i, Gui.button(KINDS[i][1], d.kind.equals(k), List.of()), (pl, t) -> { d.kind = k; d.target = null; if (k.equals("stage")) d.n = Math.min(d.n, 10); create(pl); });
        }
        int ti = ts.indexOf(d.target);
        g.set(13, Gui.button("대상: " + targetName(d.kind, d.target), false, List.of(Gui.gray("클릭: 다음 · 오른쪽 클릭: 이전"), Gui.gray((ti + 1) + "/" + ts.size()))),
                (pl, t) -> { d.target = ts.get(Math.floorMod(ti + (t.isRightClick() ? -1 : 1), ts.size())); create(pl); });
        int maxN = d.kind.equals("stage") ? plugin.data().file("dungeons").getAsJsonObject("RUINS").getAsJsonArray("stages").size() : ci("maxN");
        adjuster(g, 19, "수량 " + d.n, v -> { d.n = (int) Math.max(1, Math.min(maxN, d.n + v)); create(p); }, 1, 10);
        adjuster(g, 28, "보상 " + d.gold + " " + sym() + " (1인당)", v -> { d.gold = Math.max(0, Math.min(cfg.get("maxRuc").getAsLong(), d.gold + v)); create(p); }, 10, 1000);
        adjuster(g, 37, "인원 " + d.slots + "명", v -> { d.slots = (int) Math.max(1, Math.min(ci("maxSlots"), d.slots + v)); if (d.slots > 1) d.hand = false; create(p); }, 1, 5);
        adjuster(g, 46, "기한 " + d.days + "일", v -> { d.days = (int) Math.max(1, Math.min(ci("maxDays"), d.days + v)); create(p); }, 1, 3);
        ItemStack hand = p.getInventory().getItemInMainHand();
        g.set(16, Gui.button("보상 아이템: " + (d.hand ? "손에 든 것" : "없음"), d.hand,
                List.of(Gui.gray("손에 든 아이템 한 묶음을 보상으로 맡김 (1명 한정)"), Gui.gray(hand.getType().isAir() ? "지금 손이 비어 있어요" : "지금 손: " + PlainTextComponentSerializer.plainText().serialize(hand.effectiveName())))),
                (pl, t) -> { d.hand = !d.hand && d.slots == 1; create(pl); });
        g.set(25, Gui.button("제목: " + (d.title == null ? "(채팅으로 입력)" : d.title), d.title != null, List.of(Gui.gray("클릭하면 창이 닫히고 채팅으로 2~24자 입력"))), (pl, t) -> {
            askingTitle.put(pl.getUniqueId(), true);
            g.onBack = null;
            pl.closeInventory();
            pl.sendMessage(Component.text("[퀘스트] 제목을 채팅으로 입력하세요 (2~24자, '취소' = 그만두기)", TextColor.color(0xF2C94C)));
        });
        long total = d.gold * d.slots + fee(d.gold, d.slots);
        g.set(43, Gui.button("올리기", true, List.of(Gui.line(goal(d.kind, d.target, d.n), NamedTextColor.WHITE), Gui.gray("낼 돈 " + total + " " + sym() + " (수수료 " + fee(d.gold, d.slots) + " 포함)"))), (pl, t) -> {
            String err = post(pl, d);
            if (err != null) { say(pl, err); create(pl); return; }
            drafts.remove(pl.getUniqueId());
            pl.sendMessage(Component.text("[퀘스트] 「" + d.title + "」을(를) 게시판에 올렸습니다", NamedTextColor.GREEN));
            board(pl);
        });
        g.open(p);
    }

    private interface Adjust { void by(long v); }

    /** [−큰][−][값][+][+큰] 한 줄 */
    private void adjuster(Gui g, int at, String label, Adjust a, long small, long big) {
        g.set(at, Gui.button("−" + big, false, List.of()), (pl, t) -> a.by(-big));
        g.set(at + 1, Gui.button("−" + small, false, List.of()), (pl, t) -> a.by(-small));
        g.set(at + 2, Gui.icon(Material.NAME_TAG, null, Component.text(label, NamedTextColor.WHITE, TextDecoration.BOLD), List.of()), null);
        g.set(at + 3, Gui.button("+" + small, false, List.of()), (pl, t) -> a.by(small));
        g.set(at + 4, Gui.button("+" + big, false, List.of()), (pl, t) -> a.by(big));
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onChat(AsyncChatEvent e) {
        UUID id = e.getPlayer().getUniqueId();
        if (askingTitle.remove(id) == null) return;
        e.setCancelled(true);
        String text = PlainTextComponentSerializer.plainText().serialize(e.message()).trim().replaceAll("\\s+", " ");
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player p = Bukkit.getPlayer(id);
            if (p == null) return;
            if (text.equals("취소")) { create(p); return; }
            Draft d = drafts.computeIfAbsent(id, k -> new Draft());
            if (text.length() < 2 || text.length() > 24) p.sendMessage(Component.text("제목은 2~24자로 써 주세요", NamedTextColor.RED));
            else d.title = text;
            create(p);
        });
    }

    private int activeCount(UUID owner) {
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT COUNT(*) FROM rpg_uquests WHERE owner = ? AND status = 'open'")) {
            ps.setString(1, owner.toString());
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? rs.getInt(1) : 0; }
        } catch (SQLException e) { return Integer.MAX_VALUE; }
    }

    /** 등록 (웹 uqCreate): 검사 → Gold 차감(charge) 안에서 DB 행 넣고 → 손 아이템을 뺌. 아이템이 바뀌었으면 행을 지우고 실패(환불) */
    private String post(Player p, Draft d) {
        if (d.title == null) return "제목을 입력해 주세요";
        if (!targets(d.kind).contains(d.target)) return "목표 대상이 올바르지 않습니다";
        if (d.gold <= 0 && !d.hand) return "보상이 비어 있습니다";
        if (d.hand && d.slots > 1) return "보상 아이템은 1명 한정 퀘스트에만 걸 수 있습니다";
        if (activeCount(p.getUniqueId()) >= ci("maxActive")) return "동시에 " + ci("maxActive") + "건까지 열 수 있습니다";
        ItemStack hand = d.hand ? p.getInventory().getItemInMainHand().clone() : null;
        if (d.hand && hand.getType().isAir()) return "손에 보상으로 걸 아이템을 들어 주세요";
        long total = d.gold * d.slots + fee(d.gold, d.slots);
        return plugin.economy().charge(p, total, "uq_create", d.title, () -> {
            long id;
            try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO rpg_uquests (owner, owner_name, title, kind, target, n, gold, slots, expires, item, created) VALUES (?,?,?,?,?,?,?,?,?,?,?)", Statement.RETURN_GENERATED_KEYS)) {
                ps.setString(1, p.getUniqueId().toString()); ps.setString(2, p.getName()); ps.setString(3, d.title); ps.setString(4, d.kind); ps.setString(5, d.target);
                ps.setInt(6, d.n); ps.setLong(7, d.gold); ps.setInt(8, d.slots); ps.setLong(9, System.currentTimeMillis() + d.days * 86_400_000L);
                ps.setBytes(10, hand == null ? null : hand.serializeAsBytes()); ps.setLong(11, System.currentTimeMillis());
                ps.executeUpdate();
                try (ResultSet k = ps.getGeneratedKeys()) { k.next(); id = k.getLong(1); }
            } catch (SQLException e) { throw new Economy.Fail("게시판에 올리지 못했습니다. 다시 시도해 주세요"); }
            if (hand != null) {
                if (!hand.equals(p.getInventory().getItemInMainHand())) { update("DELETE FROM rpg_uquests WHERE id = ?", id); throw new Economy.Fail("손에 든 아이템이 바뀌었습니다"); }
                p.getInventory().setItemInMainHand(null);
            }
        });
    }

    // ── 받기 · 포기 · 전달 · 내리기 ─────────────────────────────────

    private String accept(Player p, long id) {
        Row r = row(id);
        long now = System.currentTimeMillis();
        if (r == null || !r.status().equals("open") || r.expires() <= now) return "이미 마감된 퀘스트입니다";
        if (r.owner().equals(p.getUniqueId())) return "내가 올린 퀘스트는 받을 수 없습니다";
        Map<Long, Integer> mine = takesOf(p);
        if (mine.containsKey(id)) return "이미 받은 퀘스트입니다";
        if (mine.size() >= ci("maxTaken")) return "동시에 " + ci("maxTaken") + "건까지 받을 수 있습니다";
        try (Connection c = db.getConnection()) {
            c.setAutoCommit(false);
            try (PreparedStatement ex = c.prepareStatement("SELECT 1 FROM rpg_uquest_takes WHERE qid = ? AND uuid = ?")) {
                ex.setLong(1, id); ex.setString(2, p.getUniqueId().toString());
                try (ResultSet rs = ex.executeQuery()) { if (rs.next()) { c.rollback(); return "이미 받았던 퀘스트입니다"; } }
            }
            try (PreparedStatement u = c.prepareStatement("UPDATE rpg_uquests SET taken = taken + 1 WHERE id = ? AND status = 'open' AND taken < slots AND expires > ?")) {
                u.setLong(1, id); u.setLong(2, now);
                if (u.executeUpdate() != 1) { c.rollback(); return "자리가 다 찼습니다"; }
            }
            try (PreparedStatement ins = c.prepareStatement("INSERT INTO rpg_uquest_takes (qid, uuid) VALUES (?,?)")) {
                ins.setLong(1, id); ins.setString(2, p.getUniqueId().toString()); ins.executeUpdate();
            }
            c.commit();
        } catch (SQLException e) { plugin.getLogger().warning("유저 퀘스트 수락 실패: " + e.getMessage()); return "처리 중 문제가 생겼습니다"; }
        mine.put(id, 0);
        Player owner = Bukkit.getPlayer(r.owner());
        if (owner != null) owner.sendMessage(Component.text("[퀘스트] " + p.getName() + " 님이 「" + r.title() + "」을(를) 수락했습니다", TextColor.color(0xF2C94C)));
        return null;
    }

    private String abandon(Player p, long id) {
        if (!takesOf(p).containsKey(id)) return "받은 퀘스트가 아닙니다";
        boolean ok = tx(c -> {   // DB 가 바뀐 뒤에만 메모리에서 뺌 (Codex 리뷰 6)
            if (exec(c, "UPDATE rpg_uquest_takes SET state = 'dropped' WHERE qid = ? AND uuid = ? AND state = 'active'", id, p.getUniqueId().toString()) != 1) return false;
            exec(c, "UPDATE rpg_uquests SET taken = taken - 1 WHERE id = ?", id);
            return true;
        });
        if (!ok) return "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요";
        takesOf(p).remove(id);
        return null;
    }

    /** 서버가 본 일 (QuestEngine.quest 가 넘김) */
    public void progress(Player p, String type, String target, int n) {
        Map<Long, Integer> mine = takes.get(p.getUniqueId());
        if (mine == null || mine.isEmpty()) return;
        for (Map.Entry<Long, Integer> e : new ArrayList<>(mine.entrySet())) {
            Row r = row(e.getKey());
            if (r == null || !r.kind().equals(type) || (!type.equals("duel") && !r.target().equals(target))) continue;
            if (!r.status().equals("open") || r.expires() <= System.currentTimeMillis()) { mine.remove(r.id()); continue; }
            int prog = e.getValue(), now = type.equals("stage") ? Math.max(prog, n) : prog + (type.equals("collect") ? n : 1);
            if (now == prog) continue;
            mine.put(r.id(), now);
            long qid = r.id();
            String uid = p.getUniqueId().toString();
            RucRpg.WRITER.execute(() -> update("UPDATE rpg_uquest_takes SET prog = ? WHERE qid = ? AND uuid = ? AND state = 'active'", now, qid, uid));
            p.sendActionBar(Component.text("「" + r.title() + "」 " + Math.min(now, r.n()) + "/" + r.n(), TextColor.color(0xF2C94C)));
            if (now >= r.n()) finish(p, r);
        }
    }

    /** 완료 → 지급 (한 번만: take 상태 active → done 이 1행일 때만) */
    private void finish(Player p, Row r) {
        if (!tx(c -> exec(c, "UPDATE rpg_uquest_takes SET state = 'done' WHERE qid = ? AND uuid = ? AND state = 'active'", r.id(), p.getUniqueId().toString()) == 1 && payout(c, r, p.getUniqueId()))) return;
        plugin.outbox().kick(p.getUniqueId());
        takesOf(p).remove(r.id());
        p.sendMessage(Component.text("[퀘스트 완료] 유저 퀘스트 「" + r.title() + "」 — 보상은 우편함으로 보냈어요", TextColor.color(0x7CFC7C)));
        p.playSound(p.getLocation(), org.bukkit.Sound.UI_TOAST_CHALLENGE_COMPLETE, 0.7f, 1.3f);
        Player owner = Bukkit.getPlayer(r.owner());
        if (owner != null) owner.sendMessage(Component.text("[퀘스트] 「" + r.title() + "」을(를) " + p.getName() + " 님이 완수했습니다", TextColor.color(0xF2C94C)));
    }

    /** 지급: 같은 트랜잭션 안에서 paid +1 (마지막 자리면 닫음) + outbox 줄 — 어느 하나라도 실패하면 전부 되돌림 (Codex 리뷰 6) */
    private boolean payout(Connection c, Row r, UUID to) throws SQLException {
        exec(c, "UPDATE rpg_uquests SET paid = paid + 1, status = CASE WHEN paid + 1 >= slots THEN 'closed' ELSE status END WHERE id = ?", r.id());
        String key = "uq" + r.id() + ":" + to.toString().substring(0, 8);
        if (r.gold() > 0) plugin.outbox().insertTx(c, to, key + ":g", "유저 퀘스트", r.gold(), null);
        if (r.item() != null) plugin.outbox().insertTx(c, to, key + ":i", "유저 퀘스트", 0, ItemStack.deserializeBytes(r.item()));
        return true;
    }

    private interface Work { boolean run(Connection c) throws SQLException; }

    /** 한 트랜잭션 — run 이 false 거나 예외면 되돌림 */
    private boolean tx(Work w) {
        try (Connection c = db.getConnection()) {
            c.setAutoCommit(false);
            try {
                if (!w.run(c)) { c.rollback(); return false; }
                c.commit();
                return true;
            } catch (SQLException e) { c.rollback(); throw e; }
        } catch (SQLException e) { plugin.getLogger().warning("유저 퀘스트 트랜잭션 실패: " + e.getMessage()); return false; }
    }

    private static int exec(Connection c, String sql, Object... args) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            return ps.executeUpdate();
        }
    }

    /** 전달형: 인벤토리에서 n 개를 내면 등록자에게 우편으로, 받은 사람은 보상 */
    private String deliver(Player p, long id) {
        Row r = row(id);
        if (r == null || !takesOf(p).containsKey(id) || !r.kind().equals("deliver")) return "받은 전달 퀘스트가 아닙니다";
        if (!r.status().equals("open") || r.expires() <= System.currentTimeMillis()) return "이미 마감된 퀘스트입니다";
        if (plugin.economy().count(p, r.target()) < r.n()) return targetName("deliver", r.target()) + " 이(가) " + (r.n() - plugin.economy().count(p, r.target())) + "개 모자랍니다";
        JsonObject t = plugin.items().tpl(r.target());
        ItemStack goods = plugin.items().create(r.target(), t.has("rarity") ? t.get("rarity").getAsString() : "common", r.n());
        // DB(완료 · 지급 · 등록자에게 물품) 를 한 번에 확정한 뒤에만 인벤토리에서 뺌 — DB 가 실패하면 아무것도 안 바뀜
        boolean ok = tx(c -> exec(c, "UPDATE rpg_uquest_takes SET state = 'done' WHERE qid = ? AND uuid = ? AND state = 'active'", id, p.getUniqueId().toString()) == 1
                && payout(c, r, p.getUniqueId()) && insertGoods(c, r, p, goods));
        if (!ok) return "이미 처리되었거나 저장하지 못했습니다";
        plugin.economy().takeTpl(p, r.target(), r.n());
        p.saveData();
        plugin.outbox().kick(r.owner());
        plugin.outbox().kick(p.getUniqueId());
        takesOf(p).remove(id);
        p.sendMessage(Component.text("[퀘스트 완료] 「" + r.title() + "」 전달 완료 — 보상은 우편함으로 보냈어요", TextColor.color(0x7CFC7C)));
        return null;
    }

    private boolean insertGoods(Connection c, Row r, Player p, ItemStack goods) throws SQLException {
        plugin.outbox().insertTx(c, r.owner(), "uqd" + r.id() + ":" + p.getUniqueId().toString().substring(0, 8), "유저 퀘스트", 0, goods);
        return true;
    }

    /** 등록자가 내림 — 진행 중인 사람이 있으면 못 내림. 남은 보상은 우편으로 반환 */
    private String cancel(Player p, long id) {
        Row r = row(id);
        if (r == null || !r.owner().equals(p.getUniqueId())) return "내가 올린 퀘스트가 아닙니다";
        if (!rowsActiveTakes(id).isEmpty()) return "진행 중인 사람이 있어 내릴 수 없습니다 (기한이 끝나면 정리돼요)";
        return closeAndRefund(r) ? null : "이미 마감된 퀘스트입니다";
    }

    private List<String> rowsActiveTakes(long id) {
        List<String> out = new ArrayList<>();
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT uuid FROM rpg_uquest_takes WHERE qid = ? AND state = 'active'")) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) { while (rs.next()) out.add(rs.getString(1)); }
        } catch (SQLException e) { out.add("?"); }
        return out;
    }

    /** 닫기 + 남은 보상 반환을 한 트랜잭션으로 (Codex 리뷰 6) — paid 는 트랜잭션 안에서 다시 읽음 */
    private boolean closeAndRefund(Row r) {
        boolean ok = tx(c -> {
            if (exec(c, "UPDATE rpg_uquests SET status = 'closed' WHERE id = ? AND status = 'open'", r.id()) != 1) return false;
            int paid;
            try (PreparedStatement ps = c.prepareStatement("SELECT paid FROM rpg_uquests WHERE id = ?")) {
                ps.setLong(1, r.id());
                try (ResultSet rs = ps.executeQuery()) { rs.next(); paid = rs.getInt(1); }
            }
            int left = r.slots() - paid;
            if (left > 0 && r.gold() > 0) plugin.outbox().insertTx(c, r.owner(), "uqr" + r.id() + ":g", "유저 퀘스트", r.gold() * left, null);
            if (left > 0 && r.item() != null) plugin.outbox().insertTx(c, r.owner(), "uqr" + r.id() + ":i", "유저 퀘스트", 0, ItemStack.deserializeBytes(r.item()));
            return true;
        });
        if (ok) plugin.outbox().kick(r.owner());
        return ok;
    }

    /** 기한 지난 퀘스트 정리 (1분마다): 진행 중인 사람은 포기 처리 → 남은 보상 반환 */
    private void sweep() {
        for (Row r : rows("status = 'open' AND expires <= ?", System.currentTimeMillis())) {
            for (String u : rowsActiveTakes(r.id())) {
                update("UPDATE rpg_uquest_takes SET state = 'dropped' WHERE qid = ? AND uuid = ?", r.id(), u);
                Map<Long, Integer> m = takes.get(UUID.fromString(u));
                if (m != null) m.remove(r.id());
            }
            if (closeAndRefund(r)) {
                Player o = Bukkit.getPlayer(r.owner());
                if (o != null) o.sendMessage(Component.text("[퀘스트] 「" + r.title() + "」 기한이 끝났습니다. 남은 보상은 우편으로 돌아갑니다", NamedTextColor.GRAY));
            }
        }
    }
}
