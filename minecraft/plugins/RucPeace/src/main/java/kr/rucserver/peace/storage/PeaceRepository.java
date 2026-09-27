package kr.rucserver.peace.storage;

import kr.rucserver.core.storage.Database;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 평화 서버 전용 테이블.
 *
 * {@code ruc_peace_incident} — 살해 시도로 막힌 기록 (§2.5 "테러·그리핑 탐지").
 *
 * <h2>왜 파일이 아니라 DB 인가</h2>
 * Helper 가 재량으로 제재하려면 <b>조회</b>가 되어야 합니다. "누가 몇 번 그랬나"
 * 를 세려면 로그 파일을 grep 하는 것이 아니라 질의할 수 있어야 하고, 나중에
 * 디스코드 신고(§3.8)와 제재 티어(§3.9)가 이 기록을 근거로 삼습니다.
 */
public class PeaceRepository {

    private final Database database;

    public PeaceRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_peace_incident (
                    id         INT          NOT NULL AUTO_INCREMENT,
                    actor      VARCHAR(36)  NOT NULL,
                    actor_name VARCHAR(16)  NOT NULL,
                    victim     VARCHAR(36)  NOT NULL,
                    victim_name VARCHAR(16) NOT NULL,
                    kind       VARCHAR(32)  NOT NULL,
                    world      VARCHAR(64)  NOT NULL,
                    x          INT          NOT NULL,
                    y          INT          NOT NULL,
                    z          INT          NOT NULL,
                    at         BIGINT       NOT NULL,
                    PRIMARY KEY (id)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
            // 조회는 거의 항상 "이 사람이 무엇을 했나" 입니다.
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_peace_incident_actor "
                    + "ON ruc_peace_incident (actor, at)");
        }
    }

    public void insert(Incident incident) throws SQLException {
        String sql = """
                INSERT INTO ruc_peace_incident
                    (actor, actor_name, victim, victim_name, kind, world, x, y, z, at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, incident.actor().toString());
            ps.setString(2, incident.actorName());
            ps.setString(3, incident.victim().toString());
            ps.setString(4, incident.victimName());
            ps.setString(5, incident.kind());
            ps.setString(6, incident.world());
            ps.setInt(7, incident.x());
            ps.setInt(8, incident.y());
            ps.setInt(9, incident.z());
            ps.setLong(10, incident.at());
            ps.executeUpdate();
        }
    }

    /** 최근 기록. {@code actorName} 이 null 이면 전체. */
    public List<Incident> recent(String actorName, int limit) throws SQLException {
        String sql = actorName == null
                ? "SELECT * FROM ruc_peace_incident ORDER BY at DESC LIMIT ?"
                : "SELECT * FROM ruc_peace_incident WHERE actor_name = ? ORDER BY at DESC LIMIT ?";

        List<Incident> out = new ArrayList<>();
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            if (actorName == null) {
                ps.setInt(1, limit);
            } else {
                ps.setString(1, actorName);
                ps.setInt(2, limit);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(map(rs));
            }
        }
        return out;
    }

    /** 한 사람의 누적 건수. 제재 판단의 근거가 됩니다. */
    public int countFor(String actorName) throws SQLException {
        String sql = "SELECT COUNT(*) FROM ruc_peace_incident WHERE actor_name = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, actorName);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        }
    }

    private Incident map(ResultSet rs) throws SQLException {
        return new Incident(
                UUID.fromString(rs.getString("actor")), rs.getString("actor_name"),
                UUID.fromString(rs.getString("victim")), rs.getString("victim_name"),
                rs.getString("kind"), rs.getString("world"),
                rs.getInt("x"), rs.getInt("y"), rs.getInt("z"), rs.getLong("at"));
    }

    public record Incident(UUID actor, String actorName, UUID victim, String victimName,
                           String kind, String world, int x, int y, int z, long at) {}
}
