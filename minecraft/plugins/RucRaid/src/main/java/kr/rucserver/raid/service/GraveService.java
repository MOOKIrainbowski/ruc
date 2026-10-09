package kr.rucserver.raid.service;

import kr.rucserver.raid.RucRaid;
import kr.rucserver.raid.storage.RaidRepository;
import kr.rucserver.raid.storage.RaidRepository.GraveRow;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerInteractAtEntityEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.SkullMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.scheduler.BukkitTask;
import org.jetbrains.annotations.NotNull;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;

/**
 * 도망자의 무덤 (2026-10-09, docs/08-UNIQUE-FEATURES.md C).
 *
 * 전투 태그 중에 나가면 짐을 지우는 대신 그 자리에 무덤을 남깁니다. 처형(재접속 시 사망 · XP 소멸)은 그대로입니다.
 * <ul>
 *   <li>처음 {@code grave.lock-minutes} 분은 <b>싸우던 상대만</b>, 그 뒤엔 누구나 엽니다. 주인은 끝까지 못 엽니다.</li>
 *   <li>꺼내기만 됩니다 — 넣기는 막습니다 (무덤이 공짜 금고가 되면 안 됨).</li>
 *   <li>{@code grave.expire-minutes} 분이 지나면 남은 것은 사라집니다 (원래 규칙처럼 소멸).</li>
 *   <li>드래곤 알은 무덤에 넣지 않고 그 자리에 떨어뜨립니다 — 예전에는 처형 때 같이 지워져 영영 사라졌습니다.</li>
 * </ul>
 * 내용은 DB 에 두어 서버가 꺼져도 남습니다. 표시는 주인 머리를 쓴 투명 갑옷 거치대입니다.
 */
public class GraveService implements Listener {

    private final RucRaid plugin;
    private final RaidRepository repository;
    private final String serverId;
    private final NamespacedKey graveKey;
    private final long lockMs;
    private final long expireMs;

    private final Map<Long, Grave> graves = new HashMap<>();
    private BukkitTask task;

    private static final class Grave {
        final GraveRow row;
        final Inventory inventory;
        ArmorStand marker;

        Grave(GraveRow row, Inventory inventory) {
            this.row = row;
            this.inventory = inventory;
        }
    }

    public GraveService(RucRaid plugin, RaidRepository repository, String serverId) {
        this.plugin = plugin;
        this.repository = repository;
        this.serverId = serverId;
        this.graveKey = new NamespacedKey(plugin, "grave");
        this.lockMs = plugin.getConfig().getLong("grave.lock-minutes", 5) * 60_000L;
        this.expireMs = plugin.getConfig().getLong("grave.expire-minutes", 30) * 60_000L;
    }

