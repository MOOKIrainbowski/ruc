package kr.rucserver.rpg.party;

import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 파티 (§21 · 웹 server/party.ts): 최대 5명 · 초대/수락 · 나가기 · 추방 · 위임 · 해산 · 파티 채팅 · 핑.
 * 분배: 경험치 = 20칸(320px) 안 파티원 균등 + 인원당 5%, Gold = 파티장 1.5 : 1. 파티 프레임 = 파티원마다 보스바(체력).
 * 메모리에만 (웹과 같음 — 서버를 다시 켜면 풀림). 나간 사람은 1분 유예 뒤 빠짐.
 */
public final class PartyService {

    public static final class Party {
        public UUID leader;
        public final List<UUID> members = new ArrayList<>();
        final Map<UUID, BossBar> frames = new HashMap<>();
        public String dungeon;   // 던전 인스턴스 id
        Party(UUID leader) { this.leader = leader; members.add(leader); }
    }

    private final RucRpg plugin;
    private final JsonObject cfg, pings;
    private final Map<UUID, Party> byMember = new HashMap<>();
    private final Map<UUID, UUID> invites = new HashMap<>();   // 받은 사람 → 보낸 사람
    private final Map<UUID, Long> inviteAt = new HashMap<>();
    private final Map<UUID, Long> offlineSince = new HashMap<>();

