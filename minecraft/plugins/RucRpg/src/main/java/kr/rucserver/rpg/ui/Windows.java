package kr.rucserver.rpg.ui;

import io.papermc.paper.event.player.AsyncChatEvent;
import kr.rucserver.core.storage.Database;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
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
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.SkullMeta;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * 설정 · GM · 파티 창 (웹 SettingsModal · Ops(F8) · Party.tsx).
 * 설정: 마크에서 서버가 정할 수 있는 것만 — 피해 숫자 · 미니맵 · 스탯 표 (화질 · 키 · 소리는 마크 클라이언트 설정). 계정별 저장(rpg_settings).
 * GM 창: 접속자 → 회복 · 무적 · 자원 무소모 · 이동 배율 · 레벨 · Gold · 옆으로/불러오기 · 정보, 그리고 영지 정산 · 공지.
 *   채팅 금지 · 차단 · 추방은 RucCore 제재(/rucsanction · /kick)가 원본 — 여기서 새로 만들지 않음(기존 그대로).
 */
public final class Windows implements Listener {

    public record Prefs(boolean damageNumbers, boolean minimap, boolean stats) {
        static final Prefs DEFAULT = new Prefs(true, true, true);
    }

    private final RucRpg plugin;
    private final Database db;
    private final Map<UUID, Prefs> prefs = new ConcurrentHashMap<>();
    private final Map<UUID, Consumer<String>> asking = new ConcurrentHashMap<>();

    public Windows(RucRpg plugin, Database db) throws SQLException {
        this.plugin = plugin;
        this.db = db;
        try (Connection c = db.getConnection(); Statement s = c.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS rpg_settings (uuid VARCHAR(36) PRIMARY KEY, dmg BOOLEAN NOT NULL, minimap BOOLEAN NOT NULL, stats BOOLEAN NOT NULL)");
        }
    }

