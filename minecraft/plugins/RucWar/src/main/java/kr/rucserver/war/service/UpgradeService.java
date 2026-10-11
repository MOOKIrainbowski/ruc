package kr.rucserver.war.service;

import kr.rucserver.war.RucWar;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Sound;
import org.bukkit.Tag;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.Trident;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.event.entity.ProjectileLaunchEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.PrepareItemCraftEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.EquipmentSlotGroup;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.jetbrains.annotations.NotNull;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 강화 (2026-10-10).
 *
 * <ul>
 *   <li><b>강화대</b> = 바닐라 화살 제작대(fletching table)를 리소스팩으로 다시 그린 것. 플레이어가 쓸 일이 없는 블록이라
 *       커스텀 블록 엔티티 없이 그대로 씁니다. 우클릭 → 강화 화면.</li>
 *   <li><b>러크 강화석</b> = PDC 태그 아이템 + item_model {@code ruc:upgrade_stone}. 광석 채굴 · 코어 파괴 · 보급 상자.</li>
 *   <li>마법이 이미 붙은 아이템만 +1 ~ +10. 단계가 오를수록 성공률 ↓, 하락 · 파괴 확률 ↑, 강화석 ↑ (config 표).</li>
 *   <li>효과: 근접 무기 · 활 · 쇠뇌 · 삼지창 = 피해 +%, 방어구 = 받는 피해 -% (부위 합산), 채굴 도구 = 채굴 효율.</li>
 *   <li>+10 달성은 전 서버 공지 + 피드 채널(러크 연대기).</li>
 * </ul>
 */
public class UpgradeService implements Listener {

    public static final int MAX_LEVEL = 10;
    private static final int SLOT_ITEM = 11, SLOT_BUTTON = 13, SLOT_STONE = 15;

    private final RucWar plugin;
    private final NamespacedKey stoneKey;
    private final NamespacedKey levelKey;
    private final NamespacedKey projectileKey;
    private final NamespacedKey toolKey;

    public UpgradeService(RucWar plugin) {
        this.plugin = plugin;
        this.stoneKey = new NamespacedKey(plugin, "upgrade_stone");
        this.levelKey = new NamespacedKey(plugin, "upgrade_level");
        this.projectileKey = new NamespacedKey(plugin, "upgrade_projectile");
        this.toolKey = new NamespacedKey(plugin, "upgrade_tool");
    }

    // ── 강화석 ─────────────────────────────────────────────────────────

    public ItemStack createStone(int amount) {
        ItemStack stone = new ItemStack(Material.PRISMARINE_SHARD, amount);
        stone.editMeta(meta -> {
            meta.displayName(Component.text("러크 강화석", NamedTextColor.GREEN, TextDecoration.BOLD)
                    .decoration(TextDecoration.ITALIC, false));
            meta.lore(List.of(
                    plain("강화대(화살 제작대)에서 마법이 붙은 장비를 강화합니다.", NamedTextColor.GRAY),
                    plain("광석 채굴 · 코어 파괴 · 보급 상자에서 얻습니다.", NamedTextColor.DARK_GRAY)));
            meta.setItemModel(NamespacedKey.fromString("ruc:upgrade_stone"));
            meta.getPersistentDataContainer().set(stoneKey, PersistentDataType.BYTE, (byte) 1);
        });
        return stone;
    }

    public boolean isStone(ItemStack item) {
        return item != null && item.hasItemMeta()
                && item.getItemMeta().getPersistentDataContainer().has(stoneKey, PersistentDataType.BYTE);
    }

    /** 광석을 캘 때 확률로 강화석. 크리에이티브 · 실크터치는 제외 (같은 광석을 놓고 다시 캐는 반복을 막음). */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onMine(BlockBreakEvent event) {
        Player player = event.getPlayer();
        if (player.getGameMode() != GameMode.SURVIVAL) return;
        if (player.getInventory().getItemInMainHand().containsEnchantment(Enchantment.SILK_TOUCH)) return;
        double chance = plugin.getConfig().getDouble("upgrade.stone-drops." + event.getBlock().getType().name(), 0);
        if (chance <= 0 || ThreadLocalRandom.current().nextDouble() >= chance) return;
        Location at = event.getBlock().getLocation().add(0.5, 0.5, 0.5);
        at.getWorld().dropItemNaturally(at, createStone(1));
        player.playSound(at, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1f, 1.4f);
    }

