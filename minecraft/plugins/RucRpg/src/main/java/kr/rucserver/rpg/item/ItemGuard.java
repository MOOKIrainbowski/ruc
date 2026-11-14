package kr.rucserver.rpg.item;

import kr.rucserver.core.storage.Database;
import kr.rucserver.rpg.RucRpg;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.inventory.ItemStack;

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

/**
 * 장비 UID 원장 (Codex 리뷰 4 · 계획서 Claude 답변 1): 장비 하나 = UID 하나.
 *  - 한 사람 안(인벤토리 · 방어구 · 왼손 · 장비 칸)에 같은 UID 가 둘이면 → 뒤의 것을 지움.
 *  - 다른 사람이 지금 접속해 같은 UID 를 들고 있으면 → 원장의 주인 쪽을 남기고 이쪽을 지움 (복사본).
 *  - 주인이 접속해 있지 않으면 정상 이동(거래 · 우편 · 드롭)으로 보고 주인을 바꿈.
 * 지운 것은 서버 로그 + 원장(rpg_ledger "dup_removed")에 남김. 접속 · 창 닫기 · 1분마다 검사.
 * ponytail: 주인이 꺼져 있는 동안 생긴 복사본은 그 사람이 접속해 같은 UID 를 들 때만 잡힘 — 거래 쪽 권위 원장이 생기면 그쪽에서 막을 것.
 */
public final class ItemGuard implements Listener {

    private final RucRpg plugin;
    private final ItemService items;
    private final EquipStore equip;
    private final Database db;
    private final Map<String, UUID> holderCache = new HashMap<>();

    public ItemGuard(RucRpg plugin, ItemService items, EquipStore equip, Database db) {
        this.plugin = plugin;
        this.items = items;
        this.equip = equip;
        this.db = db;
        Bukkit.getScheduler().runTaskTimer(plugin, () -> { for (Player p : Bukkit.getOnlinePlayers()) scan(p); }, 20L * 60, 20L * 60);
    }

    public void createSchema() throws SQLException {
        try (Connection c = db.getConnection(); Statement s = c.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS rpg_item_uid (uid VARCHAR(36) PRIMARY KEY, holder VARCHAR(36) NOT NULL, seen_at BIGINT NOT NULL)");
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onClose(InventoryCloseEvent e) {
        if (e.getPlayer() instanceof Player p) Bukkit.getScheduler().runTask(plugin, () -> scan(p));
    }

    /** 다른 접속자가 이 UID 를 지금 들고 있나 */
    private boolean heldBy(UUID holder, String uid) {
        Player o = Bukkit.getPlayer(holder);
        if (o == null) return false;
        for (ItemStack it : o.getInventory().getContents()) { ItemService.Inst i = items.read(it); if (i != null && uid.equals(i.uid())) return true; }
        for (ItemStack it : equip.of(holder).values()) { ItemService.Inst i = items.read(it); if (i != null && uid.equals(i.uid())) return true; }
        return false;
    }

    public void scan(Player p) {
        if (!p.isOnline()) return;
        UUID me = p.getUniqueId();
        Set<String> seen = new HashSet<>();
        List<String> mine = new ArrayList<>();
        ItemStack[] inv = p.getInventory().getContents();
        for (int s = 0; s < inv.length; s++) {
            ItemService.Inst i = items.read(inv[s]);
            if (i == null || i.uid() == null) continue;
            if (!seen.add(i.uid())) { remove(p, s, i, "한 사람 안의 같은 UID"); continue; }
            UUID h = holderCache.get(i.uid());
            if (h != null && !h.equals(me) && heldBy(h, i.uid())) { remove(p, s, i, "다른 접속자(" + Bukkit.getOfflinePlayer(h).getName() + ")가 같은 UID 를 들고 있음"); continue; }
            mine.add(i.uid());
        }
        for (ItemStack it : equip.of(me).values()) { ItemService.Inst i = items.read(it); if (i != null && i.uid() != null && seen.add(i.uid())) mine.add(i.uid()); }
        for (String uid : mine) holderCache.put(uid, me);
        long now = System.currentTimeMillis();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try (Connection c = db.getConnection()) {
                for (String uid : mine) {
                    UUID prev = null;
                    try (PreparedStatement q = c.prepareStatement("SELECT holder FROM rpg_item_uid WHERE uid = ?")) {
                        q.setString(1, uid);
                        try (ResultSet rs = q.executeQuery()) { if (rs.next()) prev = UUID.fromString(rs.getString(1)); }
                    }
                    if (prev != null && !prev.equals(me)) {
                        UUID other = prev;
                        boolean conflict = Bukkit.getScheduler().callSyncMethod(plugin, () -> heldBy(other, uid)).get();
                        if (conflict) {
                            Bukkit.getScheduler().runTask(plugin, () -> {
                                ItemStack[] cur = p.getInventory().getContents();
                                for (int s = 0; s < cur.length; s++) { ItemService.Inst i = items.read(cur[s]); if (i != null && uid.equals(i.uid())) remove(p, s, i, "원장 주인(" + Bukkit.getOfflinePlayer(other).getName() + ")이 같은 UID 를 들고 있음"); }
                            });
                            continue;
                        }
                    }
                    try (PreparedStatement d = c.prepareStatement("DELETE FROM rpg_item_uid WHERE uid = ?")) { d.setString(1, uid); d.executeUpdate(); }
                    try (PreparedStatement ins = c.prepareStatement("INSERT INTO rpg_item_uid (uid, holder, seen_at) VALUES (?,?,?)")) {
                        ins.setString(1, uid); ins.setString(2, me.toString()); ins.setLong(3, now); ins.executeUpdate();
                    }
                }
            } catch (Exception e) { plugin.getLogger().warning("UID 원장 기록 실패: " + e.getMessage()); }
        });
    }

    private void remove(Player p, int slot, ItemService.Inst i, String why) {
        p.getInventory().setItem(slot, null);
        plugin.getLogger().warning("[복사 의심] " + p.getName() + " — " + i.tpl() + " uid=" + i.uid() + " 제거: " + why);
        if (plugin.economy() != null) plugin.economy().ledger(p, "dup_removed", 0, i.tpl() + " " + i.uid() + " " + why);
        p.sendMessage(Component.text("복사된 것으로 보이는 장비를 정리했습니다. 잘못되었다면 관리자에게 알려 주세요.", NamedTextColor.RED));
    }
}
