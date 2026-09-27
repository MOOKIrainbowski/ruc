package kr.rucserver.gate;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * RucGate 설정.
 *
 * 백엔드처럼 YAML 을 쓰지 않고 properties 를 쓰는 이유: Velocity 에는 Bukkit 의
 * YamlConfiguration 이 없고, 이 플러그인이 읽어야 하는 값은 열 개가 채 되지
 * 않습니다. YAML 파서를 하나 더 번들할 이유가 없습니다.
 *
 * 파일은 BOM 없이 씁니다 — properties 에 BOM 이 들어가면 첫 키가
 * {@code ﻿database.type} 이 되어 인식되지 않습니다.
 */
public class GateConfig {

    private static final String FILE_NAME = "config.properties";

    private final Properties props = new Properties();
    private final Path dataDirectory;

    public GateConfig(Path dataDirectory) throws IOException {
        this.dataDirectory = dataDirectory;
        Files.createDirectories(dataDirectory);

        Path file = dataDirectory.resolve(FILE_NAME);
        if (!Files.exists(file)) {
            writeDefaults(file);
        }
        try (InputStream in = Files.newInputStream(file)) {
            // properties 는 기본이 ISO-8859-1 이라 한글 주석이 깨집니다.
            // UTF-8 로 명시해서 읽습니다.
            props.load(new java.io.InputStreamReader(in, StandardCharsets.UTF_8));
        }
    }

    private void writeDefaults(Path file) throws IOException {
        String defaults = """
                # RucGate — 국가전 서버 입장 제한 (§2.6)
                #
                # 백엔드(RucCore)와 같은 DB 를 봅니다. 여기 설정이 백엔드의
                # config.yml 과 어긋나면 프록시는 통과시켰는데 서버가 막거나,
                # 반대로 자격이 없는 사람이 들어가게 됩니다.

                # h2 = 로컬 개발, mysql = 운영
                database.type=h2

                # type=h2 일 때. 이 파일(plugins/rucgate/) 기준 상대 경로입니다.
                # 기본값은 minecraft/servers/shared/ruc 를 가리킵니다.
                database.h2-file=../../../servers/shared/ruc

                # type=mysql 일 때
                database.mysql.host=localhost
                database.mysql.port=3306
                database.mysql.database=ruc
                database.mysql.user=ruc
                database.mysql.password=

                # 국가 소속이 아니면 들어갈 수 없는 서버. velocity.toml 의 [servers] 키와
                # 같아야 합니다. 여러 개면 쉼표로 구분합니다.
                gate.servers=war

                # 국가 소속자 목록을 다시 읽는 주기 (초).
                # 통과는 이 캐시로 즉시 판정하고, 막기 전에는 DB 를 한 번 더 확인하므로
                # 방금 국가에 가입한 사람이 캐시 때문에 거부되지는 않습니다.
                gate.refresh-seconds=15

                # 이 권한이 있으면 자격 검사를 건너뜁니다 (운영·관전용).
                gate.bypass-permission=rucgate.bypass

                # 안내 문구. & 색코드를 씁니다.
                # 프록시에는 플레이어별 언어 설정이 없어 기본 언어(한국어)로 냅니다.
                message.denied=&c[러크] &f국가에 소속되어야 국가전 서버에 들어갈 수 있습니다.
                message.denied-hint=&7길드를 만들거나 가입해서 길드원 수를 채우면 국가가 됩니다. &f/길드
                message.unavailable=&c[러크] &f국가 소속을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.
                """;
        try (OutputStream out = Files.newOutputStream(file)) {
            out.write(defaults.getBytes(StandardCharsets.UTF_8));
        }
    }

    // ── DB ────────────────────────────────────────────────────────────

    public boolean mysql() {
        return get("database.type", "h2").equalsIgnoreCase("mysql");
    }

    /** H2 파일 경로. 설정의 상대 경로를 데이터 폴더 기준으로 풀어 줍니다. */
    public String h2Path() {
        Path path = dataDirectory.resolve(get("database.h2-file", "../../../servers/shared/ruc"));
        return path.toAbsolutePath().normalize().toString();
    }

    public String host() { return get("database.mysql.host", "localhost"); }
    public int port() { return getInt("database.mysql.port", 3306); }
    public String database() { return get("database.mysql.database", "ruc"); }
    public String user() { return get("database.mysql.user", "ruc"); }
    public String password() { return get("database.mysql.password", ""); }

    // ── 게이트 ────────────────────────────────────────────────────────

    /** 국가 자격을 요구하는 서버 이름들. */
    public java.util.Set<String> gatedServers() {
        java.util.Set<String> out = new java.util.HashSet<>();
        for (String part : get("gate.servers", "war").split(",")) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) out.add(trimmed.toLowerCase(java.util.Locale.ROOT));
        }
        return out;
    }

    public long refreshSeconds() {
        return Math.max(5, getInt("gate.refresh-seconds", 15));
    }

    public String bypassPermission() {
        return get("gate.bypass-permission", "rucgate.bypass");
    }

    // ── 안내 문구 ──────────────────────────────────────────────────────

    public String messageDenied() {
        return get("message.denied",
                "&c[러크] &f국가에 소속되어야 국가전 서버에 들어갈 수 있습니다.");
    }

    public String messageDeniedHint() {
        return get("message.denied-hint",
                "&7길드를 만들거나 가입해서 길드원 수를 채우면 국가가 됩니다. &f/길드");
    }

    public String messageUnavailable() {
        return get("message.unavailable",
                "&c[러크] &f국가 소속을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }

    // ── 내부 ──────────────────────────────────────────────────────────

    private String get(String key, String fallback) {
        String value = props.getProperty(key);
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private int getInt(String key, int fallback) {
        try {
            return Integer.parseInt(get(key, String.valueOf(fallback)));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