    /** 코어를 부순 쪽에 주는 전리품. */
    public void dropFromCore(Location at) {
        int amount = plugin.getConfig().getInt("upgrade.core-destroy-stones", 8);
        if (amount > 0) at.getWorld().dropItemNaturally(at.add(0.5, 0.5, 0.5), createStone(amount));
    }

    /** 강화석이 바닐라 조합 재료로 새지 않게 합니다 (바탕이 프리즈머린 조각). */
    @EventHandler
    public void onCraft(PrepareItemCraftEvent event) {
        for (ItemStack item : event.getInventory().getMatrix()) {
            if (isStone(item)) {
                event.getInventory().setResult(null);
                return;
            }
        }
    }

    // ── 강화대 화면 ────────────────────────────────────────────────────

    private static final class Menu implements InventoryHolder {
        Inventory inventory;
        @Override public @NotNull Inventory getInventory() { return inventory; }
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onOpen(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getHand() != EquipmentSlot.HAND) return;
        if (event.getClickedBlock() == null || event.getClickedBlock().getType() != Material.FLETCHING_TABLE) return;
        if (event.getPlayer().isSneaking()) return;   // 웅크리면 바닐라처럼 블록을 놓을 수 있게
        event.setCancelled(true);

        Menu menu = new Menu();
        menu.inventory = Bukkit.createInventory(menu, 27, Component.text("강화대"));
        ItemStack filler = new ItemStack(Material.GRAY_STAINED_GLASS_PANE);
        filler.editMeta(m -> m.displayName(Component.empty()));
        for (int i = 0; i < 27; i++) {
            if (i != SLOT_ITEM && i != SLOT_STONE) menu.inventory.setItem(i, filler);
        }
        refreshButton(menu.inventory);
        event.getPlayer().openInventory(menu.inventory);
    }

