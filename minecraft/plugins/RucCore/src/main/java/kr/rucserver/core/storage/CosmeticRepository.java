package kr.rucserver.core.storage;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * ruc_cosmetic — 사람마다 종류(파티클 · 펫 · 발광 · 킬 이펙트)별로 장착한 코스메틱 하나.
 * 4개 서버가 같은 DB 를 보므로 어느 서버에서 골라도 따라옵니다. 블로킹 I/O 입니다.
 */
public class CosmeticRepository {

    private final Database database;

    public CosmeticRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_cosmetic (
                    uuid        VARCHAR(36)  NOT NULL,
                    slot        VARCHAR(16)  NOT NULL,
                    item        VARCHAR(32)  NOT NULL,
                    PRIMARY KEY (uuid, slot)
                )
                """;
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
        }
    }

    /** 종류 → 코스메틱 키. */
    public Map<String, String> load(UUID uuid) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT slot, item FROM ruc_cosmetic WHERE uuid = ?")) {
            ps.setString(1, uuid.toString());
            try (ResultSet rs = ps.executeQuery()) {
                Map<String, String> out = new HashMap<>();
                while (rs.next()) out.put(rs.getString(1), rs.getString(2));
                return out;
            }
        }
    }

    /** 장착. item 이 null 이면 해제. */
    public void save(UUID uuid, String slot, String item) throws SQLException {
        try (Connection conn = database.getConnection()) {
            if (item == null) {
                try (PreparedStatement ps = conn.prepareStatement("DELETE FROM ruc_cosmetic WHERE uuid = ? AND slot = ?")) {
                    ps.setString(1, uuid.toString());
                    ps.setString(2, slot);
                    ps.executeUpdate();
                }
                return;
            }
            try (PreparedStatement ps = conn.prepareStatement("""
                    INSERT INTO ruc_cosmetic (uuid, slot, item) VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE item = VALUES(item)
                    """)) {
                ps.setString(1, uuid.toString());
                ps.setString(2, slot);
                ps.setString(3, item);
                ps.executeUpdate();
            }
        }
    }
}
