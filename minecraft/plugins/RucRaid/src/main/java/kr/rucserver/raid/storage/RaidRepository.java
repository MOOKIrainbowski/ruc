package kr.rucserver.raid.storage;

import kr.rucserver.core.storage.Database;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * 약탈 서버 전용 테이블.
 *
 *  - ruc_raid_pending : 전투 중 접속 종료 기록 (§2.4). 재접속 시 처형됩니다.
 *  - ruc_raid_state   : 드래곤 알 배치 여부 같은 서버당 하나짜리 상태값.
 *
 * /sethome 좌표(ruc_home)는 평화 서버와 공유하므로 Core 의 HomeRepository 가
 * 소유합니다 — 한 테이블에 주인이 둘이면 컬럼을 고칠 때 어느 쪽인지 알 수 없습니다.
 *
 * Core의 커넥션 풀을 그대로 빌려 씁니다. 같은 DB이므로 조인도 가능합니다.
 */
public class RaidRepository {

    private final Database database;

    public RaidRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String pending = """
                CREATE TABLE IF NOT EXISTS ruc_raid_pending (
                    uuid       VARCHAR(36) NOT NULL,
                    server_id  VARCHAR(16) NOT NULL,
                    logged_at  BIGINT      NOT NULL,
                    opponent   VARCHAR(16) NULL,
                    PRIMARY KEY (uuid, server_id)
                )
                """;

        String state = """
                CREATE TABLE IF NOT EXISTS ruc_raid_state (
                    server_id  VARCHAR(16)  NOT NULL,
                    k          VARCHAR(32)  NOT NULL,
                    v          VARCHAR(255) NULL,
                    PRIMARY KEY (server_id, k)
                )
                """;

        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(pending);
            st.executeUpdate(state);
        }
    }

    // ── 전투로그 처형 대기 ──────────────────────────────────────────────

    public void markPending(UUID uuid, String serverId, String opponent) throws SQLException {
        String sql = """
                INSERT INTO ruc_raid_pending (uuid, server_id, logged_at, opponent)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE logged_at = VALUES(logged_at), opponent = VALUES(opponent)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, serverId);
            ps.setLong(3, System.currentTimeMillis());
            ps.setString(4, opponent);
            ps.executeUpdate();
        }
    }

    /** 대기 중인 처형 기록. 없으면 null. */
    public Pending findPending(UUID uuid, String serverId) throws SQLException {
        String sql = "SELECT logged_at, opponent FROM ruc_raid_pending WHERE uuid = ? AND server_id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, serverId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                return new Pending(rs.getLong("logged_at"), rs.getString("opponent"));
            }
        }
    }

    public void clearPending(UUID uuid, String serverId) throws SQLException {
        String sql = "DELETE FROM ruc_raid_pending WHERE uuid = ? AND server_id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, serverId);
            ps.executeUpdate();
        }
    }

    public record Pending(long loggedAt, String opponent) {}

    // ── 서버 상태값 ────────────────────────────────────────────────────

    public String getState(String serverId, String key) throws SQLException {
        String sql = "SELECT v FROM ruc_raid_state WHERE server_id = ? AND k = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, serverId);
            ps.setString(2, key);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString("v") : null;
            }
        }
    }

    public void setState(String serverId, String key, String value) throws SQLException {
        String sql = """
                INSERT INTO ruc_raid_state (server_id, k, v) VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE v = VALUES(v)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, serverId);
            ps.setString(2, key);
            ps.setString(3, value);
            ps.executeUpdate();
        }
    }
}
