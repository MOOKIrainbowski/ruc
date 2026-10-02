package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * {@code ruc_ender_page} — 엔더상자 확장 페이지 내용 (2026-10-02 소유자 결정).
 *
 * <h2>서버마다 따로입니다</h2>
 * 키가 (uuid, server_id, page) 입니다. 인벤토리가 서버마다 따로인데 확장 페이지만
 * 네트워크 공용이면, 약탈 서버의 전리품을 평화 서버로 옮기는 통로가 됩니다.
 * "몇 페이지를 가졌는가"(권리)만 네트워크 공용이고 — {@code ruc_entitlement} —
 * 내용은 서버 것입니다.
 *
 * 바닐라 엔더상자(0페이지)는 여기 없습니다. 바닐라가 플레이어 데이터에 그대로 둡니다.
 */
public class EnderRepository {

    private final Database database;

    public EnderRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_ender_page (
                    uuid       VARCHAR(36) NOT NULL,
                    server_id  VARCHAR(16) NOT NULL,
                    page       INT         NOT NULL,
                    contents   TEXT        NOT NULL,
                    updated_at BIGINT      NOT NULL,
                    PRIMARY KEY (uuid, server_id, page)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
        }
    }

    /** @return Base64 내용. 한 번도 저장한 적 없으면 null. */
    public String load(UUID uuid, String serverId, int page) throws SQLException {
        String sql = "SELECT contents FROM ruc_ender_page WHERE uuid = ? AND server_id = ? AND page = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, serverId);
            ps.setInt(3, page);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    public void save(UUID uuid, String serverId, int page, String contents) throws SQLException {
        String sql = """
                INSERT INTO ruc_ender_page (uuid, server_id, page, contents, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE contents = VALUES(contents), updated_at = VALUES(updated_at)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, serverId);
            ps.setInt(3, page);
            ps.setString(4, contents);
            ps.setLong(5, System.currentTimeMillis());
            ps.executeUpdate();
        }
    }
}