    public Prefs prefs(UUID id) { return prefs.getOrDefault(id, Prefs.DEFAULT); }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        UUID id = e.getPlayer().getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT dmg, minimap, stats FROM rpg_settings WHERE uuid = ?")) {
                ps.setString(1, id.toString());
                try (ResultSet rs = ps.executeQuery()) { if (rs.next()) prefs.put(id, new Prefs(rs.getBoolean(1), rs.getBoolean(2), rs.getBoolean(3))); else prefs.remove(id); }
            } catch (SQLException ignored) {}
            Bukkit.getScheduler().runTaskLater(plugin, () -> apply(id), 40L);
        });
    }

    /** 스탯 표는 PlayerUnit 에 (HUD 가 봄) */
    private void apply(UUID id) {
        Player p = Bukkit.getPlayer(id);
        PlayerUnit u = p == null ? null : plugin.runtime().unit(p);
        if (u != null) u.showStats = prefs(id).stats();
    }

    private void save(UUID id, Prefs v) {
        prefs.put(id, v);
        apply(id);
        RucRpg.WRITER.execute(() -> {
            try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("MERGE INTO rpg_settings (uuid, dmg, minimap, stats) KEY (uuid) VALUES (?,?,?,?)")) {
                ps.setString(1, id.toString()); ps.setBoolean(2, v.damageNumbers()); ps.setBoolean(3, v.minimap()); ps.setBoolean(4, v.stats()); ps.executeUpdate();
            } catch (SQLException e) { plugin.getLogger().warning("설정 저장 실패: " + e.getMessage()); }
        });
    }

    // ── 설정 ────────────────────────────────────────────────────────

    public void settings(Player p) {
        Prefs v = prefs(p.getUniqueId());
        Gui g = new Gui(3, Component.text("설정", NamedTextColor.DARK_GRAY));
        g.onBack = () -> plugin.menus().main(p);
        for (int i = 0; i < 27; i++) g.set(i, Gui.filler(), null);
        g.set(11, Gui.button("피해 숫자: " + (v.damageNumbers() ? "켬" : "끔"), v.damageNumbers(), List.of(Gui.gray("때리고 맞을 때 떠오르는 숫자"))),
                (pl, t) -> { save(pl.getUniqueId(), new Prefs(!v.damageNumbers(), v.minimap(), v.stats())); settings(pl); });
        g.set(13, Gui.button("미니맵: " + (v.minimap() ? "켬" : "끔"), v.minimap(), List.of(Gui.gray("오른쪽 위 지도"))),
                (pl, t) -> { save(pl.getUniqueId(), new Prefs(v.damageNumbers(), !v.minimap(), v.stats())); settings(pl); });
        g.set(15, Gui.button("스탯 표: " + (v.stats() ? "켬" : "끔"), v.stats(), List.of(Gui.gray("마나 구슬 왼쪽 8줄"))),
                (pl, t) -> { save(pl.getUniqueId(), new Prefs(v.damageNumbers(), v.minimap(), !v.stats())); settings(pl); });
        g.set(22, Gui.icon(Material.BOOK, null, Component.text("그 밖의 설정", NamedTextColor.WHITE), List.of(Gui.gray("화질 · 키 · 소리 = 마크 클라이언트 설정(Esc → 설정)"), Gui.gray("GUI 크기를 바꾸면 HUD 도 같이 커져요"))), null);
        g.open(p);
    }

    // ── 채팅으로 한 줄 받기 ─────────────────────────────────────────

    private void ask(Player p, String prompt, Consumer<String> then) {
        asking.put(p.getUniqueId(), then);
        p.closeInventory();
        p.sendMessage(Component.text(prompt + " ('취소' = 그만두기)", TextColor.color(0xF2C94C)));
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onChat(AsyncChatEvent e) {
        Consumer<String> then = asking.remove(e.getPlayer().getUniqueId());
        if (then == null) return;
        e.setCancelled(true);
        String text = PlainTextComponentSerializer.plainText().serialize(e.message()).trim();
        if (!text.equals("취소")) Bukkit.getScheduler().runTask(plugin, () -> then.accept(text));
    }

    // ── 파티 창 ─────────────────────────────────────────────────────

    private static ItemStack head(Player who, Component name, List<Component> lore) {
        ItemStack it = Gui.icon(Material.PLAYER_HEAD, null, name, lore);
        if (it.getItemMeta() instanceof SkullMeta m) { m.setOwningPlayer(who); it.setItemMeta(m); }
        return it;
    }

    public void party(Player p) {
        var party = plugin.parties().of(p);
        Gui g = new Gui(3, Component.text(party == null ? "파티 — 아직 없음" : "파티 " + party.members.size() + "명", NamedTextColor.DARK_GRAY));
        g.onBack = () -> plugin.menus().main(p);
        for (int i = 0; i < 27; i++) g.set(i, Gui.filler(), null);
        boolean leader = party != null && party.leader.equals(p.getUniqueId());
        if (party != null) {
            int pos = 0;
            for (UUID id : party.members) {
                Player m = Bukkit.getPlayer(id);
                PlayerUnit u = m == null ? null : plugin.runtime().unit(m);
                List<Component> lore = new ArrayList<>();
                if (u == null) lore.add(Gui.gray("접속 안 함"));
                else {
                    lore.add(Gui.line("Lv." + u.ch.level + " · 체력 " + Math.round(u.hp) + "/" + Math.round(u.st.get("hp")), NamedTextColor.WHITE));
                    lore.add(Gui.gray(plugin.worlds().kindOf(m.getWorld()) == null ? m.getWorld().getName() : kr.rucserver.rpg.world.RpgWorlds.NAMES.getOrDefault(plugin.worlds().kindOf(m.getWorld()), "")));
                }
                boolean isLeader = id.equals(party.leader);
                if (leader && !isLeader) lore.add(Gui.line("클릭: 파티장 넘기기 · Shift 클릭: 추방", NamedTextColor.YELLOW));
                String name = m != null ? m.getName() : Bukkit.getOfflinePlayer(id).getName();
                ItemStack icon = m != null ? head(m, Component.text((isLeader ? "★ " : "") + name, isLeader ? TextColor.color(0xF2C94C) : NamedTextColor.WHITE, TextDecoration.BOLD), lore)
                        : Gui.icon(Material.SKELETON_SKULL, null, Component.text(String.valueOf(name), NamedTextColor.GRAY), lore);
                g.set(10 + pos++, icon, leader && !isLeader ? (pl, t) -> { if (t.isShiftClick()) plugin.parties().kick(pl, name); else plugin.parties().promote(pl, name); party(pl); } : null);
            }
        }
        g.set(19, Gui.button("초대하기", false, List.of(Gui.gray("닉네임을 채팅으로"))), (pl, t) -> ask(pl, "[파티] 초대할 닉네임을 입력하세요", s -> { plugin.parties().invite(pl, Bukkit.getPlayerExact(s)); }));
        if (party != null) g.set(21, Gui.button("나가기", false, List.of()), (pl, t) -> { plugin.parties().leave(pl); party(pl); });
        if (leader) g.set(23, Gui.button("해산", false, List.of(Gui.gray("파티를 없앱니다"))), (pl, t) -> { plugin.parties().disband(pl); party(pl); });
        g.set(25, Gui.button("던전 (고목의 유적)", false, List.of(Gui.gray("파티장이 입장하면 같이 들어가요"))), (pl, t) -> { pl.closeInventory(); plugin.dungeons().enter(pl); });
        g.open(p);
    }

    // ── GM 창 ───────────────────────────────────────────────────────

    public void gm(Player p) {
        if (!p.hasPermission("rucrpg.admin")) { p.sendMessage(Component.text("권한이 없습니다", NamedTextColor.RED)); return; }
        Gui g = new Gui(6, Component.text("GM 창 — 접속자 " + Bukkit.getOnlinePlayers().size() + "명", NamedTextColor.DARK_GRAY));
        for (int i = 0; i < 54; i++) g.set(i, Gui.filler(), null);
        int pos = 0;
        for (Player o : Bukkit.getOnlinePlayers()) {
            if (pos >= 45) break;
            PlayerUnit u = plugin.runtime().unit(o);
            List<Component> lore = new ArrayList<>();
            lore.add(Gui.gray(u == null ? "캐릭터 없음" : "Lv." + u.ch.level + " · " + o.getWorld().getName() + " (" + o.getLocation().getBlockX() + ", " + o.getLocation().getBlockZ() + ")"));
            if (u != null) lore.add(Gui.gray("체력 " + Math.round(u.hp) + "/" + Math.round(u.st.get("hp")) + (u.gmInvuln ? " · 무적" : "") + (u.gmNoCost ? " · 무소모" : "")));
            lore.add(Gui.line("클릭: 이 사람 관리", NamedTextColor.YELLOW));
            g.set(pos++, head(o, Component.text(o.getName(), NamedTextColor.WHITE, TextDecoration.BOLD), lore), (pl, t) -> gmPlayer(pl, o.getUniqueId()));
        }
        g.set(47, Gui.button("영지 정산 (지금)", false, List.of(Gui.gray("이번 주 영향력 1위를 바로 영주로"))), (pl, t) -> { RucRpg.WRITER.execute(() -> plugin.realm().settle(true)); pl.sendMessage(Component.text("영지 정산을 했습니다", NamedTextColor.GREEN)); });
        g.set(49, Gui.button("공지", false, List.of(Gui.gray("모두에게 [운영] 공지"))), (pl, t) -> ask(pl, "[GM] 공지 내용을 입력하세요", s -> Bukkit.broadcast(Component.text("[운영] " + (s.length() > 120 ? s.substring(0, 120) : s), NamedTextColor.GOLD, TextDecoration.BOLD))));
        g.set(51, Gui.button("몹 소환 (내 자리)", false, List.of(Gui.gray("채팅: <몹 id> [레벨] [등급] [수]"))), (pl, t) -> ask(pl, "[GM] 몹 id [레벨] [등급] [수]", s -> pl.performCommand("rpgadmin spawn " + s)));
        g.open(p);
    }

    private void gmPlayer(Player p, UUID id) {
        Player o = Bukkit.getPlayer(id);
        PlayerUnit u = o == null ? null : plugin.runtime().unit(o);
        if (u == null) { p.sendMessage(Component.text("접속 중인 RPG 캐릭터가 아닙니다", NamedTextColor.RED)); gm(p); return; }
        Gui g = new Gui(3, Component.text("GM — " + o.getName(), NamedTextColor.DARK_GRAY));
        g.onBack = () -> gm(p);
        for (int i = 0; i < 27; i++) g.set(i, Gui.filler(), null);
        g.set(4, head(o, Component.text(o.getName() + " Lv." + u.ch.level, NamedTextColor.WHITE, TextDecoration.BOLD), List.of(
                Gui.gray("체력 " + Math.round(u.hp) + "/" + Math.round(u.st.get("hp")) + " · 마나 " + Math.round(u.mp) + "/" + Math.round(u.st.get("mana")) + " · 기력 " + Math.round(u.en) + "/" + Math.round(u.st.get("energy"))),
                Gui.gray(kr.rucserver.core.service.EconomyService.format(plugin.core().getEconomy().balance(o.getUniqueId())) + " " + plugin.core().getEconomy().symbol()))), null);
        g.set(10, Gui.button("회복", false, List.of(Gui.gray("체력 · 마나 · 기력 · 스태미나 가득"))), (pl, t) -> {
            u.hp = u.st.get("hp"); u.mp = u.st.get("mana"); u.en = u.st.get("energy"); u.stamina = u.st.get("stamina"); gmPlayer(pl, id);
        });
        g.set(11, Gui.button("무적: " + (u.gmInvuln ? "켬" : "끔"), u.gmInvuln, List.of()), (pl, t) -> { u.gmInvuln = !u.gmInvuln; gmPlayer(pl, id); });
        g.set(12, Gui.button("자원 무소모: " + (u.gmNoCost ? "켬" : "끔"), u.gmNoCost, List.of()), (pl, t) -> { u.gmNoCost = !u.gmNoCost; gmPlayer(pl, id); });
        g.set(13, Gui.button("레벨 +1", false, List.of(Gui.gray("Shift 클릭: +10"))), (pl, t) -> { plugin.runtime().setLevel(o, u.ch.level + (t.isShiftClick() ? 10 : 1)); gmPlayer(pl, id); });
        g.set(14, Gui.button("레벨 −1", false, List.of(Gui.gray("Shift 클릭: −10"))), (pl, t) -> { plugin.runtime().setLevel(o, Math.max(1, u.ch.level - (t.isShiftClick() ? 10 : 1))); gmPlayer(pl, id); });
        g.set(15, Gui.button("Gold +1000", false, List.of(Gui.gray("Shift 클릭: +10000 (원장 기록)"))), (pl, t) -> {
            long n = t.isShiftClick() ? 10000 : 1000;
            plugin.core().getEconomy().deposit(id, n);
            plugin.economy().ledger(o, "gm", n, "by " + pl.getName());
            gmPlayer(pl, id);
        });
        g.set(16, Gui.button("아이템 주기", false, List.of(Gui.gray("채팅: <아이템 id> [수] [희귀도]"))), (pl, t) -> ask(pl, "[GM] 아이템 id [수] [희귀도]", s -> pl.performCommand("rpgadmin give " + o.getName() + " " + s)));
        g.set(19, Gui.button("옆으로 가기", false, List.of()), (pl, t) -> { pl.closeInventory(); pl.teleport(o); });
        g.set(20, Gui.button("내 옆으로 부르기", false, List.of()), (pl, t) -> { pl.closeInventory(); o.teleport(pl); });
        g.set(22, Gui.button("이동 속도 ×" + (o.getWalkSpeed() > 0.21f ? "2" : "1"), o.getWalkSpeed() > 0.21f, List.of(Gui.gray("GM 이동 배율 (1 ↔ 2)"))),
                (pl, t) -> { o.setWalkSpeed(o.getWalkSpeed() > 0.21f ? 0.2f : 0.4f); gmPlayer(pl, id); });
        g.set(24, Gui.button("제재 (RucCore)", false, List.of(Gui.gray("채팅 금지 · 차단 = /rucsanction"), Gui.gray("추방 = /kick"))), null);
        g.open(p);
    }
}
