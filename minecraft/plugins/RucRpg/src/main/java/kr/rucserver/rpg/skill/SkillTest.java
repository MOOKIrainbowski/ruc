package kr.rucserver.rpg.skill;

import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.engine.Unit;
import kr.rucserver.rpg.mob.MobUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 스킬 전수 시험 (docs/13 F7, 사용자 지시 "모든 스킬 … 확인한 후 제대로 다시 구현"): /rpgadmin skilltest [id|all]
 * 스킬마다: 4블록 앞에 움직이지 않는 허수아비 몹 → 그 발밑을 바라보고 시전(자원 · 쿨 무시) → 1.6초 뒤 측정.
 * 기대(정의) vs 결과: 피해(damage) · 대상 효과(effects) · 자기 효과(selfFx) · 회복(heal) · 보호막(shield) · 이동(dash/blink) · 소환(summon).
 * 결과 = plugins/RucRpg/skilltest.tsv (스킬, 판정, 기대, 측정, 오류) + 채팅 요약. 시험 서버 전용(운영에서 쓰지 말 것).
 */
public final class SkillTest {

    private final RucRpg plugin;

    public SkillTest(RucRpg plugin) { this.plugin = plugin; }

    public void run(Player admin, List<String> ids) {
        PlayerUnit u = plugin.runtime().unit(admin);
        if (u == null) return;
        u.gmNoCost = true;
        u.gmInvuln = true;
        Location base = plugin.worlds().spawn("field");
        if (base == null) { admin.sendMessage(Component.text("초원 맵이 없습니다", NamedTextColor.RED)); return; }
        List<String> rows = new ArrayList<>();
        rows.add("id\t이름\t판정\t대상\t기대\t측정\t오류");
        int[] k = {0}, bad = {0};
        Bukkit.getScheduler().runTaskTimer(plugin, task -> {
            if (k[0] >= ids.size() || !admin.isOnline()) {
                task.cancel();
                u.gmNoCost = false;
                u.gmInvuln = false;
                try { Files.write(plugin.getDataFolder().toPath().resolve("skilltest.tsv"), rows, StandardCharsets.UTF_8); } catch (IOException ignored) {}
                admin.sendMessage(Component.text("스킬 시험 끝: " + ids.size() + "개 중 확인 필요 " + bad[0] + "개 → plugins/RucRpg/skilltest.tsv", NamedTextColor.GOLD));
                return;
            }
            String id = ids.get(k[0]++);
            JsonObject sk = plugin.skills().defs().get(id);
            if (sk == null) return;
            // 준비: 자리 · 상태
            Location at = base.clone().add(0, 0, 0);
            at.setYaw(0); at.setPitch(0);
            admin.teleport(at);
            plugin.pets().removeOf(u);
            u.fx.clear();
            plugin.combat().recalc(u);
            u.cd.clear();
            u.lockUntil = 0; u.dashUntil = 0;
            u.hp = u.st.get("hp") * 0.5;   // 회복 측정용
            u.mp = u.st.get("mana"); u.en = u.st.get("energy");
            kr.rucserver.rpg.world.RpgWorld.place(u, admin.getLocation());
            // 둘레의 들판 몹을 치움 — 투사체가 그 몹에 먼저 맞아 허수아비 피해가 0 으로 나오던 것 (2026-11-15 진단)
            Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "execute at " + admin.getName() + " run kill @e[type=!player,type=!item_display,type=!text_display,type=!block_display,type=!mannequin,type=!armor_stand,distance=..30]");
            // 허수아비 = 공격하지 않는 정화 구슬(소환수가 죽지 않게), 거리 = 사거리 · 반경의 60% (1.2~4 블록)
            MobUnit m = plugin.mobs().spawnAt(admin, "purify_orb", 60, "high");
            if (m == null || m.body == null) { rows.add(id + "\t\t오류\t\t\t\t허수아비 소환 실패"); bad[0]++; return; }
            m.body.setAI(false);
            Location feet = m.body.getLocation();
            double reachPx = sk.has("radius") && sk.get("targeting").getAsString().equals("self") ? sk.get("radius").getAsDouble() : sk.get("range").getAsDouble();
            double d = Math.max(1.2, Math.min(4, reachPx / 16 * 0.6));
            org.bukkit.util.Vector fwd = feet.toVector().subtract(admin.getLocation().toVector()).setY(0).normalize();
            Location stand = feet.clone().subtract(fwd.clone().multiply(d));
            stand.setY(admin.getLocation().getY());
            admin.teleport(stand);
            Location look = admin.getLocation();
            look.setDirection(feet.toVector().subtract(admin.getEyeLocation().toVector()));
            admin.teleport(look);
            kr.rucserver.rpg.world.RpgWorld.place(u, admin.getLocation());
            double mobHp0 = m.hp, hp0 = u.hp, sh0 = u.shield();
            Set<String> mobFx0 = ids(m), selfFx0 = ids(u);
            Location pos0 = admin.getLocation().clone();
            long pets0 = plugin.pets().countOf(u);
            kr.rucserver.rpg.world.Projectiles.lastEnd = "";
            String err = plugin.skills().castForced(u, id);
            double cast = num(sk, "castMs") + num(sk, "delayMs") + (sk.has("charge") ? num(sk.getAsJsonObject("charge"), "ms") : 0) + (sk.has("dashSteps") ? sk.get("dashSteps").getAsInt() * 1000.0 / 60 : 0);
            double travel = sk.has("speed") ? sk.get("range").getAsDouble() / Math.max(1, sk.get("speed").getAsDouble()) * 1000 : 0;
            long waitTicks = Math.max(24, Math.round((cast + travel + 900) / 50));
            long[] petsSeen = {0};
            Bukkit.getScheduler().runTaskLater(plugin, () -> petsSeen[0] = plugin.pets().countOf(u) - pets0, Math.max(6, Math.round((cast + 300) / 50)));
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                double dmg = mobHp0 - m.hp, heal = u.hp - hp0, shield = u.shield() - sh0, moved = admin.getLocation().distance(pos0);
                Set<String> mobFx = ids(m); mobFx.removeAll(mobFx0);
                Set<String> selfFx = ids(u); selfFx.removeAll(selfFx0);
                long pets = Math.max(petsSeen[0], plugin.pets().countOf(u) - pets0);
                List<String> want = new ArrayList<>(), miss = new ArrayList<>();
                String t = sk.get("targeting").getAsString();
                boolean foe = !t.equals("self") && !t.equals("ally") || sk.has("radius");
                if (sk.has("damage") && foe) { want.add("피해"); if (dmg <= 0) miss.add("피해 0"); }
                if (sk.has("effects") && foe && sk.has("damage")) { want.add("효과"); if (mobFx.isEmpty() && dmg <= 0) miss.add("대상 효과 없음"); }
                if (sk.has("selfFx")) { want.add("자기효과"); if (selfFx.isEmpty()) miss.add("자기 효과 없음"); }
                if (sk.has("heal")) { want.add("회복"); if (heal <= 0 && selfFx.stream().noneMatch(s -> s.startsWith("regen"))) miss.add("회복 0"); }
                if (sk.has("shield")) { want.add("보호막"); if (shield <= 0) miss.add("보호막 0"); }
                if (t.equals("dash") || t.equals("blink")) { want.add("이동"); if (moved < 1) miss.add("이동 없음"); }
                if (sk.has("summon")) { want.add("소환"); if (pets <= 0) miss.add("소환 없음"); }
                String verdict = err != null ? "오류" : miss.isEmpty() ? "정상" : "확인";
                if (!verdict.equals("정상")) bad[0]++;
                rows.add(id + "\t" + sk.get("name").getAsString() + "\t" + verdict + "\t" + t + "\t" + String.join(",", want) + "\t"
                        + String.format("피해 %.0f · 대상효과 %s · 자기효과 %s · 회복 %.0f · 보호막 %.0f · 이동 %.1f · 소환 %d", dmg, mobFx, selfFx, heal, shield, moved, pets)
                        + "\t" + (err != null ? err : String.join(",", miss)) + (kr.rucserver.rpg.world.Projectiles.lastEnd.isEmpty() ? "" : " [투사체: " + kr.rucserver.rpg.world.Projectiles.lastEnd + "]"));
                if (!m.dead) plugin.combat().die(plugin.world(), m, null);
                if (m.body != null && m.body.isValid()) m.body.remove();
            }, waitTicks);
        }, 5L, 110L);
    }

    private static double num(JsonObject o, String k) { return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsDouble() : 0; }

    private static Set<String> ids(Unit u) { return u.fx.stream().map(e -> e.id).collect(Collectors.toCollection(HashSet::new)); }
}
