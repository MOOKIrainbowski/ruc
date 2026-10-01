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
 * {@code ruc_mail} — 우편함 (Phase 5.5).
 *
 * <h2>왜 Core 가 소유하는가</h2>
 * 우편함은 네트워크 전역입니다. 홈에서 받은 보상을 약탈 서버에서 꺼낼 수 있어야
 * 하고, 유저 상점(Phase 10)에서 산 물건은 어느 서버에 있든 도착해야 합니다.
 * 서버별 모듈이 소유하면 서버마다 다른 우편함이 생깁니다.
 *
 * <h2>행 하나 = 우편 하나</h2>
 * 아이템 한 뭉치 또는 Ruc 한 덩이입니다. 여러 아이템을 한 행에 묶지 않습니다 —
 * 부분 수령(인벤토리가 반만 남았을 때)이 생기면 "반쯤 받은 우편" 이라는 상태를
 * 다뤄야 하고, 그 상태에서 서버가 죽으면 무엇이 남았는지 알 수 없습니다.
 *
 * <h2>수령은 DB 가 판정합니다</h2>
 * {@link #claim} 은 {@code claimed_at IS NULL} 조건이 붙은 UPDATE 이고, 갱신된
 * 행 수로 성공을 판정합니다. 4개 서버가 같은 DB 를 보기 때문에 애플리케이션
 * 쪽 검사만으로는 같은 우편을 두 번 수령하는 경로를 막을 수 없습니다.
 */
public class MailboxRepository {

    private final Database database;

    public MailboxRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        // recipient 로 이름 짓는 이유: owner 는 SQL 방언에 따라 예약어입니다.
        // item 은 Base64 라 길이를 못 박을 수 없어 TEXT 입니다.
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_mail (
                    id         INT          NOT NULL AUTO_INCREMENT,
                    recipient  VARCHAR(36)  NOT NULL,
                    item       TEXT         NULL,
                    ruc        BIGINT       NOT NULL DEFAULT 0,
                    sender     VARCHAR(32)  NOT NULL,
                    reason     VARCHAR(32)  NOT NULL,
                    sent_at    BIGINT       NOT NULL,
                    expires_at BIGINT       NOT NULL,
                    claimed_at BIGINT       NULL,
                    PRIMARY KEY (id)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
            // 조회는 언제나 "이 사람의 안 받은 우편" 입니다.
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_mail_recipient "
                    + "ON ruc_mail (recipient, claimed_at)");
            // 만료 청소는 반대로 수령인을 가리지 않고 시간만 봅니다.
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_ruc_mail_expires "
                    + "ON ruc_mail (expires_at)");
        }
    }

    /** 우편 발송. 생성된 id 를 돌려줍니다 (실패 시 -1). */
    public long insert(Mail mail) throws SQLException {
        String sql = """
                INSERT INTO ruc_mail
                    (recipient, item, ruc, sender, reason, sent_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, mail.recipient().toString());
            ps.setString(2, mail.item());
            ps.setLong(3, mail.ruc());
            ps.setString(4, mail.sender());
            ps.setString(5, mail.reason());
            ps.setLong(6, mail.sentAt());
            ps.setLong(7, mail.expiresAt());
            ps.executeUpdate();

            try (ResultSet keys = ps.getGeneratedKeys()) {
                return keys.next() ? keys.getLong(1) : -1;
            }
        }
    }

    /**
     * 아직 받지 않았고 만료되지 않은 우편. <b>오래된 것이 먼저</b>입니다.
     *
     * 최신순이 아니라 오래된 순으로 주는 이유: 목록의 첫 장에 와 있어야 하는 것은
     * 방금 온 우편이 아니라 <b>곧 사라질 우편</b>입니다.
     */
    public List<Mail> listUnclaimed(UUID recipient, long now) throws SQLException {
        String sql = """
                SELECT * FROM ruc_mail
                WHERE recipient = ? AND claimed_at IS NULL AND expires_at > ?
                ORDER BY sent_at ASC, id ASC
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, recipient.toString());
            ps.setLong(2, now);
            try (ResultSet rs = ps.executeQuery()) {
                List<Mail> out = new ArrayList<>();
                while (rs.next()) out.add(map(rs));
                return out;
            }
        }
    }

    public int countUnclaimed(UUID recipient, long now) throws SQLException {
        String sql = """
                SELECT COUNT(*) FROM ruc_mail
                WHERE recipient = ? AND claimed_at IS NULL AND expires_at > ?
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, recipient.toString());
            ps.setLong(2, now);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        }
    }

    /**
     * 수령 처리. 이미 받았거나 만료됐으면 false 이고, 이때 아무것도 바뀌지 않습니다.
     *
     * recipient 를 조건에 넣는 이유: id 만으로 UPDATE 하면 남의 우편 id 를 아는
     * 것만으로 수령이 됩니다. 지금은 id 가 밖으로 나가지 않지만, 클릭 처리에서
     * 슬롯→id 를 들고 다니므로 조건을 붙여 두는 쪽이 안전합니다.
     */
    public boolean claim(long id, UUID recipient, long now) throws SQLException {
        String sql = """
                UPDATE ruc_mail SET claimed_at = ?
                WHERE id = ? AND recipient = ? AND claimed_at IS NULL AND expires_at > ?
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, now);
            ps.setLong(2, id);
            ps.setString(3, recipient.toString());
            ps.setLong(4, now);
            return ps.executeUpdate() == 1;
        }
    }

    /**
     * 수령을 되돌립니다.
     *
     * 수령은 "DB 에 표시 → 인벤토리에 넣기" 순서인데, 뒤쪽이 실패하는 경우가
     * 실제로 있습니다(그 사이에 인벤토리가 찼을 때). 되돌릴 수단이 없으면
     * 그 우편은 받지도 못한 채 사라집니다.
     */
    public void unclaim(long id) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE ruc_mail SET claimed_at = NULL WHERE id = ?")) {
            ps.setLong(1, id);
            ps.executeUpdate();
        }
    }

    public Mail find(long id) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT * FROM ruc_mail WHERE id = ?")) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        }
    }

    /**
     * 청소. 만료된 미수령분과, 받은 지 오래된 영수증을 지웁니다.
     *
     * 받은 우편을 바로 지우지 않는 이유: "보상이 안 왔다" 는 문의가 들어올 때
     * 근거가 남아 있어야 합니다. 영수증도 결국 같은 보관 기간이 지나면 지웁니다.
     *
     * @return 지운 행 수
     */
    /**
     * 이 사유로 보낸 우편이 이미 있는가 (받았든 안 받았든).
     * 충전 지급처럼 "한 번만" 보내야 하는 우편의 중복 방지에 씁니다.
     */
    public boolean existsByReason(UUID recipient, String reason) throws SQLException {
        String sql = "SELECT 1 FROM ruc_mail WHERE recipient = ? AND reason = ? LIMIT 1";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, recipient.toString());
            ps.setString(2, reason);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    public int purge(long expiredBefore, long claimedBefore) throws SQLException {
        int removed = 0;
        try (Connection conn = database.getConnection()) {
            try (PreparedStatement ps = conn.prepareStatement(
                    "DELETE FROM ruc_mail WHERE claimed_at IS NULL AND expires_at <= ?")) {
                ps.setLong(1, expiredBefore);
                removed += ps.executeUpdate();
            }
            try (PreparedStatement ps = conn.prepareStatement(
                    "DELETE FROM ruc_mail WHERE claimed_at IS NOT NULL AND claimed_at <= ?")) {
                ps.setLong(1, claimedBefore);
                removed += ps.executeUpdate();
            }
        }
        return removed;
    }

    private Mail map(ResultSet rs) throws SQLException {
        // claimed_at 의 null 판정은 그 컬럼을 읽은 직후에 해야 합니다
        // (PlayerRepository 의 verified_at 과 같은 이유).
        long rawClaimed = rs.getLong("claimed_at");
        Long claimedAt = rs.wasNull() ? null : rawClaimed;

        return new Mail(
                rs.getLong("id"),
                UUID.fromString(rs.getString("recipient")),
                rs.getString("item"),
                rs.getLong("ruc"),
                rs.getString("sender"),
                rs.getString("reason"),
                rs.getLong("sent_at"),
                rs.getLong("expires_at"),
                claimedAt);
    }

    /**
     * 우편 한 통.
     *
     * {@code item} 은 Base64 직렬화된 ItemStack 이거나 null(= Ruc 만 담긴 우편)
     * 입니다. 둘 다 담긴 우편도 가능하지만 지금 만드는 경로는 한쪽씩만 씁니다.
     */
    public record Mail(long id, UUID recipient, String item, long ruc,
                       String sender, String reason,
                       long sentAt, long expiresAt, Long claimedAt) {

        /** 발송용. id 와 claimed_at 은 DB 가 채웁니다. */
        public static Mail outgoing(UUID recipient, String item, long ruc,
                                    String sender, String reason,
                                    long sentAt, long expiresAt) {
            return new Mail(-1, recipient, item, ruc, sender, reason,
                    sentAt, expiresAt, null);
        }

        public boolean hasItem() {
            return item != null && !item.isEmpty();
        }
    }
}
