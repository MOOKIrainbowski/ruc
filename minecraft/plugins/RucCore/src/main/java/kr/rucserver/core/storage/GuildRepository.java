package kr.rucserver.core.storage;

import kr.rucserver.core.model.Guild;
import kr.rucserver.core.model.GuildMember;
import kr.rucserver.core.model.GuildRank;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * 길드 테이블 (§3.5). 네트워크 전역이라 Core가 소유합니다.
 *
 *  - ruc_guild        : 길드 본체. 금고·시즌 점수·국가 여부
 *  - ruc_guild_member : 소속. uuid 를 PK로 두어 <b>한 명이 두 길드에 들 수 없게</b> 합니다
 *  - ruc_guild_invite : 초대장. 메모리에 두면 초대한 사람과 받은 사람이 다른
 *                       서버에 있을 때 초대가 사라지므로 DB에 둡니다
 *
 * 이름·태그의 중복 검사는 소문자 사본 컬럼(name_key / tag_key)에 UNIQUE 를 걸어
 * 합니다. H2는 값 비교가 대소문자를 구분하고 MySQL 기본 콜레이션은 구분하지
 * 않아서, 콜레이션에 맡기면 개발과 운영의 동작이 달라집니다.
 *
 * 모든 메서드는 블로킹 I/O입니다. 메인 스레드에서 직접 부르지 마세요.
 */
public class GuildRepository {

    private final Database database;

    public GuildRepository(Database database) {
        this.database = database;
    }

