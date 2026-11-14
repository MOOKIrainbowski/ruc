package kr.rucserver.rpg.item;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.engine.Combat;
import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.engine.Unit;
import kr.rucserver.rpg.mob.MobUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemConsumeEvent;
import org.bukkit.event.player.PlayerItemHeldEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 아이템이 게임에 미치는 것: 입은 장비 → 스탯 (방어구 4칸 + 손에 든 무기 + 보조손 + 장신구 칸), 착용 레벨,
 * 소모품 · 포션 · 음식 · 스킬북 사용, 처치 드롭(주인 30초), 내구도(5타마다 −1, 사망 −5%), 장비 발동 효과(특수효과 · 세트).
 */
public final class ItemRuntime implements Listener {

    public static final int WEAR_EVERY = 5;
    private static final long RECALL_MS = 3000;

    private final RucRpg plugin;
    private final ItemService items;
    private final EquipStore equip;
    private final Map<UUID, long[]> counters = new HashMap<>();   // [때린 수, 맞은 수, 평타 수, 보루 쿨]
    private final Map<UUID, Long> potionAt = new HashMap<>();
    private final Map<UUID, Recall> recalls = new HashMap<>();

    private record Recall(long at, Location from, ItemStack used) {}

    public ItemRuntime(RucRpg plugin, ItemService items, EquipStore equip) {
        this.plugin = plugin;
        this.items = items;
        this.equip = equip;
        Bukkit.getScheduler().runTaskTimer(plugin, this::recallTick, 5L, 5L);
    }

    public EquipStore equip() { return equip; }

    // ── 입은 장비 → 스탯 ─────────────────────────────────────────────

    /** 지금 입고 든 RPG 장비 (착용 레벨이 되는 것만) */
    public List<ItemService.Inst> worn(PlayerUnit u) {
        List<ItemService.Inst> out = new ArrayList<>();
        PlayerInventory inv = u.player.getInventory();
        for (ItemStack it : inv.getArmorContents()) add(u, it, out, null);
        add(u, inv.getItemInMainHand(), out, "weapon");
        add(u, inv.getItemInOffHand(), out, "offhand");
        for (ItemStack it : equip.of(u.player.getUniqueId()).values()) add(u, it, out, null);
        return out;
    }

    private void add(PlayerUnit u, ItemStack it, List<ItemService.Inst> out, String needSlot) {
        ItemService.Inst i = items.read(it);
        if (i == null) return;
        JsonObject t = items.tpl(i.tpl());
        if (!ItemService.isGear(t)) return;
        if (needSlot != null && !needSlot.equals(t.get("slot").getAsString())) return;
        if (t.get("lv").getAsInt() > u.ch.level) return;
        out.add(i);
    }

    /** 장비가 바뀔 수 있는 일 뒤에 (다음 틱) */
    public void refreshLater(Player p) { Bukkit.getScheduler().runTask(plugin, () -> refresh(p)); }

    public void refresh(Player p) {
        PlayerUnit u = plugin.runtime().unit(p);
        if (u == null) return;
        List<ItemService.Inst> worn = worn(u);
        u.gear.clear();
        u.procs.clear();
        for (ItemService.Inst i : worn) {
            u.gear.addAll(items.mods(i));
            for (JsonElement s : i.sp()) {
                JsonObject so = s.getAsJsonObject();
                JsonObject def = plugin.data().get("items.SPECIALS." + so.get("id").getAsString()) == null ? null : plugin.data().get("items.SPECIALS." + so.get("id").getAsString()).getAsJsonObject();
                if (def != null && !def.has("mods")) u.procs.put(so.get("id").getAsString(), so.get("v").getAsDouble());
            }
        }
        items.setMods(worn, u.gear);
        setProcs(worn, u);
        plugin.combat().recalc(u);
    }

