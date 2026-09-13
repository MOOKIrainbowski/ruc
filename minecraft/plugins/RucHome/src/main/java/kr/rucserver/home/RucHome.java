package kr.rucserver.home;

import kr.rucserver.home.listener.HubRulesListener;
import kr.rucserver.home.listener.SelectorListener;
import kr.rucserver.home.service.ServerSelector;
import kr.rucserver.home.service.VoidGuard;
import kr.rucserver.home.world.PlazaBuilder;
import kr.rucserver.home.world.VoidGenerator;
import org.bukkit.Bukkit;
import org.bukkit.Difficulty;
import org.bukkit.GameMode;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.plugin.java.JavaPlugin;
import org.jetbrains.annotations.NotNull;

/**
 * 홈(허브) 서버 모듈.
 *
 * 공용 시스템은 RucCore가 소유하고, 여기서는 허브 고유의 규칙과 구조물만
 * 다룹니다 — 광장, 서버 선택, §2.3의 안전 규칙.
 */
public class RucHome extends JavaPlugin {

    private World hubWorld;
    private ServerSelector selector;
    private VoidGuard voidGuard;
    private final PlazaBuilder builder = new PlazaBuilder();

    @Override
    public void onEnable() {
        saveDefaultConfig();

        selector = new ServerSelector(this);

        hubWorld = prepareHubWorld();
        if (hubWorld == null) {
            getLogger().severe("허브 월드를 준비하지 못했습니다. 플러그인을 비활성화합니다.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        // 프록시 전환용 채널 (Velocity 가 BungeeCord 채널을 호환 지원)
        getServer().getMessenger().registerOutgoingPluginChannel(this, "BungeeCord");

        getServer().getPluginManager().registerEvents(new HubRulesListener(this), this);
        getServer().getPluginManager().registerEvents(new SelectorListener(this), this);

        // 허브 밖으로 떨어지면 스폰으로 귀환 (허공이라 죽지도 않습니다)
        voidGuard = new VoidGuard(this);
        voidGuard.start();

        getLogger().info("RucHome 활성화 완료 (월드: " + hubWorld.getName() + ")");
    }

    @Override
    public void onDisable() {
        if (voidGuard != null) voidGuard.stop();
        getLogger().info("RucHome 비활성화");
    }

    // ── 허브 월드 ──────────────────────────────────────────────────────

    /**
     * 허브 전용 빈 월드를 만들고 규칙을 적용합니다.
     * 이미 있으면 그대로 쓰고, 광장이 없으면 짓습니다.
     */
    private World prepareHubWorld() {
        String name = getConfig().getString("hub-world", "hub");

        World world = Bukkit.getWorld(name);
        if (world == null) {
            getLogger().info("허브 월드 '" + name + "' 생성 중…");
            WorldCreator creator = new WorldCreator(name)
                    .generator(new VoidGenerator())
                    .generateStructures(false);
            world = creator.createWorld();
        }
        if (world == null) return null;

        applyWorldRules(world);

        // 광장이 아직 없으면 짓습니다 (스폰 지점 아래 블록으로 판단).
        if (world.getBlockAt(0, PlazaBuilder.groundY() - 1, 0).getType().isAir()) {
            getLogger().info("광장 생성 중…");
            builder.buildAll(world);
            selector.spawnNpcs(world);
            getLogger().info("광장 생성 완료");
        }

        world.setSpawnLocation(PlazaBuilder.spawnLocation(world));
        return world;
    }

    /**
     * §2.3 허브 전역 설정.
     *
     * KEEP_INVENTORY / ANNOUNCE_ADVANCEMENTS / SHOW_DEATH_MESSAGES 는 Paper에서
     * 제거 예정으로 표시되어 있습니다. 1.21.11에서는 정상 동작하며, 실제로
     * 제거되면 여기만 고치면 됩니다.
     */
    @SuppressWarnings("removal")
    private void applyWorldRules(World world) {
        world.setDifficulty(Difficulty.PEACEFUL);
        world.setTime(6000);                       // 항상 낮
        world.setStorm(false);
        world.setThundering(false);

        world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        world.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        world.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        world.setGameRule(GameRule.FALL_DAMAGE, false);
        world.setGameRule(GameRule.DO_FIRE_TICK, false);
        world.setGameRule(GameRule.MOB_GRIEFING, false);
        world.setGameRule(GameRule.KEEP_INVENTORY, true);
        world.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);
        world.setGameRule(GameRule.SHOW_DEATH_MESSAGES, false);
    }

    public boolean isHubWorld(World world) {
        return hubWorld != null && world != null
                && world.getName().equals(hubWorld.getName());
    }

    public World getHubWorld() { return hubWorld; }
    public ServerSelector getSelector() { return selector; }

    /** 허브 도착 시 상태를 정리합니다. */
    public void setupPlayer(Player player) {
        player.setGameMode(GameMode.ADVENTURE);
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setHealth(Math.min(20.0, player.getAttribute(
                org.bukkit.attribute.Attribute.MAX_HEALTH).getValue()));
        player.setFireTicks(0);
        player.getInventory().clear();
        selector.giveCompass(player);
    }

    // ── 관리 명령어 ────────────────────────────────────────────────────

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        if (!command.getName().equalsIgnoreCase("hub")) return false;

        if (args.length == 0) {
            sender.sendMessage("§c사용법: /hub <build|npc|spawn>");
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "build" -> {
                sender.sendMessage("§a광장을 다시 짓는 중…");
                builder.buildAll(hubWorld);
                selector.spawnNpcs(hubWorld);
                hubWorld.setSpawnLocation(PlazaBuilder.spawnLocation(hubWorld));
                sender.sendMessage("§a완료.");
            }
            case "npc" -> {
                selector.spawnNpcs(hubWorld);
                sender.sendMessage("§aNPC를 다시 배치했습니다.");
            }
            case "spawn" -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("§c게임 안에서만 사용할 수 있습니다.");
                    return true;
                }
                player.teleport(PlazaBuilder.spawnLocation(hubWorld));
                setupPlayer(player);
                sender.sendMessage("§a광장으로 이동했습니다.");
            }
            default -> sender.sendMessage("§c알 수 없는 인자입니다.");
        }
        return true;
    }

    /** VoidGenerator 를 Bukkit 이 월드 로드 시에도 찾을 수 있게 합니다. */
    @Override
    public ChunkGenerator getDefaultWorldGenerator(@NotNull String worldName, String id) {
        return new VoidGenerator();
    }

    public Location spawn() {
        return PlazaBuilder.spawnLocation(hubWorld);
    }
}
