package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import net.kyori.adventure.text.Component;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

/**
 * 자체 경험치 시스템 (§3.4).
 *
 * 바닐라 경험치와 완전히 분리되어 있습니다:
 *  - 인챈트로 소모되지 않음 (바닐라 XP만 소모되고 이 값은 건드리지 않음)
 *  - 경험치 병은 이 값을 올리지 않음 (병은 바닐라 XP만 올림)
 *  - 획득 경로는 아래 award* 메서드뿐
 */
public class XpService {

    private final RucCore plugin;
    private final MessageService messages;

    private final long base;
    private final double exponent;
    private final int maxLevel;

    public XpService(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
        this.base = plugin.getConfig().getLong("xp.base", 100);
        this.exponent = plugin.getConfig().getDouble("xp.exponent", 2.2);
        this.maxLevel = plugin.getConfig().getInt("xp.max-level", 100);
    }

    /**
     * 레벨 n에서 n+1로 가는 데 필요한 경험치.
     * exponent가 1보다 크므로 고레벨로 갈수록 급격히 가팔라집니다 (§3.4).
     */
    public long requiredXp(int level) {
        if (level >= maxLevel) return Long.MAX_VALUE;
        return Math.max(1, Math.round(base * Math.pow(level, exponent)));
    }

    public int getMaxLevel() {
        return maxLevel;
    }

    /** 현재 레벨 구간에서의 진행률 0.0 ~ 1.0 */
    public double progress(RucPlayer data) {
        if (data.getLevel() >= maxLevel) return 1.0;
        long required = requiredXp(data.getLevel());
        if (required <= 0) return 1.0;
        return Math.min(1.0, (double) data.getXp() / required);
    }

    /**
     * 경험치를 지급하고 레벨업을 처리합니다.
     * 한 번에 여러 레벨이 오를 수 있습니다 (보스 처치 등).
     */
    public void award(Player player, long amount, boolean announce) {
        if (amount <= 0) return;

        RucPlayer data = plugin.getPlayerData().get(player);
        if (data == null) return;              // 아직 로드 중
        if (data.getLevel() >= maxLevel) return;

        data.setXp(data.getXp() + amount);

        int oldLevel = data.getLevel();
        while (data.getLevel() < maxLevel) {
            long required = requiredXp(data.getLevel());
            if (data.getXp() < required) break;
            data.setXp(data.getXp() - required);
            data.setLevel(data.getLevel() + 1);
        }

        // 최고 레벨에서는 남은 경험치를 버립니다 (무한 누적 방지)
        if (data.getLevel() >= maxLevel) {
            data.setXp(0);
        }

        String lang = plugin.getPlayerData().languageOf(player);

        if (announce) {
            player.sendActionBar(messages.get(lang, "xp.gained", "amount", String.valueOf(amount)));
        }

        if (data.getLevel() > oldLevel) {
            player.sendMessage(messages.prefixed(lang, "xp.level-up",
                    "old", String.valueOf(oldLevel),
                    "new", String.valueOf(data.getLevel())));
            player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 1.0f, 1.2f);

            if (data.getLevel() >= maxLevel) {
                player.sendMessage(messages.prefixed(lang, "xp.max-level"));
            }
            plugin.getPlayerData().saveAsync(data);
        }
    }

    /** 현재 상태를 한 줄로. /level 명령용. */
    public Component statusLine(Player player, RucPlayer data) {
        String lang = plugin.getPlayerData().languageOf(player);
        long required = requiredXp(data.getLevel());
        int percent = (int) Math.round(progress(data) * 100);

        return messages.prefixed(lang, "xp.status",
                "level", String.valueOf(data.getLevel()),
                "current", String.valueOf(data.getXp()),
                "required", data.getLevel() >= maxLevel ? "-" : String.valueOf(required),
                "percent", String.valueOf(percent));
    }
}
