package kr.rucserver.rpg.party;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.mob.MobUnit;
import kr.rucserver.rpg.world.MapBuilder;
import kr.rucserver.rpg.world.RpgMap;
import kr.rucserver.rpg.world.RpgWorld;
import kr.rucserver.rpg.world.VoidGen;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 던전 "고목의 유적" (§20-3 · 웹 server/dungeon.ts): 파티(1~5인)마다 인스턴스 월드(rpg_dg_n, 한 번 지어 다시 씀).
 * 스테이지 10: 무리 소환 → 다 잡으면 휴식 30초 → 다음 (보스 5 · 10). 몹 체력 × (1 + 0.6 × (인원 − 1)).
 * 쓰러지면 관전 → 공용 부활 3번(10초 뒤 50%). 전원 쓰러지면 실패. 15분 제한. 스테이지마다 포션 5개.
 * 클리어: Gold 5000 · 고대 장비 하나(5% 전설) · 강화석 · 축복석 → RucCore 우편(한 번만).
 */
public final class DungeonService {

    public static final class Run {
        final String id;
        final World world;
        final List<UUID> members = new ArrayList<>();
        int stage = -1;
        long restUntil, startAt, limitAt;
        int revives;
        final List<MobUnit> mobs = new ArrayList<>();
        final Map<UUID, Integer> potions = new HashMap<>();
        final Map<UUID, Long> downAt = new HashMap<>();
        BossBar bar;
        boolean over;
        Run(String id, World w) { this.id = id; this.world = w; }
    }

    private final RucRpg plugin;
    private final JsonObject ruins;
    private final Map<String, Run> runs = new HashMap<>();
    private final Map<UUID, Run> byPlayer = new HashMap<>();
    private final List<World> pool = new ArrayList<>();
    private final List<World> free = new ArrayList<>();
    private RpgMap map;

