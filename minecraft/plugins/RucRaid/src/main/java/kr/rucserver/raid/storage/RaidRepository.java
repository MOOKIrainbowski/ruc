package kr.rucserver.raid.storage;

import kr.rucserver.core.storage.Database;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;

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
 *  - ruc_home         : /sethome 좌표. 서버별로 따로 저장됩니다.
 *  - ruc_raid_state   : 드래곤 알 배치 여부 같은 서버당 하나짜리 상태값.
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

        // name 을 키에 포함해 두면 나중에 다중 홈(후원 혜택 D7)을 열 때
        // 스키마를 바꾸지 않아도 됩니다. 지금은 항상 'default' 하나만 씁니다.
        String home = """
                CREATE TABLE IF NOT EXISTS ruc_home (
                    uuid       VARCHAR(36) NOT NULL,
                    server_id  VARCHAR(16) NOT NULL,
                    name       VARCHAR(24) NOT NULL,
                    world      VARCHAR(64) NOT NULL,
                    x          DOUBLE      NOT NULL,
                    y          DOUBLE      NOT NULL,
                    z          DOUBLE      NOT NULL,
                    yaw        FLOAT       NOT NULL,
                    pitch      FLOAT       NOT NULL,
                    updated_at BIGINT      NOT NULL,
                    PRIMARY KEY (uuid, server_id, name)
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
            st.executeUpdate(home);
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

    // ── 홈 좌표 ────────────────────────────────────────────────────────

    public void saveHome(UUID uuid, String serverId, String name, Location loc) throws SQLException {
        String sql = """
                INSERT INTO ruc_home (uuid, server_id, name, world, x, y, z, yaw, pitch, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE world = VALUES(world), x = VALUES(x), y = VALUES(y),
                    z = VALUES(z), yaw = VALUES(yaw), pitch = VALUES(pitch),
                    updated_at = VALUES(updated_at)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, serverId);
            ps.setString(3, name);
            ps.setString(4, loc.getWorld().getName());
            ps.setDouble(5, loc.getX());
            ps.setDouble(6, loc.getY());
            ps.setDouble(7, loc.getZ());
            ps.setFloat(8, loc.getYaw());
            ps.setFloat(9, loc.getPitch());
            ps.setLong(10, System.currentTimeMillis());
            ps.executeUpdate();
        }
    }

    /**
     * 저장된 홈. 없으면 null.
     *
     * 월드 조회는 메인 스레드 전용 API라서 여기서는 이름만 읽어 돌려주고,
     * 실제 Location 조립은 호출부(메인 스레드)에서 합니다.
     */
    public HomeRow findHome(UUID uuid, String serverId, String name) throws SQLException {
        String sql = """
                SELECT world, x, y, z, yaw, pitch FROM ruc_home
                WHERE uuid = ? AND server_id = ? AND name = ?
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, serverId);
            ps.setString(3, name);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                return new HomeRow(rs.getString("world"), rs.getDouble("x"), rs.getDouble("y"),
                        rs.getDouble("z"), rs.getFloat("yaw"), rs.getFloat("pitch"));
            }
        }
    }

    public void deleteHome(UUID uuid, String serverId, String name) throws SQLException {
        String sql = "DELETE FROM ruc_home WHERE uuid = ? AND server_id = ? AND name = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, serverId);
            ps.setString(3, name);
            ps.executeUpdate();
        }
    }

    public record HomeRow(String world, double x, double y, double z, float yaw, float pitch) {
        /** 메인 스레드에서만 호출하세요. 월드가 로드되어 있지 않으면 null. */
        public Location toLocation() {
            World w = Bukkit.getWorld(world);
            if (w == null) return null;
            return new Location(w, x, y, z, yaw, pitch);
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
