package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.UUID;

/**
 * 인증 코드 저장소 (D10).
 *
 * 코드는 발급한 마크 UUID에만 유효합니다. 남의 코드를 주워서 자기 디스코드에
 * 입력해도 그 사람 계정이 연동될 뿐, 입력한 사람에게 이득이 없습니다.
 */
public class VerificationRepository {

    /** 코드 한 건. */
    public record Code(String code, UUID uuid, String name, long issuedAt, long expiresAt) {
        public boolean isExpired() {
            return System.currentTimeMillis() > expiresAt;
        }
    }

    private final Database database;

    public VerificationRepository(Database database) {
        this.database = database;
    }

    /** 해당 플레이어의 기존 코드를 모두 지우고 새 코드를 저장합니다. */
    public void issue(Code code) throws SQLException {
        try (Connection conn = database.getConnection()) {
            try (PreparedStatement del = conn.prepareStatement(
                    "DELETE FROM ruc_verify_code WHERE uuid = ?")) {
                del.setString(1, code.uuid().toString());
                del.executeUpdate();
            }
            try (PreparedStatement ins = conn.prepareStatement(
                    "INSERT INTO ruc_verify_code (code, uuid, name, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)")) {
                ins.setString(1, code.code());
                ins.setString(2, code.uuid().toString());
                ins.setString(3, code.name());
                ins.setLong(4, code.issuedAt());
                ins.setLong(5, code.expiresAt());
                ins.executeUpdate();
            }
        }
    }

    public Code findByCode(String code) throws SQLException {
        String sql = "SELECT * FROM ruc_verify_code WHERE code = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, code);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        }
    }

    public Code findByUuid(UUID uuid) throws SQLException {
        String sql = "SELECT * FROM ruc_verify_code WHERE uuid = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        }
    }

    public void delete(String code) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "DELETE FROM ruc_verify_code WHERE code = ?")) {
            ps.setString(1, code);
            ps.executeUpdate();
        }
    }

    /** 만료된 코드 정리. 주기적으로 호출합니다. */
    public int purgeExpired() throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "DELETE FROM ruc_verify_code WHERE expires_at < ?")) {
            ps.setLong(1, System.currentTimeMillis());
            return ps.executeUpdate();
        }
    }

    /** 코드가 이미 쓰이고 있는지 (충돌 방지). */
    public boolean exists(String code) throws SQLException {
        return findByCode(code) != null;
    }

    private Code map(ResultSet rs) throws SQLException {
        return new Code(
                rs.getString("code"),
                UUID.fromString(rs.getString("uuid")),
                rs.getString("name"),
                rs.getLong("issued_at"),
                rs.getLong("expires_at")
        );
    }
}
