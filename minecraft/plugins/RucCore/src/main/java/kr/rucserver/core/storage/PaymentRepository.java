package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.sql.Statement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 현금 충전 (docs/payment-design.md, 2026-10-02 승인).
 *
 * <h2>테이블 넷</h2>
 * <ul>
 *   <li>{@code ruc_pay_order} — 디스코드 {@code /충전} 이 만든 주문. 누구에게 무엇을
 *       줄지가 <b>주문 시점에</b> 확정됩니다 (D10 인증으로 디스코드 ↔ UUID).</li>
 *   <li>{@code ruc_pay_deposit} — 입금 한 건. 알림(A) · 관리자 확인(D) · 나중의 PG(C)
 *       가 전부 여기로 들어옵니다. {@code (source, external_id)} UNIQUE 가
 *       같은 알림의 재전송을 막습니다.</li>
 *   <li>{@code ruc_pay_log} — 감사 로그. 지우지 않습니다 (전자상거래법 5년 보관).</li>
 *   <li>{@code ruc_entitlement} — 기간제 등급 · 엔더상자 확장 같은 "권리" 의 <b>원장</b>.
 *       현재 값은 저장하지 않고 행을 합산해 계산합니다 (아래).</li>
 * </ul>
 *
 * <h2>상태 전이는 전부 조건부 UPDATE</h2>
 * {@code WHERE status = '<이전>'} 이 붙어 있고 갱신 행 수로 판정합니다. 자동 매칭과
 * 관리자 버튼이 거의 동시에 같은 주문을 처리해도 한쪽만 이깁니다 (§6.21 과 같은 구조).
 *
 * <h2>권리는 원장으로 — 왜 "현재 만료일" 컬럼이 아닌가</h2>
 * 지급을 다시 시도할 때(응답만 못 받은 경우) 만료일 컬럼에 30일을 더하면 두 번
 * 더해집니다. 원장 행은 {@code order_id} UNIQUE 라 두 번 들어가지 않고, 환불은
 * 그 행에 {@code revoked_at} 만 찍으면 됩니다. 현재 값은 매번 합산합니다 — 한 사람의
 * 행은 많아야 수십 개입니다.
 */
public class PaymentRepository {

    private final Database database;

