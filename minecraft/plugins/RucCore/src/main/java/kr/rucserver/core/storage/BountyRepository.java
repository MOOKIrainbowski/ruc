package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * 평판 현상금 (2026-10-09, docs/08 A).
 *
 *  - ruc_bounty_pool  : 현상금 풀 한 줄 (id = 1). 제재로 몰수된 Gold 가 쌓입니다 (SanctionService).
 *  - ruc_bounty_claim : 수배자 처치 기록 — 처치당한 수배자는 하루 동안 다시 현상금이 안 붙습니다.
 *
 * 4개 서버가 같은 DB 라 Core 가 소유하고, 약탈(RucRaid)이 빌려 씁니다. 블로킹 I/O.
 */
public class BountyRepository {

    private final Database database;

    public BountyRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS ruc_bounty_pool (
                        id      INT    PRIMARY KEY,
                        amount  BIGINT NOT NULL
                    )
                    """);
            st.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS ruc_bounty_claim (
                        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                        target      VARCHAR(36) NOT NULL,
                        target_name VARCHAR(16) NOT NULL,
                        killer      VARCHAR(36) NOT NULL,
                        killer_name VARCHAR(16) NOT NULL,
                        amount      BIGINT      NOT NULL,
                        claimed_at  BIGINT      NOT NULL
                    )
                    """);
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_bounty_claim_target ON ruc_bounty_claim (target, claimed_at)");
            // 처음 한 번만 0 으로 — 이미 있으면 그대로 (재기동 때 풀이 초기화되면 안 됨).
            st.executeUpdate("INSERT IGNORE INTO ruc_bounty_pool (id, amount) VALUES (1, 0)");
        }
    }

    public long pool() throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT amount FROM ruc_bounty_pool WHERE id = 1");
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0;
        }
    }

    public void addToPool(long amount) throws SQLException {
        if (amount <= 0) return;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement("UPDATE ruc_bounty_pool SET amount = amount + ? WHERE id = 1")) {
            ps.setLong(1, amount);
            ps.executeUpdate();
        }
    }

    /** 풀에서 amount 를 뺍니다. 모자라면(동시에 다른 서버가 먼저 뺀 경우) false — 조건부 UPDATE 라 음수가 되지 않습니다. */
    public boolean takeFromPool(long amount) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE ruc_bounty_pool SET amount = amount - ? WHERE id = 1 AND amount >= ?")) {
            ps.setLong(1, amount);
            ps.setLong(2, amount);
            return ps.executeUpdate() == 1;
        }
    }

    /** since 이후 target 이 수배자로 처치당한 적이 있는지 */
    public boolean claimedSince(UUID target, long since) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT 1 FROM ruc_bounty_claim WHERE target = ? AND claimed_at >= ?")) {
            ps.setString(1, target.toString());
            ps.setLong(2, since);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    public void insertClaim(UUID target, String targetName, UUID killer, String killerName, long amount, long at)
            throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement("""
                     INSERT INTO ruc_bounty_claim (target, target_name, killer, killer_name, amount, claimed_at)
                     VALUES (?, ?, ?, ?, ?, ?)
                     """)) {
            ps.setString(1, target.toString());
            ps.setString(2, targetName);
            ps.setString(3, killer.toString());
            ps.setString(4, killerName);
            ps.setLong(5, amount);
            ps.setLong(6, at);
            ps.executeUpdate();
        }
    }
}
