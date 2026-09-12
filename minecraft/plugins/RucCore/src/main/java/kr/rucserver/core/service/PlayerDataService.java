package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.storage.PlayerRepository;
import org.bukkit.entity.Player;

import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;

/**
 * 접속 중인 플레이어 데이터를 메모리에 캐시하고 DB와 동기화합니다.
 *
 * 규칙: DB I/O는 절대 메인 스레드에서 하지 않습니다. 스코어보드가 매 초 캐시를
 * 읽기 때문에, 캐시에 없으면 그냥 없는 것으로 처리하고 비동기 로드를 기다립니다.
 */
public class PlayerDataService {

    private final RucCore plugin;
    private final PlayerRepository repository;
    private final Map<UUID, RucPlayer> cache = new ConcurrentHashMap<>();

    public PlayerDataService(RucCore plugin, PlayerRepository repository) {
        this.plugin = plugin;
        this.repository = repository;
    }

    /** 접속 시 호출. 비동기로 로드하고, 신규면 만들어 저장합니다. */
    public void loadAsync(Player player, Runnable afterLoad) {
        UUID uuid = player.getUniqueId();
        String name = player.getName();

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            RucPlayer data;
            try {
                data = repository.find(uuid);
                if (data == null) {
                    data = RucPlayer.createNew(
                            uuid, name,
                            plugin.getConfig().getLong("economy.starting-balance", 1000),
                            plugin.getConfig().getString("language.default", "ko"));
                    repository.save(data);
                    plugin.getLogger().info("신규 플레이어 등록: " + name);
                } else {
                    data.setName(name);
                    data.setLastSeen(System.currentTimeMillis());
                }
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "플레이어 데이터 로드 실패: " + name, e);
                return;
            }

            cache.put(uuid, data);

            if (afterLoad != null) {
                plugin.getServer().getScheduler().runTask(plugin, afterLoad);
            }
        });
    }

    /** 퇴장 시 호출. 저장하고 캐시에서 제거합니다. */
    public void unloadAsync(UUID uuid) {
        RucPlayer data = cache.remove(uuid);
        if (data == null) return;
        data.setLastSeen(System.currentTimeMillis());
        saveAsync(data);
    }

    public void saveAsync(RucPlayer data) {
        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.save(data);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "플레이어 데이터 저장 실패: " + data.getName(), e);
            }
        });
    }

    /** 접속 중인 전원 저장. 서버 종료 시 동기로 한 번 돌립니다. */
    public void saveAllBlocking() {
        for (RucPlayer data : cache.values()) {
            try {
                repository.save(data);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "종료 중 저장 실패: " + data.getName(), e);
            }
        }
    }

    /** 캐시된 데이터. 아직 로드 중이면 null. */
    public RucPlayer get(UUID uuid) {
        return cache.get(uuid);
    }

    public RucPlayer get(Player player) {
        return cache.get(player.getUniqueId());
    }

    /** 플레이어의 표시 언어. 데이터가 아직 없으면 서버 기본값. */
    public String languageOf(Player player) {
        RucPlayer data = get(player);
        if (data != null && data.getLanguage() != null) return data.getLanguage();
        return plugin.getConfig().getString("language.default", "ko");
    }

    public PlayerRepository getRepository() {
        return repository;
    }
}
