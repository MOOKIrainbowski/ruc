package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.storage.EggReignRepository;
import kr.rucserver.core.storage.EggReignRepository.Reign;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Display;
import org.bukkit.entity.TextDisplay;
import org.bukkit.scheduler.BukkitTask;

import java.util.List;
import java.util.logging.Level;

/**
 * 홈 광장의 드래곤 알 기념비 (2026-10-09, docs/08 B) — 이번 시즌 통치 시간 상위 5명을 떠 있는 글자로.
 * {@code egg-reign.monument.enabled} 를 켠 서버(홈)에서만 돕니다. 표시는 저장하지 않고(재기동 때 새로) 5분마다 고칩니다.
 */
public class EggMonumentService {

    private final RucCore plugin;
    private final EggReignRepository repository;
    private TextDisplay display;
    private BukkitTask task;

    public EggMonumentService(RucCore plugin, EggReignRepository repository) {
        this.plugin = plugin;
        this.repository = repository;
    }

    public void start() {
        if (!plugin.getConfig().getBoolean("egg-reign.monument.enabled", false)) return;
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::update, 100L, 20L * 300);
    }

    public void stop() {
        if (task != null) task.cancel();
        if (display != null) display.remove();
    }

    private void update() {
        String season = plugin.getConfig().getString("egg-reign.season", "S1");
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            List<Reign> top;
            try {
                top = repository.top(season, 5);
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "[알 기념비] 조회 실패", e);
                return;
            }
            StringBuilder sb = new StringBuilder("&5&l🥚 드래곤 알 통치자 &7(" + season + ")");
            if (top.isEmpty()) sb.append("\n&7아직 아무도 — 약탈 서버의 알을 차지하세요");
            for (int i = 0; i < top.size(); i++) {
                sb.append("\n").append(i == 0 ? "&6" : "&f").append(i + 1).append(". ")
                        .append(top.get(i).name()).append(" &7").append(EggReignRepository.format(top.get(i).seconds()));
            }
            String text = sb.toString();
            Bukkit.getScheduler().runTask(plugin, () -> show(text));
        });
    }

    private void show(String text) {
        if (display == null || !display.isValid()) {
            World world = Bukkit.getWorld(plugin.getConfig().getString("egg-reign.monument.world", "world"));
            if (world == null) return;
            Location at = new Location(world,
                    plugin.getConfig().getDouble("egg-reign.monument.x"),
                    plugin.getConfig().getDouble("egg-reign.monument.y"),
                    plugin.getConfig().getDouble("egg-reign.monument.z"));
            display = world.spawn(at, TextDisplay.class, d -> {
                d.setPersistent(false);
                d.setBillboard(Display.Billboard.CENTER);
                d.setShadowed(true);
            });
        }
        display.text(MessageService.colorize(text));
    }
}
