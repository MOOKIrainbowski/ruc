package kr.rucserver.raid.service;

import kr.rucserver.raid.RucRaid;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 전투 태그 (§2.4의 전제).
 *
 * 플레이어끼리 피해를 주고받으면 양쪽 모두 일정 시간 "전투 중"이 됩니다.
 * 이 상태에서 접속을 끊으면 재접속 시 처형됩니다(ExecutionService).
 *
 * 설계 메모
 *  - <b>양쪽 다</b> 태그합니다. 때린 쪽만 태그하면, 맞기만 하다 로그아웃해
 *    도망치는 경로가 그대로 열립니다.
 *  - 태그 상태에서는 /home /spawn /tpa 가 막힙니다. 안 막으면 처형 규칙이
 *    아무 의미가 없습니다 — 그냥 텔레포트로 빠져나가면 되니까요.
 *  - 상대 이름을 같이 기록해 두면 나중에 "누구와 싸우다 끊었는지" 로그와
 *    신고 처리(D4 유효 신고)에 쓸 수 있습니다.
 */
public class CombatTagService {

    private record Tag(long expiresAt, UUID opponent, String opponentName) {}

    private final RucRaid plugin;
    private final Map<UUID, Tag> tags = new ConcurrentHashMap<>();
    private final long durationMillis;
    private BukkitTask task;

    public CombatTagService(RucRaid plugin) {
        this.plugin = plugin;
        this.durationMillis = plugin.getConfig().getLong("combat.tag-seconds", 15) * 1000L;
    }

    public void start() {
        // 액션바 카운트다운. 0.5초마다면 숫자가 매끄럽게 줄어듭니다.
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 10L);
    }

    public void stop() {
        if (task != null) task.cancel();
        tags.clear();
    }

    /** 양쪽을 서로의 상대로 태그합니다. */
    public void tag(Player a, Player b) {
        if (a == null || b == null || a.equals(b)) return;
        apply(a, b);
        apply(b, a);
    }

    private void apply(Player player, Player opponent) {
        if (player.hasPermission("rucraid.bypass.combat")) return;

        long until = System.currentTimeMillis() + durationMillis;
        Tag previous = tags.put(player.getUniqueId(),
                new Tag(until, opponent.getUniqueId(), opponent.getName()));

        if (previous == null || previous.expiresAt() < System.currentTimeMillis()) {
            plugin.msg().send(player, "combat.entered",
                    "seconds", String.valueOf(durationMillis / 1000));
        }
    }

    /**
     * 상대 없이 태그를 겁니다. 스태프 테스트 전용입니다.
     *
     * §2.4 는 플레이어끼리 싸워야 태그가 붙으므로, 사람이 한 명뿐인 환경에서는
     * 규칙 전체를 확인할 방법이 없습니다. 그 구멍만 메우는 용도입니다.
     */
    public void tagManually(Player player, String opponentName) {
        long until = System.currentTimeMillis() + durationMillis;
        tags.put(player.getUniqueId(), new Tag(until, player.getUniqueId(), opponentName));
        plugin.msg().send(player, "combat.entered",
                "seconds", String.valueOf(durationMillis / 1000));
    }

    public boolean isTagged(UUID uuid) {
        Tag tag = tags.get(uuid);
        if (tag == null) return false;
        if (tag.expiresAt() <= System.currentTimeMillis()) {
            tags.remove(uuid);
            return false;
        }
        return true;
    }

    public boolean isTagged(Player player) {
        return isTagged(player.getUniqueId());
    }

    /** 남은 초. 태그되어 있지 않으면 0. */
    public int remainingSeconds(UUID uuid) {
        Tag tag = tags.get(uuid);
        if (tag == null) return 0;
        long left = tag.expiresAt() - System.currentTimeMillis();
        return left <= 0 ? 0 : (int) Math.ceil(left / 1000.0);
    }

    /** 마지막 교전 상대의 이름. 없으면 null. */
    public String opponentName(UUID uuid) {
        Tag tag = tags.get(uuid);
        return tag == null ? null : tag.opponentName();
    }

    /** 사망·처형 등으로 전투를 끝낼 때. */
    public void clear(UUID uuid) {
        tags.remove(uuid);
    }

    /**
     * 태그 상태면 안내 메시지를 띄우고 true. 텔레포트 계열 명령 앞에 둡니다.
     */
    public boolean blockIfTagged(Player player) {
        if (!isTagged(player)) return false;
        plugin.msg().send(player, "combat.blocked",
                "seconds", String.valueOf(remainingSeconds(player.getUniqueId())));
        return true;
    }

    private void tick() {
        long now = System.currentTimeMillis();

        for (Map.Entry<UUID, Tag> entry : tags.entrySet()) {
            Player player = Bukkit.getPlayer(entry.getKey());

            // 오프라인이면 여기서 지우지 않습니다. 퇴장 처리(RaidListener)가
            // 처형 기록을 남긴 뒤 직접 정리합니다.
            if (player == null) continue;

            if (entry.getValue().expiresAt() <= now) {
                tags.remove(entry.getKey());
                plugin.msg().sendActionBar(player, "combat.left");
                plugin.msg().send(player, "combat.left");
                continue;
            }

            int left = (int) Math.ceil((entry.getValue().expiresAt() - now) / 1000.0);
            plugin.msg().sendActionBar(player, "combat.actionbar",
                    "seconds", String.valueOf(left));
        }
    }
}
