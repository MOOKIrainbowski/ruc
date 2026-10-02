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
import org.bukkit.event.entity.PlayerDeathEvent;
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

        // 디스코드 중계 (§4.1 — 입퇴장은 임베드로).
        plugin.getRelay().relayJoin(player);

        plugin.getPlayerData().loadAsync(player, () -> {
            if (!player.isOnline()) return;
            plugin.getScoreboards().attach(player);

            // 저장된 경험치가 이미 요구치를 넘었다면 여기서 레벨을 따라잡습니다.
            // 레벨업 판정이 award() 안에만 있으면 다음 획득까지 멈춰 있습니다.
            plugin.getXp().catchUp(player);

            // 길드원 이름 사본 갱신 + 주간 보상 정산 (§3.5).
            plugin.getGuilds().onJoin(player);

            // 안 받은 우편 알림 (Phase 5.5). 서버를 옮길 때도 PlayerJoinEvent 가
            // 다시 오므로, 네트워크 안을 돌아다니는 동안에도 알게 됩니다.
            plugin.getMailbox().notifyUnclaimed(player);

            // 칭호 캐시 + 탭 목록 (Phase 6). 채팅 한 줄마다 DB 를 보지 않으려면
            // 접속 시점에 한 번 읽어 둬야 합니다.
            plugin.getTitles().loadAsync(player);

            // 가이드 (Phase 11) — 처음이면 0단계로 시작, 다른 서버에 왔으면 "서버 이동" 완료.
            plugin.getGuide().onJoin(player);

            // D10 — 미인증이면 인증 구역에 격리하고 코드를 발급합니다.
            if (plugin.getVerification().requiresVerification(player)) {
                plugin.getVerification().beginVerification(player);
            }
        });
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        plugin.getRelay().relayQuit(player);
        plugin.getTpa().clear(player.getUniqueId());
        plugin.getVerification().cleanup(player.getUniqueId());
        plugin.getTitles().unload(player.getUniqueId());
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

        // 중계에는 Advancement 를 통째로 넘깁니다. 표시 이름·설명·등급을
        // 꺼내는 것은 표현의 문제라 중계 쪽이 맡습니다.
        //
        // 경험치 판정(위의 recipes/ 걸러내기)은 건드리지 않았습니다.
        // 중계는 doesAnnounceToChat() 으로 한 번 더 거르지만, 그 기준을
        // 경험치에 적용하면 지금까지 경험치를 주던 과제가 조용히 바뀝니다.
        plugin.getRelay().relayAdvancement(event.getPlayer(), event.getAdvancement());
    }

    /**
     * 플레이어 사망 → 디스코드 (§4.1 시스템 알림).
     *
     * {@code EntityDeathEvent} 와 따로 두는 이유: 사망 <b>메시지</b>는
     * PlayerDeathEvent 에만 있습니다. 아래 onDeath 는 경험치·통계를 다루고,
     * 이쪽은 알림만 다룹니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerDeath(PlayerDeathEvent event) {
        plugin.getRelay().relayDeath(event.getEntity(), event.deathMessage());
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
