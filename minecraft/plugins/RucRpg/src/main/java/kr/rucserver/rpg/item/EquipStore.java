package kr.rucserver.rpg.item;

import kr.rucserver.core.storage.Database;
import org.bukkit.inventory.ItemStack;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 마크에 칸이 없는 장비 칸 (웹 EQUIP_SLOTS 중 장갑 · 망토 · 반지 2 · 목걸이 · 귀걸이 · 시계 · 인형 · 코스튬 · 헤어).
 * 투구 · 흉갑 · 바지 · 신발 = 바닐라 방어구 칸, 무기 = 손에 든 것, 보조무기 = 왼손 — 그건 여기 없음.
 * 아이템은 ItemStack 바이트 그대로 저장 (PDC 포함) — 한 칸 = 한 줄, 바꿀 때마다 그 줄만.
 */
public final class EquipStore {

    public static final String[] SLOTS = {"gloves", "cape", "ring1", "ring2", "necklace", "earring", "watch", "doll", "costumeTop", "costumeBottom", "hair"};

    private final Database db;
    private final Map<UUID, Map<String, ItemStack>> cache = new ConcurrentHashMap<>();

    public EquipStore(Database db) { this.db = db; }

    public void createSchema() throws SQLException {
        try (Connection c = db.getConnection(); Statement s = c.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS rpg_equip (uuid VARCHAR(36) NOT NULL, slot VARCHAR(16) NOT NULL, item BLOB NOT NULL, PRIMARY KEY (uuid, slot))");
        }
    }

    /** 접속 때 (비동기에서 불러도 됨) */
    public void load(UUID id) throws SQLException {
        Map<String, ItemStack> m = new LinkedHashMap<>();
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT slot, item FROM rpg_equip WHERE uuid = ?")) {
            ps.setString(1, id.toString());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) m.put(rs.getString(1), ItemStack.deserializeBytes(rs.getBytes(2)));
            }
        }
        cache.put(id, m);
    }

    public Map<String, ItemStack> of(UUID id) { return cache.getOrDefault(id, Map.of()); }

    public void forget(UUID id) { cache.remove(id); }

    /** 칸 바꾸기 — 메모리 즉시, DB 는 호출한 쪽이 비동기로 (save) */
    public void set(UUID id, String slot, ItemStack it) {
        Map<String, ItemStack> m = cache.computeIfAbsent(id, k -> new LinkedHashMap<>());
        if (it == null || it.getType().isAir()) m.remove(slot); else m.put(slot, it.clone());
    }

    /** 저장은 한 줄로 세운 스레드에서 차례대로 — 늦게 끝난 옛 저장이 새 값을 덮지 않게 (Codex 리뷰 4) */
    private final java.util.concurrent.ExecutorService writer = java.util.concurrent.Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "RucRpg-equip"); t.setDaemon(true); return t; });

    /** 지금 메모리 값을 찍어 두고(주 스레드) 순서대로 한 트랜잭션에 씀 */
    public void saveQueued(UUID id, String slot, java.util.logging.Logger log) {
        ItemStack it = of(id).get(slot);
        byte[] bytes = it == null ? null : it.serializeAsBytes();
        writer.execute(() -> {
            try (Connection c = db.getConnection()) {
                c.setAutoCommit(false);
                try {
                    try (PreparedStatement del = c.prepareStatement("DELETE FROM rpg_equip WHERE uuid = ? AND slot = ?")) {
                        del.setString(1, id.toString());
                        del.setString(2, slot);
                        del.executeUpdate();
                    }
                    if (bytes != null) try (PreparedStatement ins = c.prepareStatement("INSERT INTO rpg_equip (uuid, slot, item) VALUES (?, ?, ?)")) {
                        ins.setString(1, id.toString());
                        ins.setString(2, slot);
                        ins.setBytes(3, bytes);
                        ins.executeUpdate();
                    }
                    c.commit();
                } catch (SQLException e) { c.rollback(); throw e; }
            } catch (SQLException e) { log.warning("장비 저장 실패 (" + id + " " + slot + "): " + e.getMessage()); }
        });
    }
}