    public PartyService(RucRpg plugin) {
        this.plugin = plugin;
        JsonObject p = plugin.data().file("party");
        cfg = p.getAsJsonObject("PARTY");
        pings = p.getAsJsonObject("PINGS");
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 10L);
    }

    public Party of(Player p) { return byMember.get(p.getUniqueId()); }
    public Party of(UUID id) { return byMember.get(id); }
    public boolean same(UUID a, UUID b) { Party p = byMember.get(a); return p != null && p == byMember.get(b); }

    public List<Player> online(Party party) {
        List<Player> out = new ArrayList<>();
        for (UUID id : party.members) { Player p = Bukkit.getPlayer(id); if (p != null) out.add(p); }
        return out;
    }

    private void say(Party party, Component c) { for (Player p : online(party)) p.sendMessage(Component.text("[파티] ", TextColor.color(0x7FD3FF)).append(c)); }

    private static Component msg(String s) { return Component.text(s, NamedTextColor.WHITE); }

    // ── 명령 ────────────────────────────────────────────────────────

    public void invite(Player from, Player to) {
        if (to == null || to == from) { from.sendMessage(Component.text("초대할 사람을 찾지 못했습니다", NamedTextColor.RED)); return; }
        if (plugin.runtime().unit(to) == null) { from.sendMessage(Component.text(to.getName() + " 님은 RPG 캐릭터가 없습니다", NamedTextColor.RED)); return; }
        Party party = of(from);
        if (party != null && !party.leader.equals(from.getUniqueId())) { from.sendMessage(Component.text("파티장만 초대할 수 있습니다", NamedTextColor.RED)); return; }
        if (party != null && party.members.size() >= cfg.get("max").getAsInt()) { from.sendMessage(Component.text("파티가 가득 찼습니다", NamedTextColor.RED)); return; }
        if (of(to) != null) { from.sendMessage(Component.text(to.getName() + " 님은 이미 파티에 있습니다", NamedTextColor.RED)); return; }
        invites.put(to.getUniqueId(), from.getUniqueId());
        inviteAt.put(to.getUniqueId(), System.currentTimeMillis());
        from.sendMessage(Component.text(to.getName() + " 님을 파티에 초대했습니다", NamedTextColor.GRAY));
        to.sendMessage(Component.text("[파티] ", TextColor.color(0x7FD3FF)).append(msg(from.getName() + " 님이 파티에 초대했습니다  "))
                .append(Component.text("[수락]", NamedTextColor.GREEN, TextDecoration.BOLD).clickEvent(ClickEvent.runCommand("/파티 수락")))
                .append(Component.text(" [거절]", NamedTextColor.RED).clickEvent(ClickEvent.runCommand("/파티 거절"))));
        to.playSound(to.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 0.7f, 1.4f);
    }

    public void accept(Player p) {
        UUID from = invites.remove(p.getUniqueId());
        Long at = inviteAt.remove(p.getUniqueId());
        if (from == null || at == null || System.currentTimeMillis() - at > cfg.get("askMs").getAsLong()) { p.sendMessage(Component.text("받은 초대가 없습니다", NamedTextColor.RED)); return; }
        if (of(p) != null) return;
        Party party = byMember.get(from);
        if (party == null) {
            party = new Party(from);
            byMember.put(from, party);
        }
        if (party.members.size() >= cfg.get("max").getAsInt()) { p.sendMessage(Component.text("파티가 가득 찼습니다", NamedTextColor.RED)); return; }
        party.members.add(p.getUniqueId());
        byMember.put(p.getUniqueId(), party);
        say(party, msg(p.getName() + " 님이 파티에 들어왔습니다 (" + party.members.size() + "명)"));
        for (Player m : online(party)) plugin.quests().quest(m, "party", null);
    }

    public void decline(Player p) {
        UUID from = invites.remove(p.getUniqueId());
        inviteAt.remove(p.getUniqueId());
        Player f = from == null ? null : Bukkit.getPlayer(from);
        if (f != null) f.sendMessage(Component.text(p.getName() + " 님이 초대를 거절했습니다", NamedTextColor.GRAY));
    }

    public void leave(Player p) {
        Party party = of(p);
        if (party == null) { p.sendMessage(Component.text("파티에 없습니다", NamedTextColor.RED)); return; }
        remove(party, p.getUniqueId(), p.getName() + " 님이 파티를 나갔습니다");
    }

    public void kick(Player leader, String name) {
        Party party = of(leader);
        if (party == null || !party.leader.equals(leader.getUniqueId())) { leader.sendMessage(Component.text("파티장만 추방할 수 있습니다", NamedTextColor.RED)); return; }
        for (UUID id : new ArrayList<>(party.members)) {
            String n = Bukkit.getOfflinePlayer(id).getName();
            if (n != null && n.equalsIgnoreCase(name) && !id.equals(leader.getUniqueId())) { remove(party, id, n + " 님을 추방했습니다"); return; }
        }
        leader.sendMessage(Component.text("파티원이 아닙니다: " + name, NamedTextColor.RED));
    }

    public void promote(Player leader, String name) {
        Party party = of(leader);
        if (party == null || !party.leader.equals(leader.getUniqueId())) { leader.sendMessage(Component.text("파티장만 위임할 수 있습니다", NamedTextColor.RED)); return; }
        for (UUID id : party.members) {
            String n = Bukkit.getOfflinePlayer(id).getName();
            if (n != null && n.equalsIgnoreCase(name)) { party.leader = id; say(party, msg(n + " 님이 새 파티장입니다")); return; }
        }
    }

    public void disband(Player leader) {
        Party party = of(leader);
        if (party == null || !party.leader.equals(leader.getUniqueId())) { leader.sendMessage(Component.text("파티장만 해산할 수 있습니다", NamedTextColor.RED)); return; }
        say(party, msg("파티가 해산되었습니다"));
        for (UUID id : new ArrayList<>(party.members)) drop(party, id);
    }

    private void remove(Party party, UUID id, String why) {
        say(party, msg(why));
        drop(party, id);
        if (party.members.size() == 1) { say(party, msg("파티원이 없어 파티가 풀렸습니다")); drop(party, party.members.get(0)); }
        else if (!party.members.isEmpty() && party.leader.equals(id)) { party.leader = party.members.get(0); say(party, msg(Bukkit.getOfflinePlayer(party.leader).getName() + " 님이 새 파티장입니다")); }
    }

    private void drop(Party party, UUID id) {
        party.members.remove(id);
        byMember.remove(id);
        Player p = Bukkit.getPlayer(id);
        for (BossBar b : party.frames.values()) if (p != null) p.hideBossBar(b);
        BossBar mine = party.frames.remove(id);
        if (mine != null) for (Player o : online(party)) o.hideBossBar(mine);
        if (party.dungeon != null && p != null) plugin.dungeons().left(p);
    }

    public void chat(Player p, String text) {
        Party party = of(p);
        if (party == null) { p.sendMessage(Component.text("파티에 없습니다", NamedTextColor.RED)); return; }
        for (Player m : online(party)) m.sendMessage(Component.text("[파티] " + p.getName() + ": ", TextColor.color(0x7FD3FF)).append(Component.text(text, NamedTextColor.WHITE)));
    }

    /** 핑 (웹 G 휠): 바라보는 곳에 빛기둥 + 파티 알림 */
    public void ping(Player p, String kind) {
        Party party = of(p);
        if (party == null) { p.sendMessage(Component.text("파티 중에만 핑을 찍을 수 있습니다", NamedTextColor.RED)); return; }
        JsonObject def = pings.has(kind) ? pings.getAsJsonObject(kind) : pings.getAsJsonObject("gather");
        var hit = p.getWorld().rayTraceBlocks(p.getEyeLocation(), p.getEyeLocation().getDirection(), 64);
        Location at = hit == null ? p.getLocation() : hit.getHitPosition().toLocation(p.getWorld());
        Color col = Color.fromRGB(Integer.parseInt(def.get("color").getAsString().substring(1), 16));
        for (int t = 0; t < 60; t += 5)
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                for (double y = 0; y < 6; y += 0.4) at.getWorld().spawnParticle(Particle.DUST, at.clone().add(0, y, 0), 1, 0.05, 0, 0.05, 0, new Particle.DustOptions(col, 1.4f));
            }, t);
        for (Player m : online(party)) {
            m.sendMessage(Component.text("[핑] " + def.get("icon").getAsString() + " " + def.get("name").getAsString() + " — " + p.getName()
                    + " (" + Math.round(m.getLocation().distance(at.getWorld() == m.getWorld() ? at : m.getLocation())) + "칸)", TextColor.color(col.asRGB())));
            m.playSound(m.getLocation(), Sound.BLOCK_NOTE_BLOCK_BELL, 0.6f, 1.6f);
        }
    }

    // ── 분배 (§21-2) ────────────────────────────────────────────────

    /** 처치 경험치: 20칸 안 파티원 균등 + 인원당 5% (웹 partyExp) */
    public List<Player> expShare(Player killer, double xPx, double yPx) {
        Party party = of(killer);
        if (party == null) return List.of(killer);
        List<Player> near = new ArrayList<>();
        double range = cfg.get("expRange").getAsDouble() / 16;
        for (Player m : online(party)) {
            PlayerUnit u = plugin.runtime().unit(m);
            if (u == null || u.dead || m.getWorld() != killer.getWorld()) continue;
            if (m == killer || Math.hypot(m.getLocation().getX() - xPx / 16, m.getLocation().getZ() - yPx / 16) <= range) near.add(m);
        }
        return near;
    }

    public long partyExp(long base, int n) { return n <= 1 ? base : Math.round(base / (double) n * (1 + cfg.get("expBonus").getAsDouble() * (n - 1))); }

    /** Gold 나누기: 파티장 1.5 : 1 */
    public Map<Player, Long> goldShare(Player killer, long total) {
        Party party = of(killer);
        Map<Player, Long> out = new LinkedHashMap<>();
        if (party == null) { out.put(killer, total); return out; }
        List<Player> list = online(party).stream().filter(m -> m.getWorld() == killer.getWorld()).toList();
        double lw = cfg.get("leaderWeight").getAsDouble(), sum = 0;
        for (Player m : list) sum += m.getUniqueId().equals(party.leader) ? lw : 1;
        long given = 0;
        for (int i = 0; i < list.size(); i++) {
            Player m = list.get(i);
            long v = i == list.size() - 1 ? total - given : (long) Math.floor(total * (m.getUniqueId().equals(party.leader) ? lw : 1) / sum);
            given += v;
            out.put(m, v);
        }
        return out;
    }

    // ── 파티 프레임 (보스바) · 접속 유예 ─────────────────────────────

    private void tick() {
        long now = System.currentTimeMillis();
        for (Party party : new ArrayList<>(new java.util.HashSet<>(byMember.values()))) {
            for (UUID id : new ArrayList<>(party.members)) {
                Player p = Bukkit.getPlayer(id);
                if (p == null) {
                    long since = offlineSince.computeIfAbsent(id, k -> now);
                    if (now - since > cfg.get("offlineMs").getAsLong()) { offlineSince.remove(id); remove(party, id, Bukkit.getOfflinePlayer(id).getName() + " 님이 접속을 끊어 파티에서 빠졌습니다"); }
                    continue;
                }
                offlineSince.remove(id);
                PlayerUnit u = plugin.runtime().unit(p);
                BossBar b = party.frames.computeIfAbsent(id, k -> BossBar.bossBar(Component.empty(), 1f, BossBar.Color.GREEN, BossBar.Overlay.NOTCHED_10));
                double frac = u == null ? 0 : Math.max(0, Math.min(1, u.hp / Math.max(1, u.st.get("hp"))));
                b.progress((float) frac);
                b.color(frac < 0.3 ? BossBar.Color.RED : frac < 0.6 ? BossBar.Color.YELLOW : BossBar.Color.GREEN);
                b.name(Component.text((id.equals(party.leader) ? "★ " : "") + p.getName() + (u == null ? "" : "  Lv." + u.ch.level + "  " + (long) u.hp + "/" + Math.round(u.st.get("hp")) + (u.dead ? "  (쓰러짐)" : "")), NamedTextColor.WHITE));
            }
            for (Player viewer : online(party))
                for (var e : party.frames.entrySet()) if (!e.getKey().equals(viewer.getUniqueId())) viewer.showBossBar(e.getValue());
        }
        invites.entrySet().removeIf(e -> now - inviteAt.getOrDefault(e.getKey(), 0L) > cfg.get("askMs").getAsLong());
    }
}