    @EventHandler(ignoreCancelled = true)
    public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Menu)) return;
        Inventory top = event.getView().getTopInventory();
        Player player = (Player) event.getWhoClicked();
        int raw = event.getRawSlot();

        if (raw >= top.getSize()) {
            // 아래(내 인벤토리): 쉬프트 클릭만 직접 나눠 넣습니다 — 그대로 두면 장식 칸에 겹쳐 들어갑니다.
            if (event.isShiftClick()) {
                event.setCancelled(true);
                ItemStack moving = event.getCurrentItem();
                if (moving == null || moving.getType().isAir()) return;
                int target = isStone(moving) ? SLOT_STONE : SLOT_ITEM;
                ItemStack there = top.getItem(target);
                if (there == null || there.getType().isAir()) {
                    top.setItem(target, moving);
                    event.setCurrentItem(null);
                } else if (target == SLOT_STONE && there.isSimilar(moving)) {
                    int room = there.getMaxStackSize() - there.getAmount();
                    int move = Math.min(room, moving.getAmount());
                    there.setAmount(there.getAmount() + move);
                    moving.setAmount(moving.getAmount() - move);
                }
            }
        } else if (raw == SLOT_BUTTON) {
            event.setCancelled(true);
            attempt(player, top);
        } else if (raw != SLOT_ITEM && raw != SLOT_STONE) {
            event.setCancelled(true);
        }
        Bukkit.getScheduler().runTask(plugin, () -> refreshButton(top));
    }

    @EventHandler(ignoreCancelled = true)
    public void onDrag(InventoryDragEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Menu)) return;
        int size = event.getView().getTopInventory().getSize();
        for (int raw : event.getRawSlots()) {
            if (raw < size && raw != SLOT_ITEM && raw != SLOT_STONE) {
                event.setCancelled(true);
                return;
            }
        }
        Bukkit.getScheduler().runTask(plugin, () -> refreshButton(event.getView().getTopInventory()));
    }

    /** 닫으면 올려 둔 것을 돌려줍니다. 가방이 차면 발밑에. */
    @EventHandler
    public void onClose(InventoryCloseEvent event) {
        if (!(event.getInventory().getHolder() instanceof Menu)) return;
        Player player = (Player) event.getPlayer();
        for (int slot : new int[]{SLOT_ITEM, SLOT_STONE}) {
            ItemStack item = event.getInventory().getItem(slot);
            if (item == null || item.getType().isAir()) continue;
            event.getInventory().setItem(slot, null);
            player.getInventory().addItem(item).values()
                    .forEach(left -> player.getWorld().dropItemNaturally(player.getLocation(), left));
        }
    }

    private void refreshButton(Inventory top) {
        ItemStack target = top.getItem(SLOT_ITEM);
        ItemStack button = new ItemStack(Material.ANVIL);
        List<Component> lore = new ArrayList<>();
        String problem = problemWith(target);
        if (problem != null) {
            lore.add(plain(problem, NamedTextColor.RED));
        } else {
            int level = levelOf(target);
            lore.add(plain("+" + level + " → +" + (level + 1), NamedTextColor.WHITE));
            lore.add(plain("성공 " + table("success", level) + "%", NamedTextColor.GREEN));
            lore.add(plain("하락 " + table("downgrade", level) + "%  ·  파괴 " + table("destroy", level) + "%", NamedTextColor.RED));
            lore.add(plain("러크 강화석 " + table("cost", level) + "개", NamedTextColor.AQUA));
        }
        lore.add(Component.empty());
        lore.add(plain("왼쪽: 마법이 붙은 장비  ·  오른쪽: 러크 강화석", NamedTextColor.DARK_GRAY));
        button.editMeta(m -> {
            m.displayName(Component.text("강화하기", NamedTextColor.GOLD, TextDecoration.BOLD)
                    .decoration(TextDecoration.ITALIC, false));
            m.lore(lore);
        });
        top.setItem(SLOT_BUTTON, button);
    }

    /** 강화할 수 없는 이유. 되면 null. */
    private String problemWith(ItemStack item) {
        if (item == null || item.getType().isAir()) return "왼쪽 칸에 장비를 올려 주세요.";
        if (item.getAmount() != 1) return "한 개씩만 강화할 수 있습니다.";
        if (item.getEnchantments().isEmpty()) return "마법이 붙은 아이템만 강화할 수 있습니다.";
        if (kindOf(item.getType()) == null) return "강화 효과가 없는 아이템입니다.";
        if (levelOf(item) >= MAX_LEVEL) return "이미 최대 강화(+" + MAX_LEVEL + ")입니다.";
        return null;
    }

    private void attempt(Player player, Inventory top) {
        ItemStack item = top.getItem(SLOT_ITEM);
        String problem = problemWith(item);
        if (problem != null) {
            player.sendMessage(plain(problem, NamedTextColor.RED));
            return;
        }
        int level = levelOf(item);
        int cost = table("cost", level);
        ItemStack stones = top.getItem(SLOT_STONE);
        if (!isStone(stones) || stones.getAmount() < cost) {
            player.sendMessage(plain("러크 강화석이 " + cost + "개 필요합니다.", NamedTextColor.RED));
            if (player.hasPermission("rucwar.admin")) {
                player.sendMessage(plain("스태프: /전쟁 강화석 [개수] 로 받을 수 있습니다 (크리에이티브 창에는 없습니다).", NamedTextColor.GRAY));
            }
            return;
        }
        stones.setAmount(stones.getAmount() - cost);

        int roll = ThreadLocalRandom.current().nextInt(100);
        int success = table("success", level);
        int destroy = table("destroy", level);
        int downgrade = table("downgrade", level);
        if (roll < success) {
            setLevel(item, level + 1);
            player.playSound(player.getLocation(), Sound.BLOCK_ANVIL_USE, 1f, 1.2f);
            player.sendMessage(plain("강화 성공! +" + (level + 1), NamedTextColor.GREEN));
            if (level + 1 == MAX_LEVEL) announceMax(player, item);
        } else if (roll < success + destroy) {
            top.setItem(SLOT_ITEM, null);
            player.playSound(player.getLocation(), Sound.ENTITY_ITEM_BREAK, 1f, 0.6f);
            player.sendMessage(plain("강화 실패 — 장비가 파괴되었습니다.", NamedTextColor.DARK_RED));
        } else if (roll < success + destroy + downgrade) {
            setLevel(item, level - 1);
            player.playSound(player.getLocation(), Sound.BLOCK_ANVIL_LAND, 1f, 0.8f);
            player.sendMessage(plain("강화 실패 — +" + (level - 1) + " 로 떨어졌습니다.", NamedTextColor.RED));
        } else {
            player.playSound(player.getLocation(), Sound.BLOCK_ANVIL_LAND, 0.6f, 1.2f);
            player.sendMessage(plain("강화 실패 — 단계는 그대로입니다.", NamedTextColor.YELLOW));
        }
    }

    private void announceMax(Player player, ItemStack item) {
        String itemName = net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText()
                .serialize(item.effectiveName());
        Bukkit.broadcast(Component.text("[강화] ", NamedTextColor.GOLD, TextDecoration.BOLD)
                .append(Component.text(player.getName() + " 님이 " + itemName + " +" + MAX_LEVEL + " 강화에 성공했습니다!",
                        NamedTextColor.YELLOW).decoration(TextDecoration.BOLD, false)));
        for (Player online : Bukkit.getOnlinePlayers()) {
            online.playSound(online.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 0.8f, 1f);
        }
        plugin.core().getRelay().relayChronicle("⚒️ **" + player.getName() + "** 님이 **" + itemName
                + " +" + MAX_LEVEL + "** 강화에 성공했습니다.");
    }

    /** config 의 단계별 표 (0 → 1 이 첫 칸). 칸이 모자라면 마지막 값. */
    private int table(String name, int level) {
        List<Integer> values = plugin.getConfig().getIntegerList("upgrade." + name);
        if (values.isEmpty()) return name.equals("success") ? 50 : name.equals("cost") ? 1 : 0;
        return values.get(Math.min(level, values.size() - 1));
    }

    // ── 단계 기록 ──────────────────────────────────────────────────────

    public int levelOf(ItemStack item) {
        if (item == null || !item.hasItemMeta()) return 0;
        return item.getItemMeta().getPersistentDataContainer().getOrDefault(levelKey, PersistentDataType.INTEGER, 0);
    }

    /** 단계 기록 + 설명 첫 줄 "★ 강화 +N" + 채굴 도구면 채굴 효율 속성. */
    private void setLevel(ItemStack item, int level) {
        Kind kind = kindOf(item.getType());
        item.editMeta(meta -> {
            boolean had = meta.getPersistentDataContainer().getOrDefault(levelKey, PersistentDataType.INTEGER, 0) > 0;
            List<Component> lore = meta.lore() == null ? new ArrayList<>() : new ArrayList<>(meta.lore());
            if (had && !lore.isEmpty()) lore.remove(0);
            if (level > 0) {
                lore.add(0, Component.text("★ 강화 +" + level, level >= MAX_LEVEL ? NamedTextColor.GOLD : NamedTextColor.AQUA)
                        .decoration(TextDecoration.ITALIC, false));
                meta.getPersistentDataContainer().set(levelKey, PersistentDataType.INTEGER, level);
            } else {
                meta.getPersistentDataContainer().remove(levelKey);
            }
            meta.lore(lore);
            if (kind != null && kind.tool) applyMining(item.getType(), meta, level);
        });
    }

    /**
     * 채굴 효율 속성. 아이템에 속성을 하나라도 넣으면 기본 속성(공격력 등)이 통째로 빠지므로, 처음 넣을 때 기본값을 먼저 옮겨 담습니다.
     */
    private void applyMining(Material type, ItemMeta meta, int level) {
        if (!meta.hasAttributeModifiers()) meta.setAttributeModifiers(type.getDefaultAttributeModifiers());
        meta.removeAttributeModifier(Attribute.MINING_EFFICIENCY);
        double perLevel = plugin.getConfig().getDouble("upgrade.effect.tool-efficiency-per-level", 2);
        if (level > 0) {
            meta.addAttributeModifier(Attribute.MINING_EFFICIENCY, new AttributeModifier(
                    toolKey, perLevel * level, AttributeModifier.Operation.ADD_NUMBER, EquipmentSlotGroup.MAINHAND));
        }
    }

    // ── 효과 ───────────────────────────────────────────────────────────

    /** 강화 효과 종류. 도끼 · 삼지창처럼 둘 이상에 걸리는 것도 있습니다. */
    private record Kind(boolean weapon, boolean ranged, boolean armor, boolean tool) {}

    private Kind kindOf(Material type) {
        boolean weapon = Tag.ITEMS_ENCHANTABLE_WEAPON.isTagged(type) || Tag.ITEMS_ENCHANTABLE_TRIDENT.isTagged(type)
                || Tag.ITEMS_ENCHANTABLE_MACE.isTagged(type);
        boolean ranged = Tag.ITEMS_ENCHANTABLE_BOW.isTagged(type) || Tag.ITEMS_ENCHANTABLE_CROSSBOW.isTagged(type)
                || Tag.ITEMS_ENCHANTABLE_TRIDENT.isTagged(type);
        boolean armor = Tag.ITEMS_ENCHANTABLE_ARMOR.isTagged(type);
        boolean tool = Tag.ITEMS_ENCHANTABLE_MINING.isTagged(type);
        return weapon || ranged || armor || tool ? new Kind(weapon, ranged, armor, tool) : null;
    }

    /** 근접 무기 강화 배율 (코어 공격에도 씀). 무기가 아니면 1. */
    public double attackMultiplier(ItemStack hand) {
        Kind kind = hand == null ? null : kindOf(hand.getType());
        if (kind == null || !kind.weapon) return 1;
        return 1 + plugin.getConfig().getDouble("upgrade.effect.damage-per-level", 0.04) * levelOf(hand);
    }

    @EventHandler(ignoreCancelled = true)
    public void onShoot(EntityShootBowEvent event) {
        int level = levelOf(event.getBow());
        if (level > 0) event.getProjectile().getPersistentDataContainer().set(projectileKey, PersistentDataType.INTEGER, level);
    }

    @EventHandler(ignoreCancelled = true)
    public void onThrow(ProjectileLaunchEvent event) {
        if (!(event.getEntity() instanceof Trident trident)) return;
        int level = levelOf(trident.getItemStack());
        if (level > 0) trident.getPersistentDataContainer().set(projectileKey, PersistentDataType.INTEGER, level);
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(EntityDamageByEntityEvent event) {
        double perLevel = plugin.getConfig().getDouble("upgrade.effect.damage-per-level", 0.04);
        int attack = 0;
        if (event.getDamager() instanceof Player attacker) {
            ItemStack hand = attacker.getInventory().getItemInMainHand();
            Kind kind = kindOf(hand.getType());
            if (kind != null && kind.weapon) attack = levelOf(hand);
        } else if (event.getDamager() instanceof Projectile projectile) {
            attack = projectile.getPersistentDataContainer().getOrDefault(projectileKey, PersistentDataType.INTEGER, 0);
        }
        double damage = event.getDamage() * (1 + perLevel * attack);

        if (event.getEntity() instanceof Player victim) {
            int armor = 0;
            for (ItemStack piece : victim.getInventory().getArmorContents()) armor += levelOf(piece);
            double perArmor = plugin.getConfig().getDouble("upgrade.effect.armor-reduction-per-level", 0.0075);
            damage *= 1 - Math.min(0.4, perArmor * armor);
        }
        if (damage != event.getDamage()) event.setDamage(damage);
    }

    private static Component plain(String text, NamedTextColor color) {
        return Component.text(text, color).decoration(TextDecoration.ITALIC, false);
    }
}
