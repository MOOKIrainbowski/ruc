package kr.rucserver.rpg.item;

import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.ItemStack;

import java.io.DataOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * 장신구 칸 (사용자 지시 2026-11-15 2차: "제작 칸은 제작으로 · 방패 칸 위에 보호구 칸처럼 세로로 목걸이 · 귀걸이 · 반지 …") — 결정 R11 바꿈.
 * 칸은 **모드가 E 인벤토리 화면에 그림**(방패 칸 위 세로 5칸: 위에서 목걸이 · 귀걸이 · 반지 · 장갑 · 망토). 서버의 바닐라 칸은 건드리지 않음.
 * 원본 = EquipStore(DB). 모드가 칸을 누르면 "acc:<칸>[:shift]" → 서버가 커서(바닐라 들고 있는 아이템)와 맞바꿈 → 칸 내용을 모드로 다시 보냄(종류 6).
 * 종류마다 하나 (반지 1개 — 예전 2번째 반지는 접속 때 인벤토리로).
 */
public final class AccessorySlots implements Listener {

    // 사용자 지시 2026-11-16: 반지 · 목걸이 하나씩만. 예전 칸(귀걸이 · 장갑 · 망토 · 두 번째 반지)은 접속 때 인벤토리로
    public static final List<String> ORDER = List.of("necklace", "ring1");
    private static final List<String> RETIRED = List.of("ring2", "earring", "gloves", "cape");
    private static final Map<String, String> NAME = Map.of("necklace", "목걸이", "ring1", "반지");

    private final RucRpg plugin;
    private final NamespacedKey ghost;

    public AccessorySlots(RucRpg plugin) {
        this.plugin = plugin;
        this.ghost = new NamespacedKey(plugin, "acc_ghost");
    }

    private EquipStore store() { return plugin.itemRuntime().equip(); }

    private static String slotOf(JsonObject t) {
        String s = t.has("slot") ? t.get("slot").getAsString() : null;
        return "ring".equals(s) ? "ring1" : s;
    }

    /** 모드 칸 클릭 (ClientBridge 가 넘김): 커서 아이템과 맞바꿈 */
    public void click(Player p, String slot, boolean shift) {
        if (!ORDER.contains(slot) || plugin.runtime().unit(p) == null) return;
        if (!(p.getOpenInventory().getTopInventory().getType() == org.bukkit.event.inventory.InventoryType.CRAFTING)) return;   // 자기 인벤토리 화면에서만
        ItemStack cursor = p.getItemOnCursor();
        ItemStack cur = store().of(p.getUniqueId()).get(slot);
        if (cursor != null && !cursor.getType().isAir()) {   // 장착 (있던 것은 커서로)
            ItemService.Inst i = plugin.items().read(cursor);
            JsonObject t = i == null ? null : plugin.items().tpl(i.tpl());
            if (t == null || !slot.equals(slotOf(t))) { p.sendActionBar(Component.text("이 칸에는 " + NAME.get(slot) + "만 낄 수 있습니다", NamedTextColor.RED)); return; }
            PlayerUnit u = plugin.runtime().unit(p);
            if (t.has("lv") && t.get("lv").getAsInt() > u.ch.level) { p.sendActionBar(Component.text("Lv" + t.get("lv").getAsInt() + " 부터 장착할 수 있습니다", NamedTextColor.RED)); return; }
            store().set(p.getUniqueId(), slot, cursor.clone());
            p.setItemOnCursor(cur);
        } else if (cur != null) {   // 벗기 (커서로 · Shift = 인벤토리로)
            if (shift) {
                if (p.getInventory().firstEmpty() < 0) { p.sendActionBar(Component.text("인벤토리에 빈 칸이 없습니다", NamedTextColor.RED)); return; }
                store().set(p.getUniqueId(), slot, null);
                p.getInventory().addItem(cur);
            } else {
                store().set(p.getUniqueId(), slot, null);
                p.setItemOnCursor(cur);
            }
        } else return;
        store().saveQueued(p.getUniqueId(), slot, plugin.getLogger());
        plugin.itemRuntime().refresh(p);
        send(p);
    }

    /** 칸 내용을 모드로 (종류 6): 칸 · 모델 · 이름(JSON) · 설명 줄(JSON) */
    public void send(Player p) {
        if (plugin.bridge() == null || !plugin.bridge().modded(p)) return;
        Map<String, ItemStack> eq = store().of(p.getUniqueId());
        plugin.bridge().send(p, out -> {
            out.writeByte(6);
            out.writeByte(ORDER.size());
            for (String s : ORDER) write(out, s, eq.get(s));
        });
    }

    private static void write(DataOutputStream out, String slot, ItemStack it) throws IOException {
        out.writeUTF(slot);
        if (it == null || it.getType().isAir()) { out.writeUTF(""); out.writeUTF(""); out.writeByte(0); return; }
        var m = it.getItemMeta();
        out.writeUTF(m != null && m.getItemModel() != null ? m.getItemModel().toString() : "minecraft:" + it.getType().getKey().getKey());
        out.writeUTF(GsonComponentSerializer.gson().serialize(it.effectiveName()));
        List<Component> lore = m != null && m.lore() != null ? m.lore() : List.of();
        out.writeByte(Math.min(40, lore.size()));
        for (int k = 0; k < Math.min(40, lore.size()); k++) out.writeUTF(GsonComponentSerializer.gson().serialize(lore.get(k)));
    }

    private boolean isGhost(ItemStack it) { return it != null && it.hasItemMeta() && it.getItemMeta().getPersistentDataContainer().has(ghost); }

    /**
     * 접속: 장비를 불러온 뒤 모드로 보냄. 예전 판(제작 칸 · 왼손 칸 방식)의 흔적 정리 —
     * 제작 칸 · 왼손의 안내 아이콘과 망토 사본(원본은 DB)을 지우고, 두 번째 반지는 인벤토리로.
     */
    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!p.isOnline() || plugin.runtime().unit(p) == null) return;
            if (p.getOpenInventory().getTopInventory() instanceof org.bukkit.inventory.CraftingInventory c)
                for (int raw = 1; raw <= 4; raw++) if (isGhost(c.getItem(raw)) || copyOfStore(p, c.getItem(raw))) c.setItem(raw, null);
            ItemStack off = p.getInventory().getItemInOffHand();
            if (isGhost(off) || copyOfStore(p, off)) p.getInventory().setItemInOffHand(null);
            for (String slot : RETIRED) {
                ItemStack old = store().of(p.getUniqueId()).get(slot);
                if (old == null) continue;
                store().set(p.getUniqueId(), slot, null);
                store().saveQueued(p.getUniqueId(), slot, plugin.getLogger());
                p.getInventory().addItem(old).values().forEach(x -> p.getWorld().dropItem(p.getLocation(), x));
                p.sendMessage(Component.text("장신구 칸이 반지 · 목걸이 둘로 줄어 ", NamedTextColor.YELLOW).append(old.effectiveName()).append(Component.text(" 을(를) 인벤토리로 옮겼습니다", NamedTextColor.YELLOW)));
            }
            plugin.itemRuntime().refresh(p);
            send(p);
        }, 60L);
    }

    /** 장비 칸(DB)에 있는 것과 UID 가 같은 사본인가 */
    private boolean copyOfStore(Player p, ItemStack it) {
        ItemService.Inst i = plugin.items().read(it);
        if (i == null || i.uid() == null) return false;
        for (ItemStack x : store().of(p.getUniqueId()).values()) { ItemService.Inst j = plugin.items().read(x); if (j != null && i.uid().equals(j.uid())) return true; }
        return false;
    }
}
