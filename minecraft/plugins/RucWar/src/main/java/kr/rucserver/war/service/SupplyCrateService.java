package kr.rucserver.war.service;

import kr.rucserver.core.model.Guild;
import kr.rucserver.war.RucWar;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Barrel;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 보급 상자 (2026-10-10) — 전쟁 시간대가 끝날 때, 그리고 평시에도 {@code supply.interval-minutes} 마다
 * 오버월드 곳곳에 떨어지는 배틀로얄식 상자.
 *
 * 좌표는 알리지 않습니다 (2026-10-12) — 개수만 공지하고, 떨어진 자리의 불꽃 · 폭음으로 찾습니다.
 * 남의 영토에 떨어진 상자는 평시에 그 국가만 열 수 있습니다
 * (다른 활동 — 채집 · 약탈 · 파괴 — 은 영토에서도 됩니다. 상자만 예외).
 *
 * 주기: 떨어진 뒤 {@code supply.lifetime-minutes} 가 지나면 남은 상자를 회수하고,
 * {@code supply.interval-minutes} 마다 새로 떨굽니다 (회수 ~ 다음 낙하 사이가 빈 시간).
 * 상자 위치는 supply-crates.txt 에 남겨서 재시작 뒤에도 회수합니다.
 */
public class SupplyCrateService implements Listener {

    private final RucWar plugin;
    private final NamespacedKey crateKey;

    /** 이번 회차 상자 위치. supply-crates.txt 에도 적어 재시작 뒤에도 회수합니다. */
    private final List<Location> live = new ArrayList<>();
    private org.bukkit.scheduler.BukkitTask expireTask;

    public SupplyCrateService(RucWar plugin) {
        this.plugin = plugin;
        this.crateKey = new NamespacedKey(plugin, "supply_crate");
    }

