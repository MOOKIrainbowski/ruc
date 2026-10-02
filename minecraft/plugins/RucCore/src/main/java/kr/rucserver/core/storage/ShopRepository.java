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
 * {@code ruc_shop_listing} — 유저 상점 매물 (Phase 10).
 *
 * <h2>상태</h2>
 * <pre>
 * ACTIVE ──(구매)──► SOLD       item_done = 구매자에게 우편 / proceeds_done = 판매자에게 대금
 *        ──(취소)──► CANCELLED  item_done = 판매자에게 되돌림
 *        ──(기간)──► EXPIRED    item_done = 판매자에게 되돌림
 * </pre>
 * 전이는 전부 {@code WHERE status = 'ACTIVE'} 조건부 UPDATE 입니다. 두 사람이 같은 물건을
 * 동시에 더블클릭해도 한 명만 이깁니다 — 4개 서버가 같은 표를 보므로 자바 쪽 검사로는
 * 막을 수 없습니다 (우편 수령 §6.21 과 같은 구조).
 *
 * <h2>왜 우편이 두 단계인가</h2>
 * "팔림" 표시와 우편 발송은 한 트랜잭션이 아닙니다. 그 사이에 서버가 죽으면 돈은 나갔는데
 * 물건이 안 간 상태가 됩니다. {@code item_done} · {@code proceeds_done} 이 그 빈틈을 기록하고,
 * 청소 작업이 채웁니다. 우편은 사유(주문 번호)로 한 번만 가므로 다시 보내도 안전합니다.
 */
public class ShopRepository {

    private final Database database;

