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
        // 확장권 (/엔더확장 구매 → 우편함). 아이템에는 이 id 만 적혀 있고, 사용은 여기
        // redeemed_at 이 비어 있을 때 한 번만 통과합니다 — 아이템을 복사해도 두 번 쓸 수 없습니다.
        String vouchers = """
                CREATE TABLE IF NOT EXISTS ruc_ender_voucher (
                    id          INT         NOT NULL AUTO_INCREMENT,
                    buyer       VARCHAR(36) NOT NULL,
                    cost        BIGINT      NOT NULL,
                    issued_at   BIGINT      NOT NULL,
                    redeemed_by VARCHAR(36) NULL,
                    redeemed_at BIGINT      NULL,
                    PRIMARY KEY (id)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
            st.executeUpdate(vouchers);
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_ender_voucher_buyer "
                    + "ON ruc_ender_voucher (buyer)");
        }
    }

    // ── 확장권 ─────────────────────────────────────────────────────────

    /** @return 새 확장권 id (실패 시 -1) */
    public long issueVoucher(UUID buyer, long cost) throws SQLException {
        String sql = "INSERT INTO ruc_ender_voucher (buyer, cost, issued_at) VALUES (?, ?, ?)";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, buyer.toString());
            ps.setLong(2, cost);
            ps.setLong(3, System.currentTimeMillis());
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                return keys.next() ? keys.getLong(1) : -1;
            }
        }
    }

    /** 발급 취소 (우편 발송이 실패했을 때만). 아직 쓰이지 않은 것만 지웁니다. */
    public void voidVoucher(long id) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "DELETE FROM ruc_ender_voucher WHERE id = ? AND redeemed_at IS NULL")) {
            ps.setLong(1, id);
            ps.executeUpdate();
        }
    }

    /** 이 사람이 지금까지 산 확장권 수 (쓴 것 · 남에게 준 것 포함). 가격 단계를 정합니다. */
    public int countBought(UUID buyer) throws SQLException {
        return count("SELECT COUNT(*) FROM ruc_ender_voucher WHERE buyer = ?", buyer);
    }

    /** 이 사람이 사서 아직 아무도 쓰지 않은 확장권 수. */
    public int countOutstanding(UUID buyer) throws SQLException {
        return count("SELECT COUNT(*) FROM ruc_ender_voucher WHERE buyer = ? AND redeemed_at IS NULL", buyer);
    }

    /** @return 1 = 이번에 사용됨, 0 = 이미 사용됨, -1 = 없는 확장권 */
    public int redeem(long id, UUID by) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE ruc_ender_voucher SET redeemed_by = ?, redeemed_at = ? WHERE id = ? AND redeemed_at IS NULL")) {
            ps.setString(1, by.toString());
            ps.setLong(2, System.currentTimeMillis());
            ps.setLong(3, id);
            if (ps.executeUpdate() == 1) return 1;
        }
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT 1 FROM ruc_ender_voucher WHERE id = ?")) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? 0 : -1;
            }
        }
    }

    /** 사용 표시를 되돌립니다 (권리 기록이 실패했을 때). */
    public void unredeem(long id) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE ruc_ender_voucher SET redeemed_by = NULL, redeemed_at = NULL WHERE id = ?")) {
            ps.setLong(1, id);
            ps.executeUpdate();
        }
    }

    private int count(String sql, UUID uuid) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
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
