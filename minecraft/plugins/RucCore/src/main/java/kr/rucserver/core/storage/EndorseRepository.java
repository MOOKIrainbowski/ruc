package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * ruc_endorse — 주간 추천 기록 (D4 방법 2, 2026-10-09). 주 1표 · 같은 사람 4주 1번 · 상호 추천 판정에 씁니다.
 * 평판 자체는 ruc_player 에 바로 더합니다 (추천은 두 사람이 같은 서버에 있을 때만 되므로 둘 다 접속 중).
 */
public class EndorseRepository {

    private final Database database;

    public EndorseRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_endorse (
                    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                    endorser    VARCHAR(36) NOT NULL,
                    target      VARCHAR(36) NOT NULL,
                    points      INT         NOT NULL,
                    created_at  BIGINT      NOT NULL
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_endorse_endorser ON ruc_endorse (endorser, created_at)");
        }
    }

    /** since 이후 endorser 가 한 추천 수 */
    public int countSince(UUID endorser, long since) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT COUNT(*) FROM ruc_endorse WHERE endorser = ? AND created_at >= ?")) {
            ps.setString(1, endorser.toString());
            ps.setLong(2, since);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        }
    }

    /** since 이후 from → to 추천의 점수. 없으면 null. */
    public Integer pointsSince(UUID from, UUID to, long since) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT points FROM ruc_endorse WHERE endorser = ? AND target = ? AND created_at >= ? ORDER BY created_at DESC")) {
            ps.setString(1, from.toString());
            ps.setString(2, to.toString());
            ps.setLong(3, since);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : null;
            }
        }
    }

    public void insert(UUID endorser, UUID target, int points, long at) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "INSERT INTO ruc_endorse (endorser, target, points, created_at) VALUES (?, ?, ?, ?)")) {
            ps.setString(1, endorser.toString());
            ps.setString(2, target.toString());
            ps.setInt(3, points);
            ps.setLong(4, at);
            ps.executeUpdate();
        }
    }
}
