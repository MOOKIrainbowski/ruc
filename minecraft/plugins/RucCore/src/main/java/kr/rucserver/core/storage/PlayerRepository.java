package kr.rucserver.core.storage;

import kr.rucserver.core.model.RucPlayer;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.UUID;

/**
 * ruc_player 테이블 접근.
 *
 * 모든 메서드는 블로킹 I/O입니다. 서버 메인 스레드에서 직접 부르지 마세요 —
 * 호출부(PlayerDataService)가 비동기로 감쌉니다.
 */
public class PlayerRepository {

    private final Database database;

    public PlayerRepository(Database database) {
        this.database = database;
    }

    public RucPlayer find(UUID uuid) throws SQLException {
        String sql = "SELECT * FROM ruc_player WHERE uuid = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        }
    }

    public RucPlayer findByDiscordId(String discordId) throws SQLException {
        String sql = "SELECT * FROM ruc_player WHERE discord_id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, discordId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        }
    }

    public void save(RucPlayer p) throws SQLException {
        // H2를 MySQL 모드로 띄웠기 때문에 이 구문이 양쪽에서 동일하게 동작합니다.
        String sql = """
                INSERT INTO ruc_player
                    (uuid, name, ruc, xp, level, reputation, discord_id, verified_at,
                     kills, deaths, assists, language, first_join, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    ruc = VALUES(ruc),
                    xp = VALUES(xp),
                    level = VALUES(level),
                    reputation = VALUES(reputation),
                    discord_id = VALUES(discord_id),
                    verified_at = VALUES(verified_at),
                    kills = VALUES(kills),
                    deaths = VALUES(deaths),
                    assists = VALUES(assists),
                    language = VALUES(language),
                    last_seen = VALUES(last_seen)
                """;

        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, p.getUuid().toString());
            ps.setString(2, p.getName());
            ps.setLong(3, p.getRuc());
            ps.setLong(4, p.getXp());
            ps.setInt(5, p.getLevel());
            ps.setInt(6, p.getReputation());
            ps.setString(7, p.getDiscordId());
            if (p.getVerifiedAt() == null) {
                ps.setNull(8, java.sql.Types.BIGINT);
            } else {
                ps.setLong(8, p.getVerifiedAt());
            }
            ps.setLong(9, p.getKills());
            ps.setLong(10, p.getDeaths());
            ps.setLong(11, p.getAssists());
            ps.setString(12, p.getLanguage());
            ps.setLong(13, p.getFirstJoin());
            ps.setLong(14, p.getLastSeen());
            ps.executeUpdate();
        }
    }

    private RucPlayer map(ResultSet rs) throws SQLException {
        // wasNull()은 "직전에 읽은 컬럼"에 대한 결과이므로, verified_at을 읽은
        // 직후에 바로 확인해야 합니다. 다른 컬럼을 읽은 뒤에 부르면 그 컬럼의
        // null 여부를 보게 됩니다.
        long rawVerifiedAt = rs.getLong("verified_at");
        Long verifiedAt = rs.wasNull() ? null : rawVerifiedAt;

        return new RucPlayer(
                UUID.fromString(rs.getString("uuid")),
                rs.getString("name"),
                rs.getLong("ruc"),
                rs.getLong("xp"),
                rs.getInt("level"),
                rs.getInt("reputation"),
                rs.getString("discord_id"),
                verifiedAt,
                rs.getLong("kills"),
                rs.getLong("deaths"),
                rs.getLong("assists"),
                rs.getString("language"),
                rs.getLong("first_join"),
                rs.getLong("last_seen")
        );
    }
}
