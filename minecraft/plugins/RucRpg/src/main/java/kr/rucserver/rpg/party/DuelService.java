package kr.rucserver.rpg.party;

import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.engine.Unit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 결투 (§13-3 · 웹 server/pvp.ts): 신청 → 15초 안 수락 → 3초 카운트다운 → 둘만 서로 적. 체력 1 에서 끝(죽지 않음), 3분 · 20칸 밖이면 무승부.
 * 결투장(rpg_arena) = 다른 파티끼리 자유 PvP, 쓰러지면 결투장에서 다시. K/D/A 는 RucCore 스코어보드 줄에 그대로 더함(기존 구현 유지).
 */
public final class DuelService {

    private record Duel(UUID a, UUID b, long startAt, long endAt) {}

    private final RucRpg plugin;
    private final JsonObject cfg;
    private final Map<UUID, UUID> asks = new HashMap<>();
    private final Map<UUID, Long> askAt = new HashMap<>();
    private final Map<UUID, Duel> duels = new HashMap<>();

    public DuelService(RucRpg plugin) {
        this.plugin = plugin;
        cfg = plugin.data().file("party").getAsJsonObject("DUEL");
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 10L);
    }

    /** 플레이어끼리 적인가 (RpgWorld.hostile 의 플레이어 쪽) */
    public boolean hostile(PlayerUnit a, PlayerUnit b) {
        Duel d = duels.get(a.player.getUniqueId());
        long now = System.currentTimeMillis();
        if (d != null && now >= d.startAt() && (d.a().equals(b.player.getUniqueId()) || d.b().equals(b.player.getUniqueId()))) return true;
        return plugin.worlds().world("arena") != null && a.player.getWorld().equals(plugin.worlds().world("arena")) && b.player.getWorld().equals(a.player.getWorld())
                && !plugin.parties().same(a.player.getUniqueId(), b.player.getUniqueId());
    }

    /** 결투 패배는 죽지 않음 (체력 1 로 끝) */
    public boolean spare(Unit src, Unit u) {
        if (!(u instanceof PlayerUnit pu)) return false;
        Duel d = duels.get(pu.player.getUniqueId());
        if (d == null || !(src instanceof PlayerUnit ps)) return false;
        UUID other = d.a().equals(pu.player.getUniqueId()) ? d.b() : d.a();
        if (!other.equals(ps.player.getUniqueId())) return false;
        u.hp = 1;
        end(d, ps.player.getUniqueId(), "승리");
        return true;
    }

    public void ask(Player from, Player to) {
        if (to == null || to == from || plugin.runtime().unit(to) == null) { from.sendMessage(Component.text("결투할 사람을 찾지 못했습니다", NamedTextColor.RED)); return; }
        if (duels.containsKey(from.getUniqueId()) || duels.containsKey(to.getUniqueId())) { from.sendMessage(Component.text("이미 결투 중입니다", NamedTextColor.RED)); return; }
        if (plugin.worlds().isPlaza(from.getLocation())) { from.sendMessage(Component.text("광장은 안전지대라 결투할 수 없습니다", NamedTextColor.RED)); return; }
        if (from.getWorld() != to.getWorld() || from.getLocation().distance(to.getLocation()) > cfg.get("range").getAsDouble() / 16) { from.sendMessage(Component.text("20칸 안에 있어야 합니다", NamedTextColor.RED)); return; }
        asks.put(to.getUniqueId(), from.getUniqueId());
        askAt.put(to.getUniqueId(), System.currentTimeMillis());
        from.sendMessage(Component.text(to.getName() + " 님에게 결투를 신청했습니다", NamedTextColor.GRAY));
        to.sendMessage(Component.text("[결투] ", TextColor.color(0xFF6B6B)).append(Component.text(from.getName() + " 님이 결투를 신청했습니다  ", NamedTextColor.WHITE))
                .append(Component.text("[수락]", NamedTextColor.GREEN, TextDecoration.BOLD).clickEvent(ClickEvent.runCommand("/결투 수락"))));
    }

    public void accept(Player p) {
        UUID from = asks.remove(p.getUniqueId());
        Long at = askAt.remove(p.getUniqueId());
        Player f = from == null ? null : Bukkit.getPlayer(from);
        if (f == null || at == null || System.currentTimeMillis() - at > cfg.get("askMs").getAsLong()) { p.sendMessage(Component.text("받은 결투 신청이 없습니다", NamedTextColor.RED)); return; }
        long now = System.currentTimeMillis(), cd = cfg.get("countdownMs").getAsLong();
        Duel d = new Duel(from, p.getUniqueId(), now + cd, now + cd + cfg.get("maxMs").getAsLong());
        duels.put(from, d);
        duels.put(p.getUniqueId(), d);
        for (Player x : new Player[]{f, p}) {
            for (int i = 3; i >= 1; i--) {
                int n = i;
                Bukkit.getScheduler().runTaskLater(plugin, () -> { x.showTitle(Title.title(Component.text(String.valueOf(n), NamedTextColor.RED, TextDecoration.BOLD), Component.empty(), Title.Times.times(Duration.ZERO, Duration.ofMillis(800), Duration.ofMillis(100)))); x.playSound(x.getLocation(), Sound.BLOCK_NOTE_BLOCK_HAT, 1f, 1f); }, (3 - i) * 20L);
            }
            Bukkit.getScheduler().runTaskLater(plugin, () -> { x.showTitle(Title.title(Component.text("결투!", NamedTextColor.RED, TextDecoration.BOLD), Component.empty())); x.playSound(x.getLocation(), Sound.EVENT_RAID_HORN, 0.6f, 1.4f); }, 60L);
        }
    }

    private void end(Duel d, UUID winner, String why) {
        duels.remove(d.a());
        duels.remove(d.b());
        for (UUID id : new UUID[]{d.a(), d.b()}) {
            Player p = Bukkit.getPlayer(id);
            if (p == null) continue;
            String r = winner == null ? "무승부" : winner.equals(id) ? "승리!" : "패배";
            p.showTitle(Title.title(Component.text(r, winner != null && winner.equals(id) ? TextColor.color(0xF2C94C) : NamedTextColor.GRAY, TextDecoration.BOLD), Component.text(why, NamedTextColor.WHITE)));
        }
        if (winner != null) {   // K/D = RucCore 스코어보드 줄
            UUID loser = winner.equals(d.a()) ? d.b() : d.a();
            var w = plugin.core().getPlayerData().get(winner);
            var l = plugin.core().getPlayerData().get(loser);
            if (w != null) { w.addKill(); plugin.core().getPlayerData().saveAsync(w); }
            if (l != null) { l.addDeath(); plugin.core().getPlayerData().saveAsync(l); }
        }
    }

    /** 결투장 처치 (진짜로 쓰러짐) — K/D 반영 */
    public void arenaKill(PlayerUnit dead, Unit by) {
        if (!(by instanceof PlayerUnit k) || by == dead) return;
        var w = plugin.core().getPlayerData().get(k.player.getUniqueId());
        var l = plugin.core().getPlayerData().get(dead.player.getUniqueId());
        if (w != null) { w.addKill(); plugin.core().getPlayerData().saveAsync(w); }
        if (l != null) { l.addDeath(); plugin.core().getPlayerData().saveAsync(l); }
        Bukkit.broadcast(Component.text("[결투장] " + k.player.getName() + " ⚔ " + dead.player.getName(), TextColor.color(0xFF6B6B)));
    }

    private void tick() {
        long now = System.currentTimeMillis();
        for (Duel d : new java.util.HashSet<>(duels.values())) {
            Player a = Bukkit.getPlayer(d.a()), b = Bukkit.getPlayer(d.b());
            if (a == null || b == null) { end(d, a == null ? d.b() : d.a(), "상대가 나갔습니다"); continue; }
            if (now > d.endAt()) { end(d, null, "시간 초과"); continue; }
            if (a.getWorld() != b.getWorld() || a.getLocation().distance(b.getLocation()) > cfg.get("range").getAsDouble() / 16) end(d, null, "너무 멀어졌습니다");
        }
    }
}