    public DungeonService(RucRpg plugin) {
        this.plugin = plugin;
        ruins = plugin.data().file("dungeons").getAsJsonObject("RUINS");
        try { map = new RpgMap("dungeon", plugin.getClass().getClassLoader()); } catch (Exception e) { plugin.getLogger().warning("던전 맵: " + e.getMessage()); }
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 10L);
    }

    public boolean in(Player p) { return byPlayer.containsKey(p.getUniqueId()); }
    public Run runOf(Player p) { return byPlayer.get(p.getUniqueId()); }

    /** 인스턴스 월드 하나 빌려 오기 (없으면 만들고 짓기) */
    private void borrow(java.util.function.Consumer<World> then) {
        if (!free.isEmpty()) { then.accept(free.remove(0)); return; }
        String name = "rpg_dg_" + pool.size();
        World w = new WorldCreator(name).generator(new VoidGen()).generateStructures(false).createWorld();
        w.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        w.setGameRule(GameRule.KEEP_INVENTORY, true);
        w.setGameRule(GameRule.NATURAL_REGENERATION, false);
        w.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        w.setGameRule(GameRule.MOB_GRIEFING, false);
        pool.add(w);
        MapBuilder b = new MapBuilder(plugin, map, w);
        if (!w.getSpawnLocation().clone().add(0, -1, 0).getBlock().isPassable()) { then.accept(w); return; }   // 이미 지은 월드 (서버 재시작)
        b.buildAsync(() -> {
            RpgMap.Obj s = map.first("spawn");
            if (s != null) w.setSpawnLocation(b.at(s.cx(), s.cy()));
            then.accept(w);
        });
    }

    /** 다리오 · /던전 입장: 파티장(또는 혼자)이 파티 전원(광장 · 필드)을 데리고 */
    public void enter(Player leader) {
        PartyService.Party party = plugin.parties().of(leader);
        if (party != null && !party.leader.equals(leader.getUniqueId())) { leader.sendMessage(Component.text("파티장만 입장시킬 수 있습니다", NamedTextColor.RED)); return; }
        if (in(leader)) { leader.sendMessage(Component.text("이미 던전에 있습니다", NamedTextColor.RED)); return; }
        List<Player> who = party == null ? List.of(leader) : plugin.parties().online(party);
        leader.sendMessage(Component.text("고목의 유적을 준비하는 중…", NamedTextColor.GRAY));
        borrow(w -> {
            Run r = new Run(UUID.randomUUID().toString().substring(0, 8), w);
            r.revives = ruins.get("revives").getAsInt();
            r.startAt = System.currentTimeMillis();
            r.limitAt = r.startAt + 15 * 60_000L;
            r.restUntil = r.startAt + 8000;
            r.bar = BossBar.bossBar(Component.text("고목의 유적 — 곧 시작", TextColor.color(0xB5F07A)), 1f, BossBar.Color.GREEN, BossBar.Overlay.PROGRESS);
            runs.put(r.id, r);
            if (party != null) party.dungeon = r.id;
            Location spawn = w.getSpawnLocation().clone().add(0.5, 0, 0.5);
            for (Player p : who) {
                if (plugin.runtime().unit(p) == null || in(p)) continue;
                r.members.add(p.getUniqueId());
                byPlayer.put(p.getUniqueId(), r);
                p.teleport(spawn);
                p.showBossBar(r.bar);
                p.showTitle(Title.title(Component.text("고목의 유적", TextColor.color(0xB5F07A), TextDecoration.BOLD), Component.text(ruins.get("recommend").getAsString(), NamedTextColor.WHITE)));
            }
        });
    }

    /** 나가기 · 파티에서 빠짐 */
    public void left(Player p) {
        Run r = byPlayer.remove(p.getUniqueId());
        if (r == null) return;
        r.members.remove(p.getUniqueId());
        p.hideBossBar(r.bar);
        if (p.getGameMode() == GameMode.SPECTATOR) p.setGameMode(GameMode.ADVENTURE);
        PlayerUnit u = plugin.runtime().unit(p);
        if (u != null && u.dead) { u.dead = false; u.hp = u.st.get("hp") * 0.3; }
        Location s = plugin.worlds().spawn("plaza");
        if (s != null && p.getWorld().equals(r.world)) p.teleport(s);
        if (r.members.isEmpty()) close(r);
    }

    private void close(Run r) {
        r.over = true;
        for (MobUnit m : r.mobs) if (!m.dead) plugin.combat().die(plugin.world(), m, null);
        r.mobs.clear();
        for (UUID id : new ArrayList<>(r.members)) { Player p = Bukkit.getPlayer(id); if (p != null) left(p); }
        runs.remove(r.id);
        if (!free.contains(r.world)) free.add(r.world);
    }

    // ── 진행 ────────────────────────────────────────────────────────

    private List<Player> players(Run r) {
        List<Player> out = new ArrayList<>();
        for (UUID id : r.members) { Player p = Bukkit.getPlayer(id); if (p != null && p.getWorld().equals(r.world)) out.add(p); }
        return out;
    }

    private void tick() {
        long now = System.currentTimeMillis();
        for (Run r : new ArrayList<>(runs.values())) {
            if (r.over) continue;
            List<Player> ps = players(r);
            if (ps.isEmpty()) { close(r); continue; }
            if (now > r.limitAt) { fail(r, "시간 초과 (15분)"); continue; }
            revives(r, ps, now);
            boolean anyAlive = ps.stream().anyMatch(p -> { PlayerUnit u = plugin.runtime().unit(p); return u != null && !u.dead; });
            if (!anyAlive && r.revives <= 0) { fail(r, "전원 쓰러짐"); continue; }
            JsonArray stages = ruins.getAsJsonArray("stages");
            r.mobs.removeIf(m -> m.dead);
            if (r.stage >= 0 && r.mobs.isEmpty() && r.restUntil == 0) {   // 스테이지 클리어
                JsonObject st = stages.get(r.stage).getAsJsonObject();
                long gold = st.has("ruc") ? st.get("ruc").getAsLong() : 0;
                for (Player p : ps) {
                    plugin.quests().quest(p, "stage", "ruins", r.stage + 1);
                    if (gold > 0) { plugin.core().getEconomy().deposit(p.getUniqueId(), gold / Math.max(1, ps.size())); }
                    p.sendMessage(Component.text("[던전] " + (r.stage + 1) + "단계 「" + st.get("name").getAsString() + "」 클리어!" + (gold > 0 ? " +" + gold / Math.max(1, ps.size()) + " " + plugin.core().getEconomy().symbol() : ""), TextColor.color(0xB5F07A)));
                    p.playSound(p.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 0.6f, 1.4f);
                }
                if (r.stage + 1 >= stages.size()) { clear(r, ps); continue; }
                r.restUntil = now + ruins.get("restMs").getAsLong();
                r.potions.clear();
            }
            if (r.restUntil > 0 && now >= r.restUntil) { r.restUntil = 0; startStage(r, r.stage + 1, ps); }
            bar(r, now);
        }
    }

    private void bar(Run r, long now) {
        JsonArray stages = ruins.getAsJsonArray("stages");
        long left = Math.max(0, r.limitAt - now) / 1000;
        String t = r.restUntil > 0 ? "휴식 " + Math.max(0, (r.restUntil - now) / 1000) + "초 — 다음: " + (r.stage + 2) + "단계 「" + stages.get(Math.min(stages.size() - 1, r.stage + 1)).getAsJsonObject().get("name").getAsString() + "」"
                : (r.stage + 1) + "/" + stages.size() + "단계 「" + stages.get(r.stage).getAsJsonObject().get("name").getAsString() + "」 남은 적 " + r.mobs.size();
        r.bar.name(Component.text("고목의 유적  " + t + "   부활 " + r.revives + "   " + left / 60 + ":" + String.format("%02d", left % 60), TextColor.color(0xB5F07A)));
        r.bar.progress((float) Math.max(0, Math.min(1, (r.stage + 1) / (double) stages.size())));
    }

    private void startStage(Run r, int i, List<Player> ps) {
        r.stage = i;
        JsonObject st = ruins.getAsJsonArray("stages").get(i).getAsJsonObject();
        RpgMap.Obj area = map.first("stage_area");
        double cx = area == null ? 0 : area.cx() * 2, cy = area == null ? 0 : area.cy() * 2, rad = area == null ? 48 : Math.min(area.w(), area.h()) * 0.8;
        double baseY = new MapBuilder(plugin, map, r.world).at(area == null ? 0 : area.cx(), area == null ? 0 : area.cy()).getY();
        double hpMul = 1 + ruins.get("hpPerMember").getAsDouble() * Math.max(0, ps.size() - 1);
        int lv = st.get("lv").getAsInt();
        for (JsonElement ge : st.getAsJsonArray("groups")) {
            JsonObject g = ge.getAsJsonObject();
            MobUnit.Zone z = new MobUnit.Zone(g.get("mob").getAsString(), 0, lv, lv, g.get("grade").getAsString(), r.world.getName(), cx, cy, rad, baseY);
            for (int k = 0; k < g.get("n").getAsInt(); k++) {
                MobUnit m = plugin.mobs().spawn(z, r.world);
                if (m == null) continue;
                m.base.set("hp", m.base.get("hp") * hpMul);
                plugin.combat().recalc(m);
                m.hp = m.st.get("hp");
                if (!ps.isEmpty()) m.threat.put(plugin.runtime().unit(ps.get(k % ps.size())).id, 1.0);
                r.mobs.add(m);
            }
        }
        boolean boss = st.has("boss") && st.get("boss").getAsBoolean();
        for (Player p : ps) {
            p.showTitle(Title.title(Component.text((i + 1) + "단계", boss ? NamedTextColor.RED : TextColor.color(0xB5F07A), TextDecoration.BOLD),
                    Component.text(st.get("name").getAsString(), NamedTextColor.WHITE)));
            p.playSound(p.getLocation(), boss ? Sound.ENTITY_WITHER_SPAWN : Sound.EVENT_RAID_HORN, boss ? 0.4f : 0.6f, 1.2f);
            plugin.quests().quest(p, "stage", "ruins", i + 1);
        }
    }

    // ── 쓰러짐 · 공용 부활 ───────────────────────────────────────────

    /** PlayerRuntime.killed 가 부름: 던전이면 관전으로 (true = 처리함) */
    public boolean down(PlayerUnit u) {
        Run r = byPlayer.get(u.player.getUniqueId());
        if (r == null) return false;
        u.player.setGameMode(GameMode.SPECTATOR);
        r.downAt.put(u.player.getUniqueId(), System.currentTimeMillis());
        for (Player p : players(r)) p.sendMessage(Component.text("[던전] " + u.player.getName() + " 님이 쓰러졌습니다" + (r.revives > 0 ? " — 10초 뒤 공용 부활 (" + r.revives + "번 남음)" : ""), NamedTextColor.RED));
        return true;
    }

    private void revives(Run r, List<Player> ps, long now) {
        for (var it = r.downAt.entrySet().iterator(); it.hasNext(); ) {
            var e = it.next();
            if (r.revives <= 0 || now - e.getValue() < ruins.get("reviveDelayMs").getAsLong()) continue;
            Player p = Bukkit.getPlayer(e.getKey());
            Player alive = ps.stream().filter(x -> { PlayerUnit u = plugin.runtime().unit(x); return u != null && !u.dead; }).findFirst().orElse(null);
            if (p == null || alive == null) continue;
            it.remove();
            r.revives--;
            PlayerUnit u = plugin.runtime().unit(p);
            u.dead = false;
            u.hp = Math.max(1, u.st.get("hp") * ruins.get("revivePct").getAsDouble());
            p.setGameMode(GameMode.ADVENTURE);
            p.teleport(alive.getLocation());
            plugin.world().revived(u);
        }
    }

    /** 스테이지마다 포션 5개 (ItemRuntime 이 포션 쓸 때 물어봄) */
    public boolean potion(Player p) {
        Run r = byPlayer.get(p.getUniqueId());
        if (r == null) return true;
        int used = r.potions.getOrDefault(p.getUniqueId(), 0);
        if (used >= ruins.get("potionsPerStage").getAsInt()) return false;
        r.potions.put(p.getUniqueId(), used + 1);
        return true;
    }

    private void fail(Run r, String why) {
        for (Player p : players(r)) p.showTitle(Title.title(Component.text("던전 실패", NamedTextColor.RED, TextDecoration.BOLD), Component.text(why, NamedTextColor.WHITE)));
        r.over = true;
        Bukkit.getScheduler().runTaskLater(plugin, () -> close(r), ruins.get("returnMs").getAsLong() / 50);
    }

    private void clear(Run r, List<Player> ps) {
        r.over = true;
        JsonObject c = ruins.getAsJsonObject("clear");
        JsonArray gear = c.getAsJsonArray("gear");
        for (Player p : ps) {
            UUID id = p.getUniqueId();
            String tpl = gear.get((int) Math.floor(Math.random() * gear.size())).getAsString();
            PlayerUnit u = plugin.runtime().unit(p);
            String rar = Math.random() < c.get("legendary").getAsDouble() ? "legendary" : plugin.items().rollRarity(0.1 + (u == null ? 0 : u.st.get("luck")) / 400);
            List<ItemStack> rewards = new ArrayList<>();
            rewards.add(plugin.items().create(tpl, rar, 1));
            for (JsonElement e : c.getAsJsonArray("items")) rewards.add(plugin.items().create(e.getAsJsonArray().get(0).getAsString(), null, e.getAsJsonArray().get(1).getAsInt()));
            long gold = c.get("ruc").getAsLong();
            String key = "rpgdg:" + r.id + ":" + id.toString().substring(0, 8);
            Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                var mail = plugin.core().getMailbox();
                mail.sendRucOnce(id, gold, "고목의 유적", key + ":g");
                for (int k = 0; k < rewards.size(); k++) mail.sendItemOnce(id, rewards.get(k), "고목의 유적", key + ":" + k);
            });
            p.showTitle(Title.title(Component.text("유적 정화 완료!", TextColor.color(0xF2C94C), TextDecoration.BOLD), Component.text("보상은 우편함으로", NamedTextColor.WHITE)));
            p.playSound(p.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);
        }
        Bukkit.broadcast(Component.text("[던전] " + String.join(", ", ps.stream().map(Player::getName).toList()) + " 님이 고목의 유적을 정화했습니다!", TextColor.color(0xF2C94C)));
        Bukkit.getScheduler().runTaskLater(plugin, () -> close(r), ruins.get("returnMs").getAsLong() / 50);
    }

    /** 개발용: 지금 스테이지 끝내기 (웹 dev stage) */
    public void skip(Player p) {
        Run r = byPlayer.get(p.getUniqueId());
        if (r == null) return;
        for (MobUnit m : new ArrayList<>(r.mobs)) if (!m.dead) plugin.combat().die(plugin.world(), m, null);
    }

    public static double px(double block) { return block * RpgWorld.PX; }
}