    private void setProcs(List<ItemService.Inst> worn, PlayerUnit u) {
        Map<String, Integer> n = new HashMap<>();
        for (ItemService.Inst i : worn) {
            JsonObject t = items.tpl(i.tpl());
            if (t.has("set") && ItemService.working(i)) n.merge(t.get("set").getAsString(), 1, Integer::sum);
        }
        for (var e : n.entrySet()) {
            JsonElement set = plugin.data().get("items.SETS." + e.getKey());
            if (set == null) continue;
            for (JsonElement tier : set.getAsJsonObject().getAsJsonArray("tiers")) {
                JsonObject to = tier.getAsJsonObject();
                if (e.getValue() >= to.get("n").getAsInt() && to.has("proc"))
                    u.procs.put(to.getAsJsonObject("proc").get("id").getAsString(), to.getAsJsonObject("proc").get("v").getAsDouble());
            }
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onHeld(PlayerItemHeldEvent e) { refreshLater(e.getPlayer()); }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onInvClick(InventoryClickEvent e) { if (e.getWhoClicked() instanceof Player p) refreshLater(p); }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onInvClose(InventoryCloseEvent e) { if (e.getPlayer() instanceof Player p) refreshLater(p); }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onArmor(com.destroystokyo.paper.event.player.PlayerArmorChangeEvent e) { refreshLater(e.getPlayer()); }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPickup(EntityPickupItemEvent e) { if (e.getEntity() instanceof Player p) refreshLater(p); }

    // ── 사용 (우클릭) ───────────────────────────────────────────────

    @EventHandler(priority = EventPriority.HIGH)
    public void onUse(PlayerInteractEvent e) {
        if (e.getHand() != EquipmentSlot.HAND) return;
        if (e.getAction() != Action.RIGHT_CLICK_AIR && e.getAction() != Action.RIGHT_CLICK_BLOCK) return;
        Player p = e.getPlayer();
        ItemStack it = p.getInventory().getItemInMainHand();
        ItemService.Inst i = items.read(it);
        if (i == null || ItemService.isGear(items.tpl(i.tpl()))) return;
        PlayerUnit u = plugin.runtime().unit(p);
        if (u == null) return;
        e.setCancelled(true);
        String err = use(u, it, i);
        if (err != null) plugin.hud().toast(p, err);
    }

    /** 바닐라 음식 · 포션을 먹는 동작은 RPG 아이템에선 막음 (우클릭 즉시 사용) */
    @EventHandler(priority = EventPriority.HIGH)
    public void onConsume(PlayerItemConsumeEvent e) { if (items.read(e.getItem()) != null) e.setCancelled(true); }

    private static String bookGrade(String r) {
        return switch (r) { case "legendary" -> "trans"; case "mythic" -> "high"; case "rare", "advanced" -> "mid"; default -> "low"; };
    }

    private void takeOne(Player p, ItemStack it) {
        it.setAmount(it.getAmount() - 1);
        p.getInventory().setItemInMainHand(it.getAmount() <= 0 ? null : it);
    }

    private String use(PlayerUnit u, ItemStack it, ItemService.Inst i) {
        JsonObject t = items.tpl(i.tpl());
        Player p = u.player;
        if (u.dead) return "쓰러진 상태입니다";
        if (t.has("skill")) {
            String err = plugin.progression().readBook(u, t.get("skill").getAsString(), bookGrade(i.rarity()));
            if (err != null) return err;
            takeOne(p, it);
            plugin.chars().saveAsync(u.ch);
            return null;
        }
        if (t.has("use")) {
            JsonObject use = t.getAsJsonObject("use");
            if (use.has("food")) {
                if (u.stamina >= u.st.get("stamina")) return "스태미나가 가득합니다";
                takeOne(p, it);
                u.stamina = Math.min(u.st.get("stamina"), u.stamina + use.get("food").getAsDouble());
                p.getWorld().playSound(p.getLocation(), Sound.ENTITY_GENERIC_EAT, 0.8f, 1.1f);
                return null;
            }
            if (use.has("recall")) {
                if (plugin.safeZones().contains(p.getLocation())) return "이미 광장에 있습니다";
                recalls.put(p.getUniqueId(), new Recall(System.currentTimeMillis() + RECALL_MS, p.getLocation(), it.asOne()));
                p.sendMessage(Component.text("3초 뒤 광장으로 돌아갑니다 — 움직이거나 공격받으면 취소", NamedTextColor.YELLOW));
                return null;
            }
            if (use.has("box")) {
                takeOne(p, it);
                ItemStack got = rollBox(u.st.get("luck"));
                if (got == null) return null;
                give(p, got);
                p.sendMessage(Component.text("랜덤 상자에서 ", NamedTextColor.WHITE).append(got.getItemMeta().displayName()).append(Component.text(" 이(가) 나왔어요!", NamedTextColor.WHITE)));
                return null;
            }
            if (use.has("tab")) return "창고 확장은 창고(M5)가 열리면 쓸 수 있습니다";
            if (use.has("fx")) {
                takeOne(p, it);
                plugin.combat().addEffect(plugin.world(), u, Combat.FxSpec.of(use.getAsJsonObject("fx")), u);
                p.getWorld().playSound(p.getLocation(), Sound.ENTITY_WITCH_DRINK, 0.8f, 1.2f);
                return null;
            }
        }
        if (t.has("heal")) {
            long now = System.currentTimeMillis();
            if (now < potionAt.getOrDefault(p.getUniqueId(), 0L)) return "포션 재사용 대기 중입니다";
            if (!plugin.dungeons().potion(p)) return "이번 스테이지에서는 포션을 더 쓸 수 없습니다 (던전 회복 제한)";
            boolean alc = "alchemist".equals(u.job);   // 연금술사 「촉매」
            double cd = plugin.data().get("items.POTION_CD_MS") != null ? plugin.data().get("items.POTION_CD_MS").getAsDouble() : 8000;
            potionAt.put(p.getUniqueId(), now + (long) (cd * (alc ? 0.8 : 1)));
            takeOne(p, it);
            double k = alc ? 1.3 : 1;
            JsonObject h = t.getAsJsonObject("heal");
            if (h.has("hp")) plugin.combat().applyHeal(plugin.world(), u, u, h.get("hp").getAsDouble() * k, false);
            if (h.has("mp")) u.mp = Math.min(u.st.get("mana"), u.mp + h.get("mp").getAsDouble() * k);
            if (h.has("en")) u.en = Math.min(u.st.get("energy"), u.en + h.get("en").getAsDouble() * k);
            p.getWorld().playSound(p.getLocation(), Sound.ENTITY_GENERIC_DRINK, 0.8f, 1.2f);
            p.getWorld().spawnParticle(Particle.HAPPY_VILLAGER, p.getLocation().add(0, 1, 0), 8, 0.3, 0.5, 0.3, 0);
            return null;
        }
        return "사용할 수 없는 아이템입니다";
    }

    /** 랜덤 상자 (웹 rollBox) — export 된 BOX_POOL 이 있을 때 */
    private ItemStack rollBox(double luck) {
        JsonElement poolE = plugin.data().get("items.BOX_POOL");
        if (poolE == null) return null;
        JsonArray pool = poolE.getAsJsonArray();
        double total = 0;
        for (JsonElement e : pool) total += e.getAsJsonObject().get("w").getAsDouble();
        double r = Math.random() * total;
        JsonObject pick = pool.get(0).getAsJsonObject();
        for (JsonElement e : pool) { r -= e.getAsJsonObject().get("w").getAsDouble(); if (r < 0) { pick = e.getAsJsonObject(); break; } }
        String tpl = pick.get("tpl").getAsString();
        JsonObject t = items.tpl(tpl);
        String rar = t.has("rarity") ? t.get("rarity").getAsString() : items.rollRarity(0.1 + luck / 400);
        return items.create(tpl, rar, pick.has("qty") ? pick.get("qty").getAsInt() : 1);
    }

    /** 인벤토리에 넣고, 넘치면 발밑에 (주인만 30초) */
    public void give(Player p, ItemStack it) {
        for (ItemStack left : p.getInventory().addItem(it).values()) drop(p.getLocation(), left, p.getUniqueId());
        refreshLater(p);
    }

    private void recallTick() {
        long now = System.currentTimeMillis();
        for (var it = recalls.entrySet().iterator(); it.hasNext(); ) {
            var e = it.next();
            Player p = Bukkit.getPlayer(e.getKey());
            PlayerUnit u = p == null ? null : plugin.runtime().unit(p);
            Recall r = e.getValue();
            if (u == null || u.dead || p.getLocation().distanceSquared(r.from()) > 0.25 || u.combatAt > r.at() - RECALL_MS) {
                it.remove();
                if (p != null) p.sendMessage(Component.text("귀환이 취소되었습니다", NamedTextColor.RED));
                continue;
            }
            p.getWorld().spawnParticle(Particle.PORTAL, p.getLocation().add(0, 1, 0), 10, 0.3, 0.6, 0.3, 0.3);
            if (now < r.at()) continue;
            it.remove();
            if (!p.getInventory().containsAtLeast(r.used(), 1)) continue;
            p.getInventory().removeItem(r.used());
            p.teleport(plugin.plazaSpawn(p.getWorld()));
            p.getWorld().playSound(p.getLocation(), Sound.ENTITY_ENDERMAN_TELEPORT, 0.8f, 1f);
        }
    }

    // ── 드롭 ────────────────────────────────────────────────────────

    /** 처치 드롭: 테이블 + 상급 이상 몹 보너스 방어구 → 몹 자리에, 30초 동안 주인만 주울 수 있음 */
    public void mobDrops(MobUnit m, PlayerUnit by) {
        if (m.body == null) return;
        Location at = m.body.getLocation().add(0, 0.5, 0);
        int gi = plugin.mobs().defs().gradeIndex(m.grade);
        double luck = by.st.get("luck");
        List<ItemStack> drops = new ArrayList<>();
        if (m.def.has("drops")) drops.addAll(items.rollDrops(m.def.getAsJsonArray("drops"), gi, luck));
        ItemStack bonus = items.bonusArmor(m.lv, gi, luck);
        if (bonus != null) drops.add(bonus);
        for (ItemStack it : drops) drop(at, it, by.player.getUniqueId());
    }

    public void drop(Location at, ItemStack it, UUID owner) {
        Item e = at.getWorld().dropItemNaturally(at, it);
        e.setOwner(owner);
        e.setCustomNameVisible(true);
        e.customName(it.getItemMeta().displayName());
        ItemService.Inst i = items.read(it);
        if (i != null && List.of("advanced", "mythic", "legendary").contains(i.rarity())) {
            e.setGlowing(true);
            at.getWorld().playSound(at, Sound.ENTITY_PLAYER_LEVELUP, 0.4f, 2f);
        }
        Bukkit.getScheduler().runTaskLater(plugin, () -> { if (e.isValid()) e.setOwner(null); }, 20L * 30);
    }

    // ── 내구도 · 발동 효과 (웹 onDealt · onTaken · onKill · deathWear) ──

    private long[] cnt(Player p) { return counters.computeIfAbsent(p.getUniqueId(), k -> new long[4]); }

    public void onDealt(PlayerUnit p, Unit tgt, double dmg, Combat.HitSpec h) {
        long[] c = cnt(p.player);
        if (++c[0] % WEAR_EVERY == 0 && items.wear(p.player.getInventory().getItemInMainHand(), 1)) brokeNotice(p.player);
        if (h == null || !h.basic || tgt.dead) return;
        c[2]++;
        Double burn = p.procs.get("burn_touch");
        if (burn != null && plugin.combat().rand() < burn)
            plugin.combat().addEffect(plugin.world(), tgt, new Combat.FxSpec("burn", 3000, null, Math.max(1, dmg * 0.15), null), p);
        Double bolt = p.procs.get("fifth_bolt");
        if (bolt != null && c[2] % 5 == 0 && !tgt.dead) {
            Combat.HitSpec s = new Combat.HitSpec();
            s.atkRatio = bolt; s.cat = "magical"; s.el = "electric";
            plugin.combat().hit(plugin.world(), p, tgt, s);
            var ent = plugin.world().entityOf(tgt);
            if (ent != null) ent.getWorld().strikeLightningEffect(ent.getLocation());
        }
    }

    public void onTaken(PlayerUnit p, Unit src, double dmg, Combat.HitSpec h) {
        long[] c = cnt(p.player);
        if (++c[1] % WEAR_EVERY == 0)
            for (ItemStack a : p.player.getInventory().getArmorContents()) if (items.wear(a, 1)) brokeNotice(p.player);
        if (p.dead) return;
        long now = System.currentTimeMillis();
        Double low = p.procs.get("low_shield");
        if (low != null && p.hp < p.st.get("hp") * 0.3 && now >= c[3]) {
            c[3] = now + 60_000;
            plugin.combat().addEffect(plugin.world(), p, Combat.FxSpec.of("shield", 5000, Formulas.jsRound(p.st.get("hp") * low)), p);
        }
        Double vine = p.procs.get("vine_shield");
        if (vine != null && plugin.combat().rand() < 0.1) plugin.combat().addEffect(plugin.world(), p, Combat.FxSpec.of("shield", 2000, Formulas.jsRound(p.st.get("hp") * vine)), p);
        Double thorns = p.procs.get("thorns");
        if (thorns != null && h != null && h.melee && !src.dead) plugin.combat().dotDamage(plugin.world(), p, src, dmg * thorns);
    }

    public void onKill(PlayerUnit p) {
        Double haste = p.procs.get("kill_haste");
        if (haste != null) plugin.combat().addEffect(plugin.world(), p, Combat.FxSpec.of("haste", 2000, haste), p);
    }

    /** 사망: 입은 장비 내구도 −5% */
    public void deathWear(PlayerUnit p) {
        List<ItemStack> all = new ArrayList<>(java.util.Arrays.asList(p.player.getInventory().getArmorContents()));   // 빈 칸 = null
        all.add(p.player.getInventory().getItemInMainHand());
        for (ItemStack it : all) {
            ItemService.Inst i = items.read(it);
            if (i != null && i.durMax() > 0) items.wear(it, (int) Math.ceil(i.durMax() * 0.05));
        }
        refresh(p.player);
    }

    private void brokeNotice(Player p) {
        p.sendMessage(Component.text("장비 내구도가 다 닳았습니다 — 수리하기 전까지 효과가 없습니다.", TextColor.color(0xFF6B6B)));
        p.playSound(p.getLocation(), Sound.ENTITY_ITEM_BREAK, 0.8f, 1f);
        refreshLater(p);
    }
}
