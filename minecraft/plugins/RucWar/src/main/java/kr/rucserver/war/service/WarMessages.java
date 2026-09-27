package kr.rucserver.war.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.service.MessageService;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.time.Duration;

/**
 * 국가전 서버 문구.
 *
 * RucRaid 의 {@code RaidMessages} 와 같은 구조입니다 — Core 의 MessageService 를
 * 쓰되 파일은 이 플러그인 폴더의 것을 보고, 플레이어별 언어는 Core 가 들고 있는
 * 값을 따릅니다 (§6.3).
 */
public class WarMessages {

    private final MessageService messages;
    private final RucCore core;
    private final String fallbackLanguage;

    public WarMessages(Plugin plugin, RucCore core, String fallbackLanguage) {
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

    /** 접두사 없이. 여러 줄 안내문에 씁니다. */
    public void sendPlain(CommandSender to, String key, String... placeholders) {
        to.sendMessage(messages.get(languageOf(to), key, placeholders));
    }

    public void sendActionBar(Player to, String key, String... placeholders) {
        to.sendActionBar(messages.get(languageOf(to), key, placeholders));
    }

    public void sendTitle(Player to, String titleKey, String subtitleKey, String... placeholders) {
        String lang = languageOf(to);
        to.showTitle(Title.title(
                messages.get(lang, titleKey, placeholders),
                messages.get(lang, subtitleKey, placeholders),
                Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3),
                        Duration.ofMillis(700))));
    }

    /**
     * 접속자 전원에게. 개전·코어 파괴처럼 모두가 알아야 하는 것에만 씁니다.
     *
     * 사람마다 언어를 맞춰 보내므로, 한국어 유저와 영어 유저가 섞여 있어도
     * 각자 자기 언어로 받습니다. 한 번 만들어 돌려 쓰는 것보다 비싸지만
     * 이런 공지는 하루에 몇 번뿐입니다.
     */
    public void broadcastAll(String key, String... placeholders) {
        for (Player player : Bukkit.getOnlinePlayers()) {
            send(player, key, placeholders);
        }
        // 콘솔에도 남겨 운영자가 흐름을 볼 수 있게 합니다.
        Bukkit.getConsoleSender().sendMessage(
                messages.prefixed(fallbackLanguage, key, placeholders));
    }

    /** 인벤토리 제목처럼 Component 가 바로 필요한 곳. 서버 기본 언어를 씁니다. */
    public Component component(String key, String... placeholders) {
        return messages.get(fallbackLanguage, key, placeholders);
    }

    public String raw(CommandSender to, String key) {
        return messages.raw(languageOf(to), key);
    }
}
