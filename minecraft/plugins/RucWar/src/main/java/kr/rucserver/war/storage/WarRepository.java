package kr.rucserver.war.storage;

import kr.rucserver.core.storage.Database;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * 국가전 서버 테이블.
 *
 * <ul>
 *   <li>{@code ruc_core}          — 거점에 설치된 코어. 거점 이름이 PK 라 한 거점에
 *       코어는 하나뿐입니다.</li>
 *   <li>{@code ruc_guild_storage} — 국가창고 내용 (§3.3). 길드당 한 행.</li>
 * </ul>
 *
 * <h2>청크 클레임 테이블이 없는 이유</h2>
 * 영토는 "코어 중심 반경 R 청크" 로 <b>계산</b>합니다. 클레임을 따로 저장하면
 * 설정에서 반경을 바꾸는 순간 저장된 클레임과 어긋나고, 그 불일치는 조용히
 * 남습니다. 거점 수가 한 자릿수라 매번 계산해도 비용이 없습니다.
 */
public class WarRepository {

    private final Database database;

    public WarRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        // confirmed = false 는 "이번 전쟁 시간대에 설치되어 아직 방어 중" 입니다.
        // 시간대가 끝날 때 살아 있으면 true 가 되고 영토가 확정됩니다 (§2.6).
        String cores = """
                CREATE TABLE IF NOT EXISTS ruc_core (
                    site       VARCHAR(32) NOT NULL,
                    guild_id   INT         NOT NULL,
                    world      VARCHAR(64) NOT NULL,
                    x          INT         NOT NULL,
                    y          INT         NOT NULL,
                    z          INT         NOT NULL,
                    placed_at  BIGINT      NOT NULL,
                    confirmed  BOOLEAN     NOT NULL DEFAULT FALSE,
                    PRIMARY KEY (site)
                )
                """;

        // 인벤토리 전체를 Base64 한 덩어리로 저장합니다. 슬롯별 행으로 쪼개면
        // 저장할 때마다 27~54개 행을 지우고 다시 넣어야 하고, 중간에 실패하면
        // 창고가 반만 남습니다. 한 행이면 그런 상태가 생기지 않습니다.
        String storage = """
                CREATE TABLE IF NOT EXISTS ruc_guild_storage (
                    guild_id   INT      NOT NULL,
                    contents   TEXT     NULL,
                    updated_at BIGINT   NOT NULL,
                    PRIMARY KEY (guild_id)
                )
                """;

        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(cores);
            st.executeUpdate(storage);
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_core_guild "
                    + "ON ruc_core (guild_id)");
        }
    }

    // ── 코어 ──────────────────────────────────────────────────────────

    public List<CoreRow> loadCores() throws SQLException {
        List<CoreRow> out = new ArrayList<>();
        try (Connection conn = database.getConnection();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT * FROM ruc_core")) {
            while (rs.next()) {
                out.add(new CoreRow(
                        rs.getString("site"), rs.getInt("guild_id"), rs.getString("world"),
                        rs.getInt("x"), rs.getInt("y"), rs.getInt("z"),
                        rs.getLong("placed_at"), rs.getBoolean("confirmed")));
            }
        }
        return out;
    }

    /**
     * 코어 설치. 거점이 비어 있을 때만 성공합니다.
     *
     * 빈 거점인지 미리 확인하더라도, 두 길드가 같은 순간에 같은 거점에 놓으려
     * 하면 그 검사만으로는 둘 다 통과합니다. PK 충돌을 실패로 받아 처리하는 것이
     * 확실한 방법입니다.
     *
     * @return 실제로 설치되었으면 true. 이미 누가 차지했으면 false
     */
    public boolean placeCore(CoreRow row) throws SQLException {
        String sql = """
                INSERT INTO ruc_core (site, guild_id, world, x, y, z, placed_at, confirmed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, row.site());
            ps.setInt(2, row.guildId());
            ps.setString(3, row.world());
            ps.setInt(4, row.x());
            ps.setInt(5, row.y());
            ps.setInt(6, row.z());
            ps.setLong(7, row.placedAt());
            ps.setBoolean(8, row.confirmed());
            ps.executeUpdate();
            return true;
        } catch (SQLException e) {
            if (isDuplicate(e)) return false;
            throw e;
        }
    }

    public void removeCore(String site) throws SQLException {
        String sql = "DELETE FROM ruc_core WHERE site = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, site);
            ps.executeUpdate();
        }
    }

    /** 전쟁 시간대가 끝날 때 살아남은 코어를 영토로 확정합니다 (§2.6). */
    public int confirmAll() throws SQLException {
        String sql = "UPDATE ruc_core SET confirmed = TRUE WHERE confirmed = FALSE";
        try (Connection conn = database.getConnection();
             Statement st = conn.createStatement()) {
            return st.executeUpdate(sql);
        }
    }

    public record CoreRow(String site, int guildId, String world, int x, int y, int z,
                          long placedAt, boolean confirmed) {}

    // ── 국가창고 ──────────────────────────────────────────────────────

    /** 저장된 창고 내용(Base64). 없으면 null. */
    public String loadStorage(int guildId) throws SQLException {
        String sql = "SELECT contents FROM ruc_guild_storage WHERE guild_id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, guildId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString("contents") : null;
            }
        }
    }

    public void saveStorage(int guildId, String contents) throws SQLException {
        String sql = """
                INSERT INTO ruc_guild_storage (guild_id, contents, updated_at)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE contents = VALUES(contents),
                                        updated_at = VALUES(updated_at)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, guildId);
            ps.setString(2, contents);
            ps.setLong(3, System.currentTimeMillis());
            ps.executeUpdate();
        }
    }

    public void deleteStorage(int guildId) throws SQLException {
        String sql = "DELETE FROM ruc_guild_storage WHERE guild_id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, guildId);
            ps.executeUpdate();
        }
    }

    /** UNIQUE / PK 위반인지. H2 와 MySQL 의 코드가 다릅니다. */
    private boolean isDuplicate(SQLException e) {
        return e.getErrorCode() == 1062 || e.getErrorCode() == 23505
                || (e.getSQLState() != null && e.getSQLState().startsWith("23"));
    }
}