    public ShopRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_shop_listing (
                    id            INT          NOT NULL AUTO_INCREMENT,
                    seller        VARCHAR(36)  NOT NULL,
                    seller_name   VARCHAR(16)  NOT NULL,
                    item          TEXT         NOT NULL,
                    price         BIGINT       NOT NULL,
                    listed_at     BIGINT       NOT NULL,
                    expires_at    BIGINT       NOT NULL,
                    status        VARCHAR(12)  NOT NULL,
                    buyer         VARCHAR(36)  NULL,
                    buyer_name    VARCHAR(16)  NULL,
                    closed_at     BIGINT       NULL,
                    fee           BIGINT       NOT NULL DEFAULT 0,
                    item_done     BOOLEAN      NOT NULL DEFAULT FALSE,
                    proceeds_done BOOLEAN      NOT NULL DEFAULT FALSE,
                    PRIMARY KEY (id)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_shop_status ON ruc_shop_listing (status, listed_at)");
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_shop_seller ON ruc_shop_listing (seller, status)");
        }
    }

    public long insert(UUID seller, String sellerName, String item, long price, long listedAt, long expiresAt)
            throws SQLException {
        String sql = """
                INSERT INTO ruc_shop_listing (seller, seller_name, item, price, listed_at, expires_at, status)
                VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, seller.toString());
            ps.setString(2, sellerName);
            ps.setString(3, item);
            ps.setLong(4, price);
            ps.setLong(5, listedAt);
            ps.setLong(6, expiresAt);
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                return keys.next() ? keys.getLong(1) : -1;
            }
        }
    }

    public Listing find(long id) throws SQLException {
        List<Listing> list = query("SELECT * FROM ruc_shop_listing WHERE id = ?", ps -> ps.setLong(1, id));
        return list.isEmpty() ? null : list.get(0);
    }

    /** 우편 단계에서 쓰는 조회 — 실패해도 예외 없이 null (청소가 다시 시도합니다). */
    public Listing findQuietly(long id) {
        try {
            return find(id);
        } catch (SQLException e) {
            return null;
        }
    }

    /** 살아 있는 매물. {@code seller} 가 null 이면 전체, 아니면 그 사람 것만. 최신순. */
    public List<Listing> active(UUID seller, long now, int offset, int limit) throws SQLException {
        String sql = "SELECT * FROM ruc_shop_listing WHERE status = 'ACTIVE' AND expires_at > ?"
                + (seller != null ? " AND seller = ?" : "")
                + " ORDER BY listed_at DESC, id DESC LIMIT ? OFFSET ?";
        return query(sql, ps -> {
            int i = 1;
            ps.setLong(i++, now);
            if (seller != null) ps.setString(i++, seller.toString());
            ps.setInt(i++, limit);
            ps.setInt(i, offset);
        });
    }

    public int countActive(UUID seller, long now) throws SQLException {
        String sql = "SELECT COUNT(*) FROM ruc_shop_listing WHERE status = 'ACTIVE' AND expires_at > ?"
                + (seller != null ? " AND seller = ?" : "");
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, now);
            if (seller != null) ps.setString(2, seller.toString());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        }
    }

    /** 구매 확정. 이번 호출이 이겼을 때만 true. */
    public boolean markSold(long id, UUID buyer, String buyerName, long fee, long now) throws SQLException {
        String sql = """
                UPDATE ruc_shop_listing SET status = 'SOLD', buyer = ?, buyer_name = ?, fee = ?, closed_at = ?
                WHERE id = ? AND status = 'ACTIVE' AND expires_at > ?
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, buyer.toString());
            ps.setString(2, buyerName);
            ps.setLong(3, fee);
            ps.setLong(4, now);
            ps.setLong(5, id);
            ps.setLong(6, now);
            return ps.executeUpdate() == 1;
        }
    }

    /** 판매 취소 — 판매자 본인 것만. */
    public boolean markCancelled(long id, UUID seller, long now) throws SQLException {
        String sql = """
                UPDATE ruc_shop_listing SET status = 'CANCELLED', closed_at = ?
                WHERE id = ? AND seller = ? AND status = 'ACTIVE'
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, now);
            ps.setLong(2, id);
            ps.setString(3, seller.toString());
            return ps.executeUpdate() == 1;
        }
    }

    /** 기간이 지난 매물을 EXPIRED 로. 되돌림은 청소가 이어서 합니다. */
    public int expire(long now) throws SQLException {
        String sql = "UPDATE ruc_shop_listing SET status = 'EXPIRED', closed_at = ? WHERE status = 'ACTIVE' AND expires_at <= ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, now);
            ps.setLong(2, now);
            return ps.executeUpdate();
        }
    }

    public void markItemDone(long id) throws SQLException {
        flag("UPDATE ruc_shop_listing SET item_done = TRUE WHERE id = ?", id);
    }

    public void markProceedsDone(long id) throws SQLException {
        flag("UPDATE ruc_shop_listing SET proceeds_done = TRUE WHERE id = ?", id);
    }

    /** 끝났는데 우편이 아직인 매물 — 청소 대상. */
    public List<Listing> unfinished(int limit) throws SQLException {
        String sql = """
                SELECT * FROM ruc_shop_listing
                WHERE (status IN ('SOLD', 'CANCELLED', 'EXPIRED') AND item_done = FALSE)
                   OR (status = 'SOLD' AND proceeds_done = FALSE)
                ORDER BY id ASC LIMIT ?
                """;
        return query(sql, ps -> ps.setInt(1, limit));
    }

    // ── 내부 ──────────────────────────────────────────────────────────

    private interface Binder { void bind(PreparedStatement ps) throws SQLException; }

    private void flag(String sql, long id) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.executeUpdate();
        }
    }

    private List<Listing> query(String sql, Binder binder) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            binder.bind(ps);
            try (ResultSet rs = ps.executeQuery()) {
                List<Listing> out = new ArrayList<>();
                while (rs.next()) {
                    String buyer = rs.getString("buyer");
                    out.add(new Listing(
                            rs.getLong("id"),
                            UUID.fromString(rs.getString("seller")),
                            rs.getString("seller_name"),
                            rs.getString("item"),
                            rs.getLong("price"),
                            rs.getLong("listed_at"),
                            rs.getLong("expires_at"),
                            rs.getString("status"),
                            buyer == null ? null : UUID.fromString(buyer),
                            rs.getString("buyer_name"),
                            rs.getLong("fee"),
                            rs.getBoolean("item_done"),
                            rs.getBoolean("proceeds_done")));
                }
                return out;
            }
        }
    }

    public record Listing(long id, UUID seller, String sellerName, String item, long price,
                          long listedAt, long expiresAt, String status, UUID buyer, String buyerName,
                          long fee, boolean itemDone, boolean proceedsDone) { }
}
