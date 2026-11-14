package kr.rucserver.rpg.character;

import kr.rucserver.rpg.RucRpg;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.logging.Level;

/**
 * 접속 → DB 에서 캐릭터를 비동기로 읽어 메모리에, 나가면 저장. 1분마다 자동 저장.
 * 처음 온 사람(캐릭터 없음)은 onNew 로 넘김 → 주 속성 고르기 창.
 */
public final class CharService implements Listener {

    private final RucRpg plugin;
    private final CharStore store;
    private final Map<UUID, RpgChar> online = new ConcurrentHashMap<>();
    private Consumer<Player> onNew = p -> {};
    private Consumer<Player> onLoaded = p -> {};

    public CharService(RucRpg plugin, CharStore store) {
        this.plugin = plugin;
        this.store = store;
        Bukkit.getScheduler().runTaskTimer(plugin, this::saveAllAsync, 20L * 60, 20L * 60);
    }

    public void onNew(Consumer<Player> f) { onNew = f; }
    public void onLoaded(Consumer<Player> f) { onLoaded = f; }

    /** 접속해 있고 캐릭터가 있으면 그 캐릭터, 아니면 null */
    public RpgChar get(Player p) { return online.get(p.getUniqueId()); }

    public Iterable<RpgChar> all() { return online.values(); }

    /** 주 속성을 고른 새 캐릭터 */
    public RpgChar create(Player p, String element) {
        RpgChar ch = new RpgChar(p.getUniqueId(), element);
        online.put(p.getUniqueId(), ch);
        saveAsync(ch);
        onLoaded.accept(p);
        return ch;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        UUID id = p.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                RpgChar ch = store.load(id);
                Bukkit.getScheduler().runTask(plugin, () -> {
                    if (!p.isOnline()) return;
                    if (ch == null) { onNew.accept(p); return; }
                    online.put(id, ch);
                    onLoaded.accept(p);
                });
            } catch (Exception ex) {
                plugin.getLogger().log(Level.SEVERE, "캐릭터 불러오기 실패: " + p.getName(), ex);
                Bukkit.getScheduler().runTask(plugin, () -> p.kick(net.kyori.adventure.text.Component.text("RPG 캐릭터를 불러오지 못했습니다. 잠시 후 다시 접속해 주세요.")));
            }
        });
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent e) {
        RpgChar ch = online.remove(e.getPlayer().getUniqueId());
        if (ch != null) saveAsync(ch);
    }

    public void saveAsync(RpgChar ch) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> saveNow(ch));
    }

    private void saveNow(RpgChar ch) {
        try {
            store.save(ch);
        } catch (Exception ex) {
            plugin.getLogger().log(Level.SEVERE, "캐릭터 저장 실패: " + ch.uuid, ex);
        }
    }

    private void saveAllAsync() {
        for (RpgChar ch : online.values()) saveAsync(ch);
    }

    /** 플러그인 끌 때 — 주 스레드에서 바로 (비동기 작업은 더 못 돌림) */
    public void saveAllNow() {
        for (RpgChar ch : online.values()) saveNow(ch);
    }
}
