package kr.rucserver.rpg.world;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Mannequin;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.persistence.PersistentDataType;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 광장 NPC (웹 quests.ts NPCS: 루미 안내원 · 볼트 대장장이 · 미르 연금술사 · 세라 직업 교관 · 오웬 스킬 교관 · 핍 우편 집배원 · 다리오 유적 탐험가).
 * 몸 = 바닐라 마네킹(사람 모양, 움직이지 않음) — 사용자 결정 Q3 의 3D 모델이 나오면 모델 엔진으로 바뀜.
 * 우클릭 = 말 걸기 → 대사 + 역할 창 (전직 · 스킬 · 강화 …), 퀘스트 talk 목표(M6 퀘스트 엔진이 talked 훅을 씀).
 */
public final class NpcRuntime implements Listener {

    private final RucRpg plugin;
    private final NamespacedKey tag;
    private final Map<UUID, String> byEntity = new HashMap<>();
    /** 퀘스트 엔진 훅 (npc id) */
    public java.util.function.BiConsumer<Player, String> talked = (p, id) -> {};

    public NpcRuntime(RucRpg plugin) {
        this.plugin = plugin;
        this.tag = new NamespacedKey(plugin, "npc");
    }

    /** 광장 NPC 다시 세우기 (켤 때 · 맵을 지은 뒤) */
    public void spawnAll() {
        RpgWorlds ws = plugin.worlds();
        for (String kind : RpgWorlds.KINDS) {
            World w = ws.world(kind);
            if (w == null) continue;
            for (Entity e : w.getEntities()) if (e.getPersistentDataContainer().has(tag)) e.remove();
            for (RpgMap.Obj o : ws.npcs.getOrDefault(kind, java.util.List.of())) {
                Location at = ws.at(kind, o.cx(), o.cy());
                if (at == null || at.getBlock().getRelative(0, -1, 0).isPassable()) continue;   // 아직 안 지은 맵
                String id = o.prop("npc");
                at.setYaw(0);   // 남쪽(화면 아래)을 봄
                Mannequin m = w.spawn(at, Mannequin.class, e -> {
                    e.setImmovable(true);
                    e.setInvulnerable(true);
                    e.setPersistent(true);
                    e.setSilent(true);
                    e.customName(Component.text(o.name(), NamedTextColor.WHITE, TextDecoration.BOLD));
                    e.setCustomNameVisible(true);
                    e.setDescription(Component.text(o.prop("role") == null ? "" : o.prop("role"), TextColor.color(0xF2C94C)));
                    e.getPersistentDataContainer().set(tag, PersistentDataType.STRING, id);
                });
                byEntity.put(m.getUniqueId(), id);
                if (plugin.models() != null && plugin.models().has(id)) {   // NPC 모델이 있으면 마네킹은 클릭 판정만
                    var inst = plugin.models().attach(id, m);
                    if (inst != null) m.setInvisible(true);
                }
            }
        }
    }

    @EventHandler
    public void onTalk(PlayerInteractEntityEvent e) {
        if (e.getHand() != EquipmentSlot.HAND) return;
        String id = e.getRightClicked().getPersistentDataContainer().get(tag, PersistentDataType.STRING);
        if (id == null) return;
        e.setCancelled(true);
        Player p = e.getPlayer();
        JsonElement def = plugin.data().get("quests.NPCS." + id);
        if (def != null) {
            JsonObject d = def.getAsJsonObject();
            String line = d.getAsJsonArray("lines").get((int) (Math.random() * d.getAsJsonArray("lines").size())).getAsString();
            p.sendMessage(Component.text("[" + d.get("name").getAsString() + "] ", TextColor.color(0xF2C94C)).append(Component.text(kr.rucserver.rpg.quest.QuestEngine.mc(line), NamedTextColor.WHITE)));
        }
        p.playSound(p.getLocation(), Sound.ENTITY_VILLAGER_AMBIENT, 0.6f, 1.2f);
        talked.accept(p, id);
        if (plugin.runtime().unit(p) == null) return;
        switch (id) {
            case "sera" -> plugin.menus().job(p);
            case "owen" -> plugin.menus().skills(p);
            case "lumi" -> plugin.menus().main(p);
            case "volt" -> plugin.econGui().smith(p);
            case "dario" -> dungeonGate(p);
            case "pip" -> { plugin.core().getMailbox().open(p, 0); plugin.quests().quest(p, "claim", null); }
            default -> {}   // 볼트(강화 M5) · 미르(제조 M8) · 핍(우편: RucCore /우편함) · 다리오(던전 M7)
        }
    }

    /** 다리오: 고목의 유적 입장 창 */
    private void dungeonGate(Player p) {
        JsonObject r = plugin.data().get("dungeons.RUINS").getAsJsonObject();
        var g = new kr.rucserver.rpg.ui.Gui(3, Component.text("고목의 유적", NamedTextColor.DARK_GRAY));
        for (int i = 0; i < 27; i++) g.set(i, kr.rucserver.rpg.ui.Gui.filler(), null);
        var party = plugin.parties().of(p);
        g.set(13, kr.rucserver.rpg.ui.Gui.button("입장하기", true, java.util.List.of(
                kr.rucserver.rpg.ui.Gui.gray(r.get("recommend").getAsString()),
                kr.rucserver.rpg.ui.Gui.gray("10단계 · 보스 2 · 공용 부활 3 · 15분"),
                kr.rucserver.rpg.ui.Gui.gray(party == null ? "혼자 입장 (파티는 /파티 초대)" : "파티 " + party.members.size() + "명 — 파티장만 입장시킬 수 있음"))),
                (pl, t) -> { pl.closeInventory(); plugin.dungeons().enter(pl); });
        g.open(p);
    }

    @EventHandler
    public void onHurt(EntityDamageEvent e) {
        if (e.getEntity().getPersistentDataContainer().has(tag)) e.setCancelled(true);
    }
}
