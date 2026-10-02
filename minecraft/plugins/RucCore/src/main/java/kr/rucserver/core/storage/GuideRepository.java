package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * {@code ruc_guide} — 가이드 진행 (Phase 11). 한 사람 한 줄.
 *
 * {@code step} 은 "끝낸 단계 수" 입니다 (0 = 아직 아무것도 안 함). 다음 단계로 넘어가는 것은
 * {@code WHERE step = ?} 조건부 UPDATE 라, 두 서버에서 같은 단계를 거의 동시에 끝내도 한 번만
 * 넘어갑니다 — 보상이 두 번 나가지 않습니다.
 */
public class GuideRepository {

    private final Database database;

    public GuideRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_guide (
                    uuid        VARCHAR(36) NOT NULL,
                    step        INT         NOT NULL DEFAULT 0,
                    started_at  BIGINT      NOT NULL,
                    updated_at  BIGINT      NOT NULL,
                    finished_at BIGINT      NULL,
                    PRIMARY KEY (uuid)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
        }
    }

    /** 진행 단계. 처음이면 0 으로 만들어 돌려줍니다. */
    public int loadOrCreate(UUID uuid) throws SQLException {
        try (Connection conn = database.getConnection()) {
            try (PreparedStatement ps = conn.prepareStatement("SELECT step FROM ruc_guide WHERE uuid = ?")) {
                ps.setString(1, uuid.toString());
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) return rs.getInt(1);
                }
            }
            long now = System.currentTimeMillis();
            try (PreparedStatement ps = conn.prepareStatement("""
                    INSERT INTO ruc_guide (uuid, step, started_at, updated_at) VALUES (?, 0, ?, ?)
                    ON DUPLICATE KEY UPDATE updated_at = updated_at
                    """)) {
                ps.setString(1, uuid.toString());
                ps.setLong(2, now);
                ps.setLong(3, now);
                ps.executeUpdate();
            }
            return 0;
        }
    }

    /** {@code from} 단계를 끝냈다고 기록합니다. 이번 호출이 넘겼을 때만 true. */
    public boolean advance(UUID uuid, int from, boolean finished) throws SQLException {
        String sql = "UPDATE ruc_guide SET step = ?, updated_at = ?"
                + (finished ? ", finished_at = ?" : "")
                + " WHERE uuid = ? AND step = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            long now = System.currentTimeMillis();
            int i = 1;
            ps.setInt(i++, from + 1);
            ps.setLong(i++, now);
            if (finished) ps.setLong(i++, now);
            ps.setString(i++, uuid.toString());
            ps.setInt(i, from);
            return ps.executeUpdate() == 1;
        }
    }
}
