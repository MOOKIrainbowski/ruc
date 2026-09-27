package kr.rucserver.peace.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.service.MessageService;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/**
 * 평화 서버 문구.
 *
 * RucRaid·RucWar 와 같은 구조입니다 — Core 의 MessageService 를 쓰되 파일은 이
 * 플러그인 폴더의 것을 보고, 플레이어별 언어는 Core 가 들고 있는 값을 따릅니다 (§6.3).
 */
public class PeaceMessages {

    private final MessageService messages;
    private final RucCore core;
    private final String fallbackLanguage;

    public PeaceMessages(Plugin plugin, RucCore core, String fallbackLanguage) {
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

    public String raw(CommandSender to, String key) {
        return messages.raw(languageOf(to), key);
    }
}
