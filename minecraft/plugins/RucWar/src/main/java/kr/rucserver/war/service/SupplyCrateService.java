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
 * 보급 상자 (2026-10-10) — 전쟁 시간대가 끝날 때마다 오버월드 곳곳에 떨어지는 배틀로얄식 상자.
 *
 * 좌표를 전 서버에 공지합니다. 남의 영토에 떨어진 상자는 평시에 그 국가만 열 수 있습니다
 * (다른 활동 — 채집 · 약탈 · 파괴 — 은 영토에서도 됩니다. 상자만 예외).
 * 다음 보급 때 남은 옛 상자는 치웁니다.
 */
public class SupplyCrateService implements Listener {

    private final RucWar plugin;
    private final NamespacedKey crateKey;

    /** 이번 회차 상자 위치. ponytail: 메모리만 — 재시작 뒤 남은 상자는 평범한 상자로 남음(태그는 유지되어 접근 규칙은 그대로) */
    private final List<Location> live = new ArrayList<>();

    public SupplyCrateService(RucWar plugin) {
        this.plugin = plugin;
        this.crateKey = new NamespacedKey(plugin, "supply_crate");
    }

    /** 종전 때 부릅니다. 옛 상자를 치우고 새로 떨굽니다. */
    public void dropAll() {
        if (!plugin.getConfig().getBoolean("supply.enabled", true)) return;
        clearOld();

        World world = Bukkit.getWorld(plugin.getConfig().getString("supply.world", "world"));
        if (world == null) return;
        int count = plugin.getConfig().getInt("supply.count", 6);
        int radius = plugin.getConfig().getInt("supply.radius", 1500);
        int minDistance = plugin.getConfig().getInt("supply.min-distance", 200);
        Location spawn = world.getSpawnLocation();

        plugin.msg().broadcastAll("war.supply-incoming", "count", String.valueOf(count));
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

        String owner = plugin.getTerritory().ownerNameAt(block.getLocation());
        plugin.msg().broadcastAll(owner == null ? "war.supply-landed" : "war.supply-landed-territory",
                "index", String.valueOf(index), "x", String.valueOf(x), "y", String.valueOf(block.getY()),
                "z", String.valueOf(z), "guild", owner == null ? "" : owner);
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
