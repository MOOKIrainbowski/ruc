package kr.rucserver.core.service;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.plugin.Plugin;

import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 한국어/영어 메시지 (§6.3).
 *
 * 플레이어별 언어는 DB에 저장되고, 없으면 config의 language.default를 씁니다.
 */
public class MessageService {

    private static final LegacyComponentSerializer LEGACY =
            LegacyComponentSerializer.legacyAmpersand();

    private static final MiniMessage MINI = MiniMessage.miniMessage();

    private final Map<String, YamlConfiguration> byLanguage = new HashMap<>();
    private final String defaultLanguage;

    public MessageService(Plugin plugin, String defaultLanguage) {
        this.defaultLanguage = defaultLanguage;
        load(plugin, "ko");
        load(plugin, "en");
    }

    private void load(Plugin plugin, String lang) {
        String fileName = "messages_" + lang + ".yml";
        File file = new File(plugin.getDataFolder(), fileName);

        // 파일이 없으면 jar 안의 기본본을 꺼내둡니다 (운영자가 편집할 수 있게).
        if (!file.exists()) {
            plugin.saveResource(fileName, false);
        }

        YamlConfiguration config = YamlConfiguration.loadConfiguration(file);

        // jar 내부본을 기본값으로 깔아두면, 새 키가 추가되어도
        // 운영자의 기존 파일에서 누락으로 깨지지 않습니다.
        try (InputStream in = plugin.getResource(fileName)) {
            if (in != null) {
                config.setDefaults(YamlConfiguration.loadConfiguration(
                        new InputStreamReader(in, StandardCharsets.UTF_8)));
            }
        } catch (Exception ignored) {
            // 기본값을 못 깔아도 파일 본체는 이미 로드되어 있습니다.
        }

        byLanguage.put(lang, config);
    }

    public boolean isSupported(String lang) {
        return byLanguage.containsKey(lang);
    }

    public String getDefaultLanguage() {
        return defaultLanguage;
    }

    /** 원문 문자열(색코드 &amp; 포함)을 그대로 반환합니다. */
    public String raw(String lang, String key) {
        YamlConfiguration config = byLanguage.getOrDefault(lang, byLanguage.get(defaultLanguage));
        if (config == null) return key;
        return config.getString(key, key);
    }

    /**
     * 메시지를 Component로 변환합니다.
     *
     * @param placeholders key, value 가 번갈아 오는 가변인자. 예: ("player", "홍길동")
     */
    public Component get(String lang, String key, String... placeholders) {
        String text = raw(lang, key);
        for (int i = 0; i + 1 < placeholders.length; i += 2) {
            text = text.replace("%" + placeholders[i] + "%", placeholders[i + 1]);
        }
        return LEGACY.deserialize(text);
    }

    /** prefix가 붙은 메시지. */
    public Component prefixed(String lang, String key, String... placeholders) {
        String prefix = raw(lang, "prefix");
        String text = raw(lang, key);
        for (int i = 0; i + 1 < placeholders.length; i += 2) {
            text = text.replace("%" + placeholders[i] + "%", placeholders[i + 1]);
        }
        return LEGACY.deserialize(prefix + text);
    }

    /** 색코드가 들어간 임의 문자열을 Component로. */
    public static Component colorize(String text) {
        return LEGACY.deserialize(text);
    }

    /**
     * MiniMessage 문자열을 Component로.
     *
     * 메시지 파일 전체는 레거시 색코드(&amp;a)를 씁니다 — 이미 수백 줄이고,
     * 운영자가 편집하는 파일이라 문법을 바꾸면 전부 다시 써야 합니다.
     * MiniMessage 는 <b>칭호처럼 그라디언트가 필요한 곳</b>에서만 씁니다
     * (요구사항: 관리자·유료 칭호는 색과 서체를 공들여 디자인).
     *
     * <b>플레이어가 입력한 문자열에는 절대 쓰지 마세요.</b>
     * {@code <click:run_command:...>} 같은 태그가 그대로 살아납니다.
     */
    public static Component mini(String text) {
        return MINI.deserialize(text);
    }
}
