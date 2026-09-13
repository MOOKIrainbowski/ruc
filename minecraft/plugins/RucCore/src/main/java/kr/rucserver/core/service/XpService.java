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

        // 드래곤 알 등 외부 배수 (D3). 등록된 것이 없으면 amount 그대로입니다.
        amount = plugin.getBonuses().applyXp(player.getUniqueId(), amount);

        RucPlayer data = plugin.getPlayerData().get(player);
        if (data == null) return;              // 아직 로드 중
        if (data.getLevel() >= maxLevel) return;

        data.setXp(data.getXp() + amount);

        int oldLevel = data.getLevel();
        normalize(data);

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

    /**
     * 누적 경험치를 레벨로 환산합니다. 여러 번 불러도 결과가 같습니다(멱등).
     *
     * 이 계산이 award() 안에만 있으면, 저장된 값이 이미 요구치를 넘긴 상태일 때
     * <b>다음 경험치 획득이 있을 때까지 레벨이 멈춰 있습니다</b>. 접속 시점이나
     * 설정 변경(xp.base 하향 등) 뒤에 실제로 그런 상태가 생기므로, 판정을
     * 따로 떼어 두고 양쪽에서 부릅니다.
     *
     * @return 이번에 오른 레벨 수
     */
    public int normalize(RucPlayer data) {
        int gained = 0;
        while (data.getLevel() < maxLevel) {
            long required = requiredXp(data.getLevel());
            if (data.getXp() < required) break;
            data.setXp(data.getXp() - required);
            data.setLevel(data.getLevel() + 1);
            gained++;
        }

        // 최고 레벨에서는 남은 경험치를 버립니다 (무한 누적 방지)
        if (data.getLevel() >= maxLevel) {
            data.setXp(0);
        }
        return gained;
    }

    /**
     * 접속 시 밀린 레벨업을 처리합니다.
     *
     * 저장된 경험치가 이미 요구치를 넘어 있으면 여기서 따라잡습니다. 조용히
     * 넘기지 않고 알려 주는 이유는, 플레이어 입장에서 "분명 채웠는데 안 올랐던"
     * 레벨이 뒤늦게 오르는 것이라 설명이 필요하기 때문입니다.
     */
    public void catchUp(Player player) {
        RucPlayer data = plugin.getPlayerData().get(player);
        if (data == null) return;

        int oldLevel = data.getLevel();
        if (normalize(data) == 0) return;

        String lang = plugin.getPlayerData().languageOf(player);
        player.sendMessage(messages.prefixed(lang, "xp.level-up",
                "old", String.valueOf(oldLevel),
                "new", String.valueOf(data.getLevel())));
        player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 1.0f, 1.2f);
        plugin.getPlayerData().saveAsync(data);

        plugin.getLogger().info("밀린 레벨업 처리: " + player.getName()
                + " Lv." + oldLevel + " → Lv." + data.getLevel());
    }

    /** (스태프) 경험치를 직접 지급합니다. 배수를 타지 않는 순수 지급입니다. */
    public void grant(Player player, long amount) {
        RucPlayer data = plugin.getPlayerData().get(player);
        if (data == null) return;

        data.setXp(data.getXp() + Math.max(0, amount));
        int oldLevel = data.getLevel();
        int gained = normalize(data);
        plugin.getPlayerData().saveAsync(data);

        String lang = plugin.getPlayerData().languageOf(player);
        if (gained > 0) {
            player.sendMessage(messages.prefixed(lang, "xp.level-up",
                    "old", String.valueOf(oldLevel),
                    "new", String.valueOf(data.getLevel())));
            player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 1.0f, 1.2f);
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
