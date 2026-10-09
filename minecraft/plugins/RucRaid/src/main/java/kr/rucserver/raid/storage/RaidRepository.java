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
 *  - ruc_raid_grave   : 도망자의 무덤 — 전투로그로 남긴 짐 (2026-10-09).
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

        String grave = """
                CREATE TABLE IF NOT EXISTS ruc_raid_grave (
                    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
                    server_id    VARCHAR(16)  NOT NULL,
                    owner        VARCHAR(36)  NOT NULL,
                    owner_name   VARCHAR(16)  NOT NULL,
                    opponent     VARCHAR(36)  NULL,
                    opponent_name VARCHAR(16) NULL,
                    world        VARCHAR(64)  NOT NULL,
                    x DOUBLE NOT NULL, y DOUBLE NOT NULL, z DOUBLE NOT NULL,
                    created_at   BIGINT       NOT NULL,
                    items        VARBINARY(1048576) NOT NULL
                )
                """;

        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(pending);
            st.executeUpdate(state);
            st.executeUpdate(grave);
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

    // ── 도망자의 무덤 ──────────────────────────────────────────────────

    public record GraveRow(long id, UUID owner, String ownerName, UUID opponent, String opponentName,
                           String world, double x, double y, double z, long createdAt, byte[] items) {}

    /** 새 무덤. 만든 id 를 돌려줍니다. */
    public long insertGrave(String serverId, GraveRow g) throws SQLException {
        String sql = """
                INSERT INTO ruc_raid_grave
                  (server_id, owner, owner_name, opponent, opponent_name, world, x, y, z, created_at, items)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, serverId);
            ps.setString(2, g.owner().toString());
            ps.setString(3, g.ownerName());
            ps.setString(4, g.opponent() == null ? null : g.opponent().toString());
            ps.setString(5, g.opponentName());
            ps.setString(6, g.world());
            ps.setDouble(7, g.x());
            ps.setDouble(8, g.y());
            ps.setDouble(9, g.z());
            ps.setLong(10, g.createdAt());
            ps.setBytes(11, g.items());
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                return rs.next() ? rs.getLong(1) : 0;
            }
        }
    }

    public java.util.List<GraveRow> loadGraves(String serverId) throws SQLException {
        String sql = "SELECT * FROM ruc_raid_grave WHERE server_id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, serverId);
            try (ResultSet rs = ps.executeQuery()) {
                java.util.List<GraveRow> out = new java.util.ArrayList<>();
                while (rs.next()) {
                    String opp = rs.getString("opponent");
                    out.add(new GraveRow(rs.getLong("id"), UUID.fromString(rs.getString("owner")),
                            rs.getString("owner_name"), opp == null ? null : UUID.fromString(opp),
                            rs.getString("opponent_name"), rs.getString("world"), rs.getDouble("x"),
                            rs.getDouble("y"), rs.getDouble("z"), rs.getLong("created_at"), rs.getBytes("items")));
                }
                return out;
            }
        }
    }

    public void updateGraveItems(long id, byte[] items) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement("UPDATE ruc_raid_grave SET items = ? WHERE id = ?")) {
            ps.setBytes(1, items);
            ps.setLong(2, id);
            ps.executeUpdate();
        }
    }

    public void deleteGrave(long id) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement("DELETE FROM ruc_raid_grave WHERE id = ?")) {
            ps.setLong(1, id);
            ps.executeUpdate();
        }
    }

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
