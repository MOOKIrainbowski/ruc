package kr.rucserver.rpg.character;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 캐릭터 만들기 (§8-1): 마크에서는 닉네임 = 마크 이름, 외형 = 스킨이라 **주 속성만** 고름.
 * 고르기 전에는 창을 닫아도 다시 열림 (캐릭터 없이 돌아다니면 HUD · 전투가 없음).
 */
public final class ElementPicker implements Listener {

    private static final int[] SLOTS = {10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23};

    private final RucRpg plugin;
    private final NamespacedKey key;

    public ElementPicker(RucRpg plugin) {
        this.plugin = plugin;
        this.key = new NamespacedKey(plugin, "pick_element");
    }

    private static final class Holder implements InventoryHolder {
        Inventory inv;
        boolean done;
        @Override public Inventory getInventory() { return inv; }
    }

    public void open(Player p) {
        Holder h = new Holder();
        Inventory inv = Bukkit.createInventory(h, 36, Component.text("주 속성을 고르세요", NamedTextColor.DARK_GRAY));
        h.inv = inv;
        JsonObject els = plugin.data().file("elements").getAsJsonObject("ELEMENTS");
        int i = 0;
        for (Map.Entry<String, JsonElement> e : els.entrySet()) {
            if (i >= SLOTS.length) break;
            inv.setItem(SLOTS[i++], icon(e.getKey(), e.getValue().getAsJsonObject(), els));
        }
        p.openInventory(inv);
    }

    private ItemStack icon(String id, JsonObject el, JsonObject all) {
        ItemStack it = new ItemStack(material(id));
        ItemMeta m = it.getItemMeta();
        TextColor color = TextColor.fromHexString(el.get("color").getAsString());
        m.displayName(Component.text(el.get("name").getAsString() + " 속성", color, TextDecoration.BOLD).decoration(TextDecoration.ITALIC, false));
        List<Component> lore = new ArrayList<>();
        lore.add(line("패시브: " + el.get("passive").getAsString(), NamedTextColor.GRAY));
        lore.add(line("강함: " + names(el, "strong", all), NamedTextColor.GREEN));
        lore.add(line("약함: " + names(el, "weak", all), NamedTextColor.RED));
        lore.add(Component.empty());
        lore.add(line("클릭하면 이 속성으로 시작합니다 (나중에 바꿀 수 없음)", NamedTextColor.YELLOW));
        m.lore(lore);
        m.getPersistentDataContainer().set(key, PersistentDataType.STRING, id);
        it.setItemMeta(m);
        return it;
    }

    private static Component line(String s, NamedTextColor c) { return Component.text(s, c).decoration(TextDecoration.ITALIC, false); }

    private static String names(JsonObject el, String k, JsonObject all) {
        List<String> out = new ArrayList<>();
        if (el.has(k)) for (JsonElement e : el.getAsJsonArray(k)) out.add(all.getAsJsonObject(e.getAsString()).get("name").getAsString());
        return out.isEmpty() ? "없음" : String.join(" · ", out);
    }

    /** 리소스팩 속성 아이콘이 들어오기 전 임시 모양 (M4 에서 item_model 로 RPG 아이콘) */
    private static Material material(String id) {
        return switch (id) {
            case "water" -> Material.HEART_OF_THE_SEA;
            case "fire" -> Material.BLAZE_POWDER;
            case "earth" -> Material.CLAY_BALL;
            case "grass" -> Material.OAK_SAPLING;
            case "wind" -> Material.FEATHER;
            case "electric" -> Material.GLOWSTONE_DUST;
            case "ice" -> Material.BLUE_ICE;
            case "light" -> Material.SUNFLOWER;
            case "dark" -> Material.ECHO_SHARD;
            case "poison" -> Material.SPIDER_EYE;
            case "iron" -> Material.IRON_INGOT;
            default -> Material.AMETHYST_SHARD;
        };
    }

    @EventHandler
    public void onClick(InventoryClickEvent e) {
        if (!(e.getInventory().getHolder() instanceof Holder h)) return;
        e.setCancelled(true);
        if (!(e.getWhoClicked() instanceof Player p) || e.getClickedInventory() != e.getInventory()) return;
        ItemStack it = e.getCurrentItem();
        if (it == null || !it.hasItemMeta()) return;
        String el = it.getItemMeta().getPersistentDataContainer().get(key, PersistentDataType.STRING);
        if (el == null || h.done) return;
        h.done = true;
        p.closeInventory();
        plugin.chars().create(p, el);
        p.playSound(p.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 0.8f, 1.4f);
        p.sendMessage(Component.text("[러크 RPG] ", NamedTextColor.GOLD).append(Component.text(plainName(it) + "으로 모험을 시작합니다!", NamedTextColor.WHITE)));   // "… 속성" 뒤라 늘 "으로"
    }

    private static String plainName(ItemStack it) {
        return net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText().serialize(it.getItemMeta().displayName());
    }

    @EventHandler
    public void onDrag(InventoryDragEvent e) {
        if (e.getInventory().getHolder() instanceof Holder) e.setCancelled(true);
    }

    @EventHandler
    public void onClose(InventoryCloseEvent e) {
        if (!(e.getInventory().getHolder() instanceof Holder h) || h.done) return;
        if (e.getPlayer() instanceof Player p) Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (p.isOnline() && plugin.chars().get(p) == null) open(p);
        }, 10L);
    }
}
