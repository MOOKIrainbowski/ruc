package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * {@code ruc_report} — 인게임 신고 (Phase 6-5, §3.8).
 *
 * <h2>왜 접수와 판정을 나누는가</h2>
 * 신고가 들어왔다고 평판이 바로 내려가면, 누구든 남을 지목하는 것만으로 남의
 * 평판을 떨어뜨릴 수 있습니다. 그건 신고 시스템이 아니라 괴롭힘 도구입니다.
 *
 * 그래서 행에 {@code status} 가 있습니다. 접수는 {@code PENDING} 이고,
 * 스태프가 확정({@code CONFIRMED})했을 때만 평판이 움직입니다. 기각
 * ({@code REJECTED})은 아무 일도 일으키지 않지만 기록으로 남습니다 —
 * 같은 사람이 계속 기각당하는 신고를 넣는 것도 봐야 할 정보입니다.
 *
 * <h2>중복 신고</h2>
 * 막지 않습니다. 여러 사람이 같은 사람을 신고하는 것은 정상이고 오히려
 * 중요한 신호입니다. 대신 한 사람이 도배하지 못하게 쿨타임을 서비스 쪽에
 * 둡니다.
 */
public class ReportRepository {

    private final Database database;

    public ReportRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_report (
                    id          INT          NOT NULL AUTO_INCREMENT,
                    reporter    VARCHAR(36)  NOT NULL,
                    reporter_name VARCHAR(16) NOT NULL,
                    target      VARCHAR(36)  NOT NULL,
                    target_name VARCHAR(16)  NOT NULL,
                    reason      VARCHAR(512) NOT NULL,
                    server_id   VARCHAR(16)  NOT NULL,
                    created_at  BIGINT       NOT NULL,
                    status      VARCHAR(16)  NOT NULL,
                    handled_by  VARCHAR(32)  NULL,
                    handled_at  BIGINT       NULL,
                    PRIMARY KEY (id)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
            // "이 사람이 몇 번 신고당했나" 가 가장 잦은 질문입니다.
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_report_target "
                    + "ON ruc_report (target, status)");
            // 스태프가 처리할 목록을 뽑는 경로.
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_report_status "
                    + "ON ruc_report (status, created_at)");
        }
    }

    /** 접수. 생성된 번호를 돌려줍니다 (실패 시 -1). */
    public long insert(Report report) throws SQLException {
        String sql = """
                INSERT INTO ruc_report
                    (reporter, reporter_name, target, target_name, reason,
                     server_id, created_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, report.reporter().toString());
            ps.setString(2, report.reporterName());
            ps.setString(3, report.target().toString());
            ps.setString(4, report.targetName());
            ps.setString(5, report.reason());
            ps.setString(6, report.serverId());
            ps.setLong(7, report.createdAt());
            ps.executeUpdate();

            try (ResultSet keys = ps.getGeneratedKeys()) {
                return keys.next() ? keys.getLong(1) : -1;
            }
        }
    }

    /** 그 사람이 마지막으로 신고한 시각. 없으면 0. 쿨타임 판정에 씁니다. */
    public long lastReportAt(UUID reporter) throws SQLException {
        String sql = "SELECT MAX(created_at) FROM ruc_report WHERE reporter = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, reporter.toString());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0;
            }
        }
    }

    /** 확정된 신고 수. 제재 판단의 근거입니다. */
    public int confirmedAgainst(UUID target) throws SQLException {
        String sql = "SELECT COUNT(*) FROM ruc_report WHERE target = ? AND status = 'CONFIRMED'";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, target.toString());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        }
    }

    public Report find(long id) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT * FROM ruc_report WHERE id = ?")) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        }
    }

    /** 아직 처리하지 않은 신고. 오래된 것부터. */
    public List<Report> pending(int limit) throws SQLException {
        String sql = """
                SELECT * FROM ruc_report WHERE status = 'PENDING'
                ORDER BY created_at ASC LIMIT ?
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, limit);
            try (ResultSet rs = ps.executeQuery()) {
                List<Report> out = new ArrayList<>();
                while (rs.next()) out.add(map(rs));
                return out;
            }
        }
    }

    /**
     * 처리 표시. 이미 처리된 신고면 false 이고 아무것도 바뀌지 않습니다.
     *
     * {@code status = 'PENDING'} 조건이 핵심입니다 — 두 스태프가 같은 신고를
     * 동시에 확정하면 평판이 두 번 깎입니다. 갱신된 행 수로 한 번만 통과시킵니다.
     */
    public boolean handle(long id, String status, String handledBy, long at) throws SQLException {
        String sql = """
                UPDATE ruc_report SET status = ?, handled_by = ?, handled_at = ?
                WHERE id = ? AND status = 'PENDING'
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, status);
            ps.setString(2, handledBy);
            ps.setLong(3, at);
            ps.setLong(4, id);
            return ps.executeUpdate() == 1;
        }
    }

    private Report map(ResultSet rs) throws SQLException {
        long rawHandled = rs.getLong("handled_at");
        Long handledAt = rs.wasNull() ? null : rawHandled;

        return new Report(
                rs.getLong("id"),
                UUID.fromString(rs.getString("reporter")),
                rs.getString("reporter_name"),
                UUID.fromString(rs.getString("target")),
                rs.getString("target_name"),
                rs.getString("reason"),
                rs.getString("server_id"),
                rs.getLong("created_at"),
                rs.getString("status"),
                rs.getString("handled_by"),
                handledAt);
    }

    public record Report(long id, UUID reporter, String reporterName,
                         UUID target, String targetName, String reason,
                         String serverId, long createdAt,
                         String status, String handledBy, Long handledAt) {

        /** 접수용. id 와 처리 정보는 DB 가 채웁니다. */
        public static Report incoming(UUID reporter, String reporterName,
                                      UUID target, String targetName,
                                      String reason, String serverId) {
            return new Report(-1, reporter, reporterName, target, targetName,
                    reason, serverId, System.currentTimeMillis(), "PENDING", null, null);
        }
    }
}
