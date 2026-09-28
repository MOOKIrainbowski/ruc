package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * {@code ruc_sanction} — 제재 기록 (Phase 6-7, §3.9 + D5).
 *
 * <h2>밴의 진실은 이 테이블 하나입니다</h2>
 * 바닐라 {@code /ban} 은 <b>그 백엔드 서버에만</b> 걸립니다. 약탈에서 밴해도
 * 홈으로는 들어옵니다. 그래서 밴을 여기 적고, 프록시(RucGate)가 로그인 때
 * 이 테이블을 봅니다. 백엔드 4개 · 프록시 하나가 같은 행을 보므로 어긋날 수
 * 없습니다.
 *
 * <h2>{@code ref} — 같은 제재를 두 번 넣지 않습니다</h2>
 * 봇은 RCON 이 실패하면 "재시도" 버튼을 띄웁니다. 그런데 실패가 "응답만
 * 못 받았고 실제로는 들어갔다" 일 수 있습니다. 재시도가 같은 {@code ref}
 * 를 보내고 DB 가 UNIQUE 로 막아서, 몰수가 두 번 되는 일이 원천적으로
 * 없습니다.
 *
 * <h2>{@code effects_applied} — 몰수·평판은 나중에 적용될 수 있습니다</h2>
 * 대상이 <b>다른 서버</b>에 접속해 있으면 그쪽 캐시가 나중에 저장되면서 DB 에
 * 직접 뺀 잔고를 덮어씁니다 (§7.4 와 같은 이유). 그래서 이 서버에 있지 않으면
 * 몰수를 미뤄 두고, 그 사람의 데이터가 <b>다음에 로드되는 순간</b> 적용합니다.
 * 적용 표시는 우편 수령(§6.21)처럼 조건부 UPDATE 로 한 번만 통과시킵니다.
 */
public class SanctionRepository {

    /** 영구 밴. MySQL BIGINT 에 그대로 들어갑니다. */
    public static final long PERMANENT = Long.MAX_VALUE;

    private final Database database;

