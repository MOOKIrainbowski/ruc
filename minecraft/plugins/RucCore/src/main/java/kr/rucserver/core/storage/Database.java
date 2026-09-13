package kr.rucserver.core.storage;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.bukkit.configuration.ConfigurationSection;

import java.io.File;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.logging.Logger;

/**
 * DB 연결 관리.
 *
 * 로컬 개발은 H2(설치 불필요), 운영은 MySQL을 씁니다. SQL 방언 차이를 피하려고
 * H2를 MySQL 호환 모드로 띄우므로, 양쪽에서 같은 쿼리가 그대로 동작합니다.
 */
public class Database {

    private final Logger logger;
    private HikariDataSource dataSource;
    private boolean mysql;

    public Database(Logger logger) {
        this.logger = logger;
    }

    public void connect(ConfigurationSection section, File pluginFolder) throws SQLException {
        String type = section.getString("type", "h2").toLowerCase();
        this.mysql = type.equals("mysql");

        HikariConfig hikari = new HikariConfig();
        hikari.setPoolName("RucCore-Pool");

        if (mysql) {
            ConfigurationSection my = section.getConfigurationSection("mysql");
            if (my == null) throw new SQLException("config.yml에 database.mysql 섹션이 없습니다.");

            String host = my.getString("host", "localhost");
            int port = my.getInt("port", 3306);
            String db = my.getString("database", "ruc");

            hikari.setDriverClassName("com.mysql.cj.jdbc.Driver");
            hikari.setJdbcUrl("jdbc:mysql://" + host + ":" + port + "/" + db
                    + "?useUnicode=true&characterEncoding=utf8&useSSL=false&allowPublicKeyRetrieval=true");
            hikari.setUsername(my.getString("user", "ruc"));
            hikari.setPassword(my.getString("password", ""));
            hikari.setMaximumPoolSize(my.getInt("pool-size", 6));
        } else {
            File dataFile = new File(pluginFolder, section.getString("h2-file", "data"));
            hikari.setDriverClassName("org.h2.Driver");
            // MODE=MySQL  → MySQL 문법(ON DUPLICATE KEY UPDATE 등)을 그대로 사용
            // AUTO_SERVER  → 여러 서버 프로세스가 같은 파일을 열 수 있게 (로컬 네트워크 테스트용)
            hikari.setJdbcUrl("jdbc:h2:file:" + dataFile.getAbsolutePath()
                    + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;AUTO_SERVER=TRUE");
            hikari.setUsername("sa");
            hikari.setPassword("");
            hikari.setMaximumPoolSize(4);
        }

        hikari.setConnectionTimeout(10_000);
        hikari.setMaxLifetime(600_000);

        openWithRetry(hikari, section.getInt("connect-retries", 6));
        logger.info("DB 연결됨 (" + (mysql ? "MySQL" : "H2 로컬") + ")");

        createSchema();
    }

    /**
     * 연결을 재시도하며 엽니다.
     *
     * 4개 서버가 같은 H2 파일을 공유하는데, 동시에 기동하면 서로 잠금 파일을
     * 만들려다 부딪혀 한두 개가 {@code FileLock.waitUntilOld} 에서 죽습니다
     * (AUTO_SERVER 의 알려진 경쟁 상황). 먼저 연 쪽이 서버가 되고 나면 나머지는
     * 정상적으로 붙으므로, 잠깐 기다렸다 다시 시도하면 해결됩니다.
     *
     * 운영의 MySQL 에서도 같은 재시도가 재시작 직후의 연결 거부를 흡수합니다.
     */
    private void openWithRetry(HikariConfig hikari, int attempts) throws SQLException {
        long backoff = 1000;
        for (int attempt = 1; ; attempt++) {
            try {
                this.dataSource = new HikariDataSource(hikari);
                // 풀 생성만으로는 부족합니다. 실제로 한 번 열어 봐야 압니다.
                try (Connection probe = dataSource.getConnection()) {
                    probe.isValid(5);
                }
                return;
            } catch (Exception e) {
                if (dataSource != null) {
                    dataSource.close();
                    dataSource = null;
                }
                if (attempt >= attempts) {
                    throw new SQLException("DB 연결 실패 (" + attempts + "회 시도)", e);
                }
                logger.warning("DB 연결 실패 " + attempt + "/" + attempts
                        + " — " + backoff + "ms 후 재시도합니다. (" + e.getMessage() + ")");
                try {
                    Thread.sleep(backoff);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new SQLException("DB 연결 대기 중 중단됨", interrupted);
                }
                backoff = Math.min(backoff * 2, 8000);
            }
        }
    }

    private void createSchema() throws SQLException {
        // discord_id에 UNIQUE를 거는 것이 D10의 "디스코드 1 : 마크 1" 규칙을
        // 애플리케이션이 아니라 DB 차원에서 강제하는 장치입니다.
        String sql = """
                CREATE TABLE IF NOT EXISTS ruc_player (
                    uuid        VARCHAR(36)  NOT NULL,
                    name        VARCHAR(16)  NOT NULL,
                    ruc         BIGINT       NOT NULL DEFAULT 0,
                    xp          BIGINT       NOT NULL DEFAULT 0,
                    level       INT          NOT NULL DEFAULT 1,
                    reputation  INT          NOT NULL DEFAULT 100,
                    discord_id  VARCHAR(32)  NULL,
                    verified_at BIGINT       NULL,
                    kills       BIGINT       NOT NULL DEFAULT 0,
                    deaths      BIGINT       NOT NULL DEFAULT 0,
                    assists     BIGINT       NOT NULL DEFAULT 0,
                    language    VARCHAR(4)   NOT NULL DEFAULT 'ko',
                    first_join  BIGINT       NOT NULL,
                    last_seen   BIGINT       NOT NULL,
                    PRIMARY KEY (uuid),
                    CONSTRAINT uq_ruc_player_discord UNIQUE (discord_id)
                )
                """;

        String codes = """
                CREATE TABLE IF NOT EXISTS ruc_verify_code (
                    code        VARCHAR(8)   NOT NULL,
                    uuid        VARCHAR(36)  NOT NULL,
                    name        VARCHAR(16)  NOT NULL,
                    issued_at   BIGINT       NOT NULL,
                    expires_at  BIGINT       NOT NULL,
                    PRIMARY KEY (code)
                )
                """;

        try (Connection conn = dataSource.getConnection(); Statement st = conn.createStatement()) {
            st.executeUpdate(sql);
            st.executeUpdate(codes);
        }
        logger.info("DB 스키마 준비 완료");
    }

    public Connection getConnection() throws SQLException {
        if (dataSource == null) throw new SQLException("DB가 연결되지 않았습니다.");
        return dataSource.getConnection();
    }

    public boolean isMysql() { return mysql; }

    public void close() {
        if (dataSource != null && !dataSource.isClosed()) {
            dataSource.close();
            logger.info("DB 연결 종료");
        }
    }
}
