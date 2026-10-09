package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import java.util.logging.Level;

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
            chronicleLevels(player, oldLevel, data.getLevel());
        }
    }

    /**
     * 러크 연대기 — 이정표 레벨({@code chronicle.level-milestones}, 기본 50 · 100)을 넘으면 "서버 N번째" 와 함께 남깁니다.
     * 스태프 지급(grant · setLevel)은 시험용이라 남기지 않습니다.
     */
    private void chronicleLevels(Player player, int from, int to) {
        var config = plugin.getConfig();
        List<Integer> marks = config.isList("chronicle.level-milestones")
                ? config.getIntegerList("chronicle.level-milestones") : List.of(50, 100);
        UUID uuid = player.getUniqueId();
        String name = player.getName();
        for (int m : marks) {
            if (from >= m || to < m) continue;
            Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                try {
                    int rank = plugin.getPlayerData().getRepository().countAtLeastLevel(m, uuid) + 1;
                    plugin.getRelay().relayChronicle("⭐ **" + name + "** 이(가) Lv." + m + " 달성 — 서버 " + rank + "번째");
                } catch (SQLException e) {
                    plugin.getLogger().log(Level.WARNING, "[연대기] 레벨 순위 조회 실패", e);
                }
            });
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
        chronicleLevels(player, oldLevel, data.getLevel());

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

    /**
     * (스태프) 레벨을 직접 지정합니다. 테스트·운영 보정용.
     *
     * {@code xp} 는 <b>누적값이 아니라 현재 레벨 구간의 진행도</b>입니다
     * ({@link #normalize}가 레벨업마다 요구치를 빼기 때문). 그래서 레벨을 옮길
     * 때는 경험치를 먹이는 것이 아니라 레벨을 쓰고 진행도를 0으로 되돌립니다.
     * 경험치로 밀어 올리려면 고레벨에서 천문학적인 값이 필요하고, 그 값이
     * 진행도 칸에 남아 막대가 꽉 찬 채로 표시됩니다.
     *
     * 내리는 것도 허용합니다. 레벨 조건(길드 창설 등)을 다시 시험하려면
     * 되돌릴 수단이 있어야 합니다.
     *
     * @return 실제로 적용된 레벨. 데이터가 아직 로드되지 않았으면 -1
     */
    public int setLevel(Player player, int level) {
        RucPlayer data = plugin.getPlayerData().get(player);
        if (data == null) return -1;

        int target = Math.max(1, Math.min(maxLevel, level));
        int oldLevel = data.getLevel();

        data.setLevel(target);
        data.setXp(0);
        plugin.getPlayerData().saveAsync(data);

        if (target == oldLevel) return target;

        String lang = plugin.getPlayerData().languageOf(player);
        player.sendMessage(messages.prefixed(lang, "admin.level-set-notify",
                "old", String.valueOf(oldLevel),
                "new", String.valueOf(target)));

        // 올라갈 때만 소리를 냅니다. 내려가는데 레벨업 효과음이 나면 혼란스럽습니다.
        if (target > oldLevel) {
            player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 1.0f, 1.2f);
        }
        return target;
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
