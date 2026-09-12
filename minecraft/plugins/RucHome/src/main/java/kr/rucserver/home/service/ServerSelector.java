package kr.rucserver.home.service;

import com.google.common.io.ByteArrayDataOutput;
import com.google.common.io.ByteStreams;
import kr.rucserver.home.RucHome;
import kr.rucserver.home.world.PlazaBuilder;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.bukkit.entity.Villager;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.NamespacedKey;

import java.util.List;

/**
 * 서버 선택 UI (D1).
 *
 * NPC는 Citizens 같은 외부 플러그인 없이 바닐라 엔티티로 구현했습니다.
 * 의존성이 하나 줄고, 버전 업데이트 때 깨질 일도 줄어듭니다.
 */
public class ServerSelector {

    /** 선택 가능한 서버. key는 Velocity 의 서버 이름과 일치해야 합니다. */
    public record Target(String key, String displayName, String description,
                         Material icon, NamedTextColor color) {}

    public static final List<Target> TARGETS = List.of(
            new Target("raid", "약탈", "전투 중 접속 종료 시 전부 소멸",
                    Material.NETHERITE_SWORD, NamedTextColor.RED),
            new Target("war", "국가전", "국가 소속만 입장 가능",
                    Material.SHIELD, NamedTextColor.GOLD),
            new Target("peace", "평화", "직접·간접 살해 전면 차단",
                    Material.OAK_SAPLING, NamedTextColor.GREEN)
    );

    private static final LegacyComponentSerializer LEGACY =
            LegacyComponentSerializer.legacyAmpersand();

    private final RucHome plugin;
    private final NamespacedKey npcKey;
    private final NamespacedKey compassKey;

    public ServerSelector(RucHome plugin) {
        this.plugin = plugin;
        this.npcKey = new NamespacedKey(plugin, "selector_target");
        this.compassKey = new NamespacedKey(plugin, "hub_compass");
    }

    // ── NPC 배치 ───────────────────────────────────────────────────────

    /** 기존 NPC를 지우고 다시 세웁니다. 재실행해도 중복되지 않습니다. */
    public void spawnNpcs(World world) {
        removeNpcs(world);

        for (int i = 0; i < TARGETS.size(); i++) {
            Target target = TARGETS.get(i);
            Location loc = PlazaBuilder.podiumLocation(world, i);

            Villager villager = world.spawn(loc, Villager.class, v -> {
                v.setAI(false);
                v.setInvulnerable(true);
                v.setSilent(true);
                v.setCollidable(false);
                v.setRemoveWhenFarAway(false);
                v.setPersistent(true);
                v.customName(Component.text(target.displayName())
                        .color(target.color())
                        .decorate(TextDecoration.BOLD));
                v.setCustomNameVisible(true);
                v.getPersistentDataContainer()
                        .set(npcKey, PersistentDataType.STRING, target.key());
            });

            // 머리 위 홀로그램 — 접속 인원을 실시간 표시 (D1)
            spawnHologram(world, loc.clone().add(0, 2.3, 0), target, villager);
        }

        plugin.getLogger().info("서버 선택 NPC " + TARGETS.size() + "체 배치 완료");
    }

    private void spawnHologram(World world, Location loc, Target target, Entity anchor) {
        world.spawn(loc, TextDisplay.class, display -> {
            display.text(Component.text(target.description()).color(NamedTextColor.GRAY));
            display.setBillboard(Display.Billboard.CENTER);
            display.setSeeThrough(false);
            display.setPersistent(true);
            display.getPersistentDataContainer()
                    .set(npcKey, PersistentDataType.STRING, "holo_" + target.key());
        });
    }

    public void removeNpcs(World world) {
        for (Entity entity : world.getEntities()) {
            if (entity.getPersistentDataContainer().has(npcKey, PersistentDataType.STRING)) {
                entity.remove();
            }
        }
    }

    /** 클릭된 엔티티가 선택 NPC면 해당 서버 키를 돌려줍니다. */
    public String targetOf(Entity entity) {
        return entity.getPersistentDataContainer()
                .get(npcKey, PersistentDataType.STRING);
    }

    // ── 나침반 GUI (D1) ────────────────────────────────────────────────

