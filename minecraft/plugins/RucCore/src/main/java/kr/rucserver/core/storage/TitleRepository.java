package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * {@code ruc_title} — 보유 칭호 (Phase 6).
 *
 * <h2>왜 ruc_player 의 컬럼이 아닌가</h2>
 * 한 사람이 칭호를 <b>여럿</b> 가질 수 있습니다. 디스코드 역할에서 온 것,
 * 후원으로 산 것(Phase 8), 가이드를 끝내서 받은 것(Phase 11)이 동시에
 * 존재합니다. 컬럼 하나에 넣으면 "관리자이면서 가이드 완주자" 를 표현할 수
 * 없고, 역할이 빠졌을 때 무엇을 되돌려야 하는지도 알 수 없습니다.
 *
 * <h2>source 를 남기는 이유</h2>
 * 디스코드 동기화는 <b>디스코드에서 온 칭호만</b> 회수해야 합니다. 역할이
 * 하나 빠졌다고 유료 칭호나 가이드 칭호를 지우면 돈과 성취가 사라집니다.
 * 그래서 회수 쿼리에 {@code source = 'discord'} 가 붙습니다.
 *
 * <h2>표시할 칭호를 고르는 방법</h2>
 * {@code selected} 가 켜진 행이 있으면 그것, 없으면 우선순위가 가장 높은
 * 보유 칭호입니다. 우선순위는 DB 가 아니라 설정에 있습니다 — 서버를 재시작하지
 * 않고 칭호의 격을 바꿀 수 있어야 하고, DB 에 숫자를 박아 두면 설정과
 * 어긋났을 때 어느 쪽이 맞는지 알 수 없게 됩니다.
 */
public class TitleRepository {

    private final Database database;

    public TitleRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_title (
                    uuid       VARCHAR(36) NOT NULL,
                    title_key  VARCHAR(32) NOT NULL,
                    source     VARCHAR(16) NOT NULL,
                    selected   BOOLEAN     NOT NULL DEFAULT FALSE,
                    granted_at BIGINT      NOT NULL,
                    PRIMARY KEY (uuid, title_key)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_title_uuid "
                    + "ON ruc_title (uuid)");
        }
    }

    /** 보유 칭호 전부. */
    public List<Row> list(UUID uuid) throws SQLException {
        String sql = "SELECT title_key, source, selected FROM ruc_title WHERE uuid = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            try (ResultSet rs = ps.executeQuery()) {
                List<Row> out = new ArrayList<>();
                while (rs.next()) {
                    out.add(new Row(rs.getString("title_key"), rs.getString("source"),
                            rs.getBoolean("selected")));
                }
                return out;
            }
        }
    }

    /** 부여. 이미 있으면 source 만 갱신합니다 (유료 → 디스코드 승격 등). */
    public void grant(UUID uuid, String key, String source) throws SQLException {
        String sql = """
                INSERT INTO ruc_title (uuid, title_key, source, selected, granted_at)
                VALUES (?, ?, ?, FALSE, ?)
                ON DUPLICATE KEY UPDATE source = VALUES(source)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, key);
            ps.setString(3, source);
            ps.setLong(4, System.currentTimeMillis());
            ps.executeUpdate();
        }
    }

    public void revoke(UUID uuid, String key) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "DELETE FROM ruc_title WHERE uuid = ? AND title_key = ?")) {
            ps.setString(1, uuid.toString());
            ps.setString(2, key);
            ps.executeUpdate();
        }
    }

    /**
     * 디스코드에서 온 칭호를 {@code keep} 에 있는 것만 남기고 회수합니다.
     *
     * <b>{@code source = 'discord'} 조건이 이 메서드의 핵심입니다.</b> 이것이
     * 없으면 디스코드에서 역할 하나가 빠질 때 유료 칭호(Phase 8)와 가이드
     * 칭호(Phase 11)까지 같이 날아갑니다.
     *
     * @return 회수한 칭호 수
     */
    public int revokeDiscordExcept(UUID uuid, Collection<String> keep) throws SQLException {
        StringBuilder sql = new StringBuilder(
                "DELETE FROM ruc_title WHERE uuid = ? AND source = 'discord'");
        if (!keep.isEmpty()) {
            sql.append(" AND title_key NOT IN (");
            sql.append("?,".repeat(keep.size()));
            sql.setLength(sql.length() - 1);
            sql.append(')');
        }

        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql.toString())) {
            ps.setString(1, uuid.toString());
            int index = 2;
            for (String key : keep) ps.setString(index++, key);
            return ps.executeUpdate();
        }
    }

    /**
     * 표시할 칭호를 고정합니다. {@code key} 가 null 이면 자동(우선순위)으로 돌립니다.
     *
     * 한 사람에게 selected 행이 둘 이상 생기지 않게 먼저 전부 내립니다.
     * UNIQUE 로 막을 수 없는 제약이라(부분 인덱스가 필요) 쓰기 쪽에서 지킵니다.
     */
    public void select(UUID uuid, String key) throws SQLException {
        try (Connection conn = database.getConnection()) {
            try (PreparedStatement ps = conn.prepareStatement(
                    "UPDATE ruc_title SET selected = FALSE WHERE uuid = ?")) {
                ps.setString(1, uuid.toString());
                ps.executeUpdate();
            }
            if (key == null) return;

            try (PreparedStatement ps = conn.prepareStatement(
                    "UPDATE ruc_title SET selected = TRUE WHERE uuid = ? AND title_key = ?")) {
                ps.setString(1, uuid.toString());
                ps.setString(2, key);
                ps.executeUpdate();
            }
        }
    }

    public record Row(String key, String source, boolean selected) { }
}
