package kr.rucserver.core.listener;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import org.bukkit.entity.EnderDragon;
import org.bukkit.entity.ElderGuardian;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Monster;
import org.bukkit.entity.Player;
import org.bukkit.entity.Warden;
import org.bukkit.entity.Wither;
import org.bukkit.entity.PiglinBrute;
import org.bukkit.entity.Ravager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * 접속/퇴장, 그리고 자체 경험치 획득 경로 (§3.4).
 */
public class PlayerListener implements Listener {

    private final RucCore plugin;

    public PlayerListener(RucCore plugin) {
        this.plugin = plugin;
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();

        plugin.getPlayerData().loadAsync(player, () -> {
            if (!player.isOnline()) return;
            plugin.getScoreboards().attach(player);

            // D10 — 미인증이면 인증 구역에 격리하고 코드를 발급합니다.
            if (plugin.getVerification().requiresVerification(player)) {
                plugin.getVerification().beginVerification(player);
            }
        });
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        plugin.getTpa().clear(player.getUniqueId());
        plugin.getVerification().cleanup(player.getUniqueId());
        plugin.getPlayerData().unloadAsync(player.getUniqueId());
    }

    /** 발전 과제 달성 (§3.4). */
    @EventHandler
    public void onAdvancement(PlayerAdvancementDoneEvent event) {
        // 레시피 해금 같은 내부용 발전과제는 제외합니다.
        String key = event.getAdvancement().getKey().getKey();
        if (key.startsWith("recipes/")) return;

        long amount = plugin.getConfig().getLong("xp.reward.advancement", 80);
        plugin.getXp().award(event.getPlayer(), amount, true);
    }

    /**
     * 몬스터/플레이어 처치 경험치 (§3.4).
     * 일반 몬스터는 "아주 적은 양"만 줍니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDeath(EntityDeathEvent event) {
        LivingEntity victim = event.getEntity();
        Player killer = victim.getKiller();

        // 사망 통계는 죽은 쪽이 플레이어일 때 기록
        if (victim instanceof Player dead) {
            RucPlayer deadData = plugin.getPlayerData().get(dead);
            if (deadData != null) {
                deadData.addDeath();
                plugin.getPlayerData().saveAsync(deadData);
            }
        }

        if (killer == null) return;

        long amount;
        if (victim instanceof Player) {
            amount = plugin.getConfig().getLong("xp.reward.player-kill", 120);

            RucPlayer killerData = plugin.getPlayerData().get(killer);
            if (killerData != null) {
                killerData.addKill();
                plugin.getPlayerData().saveAsync(killerData);
            }
        } else if (isBoss(victim)) {
            amount = plugin.getConfig().getLong("xp.reward.boss-kill", 400);
        } else if (isElite(victim)) {
            amount = plugin.getConfig().getLong("xp.reward.elite-kill", 60);
        } else if (victim instanceof Monster) {
            amount = plugin.getConfig().getLong("xp.reward.normal-mob", 2);
        } else {
            return;   // 동물 등은 경험치 없음
        }

        plugin.getXp().award(killer, amount, true);
    }

    private boolean isBoss(Entity entity) {
        return entity instanceof EnderDragon
                || entity instanceof Wither
                || entity instanceof Warden
                || entity instanceof ElderGuardian;
    }

    private boolean isElite(Entity entity) {
        return entity instanceof PiglinBrute
                || entity instanceof Ravager;
    }
}