    public SanctionRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_sanction (
                    id              INT          NOT NULL AUTO_INCREMENT,
                    ref             VARCHAR(32)  NOT NULL,
                    target          VARCHAR(36)  NOT NULL,
                    target_name     VARCHAR(16)  NOT NULL,
                    tier            INT          NOT NULL,
                    reason          VARCHAR(512) NOT NULL,
                    issued_by       VARCHAR(64)  NOT NULL,
                    created_at      BIGINT       NOT NULL,
                    ban_until       BIGINT       NOT NULL,
                    confiscate_pct  INT          NOT NULL,
                    rep_effect      VARCHAR(16)  NOT NULL,
                    effects_applied BOOLEAN      NOT NULL,
                    revoked_at      BIGINT       NULL,
                    revoked_by      VARCHAR(64)  NULL,
                    PRIMARY KEY (id),
                    UNIQUE (ref)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
            // 로그인 판정(프록시)과 이력 조회가 전부 대상으로 찾습니다.
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_sanction_target "
                    + "ON ruc_sanction (target, revoked_at)");
        }
    }

    /**
     * 기록. 생성된 번호를 돌려줍니다.
     *
     * @return 새 번호. 같은 {@code ref} 가 이미 있으면 <b>음수로 된 기존 번호</b>
     *         (-id) — 호출부가 "중복" 을 구분할 수 있게 합니다.
     */
    public long insert(Sanction s) throws SQLException {
        String sql = """
                INSERT INTO ruc_sanction
                    (ref, target, target_name, tier, reason, issued_by, created_at,
                     ban_until, confiscate_pct, rep_effect, effects_applied)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, s.ref());
            ps.setString(2, s.target().toString());
            ps.setString(3, s.targetName());
            ps.setInt(4, s.tier());
            ps.setString(5, s.reason());
            ps.setString(6, s.issuedBy());
            ps.setLong(7, s.createdAt());
            ps.setLong(8, s.banUntil());
            ps.setInt(9, s.confiscatePct());
            ps.setString(10, s.repEffect());
            ps.executeUpdate();

            try (ResultSet keys = ps.getGeneratedKeys()) {
                return keys.next() ? keys.getLong(1) : 0;
            }
        } catch (SQLException e) {
            // H2 는 SQLIntegrityConstraintViolationException 을, MySQL 드라이버는
            // SQLState 23xxx 를 줍니다. 둘 다 "같은 ref" 로 봅니다.
            if (e instanceof SQLIntegrityConstraintViolationException
                    || (e.getSQLState() != null && e.getSQLState().startsWith("23"))) {
                Sanction existing = findByRef(s.ref());
                if (existing != null) return -existing.id();
            }
            throw e;
        }
    }

    public Sanction find(long id) throws SQLException {
        return one("SELECT * FROM ruc_sanction WHERE id = ?", ps -> ps.setLong(1, id));
    }

    public Sanction findByRef(String ref) throws SQLException {
        return one("SELECT * FROM ruc_sanction WHERE ref = ?", ps -> ps.setString(1, ref));
    }

    /** 그 사람의 제재 전부. 최근 것부터. */
    public List<Sanction> history(UUID target) throws SQLException {
        String sql = "SELECT * FROM ruc_sanction WHERE target = ? ORDER BY created_at DESC";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, target.toString());
            try (ResultSet rs = ps.executeQuery()) {
                List<Sanction> out = new ArrayList<>();
                while (rs.next()) out.add(map(rs));
                return out;
            }
        }
    }

    /** 아직 몰수·평판이 적용되지 않은 제재. 데이터 로드 시점에 봅니다. */
    public List<Sanction> unapplied(UUID target) throws SQLException {
        String sql = """
                SELECT * FROM ruc_sanction
                WHERE target = ? AND effects_applied = FALSE AND revoked_at IS NULL
                ORDER BY id ASC
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, target.toString());
            try (ResultSet rs = ps.executeQuery()) {
                List<Sanction> out = new ArrayList<>();
                while (rs.next()) out.add(map(rs));
                return out;
            }
        }
    }

    /**
     * 적용 표시. 이미 적용됐으면 false 이고 아무것도 바뀌지 않습니다.
     *
     * 두 서버가 같은 사람의 데이터를 거의 동시에 로드하면(빠른 서버 이동)
     * 둘 다 미적용으로 읽습니다. 이 UPDATE 가 성공한 쪽만 몰수합니다.
     */
    public boolean markApplied(long id) throws SQLException {
        String sql = "UPDATE ruc_sanction SET effects_applied = TRUE "
                + "WHERE id = ? AND effects_applied = FALSE";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            return ps.executeUpdate() == 1;
        }
    }

    /**
     * 해제. 이미 해제됐으면 false.
     *
     * 밴만 풀립니다. 이미 적용된 몰수·평판은 되돌리지 않습니다 — 되돌릴
     * 금액을 계산하려면 그 시점의 잔고가 필요한데, 그 사이에 벌고 쓴 것과
     * 섞여 있습니다. 오판이면 스태프가 {@code /ruc give} 로 보상하세요.
     * 아직 적용되지 않은 몰수는 {@code revoked_at} 조건으로 적용되지 않습니다.
     */
    public boolean revoke(long id, String by, long at) throws SQLException {
        String sql = """
                UPDATE ruc_sanction SET revoked_at = ?, revoked_by = ?
                WHERE id = ? AND revoked_at IS NULL
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, at);
            ps.setString(2, by);
            ps.setLong(3, id);
            return ps.executeUpdate() == 1;
        }
    }

    // ── 내부 ──────────────────────────────────────────────────────────

    private interface Binder { void bind(PreparedStatement ps) throws SQLException; }

    private Sanction one(String sql, Binder binder) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            binder.bind(ps);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        }
    }

    private Sanction map(ResultSet rs) throws SQLException {
        long rawRevoked = rs.getLong("revoked_at");
        Long revokedAt = rs.wasNull() ? null : rawRevoked;

        return new Sanction(
                rs.getLong("id"),
                rs.getString("ref"),
                UUID.fromString(rs.getString("target")),
                rs.getString("target_name"),
                rs.getInt("tier"),
                rs.getString("reason"),
                rs.getString("issued_by"),
                rs.getLong("created_at"),
                rs.getLong("ban_until"),
                rs.getInt("confiscate_pct"),
                rs.getString("rep_effect"),
                rs.getBoolean("effects_applied"),
                revokedAt,
                rs.getString("revoked_by"));
    }

    public record Sanction(long id, String ref, UUID target, String targetName, int tier,
                           String reason, String issuedBy, long createdAt, long banUntil,
                           int confiscatePct, String repEffect, boolean effectsApplied,
                           Long revokedAt, String revokedBy) {

        public boolean permanent() { return banUntil == PERMANENT; }

        /** 지금 밴이 걸려 있는가. */
        public boolean activeAt(long now) {
            return revokedAt == null && banUntil > now;
        }
    }
}