    public void createSchema() throws SQLException {
        String guild = """
                CREATE TABLE IF NOT EXISTS ruc_guild (
                    id             INT          NOT NULL AUTO_INCREMENT,
                    name           VARCHAR(32)  NOT NULL,
                    name_key       VARCHAR(32)  NOT NULL,
                    tag            VARCHAR(8)   NOT NULL,
                    tag_key        VARCHAR(8)   NOT NULL,
                    master         VARCHAR(36)  NOT NULL,
                    bank           BIGINT       NOT NULL DEFAULT 0,
                    points         BIGINT       NOT NULL DEFAULT 0,
                    nation         BOOLEAN      NOT NULL DEFAULT FALSE,
                    created_at     BIGINT       NOT NULL,
                    last_season_at BIGINT       NOT NULL DEFAULT 0,
                    PRIMARY KEY (id),
                    CONSTRAINT uq_ruc_guild_name UNIQUE (name_key),
                    CONSTRAINT uq_ruc_guild_tag  UNIQUE (tag_key)
                )
                """;

        // uuid 가 PK라는 것이 "동시에 두 길드 소속" 을 DB 차원에서 막는 장치입니다.
        String member = """
                CREATE TABLE IF NOT EXISTS ruc_guild_member (
                    uuid         VARCHAR(36) NOT NULL,
                    guild_id     INT         NOT NULL,
                    name         VARCHAR(16) NOT NULL,
                    rank_name    VARCHAR(8)  NOT NULL,
                    joined_at    BIGINT      NOT NULL,
                    contribution BIGINT      NOT NULL DEFAULT 0,
                    last_weekly_at BIGINT    NOT NULL DEFAULT 0,
                    PRIMARY KEY (uuid)
                )
                """;

        String invite = """
                CREATE TABLE IF NOT EXISTS ruc_guild_invite (
                    uuid       VARCHAR(36) NOT NULL,
                    guild_id   INT         NOT NULL,
                    inviter    VARCHAR(16) NOT NULL,
                    expires_at BIGINT      NOT NULL,
                    PRIMARY KEY (uuid, guild_id)
                )
                """;

        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(guild);
            st.executeUpdate(member);
            st.executeUpdate(invite);
            // 길드원 목록 조회가 guild_id 기준이므로 인덱스가 필요합니다.
            // H2와 MySQL 모두 IF NOT EXISTS 를 지원합니다.
            st.executeUpdate("CREATE INDEX IF NOT EXISTS ix_guild_member_guild "
                    + "ON ruc_guild_member (guild_id)");
        }
    }

    // ── 전체 로드 ──────────────────────────────────────────────────────

    /**
     * 길드 전체 + 소속을 한 번에 읽습니다.
     *
     * 길드 수가 수백 개 수준이라 통째로 읽는 편이 개별 조회보다 단순하고,
     * 4개 서버가 각자 캐시를 새로 고칠 때도 쿼리 두 번으로 끝납니다.
     */
    public Map<Integer, Guild> loadAll() throws SQLException {
        Map<Integer, Guild> guilds = new LinkedHashMap<>();

        try (Connection conn = database.getConnection(); Statement st = conn.createStatement()) {
            try (ResultSet rs = st.executeQuery("SELECT * FROM ruc_guild ORDER BY id")) {
                while (rs.next()) {
                    Guild g = new Guild(
                            rs.getInt("id"),
                            rs.getString("name"),
                            rs.getString("tag"),
                            UUID.fromString(rs.getString("master")),
                            rs.getLong("bank"),
                            rs.getLong("points"),
                            rs.getBoolean("nation"),
                            rs.getLong("created_at"),
                            rs.getLong("last_season_at"));
                    guilds.put(g.getId(), g);
                }
            }

            try (ResultSet rs = st.executeQuery(
                    "SELECT * FROM ruc_guild_member ORDER BY joined_at")) {
                while (rs.next()) {
                    Guild g = guilds.get(rs.getInt("guild_id"));
                    // 길드가 지워졌는데 소속이 남아 있으면 버립니다 (정리는 아래 purge).
                    if (g == null) continue;
                    g.putMember(new GuildMember(
                            UUID.fromString(rs.getString("uuid")),
                            rs.getString("name"),
                            GuildRank.of(rs.getString("rank_name")),
                            rs.getLong("joined_at"),
                            rs.getLong("contribution"),
                            rs.getLong("last_weekly_at")));
                }
            }
        }
        return guilds;
    }

    // ── 길드 ──────────────────────────────────────────────────────────

    /**
     * 길드를 만들고 부여된 id를 돌려줍니다.
     * 이름/태그가 이미 있으면 UNIQUE 위반으로 SQLException 이 납니다 — 호출부가
     * 미리 검사하더라도, 두 사람이 같은 이름으로 동시에 만들 때는 이쪽이 최후 방어선입니다.
     */
    public int insert(String name, String tag, UUID master, long createdAt) throws SQLException {
        String sql = """
                INSERT INTO ruc_guild (name, name_key, tag, tag_key, master, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, name);
            ps.setString(2, key(name));
            ps.setString(3, tag);
            ps.setString(4, key(tag));
            ps.setString(5, master.toString());
            ps.setLong(6, createdAt);
            ps.executeUpdate();

            try (ResultSet keys = ps.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("길드 id 를 받지 못했습니다.");
                return keys.getInt(1);
            }
        }
    }

    public void updateGuild(Guild guild) throws SQLException {
        String sql = """
                UPDATE ruc_guild SET name = ?, name_key = ?, tag = ?, tag_key = ?, master = ?,
                    bank = ?, points = ?, nation = ?, last_season_at = ?
                WHERE id = ?
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, guild.getName());
            ps.setString(2, key(guild.getName()));
            ps.setString(3, guild.getTag());
            ps.setString(4, key(guild.getTag()));
            ps.setString(5, guild.getMaster().toString());
            ps.setLong(6, guild.getBank());
            ps.setLong(7, guild.getPoints());
            ps.setBoolean(8, guild.isNation());
            ps.setLong(9, guild.getLastSeasonAt());
            ps.setInt(10, guild.getId());
            ps.executeUpdate();
        }
    }

    /**
     * 금고 증감을 DB에서 직접 계산합니다.
     *
     * 캐시 값으로 덮어쓰는 updateGuild() 와 달리, 다른 서버에서 동시에 입금해도
     * 한쪽이 사라지지 않습니다. 잔고가 부족하면 0행이 갱신되고 false 입니다.
     */
    public boolean addBank(int guildId, long delta) throws SQLException {
        String sql = delta >= 0
                ? "UPDATE ruc_guild SET bank = bank + ? WHERE id = ?"
                : "UPDATE ruc_guild SET bank = bank + ? WHERE id = ? AND bank >= ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, delta);
            ps.setInt(2, guildId);
            if (delta < 0) ps.setLong(3, -delta);
            return ps.executeUpdate() > 0;
        }
    }

    public void addPoints(int guildId, long delta) throws SQLException {
        // 점수는 음수로 내려가지 않게 GREATEST 로 잠급니다 (H2 MySQL 모드도 지원).
        String sql = "UPDATE ruc_guild SET points = GREATEST(0, points + ?) WHERE id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, delta);
            ps.setInt(2, guildId);
            ps.executeUpdate();
        }
    }

    /**
     * 시즌 정산을 한 문장으로 처리합니다.
     *
     * 읽어서 고쳐 쓰는 방식을 피한 이유가 두 가지입니다. 금고는 다른 서버에서도
     * 동시에 움직이므로 캐시 값으로 덮어쓰면 그 입금이 사라지고, 캐시 객체를
     * 제자리에서 고치면 스코어보드가 읽는 중인 스냅샷을 건드립니다.
     */
    public void settleSeason(int guildId, long reward, boolean resetPoints, long now)
            throws SQLException {
        String sql = resetPoints
                ? "UPDATE ruc_guild SET bank = bank + ?, points = 0, last_season_at = ? WHERE id = ?"
                : "UPDATE ruc_guild SET bank = bank + ?, last_season_at = ? WHERE id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, reward);
            ps.setLong(2, now);
            ps.setInt(3, guildId);
            ps.executeUpdate();
        }
    }

    /** 길드 해산. 소속과 초대장도 같이 지웁니다. */
    public void delete(int guildId) throws SQLException {
        try (Connection conn = database.getConnection()) {
            for (String sql : List.of(
                    "DELETE FROM ruc_guild_member WHERE guild_id = ?",
                    "DELETE FROM ruc_guild_invite WHERE guild_id = ?",
                    "DELETE FROM ruc_guild WHERE id = ?")) {
                try (PreparedStatement ps = conn.prepareStatement(sql)) {
                    ps.setInt(1, guildId);
                    ps.executeUpdate();
                }
            }
        }
    }

    // ── 소속 ──────────────────────────────────────────────────────────

    /**
     * 가입. 이미 다른 길드에 속해 있으면 uuid PK 위반으로 실패합니다.
     * (덮어쓰기로 처리하면 "탈퇴하지 않고 다른 길드로 갈아타기" 가 열립니다.)
     */
    public void addMember(int guildId, UUID uuid, String name, GuildRank rank, long joinedAt)
            throws SQLException {
        String sql = """
                INSERT INTO ruc_guild_member (uuid, guild_id, name, rank_name, joined_at)
                VALUES (?, ?, ?, ?, ?)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setInt(2, guildId);
            ps.setString(3, name);
            ps.setString(4, rank.name());
            ps.setLong(5, joinedAt);
            ps.executeUpdate();
        }
    }

    public void removeMember(UUID uuid) throws SQLException {
        String sql = "DELETE FROM ruc_guild_member WHERE uuid = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.executeUpdate();
        }
    }

    public void setRank(UUID uuid, GuildRank rank) throws SQLException {
        String sql = "UPDATE ruc_guild_member SET rank_name = ? WHERE uuid = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, rank.name());
            ps.setString(2, uuid.toString());
            ps.executeUpdate();
        }
    }

    public void touchName(UUID uuid, String name) throws SQLException {
        String sql = "UPDATE ruc_guild_member SET name = ? WHERE uuid = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, name);
            ps.setString(2, uuid.toString());
            ps.executeUpdate();
        }
    }

    public void addContribution(UUID uuid, long delta) throws SQLException {
        String sql = "UPDATE ruc_guild_member SET contribution = GREATEST(0, contribution + ?) "
                + "WHERE uuid = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, delta);
            ps.setString(2, uuid.toString());
            ps.executeUpdate();
        }
    }

    /**
     * 주간 보상 지급 기록.
     *
     * 조건을 WHERE 에 넣어 "아직 못 받은 상태" 일 때만 갱신되게 합니다. 같은
     * 사람이 두 서버를 빠르게 오가며 양쪽에서 정산 시점에 걸리더라도 한 번만
     * 지급되도록, 이 갱신이 성공한 쪽만 실제로 지급합니다.
     *
     * @return 실제로 갱신되었으면 true (= 지급해도 되는 쪽)
     */
    public boolean claimWeekly(UUID uuid, long before, long now) throws SQLException {
        String sql = "UPDATE ruc_guild_member SET last_weekly_at = ? "
                + "WHERE uuid = ? AND last_weekly_at < ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, now);
            ps.setString(2, uuid.toString());
            ps.setLong(3, before);
            return ps.executeUpdate() > 0;
        }
    }

    /** 특정 길드의 국가 여부만 갱신. 길드원 수 변동 직후에 부릅니다. */
    public void setNation(int guildId, boolean nation) throws SQLException {
        String sql = "UPDATE ruc_guild SET nation = ? WHERE id = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setBoolean(1, nation);
            ps.setInt(2, guildId);
            ps.executeUpdate();
        }
    }

    // ── 초대장 ────────────────────────────────────────────────────────

    public void putInvite(UUID uuid, int guildId, String inviter, long expiresAt)
            throws SQLException {
        String sql = """
                INSERT INTO ruc_guild_invite (uuid, guild_id, inviter, expires_at)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE inviter = VALUES(inviter), expires_at = VALUES(expires_at)
                """;
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setInt(2, guildId);
            ps.setString(3, inviter);
            ps.setLong(4, expiresAt);
            ps.executeUpdate();
        }
    }

    /** 만료되지 않은 초대장 목록. */
    public List<Invite> findInvites(UUID uuid) throws SQLException {
        String sql = """
                SELECT guild_id, inviter, expires_at FROM ruc_guild_invite
                WHERE uuid = ? AND expires_at > ?
                ORDER BY expires_at
                """;
        List<Invite> out = new ArrayList<>();
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.setLong(2, System.currentTimeMillis());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new Invite(rs.getInt("guild_id"), rs.getString("inviter"),
                            rs.getLong("expires_at")));
                }
            }
        }
        return out;
    }

    public void deleteInvites(UUID uuid) throws SQLException {
        String sql = "DELETE FROM ruc_guild_invite WHERE uuid = ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            ps.executeUpdate();
        }
    }

    /** 만료된 초대장 청소. 주기 작업에서 부릅니다. */
    public int purgeExpiredInvites() throws SQLException {
        String sql = "DELETE FROM ruc_guild_invite WHERE expires_at <= ?";
        try (Connection conn = database.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, System.currentTimeMillis());
            return ps.executeUpdate();
        }
    }

    public record Invite(int guildId, String inviter, long expiresAt) {}

    private static String key(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
