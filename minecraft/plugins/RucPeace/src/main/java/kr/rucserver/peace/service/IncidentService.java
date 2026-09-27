package kr.rucserver.peace.service;

import kr.rucserver.peace.RucPeace;
import kr.rucserver.peace.storage.PeaceRepository;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.logging.Level;

/**
 * 테러·그리핑 기록 (§2.5 — "Helper 재량 제재" 의 근거).
 *
 * <h2>기록하는 것과 하지 않는 것</h2>
 * 막힌 <b>치명타와 폭발</b>만 남깁니다. 서로 스치는 직접 피해까지 남기면 하루에
 * 수천 건이 쌓여서 정작 봐야 할 것이 묻힙니다. 기록의 목적은 감시가 아니라
 * "이 사람이 반복해서 죽이려 했다" 를 Helper 가 알아보게 하는 것입니다.
 *
 * <h2>같은 사람에 대한 연속 시도는 묶습니다</h2>
 * 크리스탈 한 번에 피해 이벤트가 여러 번 들어오고, 용암에 밀린 사람은 초당
 * 여러 번 피해를 받습니다. 그대로 적으면 한 사건이 수십 줄이 됩니다.
 */
public class IncidentService {

    private final RucPeace plugin;
    private final PeaceRepository repository;

    /** (가해자→피해자) 마지막 기록 시각. 같은 사건의 중복 기록을 막습니다. */
    private final Map<String, Long> lastLogged = new ConcurrentHashMap<>();

    public IncidentService(RucPeace plugin, PeaceRepository repository) {
        this.plugin = plugin;
        this.repository = repository;
    }

    /**
     * 막힌 시도를 기록합니다.
     *
     * 실패해도 게임 진행을 막지 않습니다 — 기록은 운영 편의이고, 보호 자체는
     * 이미 {@link GuardService} 가 끝냈습니다.
     */
    public void record(Player victim, GuardService.Verdict verdict) {
        UUID actorUuid = verdict.actor();
        if (actorUuid == null) return;

        long debounce = plugin.getConfig().getLong("incident.debounce-seconds", 10) * 1000L;
        String pairKey = actorUuid + ">" + victim.getUniqueId();
        long now = System.currentTimeMillis();

        Long previous = lastLogged.get(pairKey);
        if (previous != null && now - previous < debounce) return;
        lastLogged.put(pairKey, now);

        // 가해자가 이미 나갔을 수 있습니다. 이름은 알 수 있으면 남기고,
        // 아니면 UUID 로 둡니다 — 나중에 조회할 때 UUID 가 본체입니다.
        Player actor = Bukkit.getPlayer(actorUuid);
        String actorName = actor != null ? actor.getName()
                : Bukkit.getOfflinePlayer(actorUuid).getName();
        if (actorName == null) actorName = actorUuid.toString().substring(0, 8);

        Location at = victim.getLocation();
        PeaceRepository.Incident incident = new PeaceRepository.Incident(
                actorUuid, actorName, victim.getUniqueId(), victim.getName(),
                verdict.kind(), at.getWorld() == null ? "?" : at.getWorld().getName(),
                at.getBlockX(), at.getBlockY(), at.getBlockZ(), now);

        // 콘솔에도 한 줄 남깁니다. DB 를 못 쓰게 되어도 흔적은 남아야 합니다.
        plugin.getLogger().warning("[평화] 살해 시도 차단: " + actorName
                + " → " + victim.getName() + " (" + verdict.kind() + ") "
                + incident.world() + " " + incident.x() + "," + incident.y() + "," + incident.z());

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.insert(incident);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "평화 서버 기록 저장 실패", e);
            }
        });

        notifyStaff(incident);
    }

    /**
     * 접속 중인 스태프에게 알립니다.
     *
     * 사후 조회만 있으면 아무도 보지 않습니다. 실시간 대응이 Helper 의 역할(§3.2)
     * 이므로 그 순간에 알려야 의미가 있습니다.
     */
    private void notifyStaff(PeaceRepository.Incident incident) {
        if (!plugin.getConfig().getBoolean("incident.notify-staff", true)) return;

        for (Player staff : Bukkit.getOnlinePlayers()) {
            if (!staff.hasPermission("rucpeace.staff")) continue;
            plugin.msg().send(staff, "peace.incident-alert",
                    "actor", incident.actorName(),
                    "victim", incident.victimName(),
                    "kind", incident.kind());
        }
    }

    /** 최근 기록 조회. 비동기 콜백입니다. */
    public void recent(String actorName, int limit,
                       Consumer<List<PeaceRepository.Incident>> callback) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            List<PeaceRepository.Incident> rows;
            try {
                rows = repository.recent(actorName, limit);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "평화 서버 기록 조회 실패", e);
                rows = List.of();
            }
            List<PeaceRepository.Incident> result = rows;
            Bukkit.getScheduler().runTask(plugin, () -> callback.accept(result));
        });
    }

    /** 누적 건수 조회. 비동기 콜백입니다. */
    public void countFor(String actorName, Consumer<Integer> callback) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            int count;
            try {
                count = repository.countFor(actorName);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "평화 서버 기록 집계 실패", e);
                count = -1;
            }
            int result = count;
            Bukkit.getScheduler().runTask(plugin, () -> callback.accept(result));
        });
    }

    /** 오래된 디바운스 항목 정리. */
    public void purge() {
        long debounce = plugin.getConfig().getLong("incident.debounce-seconds", 10) * 1000L;
        long now = System.currentTimeMillis();
        lastLogged.entrySet().removeIf(entry -> now - entry.getValue() > debounce * 10);
    }
}