    /** 인벤토리 5번 슬롯에 고정할 나침반. */
    public ItemStack createCompass() {
        ItemStack compass = new ItemStack(Material.COMPASS);
        ItemMeta meta = compass.getItemMeta();
        meta.displayName(Component.text("서버 이동")
                .color(NamedTextColor.GREEN)
                .decorate(TextDecoration.BOLD)
                .decoration(TextDecoration.ITALIC, false));
        meta.lore(List.of(
                Component.text("우클릭해서 서버를 선택하세요")
                        .color(NamedTextColor.GRAY)
                        .decoration(TextDecoration.ITALIC, false)));
        meta.getPersistentDataContainer().set(compassKey, PersistentDataType.BYTE, (byte) 1);
        compass.setItemMeta(meta);
        return compass;
    }

    public boolean isCompass(ItemStack item) {
        if (item == null || !item.hasItemMeta()) return false;
        return item.getItemMeta().getPersistentDataContainer()
                .has(compassKey, PersistentDataType.BYTE);
    }

    public void giveCompass(Player player) {
        player.getInventory().setItem(4, createCompass());   // 5번째 칸 (0-based 4)
    }

    /**
     * 메뉴 식별용 홀더.
     * 인벤토리 제목 문자열로 판별하면 제목이 바뀌거나 번역될 때 쉽게 깨집니다.
     */
    public static final class MenuHolder implements InventoryHolder {
        private Inventory inventory;
        @Override public Inventory getInventory() { return inventory; }
        void bind(Inventory inventory) { this.inventory = inventory; }
    }

    /** 서버 선택 메뉴를 엽니다. */
    public void openMenu(Player player) {
        MenuHolder holder = new MenuHolder();
        Inventory menu = Bukkit.createInventory(holder, 27,
                Component.text("서버 선택").color(NamedTextColor.DARK_GREEN));
        holder.bind(menu);

        int[] slots = {11, 13, 15};
        for (int i = 0; i < TARGETS.size(); i++) {
            Target target = TARGETS.get(i);
            ItemStack item = new ItemStack(target.icon());
            ItemMeta meta = item.getItemMeta();

            meta.displayName(Component.text(target.displayName())
                    .color(target.color())
                    .decorate(TextDecoration.BOLD)
                    .decoration(TextDecoration.ITALIC, false));
            meta.lore(List.of(
                    Component.text(target.description())
                            .color(NamedTextColor.GRAY)
                            .decoration(TextDecoration.ITALIC, false),
                    Component.empty(),
                    Component.text("클릭해서 이동")
                            .color(NamedTextColor.YELLOW)
                            .decoration(TextDecoration.ITALIC, false)));
            meta.getPersistentDataContainer()
                    .set(npcKey, PersistentDataType.STRING, target.key());
            item.setItemMeta(meta);

            menu.setItem(slots[i], item);
        }

        player.openInventory(menu);
    }

    public String menuSelectionOf(ItemStack item) {
        if (item == null || !item.hasItemMeta()) return null;
        return item.getItemMeta().getPersistentDataContainer()
                .get(npcKey, PersistentDataType.STRING);
    }

    // ── 실제 서버 이동 ─────────────────────────────────────────────────

    /**
     * Velocity 로 서버 전환을 요청합니다.
     *
     * 프록시가 없으면 아무 일도 일어나지 않으므로, 그 경우를 감지해
     * 안내 메시지를 띄웁니다 (현재는 프록시 미기동 상태에서도 테스트하므로).
     */
    public void sendToServer(Player player, String serverKey) {
        Target target = TARGETS.stream()
                .filter(t -> t.key().equals(serverKey))
                .findFirst().orElse(null);
        if (target == null) return;

        player.closeInventory();
        player.playSound(player.getLocation(), Sound.ENTITY_ENDERMAN_TELEPORT, 1.0f, 1.2f);
        player.sendMessage(LEGACY.deserialize(
                "&a" + target.displayName() + " &f서버로 이동합니다…"));

        ByteArrayDataOutput out = ByteStreams.newDataOutput();
        out.writeUTF("Connect");
        out.writeUTF(serverKey);
        player.sendPluginMessage(plugin, "BungeeCord", out.toByteArray());

        // 프록시가 없으면 전환이 일어나지 않습니다. 2초 뒤에도 여기 있으면 안내.
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!player.isOnline()) return;
            player.sendMessage(LEGACY.deserialize(
                    "&e아직 이동하지 않았다면 프록시(Velocity)가 실행 중이 아닙니다."));
            player.sendMessage(LEGACY.deserialize(
                    "&7현재는 홈 서버만 가동 중입니다."));
        }, 40L);
    }
}
