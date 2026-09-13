package kr.rucserver.raid.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.service.MessageService;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.time.Duration;

/**
 * 약탈 서버 문구.
 *
 * Core의 MessageService를 그대로 쓰되 파일은 이 플러그인 폴더의
 * messages_ko.yml / messages_en.yml 을 봅니다. 플레이어별 언어 선택은
 * Core가 이미 DB에 들고 있으므로 그것을 따릅니다 (§6.3).
 */
public class RaidMessages {

    private final MessageService messages;
    private final RucCore core;
    private final String fallbackLanguage;

    public RaidMessages(Plugin plugin, RucCore core, String fallbackLanguage) {
        this.core = core;
        this.fallbackLanguage = fallbackLanguage;
        this.messages = new MessageService(plugin, fallbackLanguage);
    }

    public String languageOf(CommandSender sender) {
        if (sender instanceof Player player) return core.getPlayerData().languageOf(player);
        return fallbackLanguage;
    }

    public Component get(CommandSender to, String key, String... placeholders) {
        return messages.get(languageOf(to), key, placeholders);
    }

    public void send(CommandSender to, String key, String... placeholders) {
        to.sendMessage(messages.prefixed(languageOf(to), key, placeholders));
    }

    /** 접두사 없이 그대로. 여러 줄 안내문에 씁니다. */
    public void sendPlain(CommandSender to, String key, String... placeholders) {
        to.sendMessage(messages.get(languageOf(to), key, placeholders));
    }

    public void sendActionBar(Player to, String key, String... placeholders) {
        to.sendActionBar(messages.get(languageOf(to), key, placeholders));
    }

    public void sendTitle(Player to, String titleKey, String subtitleKey, String... placeholders) {
        String lang = languageOf(to);
        to.showTitle(net.kyori.adventure.title.Title.title(
                messages.get(lang, titleKey, placeholders),
                messages.get(lang, subtitleKey, placeholders),
                net.kyori.adventure.title.Title.Times.times(
                        Duration.ofMillis(300), Duration.ofSeconds(3), Duration.ofMillis(700))));
    }

    public String raw(CommandSender to, String key) {
        return messages.raw(languageOf(to), key);
    }

    /** 언어를 고르지 않고 서버 기본으로. 브로드캐스트용. */
    public Component broadcast(String key, String... placeholders) {
        return messages.prefixed(fallbackLanguage, key, placeholders);
    }
}