    public void start() {
        try {
            for (GraveRow row : repository.loadGraves(serverId)) restore(row);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[무덤] 불러오기 실패", e);
        }
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L * 30, 20L * 30);
    }

    public void stop() {
        if (task != null) task.cancel();
        for (Grave g : graves.values()) {
            for (Player viewer : viewers(g)) viewer.closeInventory();
            if (g.marker != null) g.marker.remove();
        }
        graves.clear();
    }

    // ── 만들기 ─────────────────────────────────────────────────────────

    /**
     * 퇴장 순간 짐을 무덤으로 옮깁니다. ExecutionService.recordCombatLog 처럼 DB 를 <b>동기로</b> 씁니다 —
     * 기록 전에 서버가 꺼지면 짐이 복사되거나 사라집니다. 기록이 실패하면 짐은 그대로 두어 처형 때 지워집니다(예전 동작).
     */
    public void create(Player player, UUID opponent, String opponentName) {
        PlayerInventory inv = player.getInventory();
        Location at = player.getLocation();
        List<ItemStack> items = new ArrayList<>();
        for (ItemStack item : inv.getContents()) {   // 장비칸 · 보조손 포함
            if (item == null || item.getType().isAir()) continue;
            if (item.getType() == Material.DRAGON_EGG) {
                at.getWorld().dropItemNaturally(at, item);
                continue;
            }
            items.add(item);
        }
        ItemStack cursor = player.getItemOnCursor();
        if (!cursor.getType().isAir()) items.add(cursor);
        if (items.isEmpty()) {
            inv.clear();   // 알만 있었던 경우
            return;
        }
        // 54칸을 넘는 짐은 없습니다 (인벤토리 41칸 + 커서).
        GraveRow row = new GraveRow(0, player.getUniqueId(), player.getName(), opponent, opponentName,
                at.getWorld().getName(), at.getX(), at.getY(), at.getZ(), System.currentTimeMillis(),
                ItemStack.serializeItemsAsBytes(items));
        long id;
        try {
            id = repository.insertGrave(serverId, row);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[무덤] 기록 실패 — 짐은 처형 때 소멸: " + player.getName(), e);
            return;
        }
        inv.clear();
        player.setItemOnCursor(null);
        restore(new GraveRow(id, row.owner(), row.ownerName(), opponent, opponentName, row.world(),
                row.x(), row.y(), row.z(), row.createdAt(), row.items()));

        Bukkit.broadcast(plugin.msg().broadcast("grave.created",
                "player", player.getName(),
                "x", String.valueOf(Math.round(at.getX() / 10) * 10),
                "z", String.valueOf(Math.round(at.getZ() / 10) * 10),
                "opponent", opponentName == null ? plugin.msg().raw(Bukkit.getConsoleSender(), "execution.unknown-opponent") : opponentName,
                "minutes", String.valueOf(lockMs / 60_000)));
    }

    private void restore(GraveRow row) {
        World world = Bukkit.getWorld(row.world());
        if (world == null) return;
        Holder holder = new Holder(row.id());
        Inventory inv = Bukkit.createInventory(holder, 54, Component.text("☠ " + row.ownerName() + " 의 무덤"));
        holder.inventory = inv;
        ItemStack[] items = ItemStack.deserializeItemsFromBytes(row.items());
        for (int i = 0; i < items.length && i < 54; i++) inv.setItem(i, items[i]);
        Grave g = new Grave(row, inv);
        graves.put(row.id(), g);
        spawnMarker(g, new Location(world, row.x(), row.y(), row.z()));
    }

    private void spawnMarker(Grave g, Location at) {
        g.marker = at.getWorld().spawn(at, ArmorStand.class, s -> {
            s.setInvisible(true);
            s.setSmall(true);
            s.setGravity(false);
            s.setInvulnerable(true);
            s.setPersistent(false);   // 다시 켤 때 DB 에서 새로 만듭니다
            s.setCustomNameVisible(true);
            s.customName(Component.text("☠ " + g.row.ownerName() + " 의 무덤"));
            s.getPersistentDataContainer().set(graveKey, PersistentDataType.LONG, g.row.id());
            ItemStack head = new ItemStack(Material.PLAYER_HEAD);
            SkullMeta meta = (SkullMeta) head.getItemMeta();
            meta.setOwningPlayer(Bukkit.getOfflinePlayer(g.row.owner()));
            head.setItemMeta(meta);
            s.getEquipment().setHelmet(head);
        });
    }

    // ── 열기 ───────────────────────────────────────────────────────────

    @EventHandler(priority = EventPriority.HIGH)
    public void onInteract(PlayerInteractAtEntityEvent event) {
        Long id = graveId(event.getRightClicked());
        if (id == null) return;
        event.setCancelled(true);
        if (event.getHand() != EquipmentSlot.HAND) return;
        Player player = event.getPlayer();
        Grave g = graves.get(id);
        if (g == null) {
            event.getRightClicked().remove();
            return;
        }
        boolean staff = player.hasPermission("ruccore.admin");
        if (!staff && player.getUniqueId().equals(g.row.owner())) {
            plugin.msg().send(player, "grave.own");
            return;
        }
        long age = System.currentTimeMillis() - g.row.createdAt();
        if (!staff && age < lockMs && !player.getUniqueId().equals(g.row.opponent())) {
            long left = (lockMs - age + 999) / 1000;
            plugin.msg().send(player, "grave.locked",
                    "opponent", g.row.opponentName() == null ? "?" : g.row.opponentName(),
                    "seconds", String.valueOf(left));
            return;
        }
        player.openInventory(g.inventory);
        player.playSound(player.getLocation(), Sound.BLOCK_CHEST_OPEN, 0.7f, 0.6f);
    }

    /** 꺼내기만 — 무덤 칸에서 커서로 집기 · Shift+클릭으로 내 쪽으로만 허용합니다. */
    @EventHandler(priority = EventPriority.HIGH)
    public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Holder holder)) return;
        boolean top = event.getClickedInventory() == event.getView().getTopInventory();
        InventoryAction a = event.getAction();
        boolean take = top && (a == InventoryAction.PICKUP_ALL || a == InventoryAction.PICKUP_HALF
                || a == InventoryAction.PICKUP_ONE || a == InventoryAction.PICKUP_SOME
                || a == InventoryAction.MOVE_TO_OTHER_INVENTORY);
        // 아래(내 인벤토리) 안에서의 정리는 괜찮지만, 위로 보내는 것(Shift+클릭 · 모으기)은 막습니다.
        boolean ownSide = !top && a != InventoryAction.MOVE_TO_OTHER_INVENTORY && a != InventoryAction.COLLECT_TO_CURSOR;
        if (!take && !ownSide) {
            event.setCancelled(true);
            return;
        }
        if (take) saveSoon(holder.id);
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onDrag(InventoryDragEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Holder)) return;
        int topSize = event.getView().getTopInventory().getSize();
        for (int slot : event.getRawSlots()) {
            if (slot < topSize) {
                event.setCancelled(true);
                return;
            }
        }
    }

    @EventHandler
    public void onClose(InventoryCloseEvent event) {
        if (event.getInventory().getHolder() instanceof Holder holder) saveSoon(holder.id);
    }

    /**
     * 다음 틱에 남은 내용을 DB 에 씁니다 (꺼낼 때마다).
     * ponytail: 꺼낸 직후 · 저장 전에 서버가 죽으면 그 아이템이 무덤에도 남습니다 (틱 1개 창). 문제가 되면 꺼낼 때 동기 저장.
     */
    private void saveSoon(long id) {
        Bukkit.getScheduler().runTask(plugin, () -> {
            Grave g = graves.get(id);
            if (g == null) return;
            if (g.inventory.isEmpty()) {
                remove(g, true);
                return;
            }
            byte[] bytes = serialize(g.inventory);
            Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                try {
                    repository.updateGraveItems(id, bytes);
                } catch (SQLException e) {
                    plugin.getLogger().log(Level.WARNING, "[무덤] 저장 실패 #" + id, e);
                }
            });
        });
    }

    private static byte[] serialize(Inventory inv) {
        ItemStack[] contents = inv.getContents();
        for (int i = 0; i < contents.length; i++) if (contents[i] == null) contents[i] = ItemStack.empty();
        return ItemStack.serializeItemsAsBytes(contents);
    }

    // ── 정리 ───────────────────────────────────────────────────────────

    private void tick() {
        long now = System.currentTimeMillis();
        for (Grave g : new ArrayList<>(graves.values())) {
            if (now - g.row.createdAt() >= expireMs) {
                remove(g, false);
                continue;
            }
            if (g.marker != null && g.marker.isValid()) {
                g.marker.getWorld().spawnParticle(Particle.SOUL, g.marker.getLocation().add(0, 1, 0), 3, 0.2, 0.3, 0.2, 0.01);
            } else {
                World w = Bukkit.getWorld(g.row.world());
                if (w != null && w.isChunkLoaded((int) Math.floor(g.row.x()) >> 4, (int) Math.floor(g.row.z()) >> 4)) {
                    spawnMarker(g, new Location(w, g.row.x(), g.row.y(), g.row.z()));
                }
            }
        }
    }

    /** emptied = 다 꺼내서 빈 경우 · 아니면 시간이 다 된 경우 (남은 짐 소멸). */
    private void remove(Grave g, boolean emptied) {
        graves.remove(g.row.id());
        for (Player viewer : viewers(g)) viewer.closeInventory();
        if (g.marker != null) g.marker.remove();
        if (!emptied) plugin.getLogger().info("[무덤] 시간 만료로 소멸 #" + g.row.id() + " (" + g.row.ownerName() + ")");
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.deleteGrave(g.row.id());
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "[무덤] 삭제 실패 #" + g.row.id(), e);
            }
        });
    }

    private static List<Player> viewers(Grave g) {
        List<Player> out = new ArrayList<>();
        g.inventory.getViewers().forEach(h -> { if (h instanceof Player p) out.add(p); });
        return out;
    }

    // ── 표시 보호 ──────────────────────────────────────────────────────

    private Long graveId(Entity e) {
        return e == null ? null : e.getPersistentDataContainer().get(graveKey, PersistentDataType.LONG);
    }

    @EventHandler(ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (graveId(event.getEntity()) != null) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onManipulate(PlayerArmorStandManipulateEvent event) {
        if (graveId(event.getRightClicked()) != null) event.setCancelled(true);   // 머리 빼가기 막기
    }

    /** 서버가 갑자기 꺼져 남은 표시 정리 — 진짜는 DB 에서 다시 만듭니다. */
    @EventHandler
    public void onEntitiesLoad(EntitiesLoadEvent event) {
        for (Entity e : event.getEntities()) {
            Long id = graveId(e);
            if (id == null) continue;
            Grave g = graves.get(id);
            if (g == null || g.marker != e) e.remove();
        }
    }

    public static final class Holder implements InventoryHolder {
        private final long id;
        private Inventory inventory;

        Holder(long id) { this.id = id; }

        @Override
        public @NotNull Inventory getInventory() { return inventory; }
    }
}
