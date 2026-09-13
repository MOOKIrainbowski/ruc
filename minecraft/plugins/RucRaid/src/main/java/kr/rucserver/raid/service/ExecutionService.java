package kr.rucserver.raid.service;

import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.raid.RucRaid;
import kr.rucserver.raid.storage.RaidRepository;
import org.bukkit.Bukkit;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.PlayerInventory;

import java.sql.SQLException;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;

/**
 * 전투 로그 처형 (§2.4).
 *
 * <b>전투 중 접속 종료 → 재접속 시 강제 사망 + 아이템 전부 소멸 + XP 전부 소멸.</b>
 *
 * 핵심은 "강제 사망"이 아니라 <b>드랍이 남지 않는 것</b>입니다. 그냥 죽이기만 하면
 * 콤벳로그가 오히려 이득이 됩니다 — 불리한 싸움에서 끊고, 안전한 곳에서 재접속해
 * 죽은 뒤 드랍을 지인이 줍게 하면 상대에게는 아무것도 안 넘어가니까요.
 * 그래서 반드시 <b>인벤토리를 비운 뒤에</b> 죽입니다. 순서가 뒤바뀌면 규칙 전체가
 * 무력해집니다.
 */
public class ExecutionService {

    private final RucRaid plugin;
    private final RaidRepository repository;
    private final String serverId;

    /** 처형이 진행 중인 동안 사망 이벤트에서 알아보기 위한 표시. */
    private final Set<UUID> executing = ConcurrentHashMap.newKeySet();

    public ExecutionService(RucRaid plugin, RaidRepository repository, String serverId) {
        this.plugin = plugin;
        this.repository = repository;
        this.serverId = serverId;
    }

    // ── 접속 종료 시 기록 ──────────────────────────────────────────────

    /**
     * 전투 태그 상태로 나간 사람을 기록합니다.
     *
     * 여기서만 DB를 <b>동기로</b> 씁니다. 비동기로 넘기면 퇴장 직후 서버가
     * 내려가거나 재시작될 때 기록이 통째로 유실되고, 하필 그 경우가 콤벳로그를
     * 하는 사람이 노리는 상황입니다. UPSERT 한 건이라 비용도 미미합니다.
     */
    public void recordCombatLog(Player player, String opponentName) {
        UUID uuid = player.getUniqueId();
        try {
            repository.markPending(uuid, serverId, opponentName);
            plugin.getLogger().warning("전투 중 접속 종료: " + player.getName()
                    + (opponentName == null ? "" : " (상대: " + opponentName + ")")
                    + " — 재접속 시 처형 예약");
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE,
                    "전투로그 기록 실패: " + player.getName(), e);
            return;
        }

        if (plugin.getConfig().getBoolean("combat.announce-logout", true)) {
            Bukkit.broadcast(plugin.msg().broadcast("combat.logout-announce",
                    "player", player.getName()));
        }
    }

    // ── 재접속 시 처형 ────────────────────────────────────────────────

    /**
     * 접속한 플레이어에게 처형 기록이 있으면 집행합니다.
     *
     * 조회는 비동기, 집행은 메인 스레드. 집행 전에 Core의 플레이어 데이터가
     * 로드되어 있어야 자체 XP를 0으로 만들 수 있으므로 약간 늦춰 실행합니다.
     */
    public void checkOnJoin(Player player) {
        UUID uuid = player.getUniqueId();

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            RaidRepository.Pending pending;
            try {
                pending = repository.findPending(uuid, serverId);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "처형 기록 조회 실패: " + player.getName(), e);
                return;
            }
            if (pending == null) return;

            long delay = plugin.getConfig().getLong("combat.execution-delay-ticks", 40);
            Bukkit.getScheduler().runTaskLater(plugin,
                    () -> execute(player, pending), delay);
        });
    }

    private void execute(Player player, RaidRepository.Pending pending) {
        if (!player.isOnline()) return;   // 바로 다시 나갔다면 기록은 남겨둡니다

        UUID uuid = player.getUniqueId();
        executing.add(uuid);
        try {
            // 1) 인벤토리를 먼저 비웁니다. 이 순서가 규칙의 전부입니다.
            //    clear() 는 장비칸과 보조손까지 포함하지만, 의존하지 않고 명시합니다.
            PlayerInventory inventory = player.getInventory();
            inventory.clear();
            inventory.setArmorContents(null);
            inventory.setItemInOffHand(null);
            player.setItemOnCursor(null);

            // 2) 자체 XP 소멸. 레벨까지 날릴지는 설정으로 둡니다 —
            //    기본값은 레벨 유지입니다. 레벨은 수십 시간짜리 누적이라
            //    한 번의 콤벳로그로 지우면 처벌이 아니라 탈주 사유가 됩니다.
            wipeXp(player);

            // 3) 바닐라 XP도 0으로. 안 하면 경험치 구슬이 바닥에 흩뿌려집니다.
            player.setTotalExperience(0);
            player.setLevel(0);
            player.setExp(0f);

            // 4) 왜 죽는지 먼저 알립니다. 죽인 다음에 띄우면 사망 화면에 가려서,
            //    플레이어 입장에서는 이유 없이 죽은 것으로 보입니다.
            plugin.msg().sendTitle(player, "execution.title", "execution.subtitle");
            plugin.msg().send(player, "execution.chat",
                    "opponent", pending.opponent() == null
                            ? plugin.msg().raw(player, "execution.unknown-opponent")
                            : pending.opponent());
            player.playSound(player.getLocation(), Sound.ENTITY_WITHER_SPAWN, 0.6f, 0.6f);

            plugin.getCombatTags().clear(uuid);

            // 5) 이제 죽입니다. 떨어질 것이 아무것도 남아 있지 않습니다.
            player.setHealth(0.0);

            plugin.getLogger().warning("전투로그 처형 집행: " + player.getName());
        } finally {
            // 사망 이벤트가 같은 틱에 돌고 나서 지워야 합니다.
            Bukkit.getScheduler().runTask(plugin, () -> executing.remove(uuid));
        }

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.clearPending(uuid, serverId);
            } catch (SQLException e) {
                // 지우지 못하면 다음 접속에 한 번 더 집행됩니다. 인벤토리는 이미
                // 비어 있으므로 손해는 없고, 기록이 남는 쪽이 안전합니다.
                plugin.getLogger().log(Level.SEVERE, "처형 기록 삭제 실패: " + player.getName(), e);
            }
        });
    }

    private void wipeXp(Player player) {
        RucPlayer data = plugin.core().getPlayerData().get(player);
        if (data == null) {
            // 아직 로드 전이면 조금 뒤 다시 시도합니다. 인벤토리는 이미 비웠으므로
            // XP만 놓치는 상황을 막습니다.
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                if (player.isOnline()) wipeXp(player);
            }, 20L);
            return;
        }

        data.setXp(0);
        if (plugin.getConfig().getBoolean("combat.execution-resets-level", false)) {
            data.setLevel(1);
        }
        plugin.core().getPlayerData().saveAsync(data);
    }

    /** 지금 처형 중인 사망인지. 사망 메시지·드랍 처리에서 구분용. */
    public boolean isExecuting(UUID uuid) {
        return executing.contains(uuid);
    }

    /** (스태프) 예약된 처형을 취소합니다. 오심 구제용. */
    public void pardon(UUID uuid, Runnable done) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.clearPending(uuid, serverId);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "처형 취소 실패", e);
            }
            if (done != null) Bukkit.getScheduler().runTask(plugin, done);
        });
    }
}
