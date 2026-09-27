package kr.rucserver.gate;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * 프록시에서 보는 러크 DB.
 *
 * 백엔드(RucCore)와 <b>같은 DB</b>를 읽습니다. 프록시가 백엔드에 물어보는 대신
 * DB를 직접 보는 이유:
 *
 * <ul>
 *   <li>플러그인 메시지는 플레이어의 연결을 타고 가므로, 아직 어느 서버에도
 *       붙지 않은 상태에서 물어볼 상대가 없습니다.</li>
 *   <li>홈 서버가 내려가 있을 때도 입장 판정은 작동해야 합니다.</li>
 * </ul>
 *
 * 쓰기는 하지 않습니다 — 프록시는 판정만 합니다.
 */
public class GateDatabase {

    private final HikariDataSource dataSource;
    private final boolean mysql;

    public GateDatabase(GateConfig config) throws SQLException {
        this.mysql = config.mysql();

        HikariConfig hikari = new HikariConfig();
        hikari.setPoolName("RucGate-Pool");

        if (mysql) {
            hikari.setDriverClassName("com.mysql.cj.jdbc.Driver");
            hikari.setJdbcUrl("jdbc:mysql://" + config.host() + ":" + config.port()
                    + "/" + config.database()
                    + "?useUnicode=true&characterEncoding=utf8&useSSL=false"
                    + "&allowPublicKeyRetrieval=true");
            hikari.setUsername(config.user());
            hikari.setPassword(config.password());
        } else {
            hikari.setDriverClassName("org.h2.Driver");
            // 백엔드와 동일한 URL 옵션이어야 같은 파일을 같은 방식으로 엽니다.
            // AUTO_SERVER 가 빠지면 백엔드가 이미 열어 둔 파일을 열 수 없습니다.
            hikari.setJdbcUrl("jdbc:h2:file:" + config.h2Path()
                    + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;AUTO_SERVER=TRUE");
            hikari.setUsername("sa");
            hikari.setPassword("");
        }

        // 프록시는 판정 쿼리만 하므로 풀이 클 필요가 없습니다.
        hikari.setMaximumPoolSize(2);
        hikari.setConnectionTimeout(10_000);
        hikari.setMaxLifetime(600_000);

        this.dataSource = new HikariDataSource(hikari);
        try (Connection probe = dataSource.getConnection()) {
            probe.isValid(5);
        }
    }

    /**
     * 국가 소속 여부. 이것이 §2.6 입장 판정의 전부입니다.
     *
     * 백엔드의 {@code GuildService.isInNation()} 과 같은 규칙(소속 길드의 nation
     * 플래그)을 봅니다. 양쪽이 어긋나면 프록시는 통과시켰는데 서버가 막는 상황이
     * 생깁니다.
     */
    public boolean isInNation(UUID uuid) throws SQLException {
        String sql = """
                SELECT g.nation FROM ruc_guild_member m
                JOIN ruc_guild g ON g.id = m.guild_id
                WHERE m.uuid = ?
                """;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, uuid.toString());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getBoolean(1);
            }
        }
    }

    /** 국가 소속원 전체. 주기 갱신으로 캐시를 채웁니다. */
    public Set<UUID> nationMembers() throws SQLException {
        String sql = """
                SELECT m.uuid FROM ruc_guild_member m
                JOIN ruc_guild g ON g.id = m.guild_id
                WHERE g.nation = TRUE
                """;
        Set<UUID> out = new HashSet<>();
        try (Connection conn = dataSource.getConnection();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(sql)) {
            while (rs.next()) {
                try {
                    out.add(UUID.fromString(rs.getString(1)));
                } catch (IllegalArgumentException ignored) {
                    // 손상된 행 하나가 전체 캐시를 못 쓰게 만들지 않도록 건너뜁니다.
                }
            }
        }
        return out;
    }

    /**
     * 길드 테이블이 준비되었는지.
     *
     * 프록시가 백엔드보다 먼저 떠서 테이블이 아직 없을 수 있습니다. 그때
     * "국가 소속자가 없다"로 읽어 전원을 막아 버리면 안 되므로 구분합니다.
     */
    public boolean schemaReady() {
        try (Connection conn = dataSource.getConnection();
             Statement st = conn.createStatement()) {
            st.executeQuery("SELECT 1 FROM ruc_guild_member WHERE 1 = 0").close();
            return true;
        } catch (SQLException e) {
            return false;
        }
    }

    public void close() {
        if (dataSource != null && !dataSource.isClosed()) dataSource.close();
    }

    public boolean isMysql() { return mysql; }
}
