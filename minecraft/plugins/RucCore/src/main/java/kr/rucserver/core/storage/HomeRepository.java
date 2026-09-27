package kr.rucserver.core.storage;

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
 * {@code ruc_home} — /sethome 좌표.
 *
 * <h2>왜 Core 가 소유하는가</h2>
 * 약탈(§2.4)과 평화(§2.5) 두 서버가 모두 /home 을 제공합니다(§3.3). 테이블을
 * 각 모듈이 따로 만들면 같은 테이블에 CREATE 를 두 번 내는 주인 없는 상태가
 * 되고, 컬럼을 하나 고칠 때 어느 쪽을 고쳐야 하는지 알 수 없게 됩니다.
 *
 * 행은 {@code server_id} 로 나뉘므로 약탈의 홈과 평화의 홈은 서로 별개입니다 —
 * 서버마다 지형이 다르니 당연히 그래야 합니다.
 *
 * {@code name} 이 키에 있어서 나중에 다중 홈(후원 혜택 D7)을 열 때 스키마를
 * 바꾸지 않아도 됩니다. 지금은 항상 {@code default} 하나만 씁니다.
 */
public class HomeRepository {

    private final Database database;

    public HomeRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
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
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
        }
    }

    public void save(UUID uuid, String serverId, String name, Location loc) throws SQLException {
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
     * 월드 조회는 메인 스레드 전용 API 라서 여기서는 이름만 읽어 돌려주고,
     * 실제 Location 조립은 호출부(메인 스레드)에서 합니다.
     */
    public HomeRow find(UUID uuid, String serverId, String name) throws SQLException {
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

    public void delete(UUID uuid, String serverId, String name) throws SQLException {
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
}
