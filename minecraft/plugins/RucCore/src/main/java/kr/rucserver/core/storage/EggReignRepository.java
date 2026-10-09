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
 * ruc_egg_reign — 시즌별 드래곤 알 통치 시간 (2026-10-09, docs/08 B).
 * 약탈(RucRaid)이 쌓고, 홈 광장 기념비(Core)가 읽습니다. 그래서 Core 가 소유합니다. 블로킹 I/O.
 */
public class EggReignRepository {

    public record Reign(String name, long seconds) { }

    private final Database database;

    public EggReignRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS ruc_egg_reign (
                        season   VARCHAR(16) NOT NULL,
                        uuid     VARCHAR(36) NOT NULL,
                        name     VARCHAR(16) NOT NULL,
                        seconds  BIGINT      NOT NULL,
                        PRIMARY KEY (season, uuid)
                    )
                    """);
        }
    }

    public void addSeconds(String season, UUID uuid, String name, long seconds) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement("""
                     INSERT INTO ruc_egg_reign (season, uuid, name, seconds) VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE seconds = seconds + VALUES(seconds), name = VALUES(name)
                     """)) {
            ps.setString(1, season);
            ps.setString(2, uuid.toString());
            ps.setString(3, name);
            ps.setLong(4, seconds);
            ps.executeUpdate();
        }
    }

    public List<Reign> top(String season, int limit) throws SQLException {
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT name, seconds FROM ruc_egg_reign WHERE season = ? ORDER BY seconds DESC LIMIT ?")) {
            ps.setString(1, season);
            ps.setInt(2, limit);
            try (ResultSet rs = ps.executeQuery()) {
                List<Reign> out = new ArrayList<>();
                while (rs.next()) out.add(new Reign(rs.getString(1), rs.getLong(2)));
                return out;
            }
        }
    }

    /** "3시간 12분" */
    public static String format(long seconds) {
        long h = seconds / 3600, m = seconds % 3600 / 60;
        return h > 0 ? h + "시간 " + m + "분" : m + "분";
    }
}