    /** 평시 자동 보급 (2026-10-11). 국가전 서버에 아무도 없으면 건너뜁니다 — 보는 사람 없는 상자를 위해 청크를 만들 이유가 없습니다. */
    public void start() {
        loadLive();
        clearOld(); // 재시작 전 회차의 상자 — 얼마나 지났는지 모르니 치우고 새 주기로
        long minutes = plugin.getConfig().getLong("supply.interval-minutes", 30);
        if (minutes <= 0) return;
        long period = minutes * 60 * 20;
        long first = Math.min(period, plugin.getConfig().getLong("supply.first-drop-minutes", 5) * 60 * 20);
        Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            if (!Bukkit.getOnlinePlayers().isEmpty()) dropAll("war.supply-incoming-timer");
        }, Math.max(1, first), period);
    }

    /** 종전 때 부릅니다. 옛 상자를 치우고 새로 떨굽니다. */
    public void dropAll() {
        dropAll("war.supply-incoming");
    }

    /** 스태프 /전쟁 보급 — 평시 보급과 같은 안내로. */
    public void dropNow() {
        dropAll("war.supply-incoming-timer");
    }

    private void dropAll(String announceKey) {
        if (!plugin.getConfig().getBoolean("supply.enabled", true)) return;
        clearOld();
        long lifetime = plugin.getConfig().getLong("supply.lifetime-minutes", 25);
        if (expireTask != null) expireTask.cancel();
        if (lifetime > 0) {
            expireTask = Bukkit.getScheduler().runTaskLater(plugin, () -> {
                if (live.isEmpty()) return;
                clearOld();
                plugin.msg().broadcastAll("war.supply-expired");
            }, lifetime * 60 * 20);
        }

        World world = Bukkit.getWorld(plugin.getConfig().getString("supply.world", "world"));
        if (world == null) return;
        int count = plugin.getConfig().getInt("supply.count", 6);
        int radius = plugin.getConfig().getInt("supply.radius", 1500);
        int minDistance = plugin.getConfig().getInt("supply.min-distance", 200);
        Location spawn = world.getSpawnLocation();

        plugin.msg().broadcastAll(announceKey, "count", String.valueOf(count),
                "minutes", String.valueOf(lifetime));
        for (int i = 1; i <= count; i++) {
            int x, z;
            do {
                x = spawn.getBlockX() + ThreadLocalRandom.current().nextInt(-radius, radius + 1);
                z = spawn.getBlockZ() + ThreadLocalRandom.current().nextInt(-radius, radius + 1);
            } while (Math.hypot(x - spawn.getX(), z - spawn.getZ()) < minDistance);
            final int fx = x, fz = z, index = i;
            world.getChunkAtAsync(x >> 4, z >> 4).thenAccept(chunk -> place(world, fx, fz, index));
        }
    }

    private void place(World world, int x, int z, int index) {
        Block block = world.getHighestBlockAt(x, z).getRelative(0, 1, 0);
        // 통(barrel) — 상자는 옆에 상자를 놓으면 합쳐져서 접근 규칙을 우회합니다.
        block.setType(Material.BARREL);
        if (!(block.getState() instanceof Barrel chest)) return;
        chest.customName(Component.text("보급 상자 #" + index));
        chest.getPersistentDataContainer().set(crateKey, PersistentDataType.BYTE, (byte) 1);
        chest.update();
        fill(((Barrel) block.getState()).getInventory());
        live.add(block.getLocation());
        saveLive();
        world.spawnParticle(Particle.FIREWORK, block.getLocation().add(0.5, 1, 0.5), 80, 0.5, 4, 0.5, 0.05, null, true);
        world.playSound(block.getLocation(), Sound.ENTITY_FIREWORK_ROCKET_LARGE_BLAST_FAR, 4f, 1f);
    }

    /** 강화석 + config 의 보물 목록에서 몇 줄. 보물 한 줄 = "재료 최소-최대 확률%". */
    private void fill(Inventory inventory) {
        ThreadLocalRandom random = ThreadLocalRandom.current();
        List<ItemStack> items = new ArrayList<>();
        int minStones = plugin.getConfig().getInt("supply.stones-min", 2);
        int maxStones = plugin.getConfig().getInt("supply.stones-max", 5);
        items.add(plugin.getUpgrades().createStone(random.nextInt(minStones, maxStones + 1)));

        for (String line : plugin.getConfig().getStringList("supply.loot")) {
            String[] parts = line.trim().split("\\s+");
            Material material = parts.length == 3 ? Material.matchMaterial(parts[0]) : null;
            if (material == null) {
                plugin.getLogger().warning("supply.loot 줄을 읽을 수 없습니다: " + line);
                continue;
            }
            String[] range = parts[1].split("-");
            double chance = Double.parseDouble(parts[2].replace("%", "")) / 100.0;
            if (random.nextDouble() >= chance) continue;
            int min = Integer.parseInt(range[0]);
            int max = range.length > 1 ? Integer.parseInt(range[1]) : min;
            items.add(new ItemStack(material, random.nextInt(min, max + 1)));
        }

        for (ItemStack item : items) {
            int slot;
            do slot = random.nextInt(inventory.getSize()); while (inventory.getItem(slot) != null);
            inventory.setItem(slot, item);
        }
    }

    private void clearOld() {
        for (Location at : live) {
            if (!at.isChunkLoaded()) {
                at.getWorld().getChunkAtAsync(at).thenAccept(c -> remove(at.getBlock()));
            } else {
                remove(at.getBlock());
            }
        }
        live.clear();
        saveLive();
    }

    private java.io.File liveFile() {
        return new java.io.File(plugin.getDataFolder(), "supply-crates.txt");
    }

    /** 한 줄 = "월드 x y z" */
    private void saveLive() {
        StringBuilder sb = new StringBuilder();
        for (Location at : live) {
            sb.append(at.getWorld().getName()).append(' ').append(at.getBlockX()).append(' ')
                    .append(at.getBlockY()).append(' ').append(at.getBlockZ()).append('\n');
        }
        try {
            java.nio.file.Files.writeString(liveFile().toPath(), sb.toString());
        } catch (java.io.IOException e) {
            plugin.getLogger().warning("supply-crates.txt 저장 실패: " + e.getMessage());
        }
    }

    private void loadLive() {
        if (!liveFile().exists()) return;
        try {
            for (String line : java.nio.file.Files.readAllLines(liveFile().toPath())) {
                String[] p = line.trim().split(" ");
                World w = p.length == 4 ? Bukkit.getWorld(p[0]) : null;
                if (w != null) live.add(new Location(w, Integer.parseInt(p[1]), Integer.parseInt(p[2]), Integer.parseInt(p[3])));
            }
        } catch (Exception e) {
            plugin.getLogger().warning("supply-crates.txt 읽기 실패: " + e.getMessage());
        }
    }

    private void remove(Block block) {
        if (!isCrate(block)) return;
        ((Barrel) block.getState()).getInventory().clear();
        block.setType(Material.AIR);
    }

    public boolean isCrate(Block block) {
        return block.getType() == Material.BARREL && block.getState() instanceof Barrel chest
                && chest.getPersistentDataContainer().has(crateKey, PersistentDataType.BYTE);
    }

    // ── 접근 규칙 ──────────────────────────────────────────────────────

    /** 평시 남의 영토의 보급 상자는 그 국가만. 전쟁 중에는 누구나. */
    private boolean denied(Player player, Block block) {
        if (!isCrate(block) || plugin.getSchedule().isOpen()) return false;
        if (player.hasPermission("rucwar.bypass.territory")) return false;
        Integer owner = plugin.getTerritory().ownerOf(block.getLocation());
        if (owner == null) return false;
        Guild guild = plugin.core().getGuilds().of(player);
        return guild == null || guild.getId() != owner;
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onOpen(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getClickedBlock() == null) return;
        if (!denied(event.getPlayer(), event.getClickedBlock())) return;
        event.setCancelled(true);
        plugin.msg().send(event.getPlayer(), "war.supply-denied",
                "guild", String.valueOf(plugin.getTerritory().ownerNameAt(event.getClickedBlock().getLocation())));
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        if (!denied(event.getPlayer(), event.getBlock())) return;
        event.setCancelled(true);
        plugin.msg().send(event.getPlayer(), "war.supply-denied",
                "guild", String.valueOf(plugin.getTerritory().ownerNameAt(event.getBlock().getLocation())));
    }

    /** 폭발로 상자를 터뜨려 우회하는 길. 보급 상자는 폭발에 안 깨집니다. */
    @EventHandler(ignoreCancelled = true)
    public void onEntityExplode(EntityExplodeEvent event) {
        event.blockList().removeIf(this::isCrate);
    }

    @EventHandler(ignoreCancelled = true)
    public void onBlockExplode(BlockExplodeEvent event) {
        event.blockList().removeIf(this::isCrate);
    }

    /** 호퍼로 빼 가는 우회 길. */
    @EventHandler(ignoreCancelled = true)
    public void onHopper(InventoryMoveItemEvent event) {
        if (event.getSource().getHolder() instanceof Barrel barrel && isCrate(barrel.getBlock())) event.setCancelled(true);
    }
}
