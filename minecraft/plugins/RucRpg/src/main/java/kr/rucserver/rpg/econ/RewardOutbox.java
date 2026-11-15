package kr.rucserver.rpg.econ;

import kr.rucserver.core.storage.Database;
import kr.rucserver.rpg.RucRpg;
import org.bukkit.Bukkit;
import org.bukkit.inventory.ItemStack;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 보상 우편함 outbox (Codex 리뷰 5): 퀘스트 · 던전 보상을 먼저 DB 에 적고(주 스레드, 짧은 INSERT), 보내는 쪽이 RucCore 우편의
 * sendRucOnce / sendItemOnce(사유 키로 한 번만)로 보낸 뒤 done 표시. 실패 · 서버 종료로 못 보낸 것은 접속 · 5분마다 다시 보냄.
 * 사유 키가 같으면 RucCore 가 두 번 넣지 않으므로 다시 보내도 안전(멱등).
 */
public final class RewardOutbox {

    public record Item(String tpl, String rarity, int qty) {}

    private final RucRpg plugin;
    private final Database db;
    private volatile boolean flushing;

    public RewardOutbox(RucRpg plugin, Database db) {
        this.plugin = plugin;
        this.db = db;
        Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> flush(null), 20L * 30, 20L * 300);
    }

    public void createSchema() throws SQLException {
        try (Connection c = db.getConnection(); Statement s = c.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS rpg_reward_outbox (id BIGINT AUTO_INCREMENT PRIMARY KEY, uuid VARCHAR(36) NOT NULL, reason VARCHAR(32) NOT NULL, sender VARCHAR(32) NOT NULL, "
                    + "gold BIGINT NOT NULL, tpl VARCHAR(48), rarity VARCHAR(16), qty INT NOT NULL, done BOOLEAN NOT NULL, created BIGINT NOT NULL, UNIQUE (uuid, reason))");
        }
    }

    /** 보상 적기 (사유 키 · 같은 (사람, 사유)는 한 줄만 — 다시 불려도 안전). 사유 키는 RucCore 제한 32자 */
    public void enqueue(UUID who, String reasonPrefix, String sender, long gold, List<Item> items) {
        List<Object[]> rows = new ArrayList<>();
        if (gold > 0) rows.add(new Object[]{reasonPrefix + ":g", gold, null, null, 0});
        for (int k = 0; k < items.size(); k++) rows.add(new Object[]{reasonPrefix + ":" + k, 0L, items.get(k).tpl(), items.get(k).rarity(), items.get(k).qty()});
        try (Connection c = db.getConnection(); PreparedStatement ins = c.prepareStatement(
                "INSERT INTO rpg_reward_outbox (uuid, reason, sender, gold, tpl, rarity, qty, done, created) SELECT ?,?,?,?,?,?,?,FALSE,? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM rpg_reward_outbox WHERE uuid = ? AND reason = ?)")) {
            for (Object[] r : rows) {
                String reason = trunc((String) r[0]);
                ins.setString(1, who.toString()); ins.setString(2, reason); ins.setString(3, trunc(sender));
                ins.setLong(4, (Long) r[1]); ins.setString(5, (String) r[2]); ins.setString(6, (String) r[3]); ins.setInt(7, (Integer) r[4]);
                ins.setLong(8, System.currentTimeMillis()); ins.setString(9, who.toString()); ins.setString(10, reason);
                ins.addBatch();
            }
            ins.executeBatch();
        } catch (SQLException e) {
            plugin.getLogger().severe("보상 outbox 기록 실패 (" + who + " " + reasonPrefix + "): " + e.getMessage());
        }
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> flush(who));
    }

    private static String trunc(String s) { return s.length() > 32 ? s.substring(0, 32) : s; }

    /** 남은 보상 보내기 (비동기에서 부름). who = null 이면 전부 */
    public void flush(UUID who) {
        if (flushing) return;
        flushing = true;
        try (Connection c = db.getConnection()) {
            List<Object[]> todo = new ArrayList<>();
            try (PreparedStatement q = c.prepareStatement("SELECT id, uuid, reason, sender, gold, tpl, rarity, qty FROM rpg_reward_outbox WHERE done = FALSE" + (who == null ? "" : " AND uuid = ?"))) {
                if (who != null) q.setString(1, who.toString());
                try (ResultSet rs = q.executeQuery()) {
                    while (rs.next()) todo.add(new Object[]{rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getString(6), rs.getString(7), rs.getInt(8)});
                }
            }
            var mail = plugin.core().getMailbox();
            for (Object[] r : todo) {
                UUID id = UUID.fromString((String) r[1]);
                String reason = (String) r[2], sender = (String) r[3];
                kr.rucserver.core.service.MailboxService.Result res;
                if ((Long) r[4] > 0) res = mail.sendRucOnce(id, (Long) r[4], sender, reason);
                else {
                    String tpl = (String) r[5], rar = (String) r[6];
                    int qty = (Integer) r[7];
                    if (plugin.items().tpl(tpl) == null) { mark(c, (Long) r[0]); continue; }
                    ItemStack stack = Bukkit.getScheduler().callSyncMethod(plugin, () -> plugin.items().create(tpl, rar, qty)).get();
                    res = mail.sendItemOnce(id, stack, sender, reason);
                }
                if (res == kr.rucserver.core.service.MailboxService.Result.OK || res == kr.rucserver.core.service.MailboxService.Result.EMPTY) mark(c, (Long) r[0]);
                else plugin.getLogger().warning("보상 우편 다시 시도 대기 (" + id + " " + reason + "): " + res);
            }
        } catch (Exception e) {
            plugin.getLogger().warning("보상 outbox 보내기 실패: " + e.getMessage());
        } finally {
            flushing = false;
        }
    }

    private static void mark(Connection c, long id) throws SQLException {
        try (PreparedStatement u = c.prepareStatement("UPDATE rpg_reward_outbox SET done = TRUE WHERE id = ?")) { u.setLong(1, id); u.executeUpdate(); }
    }
}