    public PaymentRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String orders = """
                CREATE TABLE IF NOT EXISTS ruc_pay_order (
                    id           INT          NOT NULL AUTO_INCREMENT,
                    code         VARCHAR(8)   NOT NULL,
                    discord_id   VARCHAR(32)  NOT NULL,
                    uuid         VARCHAR(36)  NOT NULL,
                    player_name  VARCHAR(16)  NOT NULL,
                    product_id   VARCHAR(32)  NOT NULL,
                    grants       VARCHAR(255) NOT NULL,
                    amount       INT          NOT NULL,
                    status       VARCHAR(16)  NOT NULL,
                    created_at   BIGINT       NOT NULL,
                    expires_at   BIGINT       NOT NULL,
                    paid_at      BIGINT       NULL,
                    delivered_at BIGINT       NULL,
                    deposit_id   INT          NULL,
                    discord_done BOOLEAN      NOT NULL DEFAULT FALSE,
                    note         VARCHAR(255) NULL,
                    PRIMARY KEY (id)
                )
                """;
        String deposits = """
                CREATE TABLE IF NOT EXISTS ruc_pay_deposit (
                    id           INT          NOT NULL AUTO_INCREMENT,
                    source       VARCHAR(16)  NOT NULL,
                    external_id  VARCHAR(64)  NOT NULL,
                    amount       INT          NOT NULL,
                    depositor    VARCHAR(64)  NOT NULL,
                    received_at  BIGINT       NOT NULL,
                    status       VARCHAR(16)  NOT NULL,
                    reason       VARCHAR(24)  NULL,
                    order_id     INT          NULL,
                    resolved_by  VARCHAR(32)  NULL,
                    resolved_at  BIGINT       NULL,
                    PRIMARY KEY (id),
                    CONSTRAINT uq_ruc_pay_deposit_ext UNIQUE (source, external_id)
                )
                """;
        String log = """
                CREATE TABLE IF NOT EXISTS ruc_pay_log (
                    id          INT          NOT NULL AUTO_INCREMENT,
                    at          BIGINT       NOT NULL,
                    order_id    INT          NULL,
                    deposit_id  INT          NULL,
                    action      VARCHAR(24)  NOT NULL,
                    actor       VARCHAR(32)  NOT NULL,
                    detail      VARCHAR(500) NULL,
                    PRIMARY KEY (id)
                )
                """;
        String entitlements = """
                CREATE TABLE IF NOT EXISTS ruc_entitlement (
                    id           INT          NOT NULL AUTO_INCREMENT,
                    uuid         VARCHAR(36)  NOT NULL,
                    ent_key      VARCHAR(32)  NOT NULL,
                    days         INT          NOT NULL DEFAULT 0,
                    amount       INT          NOT NULL DEFAULT 0,
                    order_id     INT          NULL,
                    source       VARCHAR(16)  NOT NULL,
                    created_at   BIGINT       NOT NULL,
                    revoked_at   BIGINT       NULL,
                    role_cleared BOOLEAN      NOT NULL DEFAULT FALSE,
                    PRIMARY KEY (id),
                    CONSTRAINT uq_ruc_entitlement_order UNIQUE (order_id, ent_key)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(orders);
            st.executeUpdate(deposits);
            st.executeUpdate(log);
            st.executeUpdate(entitlements);
            // 매칭은 코드로 찾고, 코드 재사용 금지(7일)도 코드 + 시각으로 봅니다.
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_pay_order_code "
                    + "ON ruc_pay_order (code, created_at)");
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_pay_order_status "
                    + "ON ruc_pay_order (status, expires_at)");
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_pay_order_discord "
                    + "ON ruc_pay_order (discord_id, status)");
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_pay_deposit_status "
                    + "ON ruc_pay_deposit (status)");
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_entitlement_uuid "
                    + "ON ruc_entitlement (uuid, ent_key)");
        }
    }

    // ── 주문 ───────────────────────────────────────────────────────────

    public long insertOrder(Order o) throws SQLException {
        String sql = """
                INSERT INTO ruc_pay_order
                    (code, discord_id, uuid, player_name, product_id, grants, amount,
                     status, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, o.code());
            ps.setString(2, o.discordId());
            ps.setString(3, o.uuid().toString());
            ps.setString(4, o.playerName());
            ps.setString(5, o.productId());
            ps.setString(6, o.grants());
            ps.setInt(7, o.amount());
            ps.setLong(8, o.createdAt());
            ps.setLong(9, o.expiresAt());
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                return keys.next() ? keys.getLong(1) : -1;
            }
        }
    }

    public Order findOrder(long id) throws SQLException {
        return oneOrder("SELECT * FROM ruc_pay_order WHERE id = ?", ps -> ps.setLong(1, id));
    }

    /** 그 코드의 가장 최근 주문. 코드는 7일간 재사용하지 않으므로 사실상 하나입니다. */
    public Order findOrderByCode(String code) throws SQLException {
        return oneOrder("SELECT * FROM ruc_pay_order WHERE code = ? ORDER BY created_at DESC LIMIT 1",
                ps -> ps.setString(1, code));
    }

    /** 최근 {@code since} 이후에 쓰인 코드인가 (상태 무관). */
    public boolean codeUsedSince(String code, long since) throws SQLException {
        String sql = "SELECT 1 FROM ruc_pay_order WHERE code = ? AND created_at >= ? LIMIT 1";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, code);
            ps.setLong(2, since);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    public int countPending(String discordId, long now) throws SQLException {
        String sql = """
                SELECT COUNT(*) FROM ruc_pay_order
                WHERE discord_id = ? AND status = 'PENDING' AND expires_at > ?
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, discordId);
            ps.setLong(2, now);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        }
    }

    public long lastOrderAt(String discordId) throws SQLException {
        // RUC · Gold 결제(바로 지급되는 주문)는 연타 방지 대상이 아닙니다.
        String sql = "SELECT MAX(created_at) FROM ruc_pay_order WHERE discord_id = ? "
                + "AND (note IS NULL OR note NOT IN ('RUC', 'GOLD'))";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, discordId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0;
            }
        }
    }

    /** 최근 주문 (조회용). 디스코드 ID 또는 닉네임. */
    public List<Order> recentOrders(String discordIdOrName, int limit) throws SQLException {
        String sql = """
                SELECT * FROM ruc_pay_order
                WHERE discord_id = ? OR LOWER(player_name) = LOWER(?)
                ORDER BY created_at DESC LIMIT ?
                """;
        return manyOrders(sql, ps -> {
            ps.setString(1, discordIdOrName);
            ps.setString(2, discordIdOrName);
            ps.setInt(3, limit);
        });
    }

    /** 지급은 끝났는데 디스코드 역할 부여가 아직인 주문. */
    public List<Order> discordPending(int limit) throws SQLException {
        String sql = """
                SELECT * FROM ruc_pay_order
                WHERE status = 'DELIVERED' AND discord_done = FALSE
                ORDER BY id ASC LIMIT ?
                """;
        return manyOrders(sql, ps -> ps.setInt(1, limit));
    }

    /** 지급을 다시 시도해야 하는 주문. */
    public List<Order> deliverFailed(int limit) throws SQLException {
        String sql = "SELECT * FROM ruc_pay_order WHERE status = 'DELIVER_FAILED' ORDER BY id ASC LIMIT ?";
        return manyOrders(sql, ps -> ps.setInt(1, limit));
    }

    /**
     * 상태 전이. 이전 상태가 {@code from} 중 하나일 때만 바뀝니다.
     * @return 이번 호출이 바꿨는가
     */
    public boolean transition(long orderId, String to, long at, String... from) throws SQLException {
        StringBuilder in = new StringBuilder();
        for (int i = 0; i < from.length; i++) in.append(i == 0 ? "?" : ", ?");
        String column = switch (to) {
            case "PAID" -> ", paid_at = ?";
            case "DELIVERED" -> ", delivered_at = ?";
            default -> "";
        };
        String sql = "UPDATE ruc_pay_order SET status = ?" + column
                + " WHERE id = ? AND status IN (" + in + ")";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            int i = 1;
            ps.setString(i++, to);
            if (!column.isEmpty()) ps.setLong(i++, at);
            ps.setLong(i++, orderId);
            for (String f : from) ps.setString(i++, f);
            return ps.executeUpdate() == 1;
        }
    }

    public void attachDeposit(long orderId, long depositId) throws SQLException {
        update("UPDATE ruc_pay_order SET deposit_id = ? WHERE id = ?", ps -> {
            ps.setLong(1, depositId);
            ps.setLong(2, orderId);
        });
    }

    public void setOrderNote(long orderId, String note) throws SQLException {
        update("UPDATE ruc_pay_order SET note = ? WHERE id = ?", ps -> {
            ps.setString(1, note);
            ps.setLong(2, orderId);
        });
    }

    public boolean markDiscordDone(long orderId) throws SQLException {
        return update("UPDATE ruc_pay_order SET discord_done = TRUE WHERE id = ? AND discord_done = FALSE",
                ps -> ps.setLong(1, orderId)) == 1;
    }

    /** 만료 처리. 모든 서버가 돌려도 조건부 UPDATE 라 결과가 같습니다. */
    public int expire(long now) throws SQLException {
        return update("UPDATE ruc_pay_order SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at <= ?",
                ps -> ps.setLong(1, now));
    }

    // ── 입금 ───────────────────────────────────────────────────────────

    /**
     * 입금 기록.
     * @return 새 id. 같은 {@code (source, external_id)} 가 이미 있으면 <b>음수로 된 기존 id</b>.
     */
    public long insertDeposit(Deposit d) throws SQLException {
        String sql = """
                INSERT INTO ruc_pay_deposit
                    (source, external_id, amount, depositor, received_at, status)
                VALUES (?, ?, ?, ?, ?, 'NEW')
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, d.source());
            ps.setString(2, d.externalId());
            ps.setInt(3, d.amount());
            ps.setString(4, d.depositor());
            ps.setLong(5, d.receivedAt());
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                return keys.next() ? keys.getLong(1) : 0;
            }
        } catch (SQLException e) {
            // H2 · MySQL 양쪽의 UNIQUE 위반 (SanctionRepository 와 같은 판정)
            if (e instanceof SQLIntegrityConstraintViolationException
                    || (e.getSQLState() != null && e.getSQLState().startsWith("23"))) {
                Deposit existing = findDepositByExternal(d.source(), d.externalId());
                if (existing != null) return -existing.id();
            }
            throw e;
        }
    }

    public Deposit findDeposit(long id) throws SQLException {
        return oneDeposit("SELECT * FROM ruc_pay_deposit WHERE id = ?", ps -> ps.setLong(1, id));
    }

    public Deposit findDepositByExternal(String source, String externalId) throws SQLException {
        return oneDeposit("SELECT * FROM ruc_pay_deposit WHERE source = ? AND external_id = ?", ps -> {
            ps.setString(1, source);
            ps.setString(2, externalId);
        });
    }

    public List<Deposit> depositsByStatus(String status, int limit) throws SQLException {
        String sql = "SELECT * FROM ruc_pay_deposit WHERE status = ? ORDER BY id ASC LIMIT ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, status);
            ps.setInt(2, limit);
            try (ResultSet rs = ps.executeQuery()) {
                List<Deposit> out = new ArrayList<>();
                while (rs.next()) out.add(mapDeposit(rs));
                return out;
            }
        }
    }

    /** 이 주문에 이미 매칭된 입금이 있는가 (같은 코드로 두 번 입금). */
    public boolean orderHasMatchedDeposit(long orderId) throws SQLException {
        String sql = "SELECT 1 FROM ruc_pay_deposit WHERE order_id = ? AND status = 'MATCHED' LIMIT 1";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    /**
     * 입금 상태 전이. {@code from} 중 하나일 때만.
     * @param orderId null 이면 바꾸지 않음
     */
    public boolean resolveDeposit(long depositId, String to, String reason, Long orderId,
                                  String by, long at, String... from) throws SQLException {
        StringBuilder in = new StringBuilder();
        for (int i = 0; i < from.length; i++) in.append(i == 0 ? "?" : ", ?");
        String sql = "UPDATE ruc_pay_deposit SET status = ?, reason = ?, resolved_by = ?, resolved_at = ?"
                + (orderId != null ? ", order_id = ?" : "")
                + " WHERE id = ? AND status IN (" + in + ")";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            int i = 1;
            ps.setString(i++, to);
            if (reason == null) ps.setNull(i++, Types.VARCHAR); else ps.setString(i++, reason);
            ps.setString(i++, by);
            ps.setLong(i++, at);
            if (orderId != null) ps.setLong(i++, orderId);
            ps.setLong(i++, depositId);
            for (String f : from) ps.setString(i++, f);
            return ps.executeUpdate() == 1;
        }
    }

    // ── 로그 ───────────────────────────────────────────────────────────

    public void log(Long orderId, Long depositId, String action, String actor, String detail) throws SQLException {
        String sql = "INSERT INTO ruc_pay_log (at, order_id, deposit_id, action, actor, detail) VALUES (?, ?, ?, ?, ?, ?)";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, System.currentTimeMillis());
            if (orderId == null) ps.setNull(2, Types.INTEGER); else ps.setLong(2, orderId);
            if (depositId == null) ps.setNull(3, Types.INTEGER); else ps.setLong(3, depositId);
            ps.setString(4, action);
            ps.setString(5, actor.length() > 32 ? actor.substring(0, 32) : actor);
            ps.setString(6, detail == null ? null : (detail.length() > 500 ? detail.substring(0, 500) : detail));
            ps.executeUpdate();
        }
    }

    public int countLog(long orderId) throws SQLException {
        String sql = "SELECT COUNT(*) FROM ruc_pay_log WHERE order_id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        }
    }

    // ── 권리 원장 ──────────────────────────────────────────────────────

    /**
     * 원장에 한 줄. 같은 주문 · 같은 키는 한 번만 들어갑니다.
     * @return 이번에 들어갔는가 (false = 이미 있음 — 재지급)
     */
    public boolean addEntitlement(UUID uuid, String key, int days, int amount, Long orderId,
                                  String source, long at) throws SQLException {
        String sql = """
                INSERT INTO ruc_entitlement (uuid, ent_key, days, amount, order_id, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, key);
            ps.setInt(3, days);
            ps.setInt(4, amount);
            if (orderId == null) ps.setNull(5, Types.INTEGER); else ps.setLong(5, orderId);
            ps.setString(6, source);
            ps.setLong(7, at);
            ps.executeUpdate();
            return true;
        } catch (SQLException e) {
            if (e instanceof SQLIntegrityConstraintViolationException
                    || (e.getSQLState() != null && e.getSQLState().startsWith("23"))) {
                return false;
            }
            throw e;
        }
    }

    public int revokeEntitlements(long orderId, long at) throws SQLException {
        return update("UPDATE ruc_entitlement SET revoked_at = ? WHERE order_id = ? AND revoked_at IS NULL", ps -> {
            ps.setLong(1, at);
            ps.setLong(2, orderId);
        });
    }

    /** 그 사람 · 그 키의 살아 있는 원장 행. 오래된 것부터. */
    public List<EntitlementRow> entitlements(UUID uuid, String key) throws SQLException {
        String sql = """
                SELECT * FROM ruc_entitlement
                WHERE uuid = ? AND ent_key = ? AND revoked_at IS NULL
                ORDER BY created_at ASC, id ASC
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, key);
            try (ResultSet rs = ps.executeQuery()) {
                List<EntitlementRow> out = new ArrayList<>();
                while (rs.next()) out.add(mapEntitlement(rs));
                return out;
            }
        }
    }

    /**
     * 역할을 아직 떼지 않은 기간제 권리의 (uuid, 키) 목록. 봇의 만료 확인 재료입니다.
     * 실제로 끝났는지는 호출부가 원장을 합산해 판정합니다.
     */
    public List<String[]> roleHolders() throws SQLException {
        String sql = """
                SELECT DISTINCT uuid, ent_key FROM ruc_entitlement
                WHERE days > 0 AND role_cleared = FALSE
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            List<String[]> out = new ArrayList<>();
            while (rs.next()) out.add(new String[] { rs.getString(1), rs.getString(2) });
            return out;
        }
    }

    public int markRoleCleared(UUID uuid, String key) throws SQLException {
        return update("UPDATE ruc_entitlement SET role_cleared = TRUE WHERE uuid = ? AND ent_key = ? AND role_cleared = FALSE",
                ps -> {
                    ps.setString(1, uuid.toString());
                    ps.setString(2, key);
                });
    }

    // ── 내부 ──────────────────────────────────────────────────────────

    private interface Binder { void bind(PreparedStatement ps) throws SQLException; }

    private int update(String sql, Binder binder) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            binder.bind(ps);
            return ps.executeUpdate();
        }
    }

    private Order oneOrder(String sql, Binder binder) throws SQLException {
        List<Order> list = manyOrders(sql, binder);
        return list.isEmpty() ? null : list.get(0);
    }

    private List<Order> manyOrders(String sql, Binder binder) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            binder.bind(ps);
            try (ResultSet rs = ps.executeQuery()) {
                List<Order> out = new ArrayList<>();
                while (rs.next()) out.add(mapOrder(rs));
                return out;
            }
        }
    }

    private Deposit oneDeposit(String sql, Binder binder) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            binder.bind(ps);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? mapDeposit(rs) : null;
            }
        }
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long v = rs.getLong(column);
        return rs.wasNull() ? null : v;
    }

    private Order mapOrder(ResultSet rs) throws SQLException {
        return new Order(
                rs.getLong("id"),
                rs.getString("code"),
                rs.getString("discord_id"),
                UUID.fromString(rs.getString("uuid")),
                rs.getString("player_name"),
                rs.getString("product_id"),
                rs.getString("grants"),
                rs.getInt("amount"),
                rs.getString("status"),
                rs.getLong("created_at"),
                rs.getLong("expires_at"),
                nullableLong(rs, "paid_at"),
                nullableLong(rs, "delivered_at"),
                nullableLong(rs, "deposit_id"),
                rs.getBoolean("discord_done"),
                rs.getString("note"));
    }

    private Deposit mapDeposit(ResultSet rs) throws SQLException {
        return new Deposit(
                rs.getLong("id"),
                rs.getString("source"),
                rs.getString("external_id"),
                rs.getInt("amount"),
                rs.getString("depositor"),
                rs.getLong("received_at"),
                rs.getString("status"),
                rs.getString("reason"),
                nullableLong(rs, "order_id"));
    }

    private EntitlementRow mapEntitlement(ResultSet rs) throws SQLException {
        return new EntitlementRow(
                rs.getLong("id"),
                rs.getInt("days"),
                rs.getInt("amount"),
                nullableLong(rs, "order_id"),
                rs.getLong("created_at"));
    }

    /** 주문. {@code grants} 는 봇이 넘긴 지급 명세 (예: {@code title:supporter,ent:vip:30}). */
    public record Order(long id, String code, String discordId, UUID uuid, String playerName,
                        String productId, String grants, int amount, String status,
                        long createdAt, long expiresAt, Long paidAt, Long deliveredAt,
                        Long depositId, boolean discordDone, String note) {

        public static Order draft(String code, String discordId, UUID uuid, String playerName,
                                  String productId, String grants, int amount,
                                  long createdAt, long expiresAt) {
            return new Order(0, code, discordId, uuid, playerName, productId, grants, amount,
                    "PENDING", createdAt, expiresAt, null, null, null, false, null);
        }
    }

    public record Deposit(long id, String source, String externalId, int amount, String depositor,
                          long receivedAt, String status, String reason, Long orderId) {

        public static Deposit draft(String source, String externalId, int amount, String depositor,
                                    long receivedAt) {
            return new Deposit(0, source, externalId, amount, depositor, receivedAt, "NEW", null, null);
        }
    }

    public record EntitlementRow(long id, int days, int amount, Long orderId, long createdAt) { }
}
