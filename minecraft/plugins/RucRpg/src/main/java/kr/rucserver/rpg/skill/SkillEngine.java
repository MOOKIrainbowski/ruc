package kr.rucserver.rpg.skill;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.character.RpgChar;
import kr.rucserver.rpg.engine.Combat;
import kr.rucserver.rpg.engine.EffectDefs;
import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.engine.Unit;
import kr.rucserver.rpg.mob.MobUnit;
import kr.rucserver.rpg.world.Projectiles;
import kr.rucserver.rpg.world.RpgWorld;
import kr.rucserver.rpg.world.Telegraph;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.event.player.PlayerToggleFlightEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.Vector;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 스킬 엔진 (웹 RUC_RPG/server/src/skills.ts): 검증(쿨 · 자원 · 상태 · 대상) → 움직임(돌진 · 순간이동 · 경직) → 발동(즉시 · 시전 · 반복 · 지연 · 보조).
 * 판정 8가지 melee · skillshot · dash · ally · self · target · ground · blink 를 같은 수치(px)로.
 *
 * 조작 (사용자 결정 Q1): 좌클릭 = 평타(A) · Q = Q · 웅크리고 Q = W(C 칸) · F = E · 웅크리고 우클릭 = R(궁극기) · 공중에서 Space = 구르기.
 * 조준 = 바라보는 방향, 지면 · 대상 스킬은 바라보는 블록 · 시선 가까운 적(웹의 커서 24px ↔ 시선에서 24px).
 */
public final class SkillEngine implements Listener {

    /** 시전 한 번 (웹 Shot) */
    static final class Shot {
        final PlayerUnit p;
        final JsonObject sk;
        final String id;
        final SkillDefs.Nums n;
        final double mul;
        final int tid;
        final int rep;
        /** 숙련도를 받을 스킬 (보조 스킬은 부모) */
        final String mid;
        final Set<Integer> hit;

        Shot(PlayerUnit p, String id, JsonObject sk, SkillDefs.Nums n, double mul, int tid, int rep, String mid, Set<Integer> hit) {
            this.p = p; this.id = id; this.sk = sk; this.n = n; this.mul = mul; this.tid = tid; this.rep = rep; this.mid = mid; this.hit = hit;
        }

        Shot rep(int i) { return new Shot(p, id, sk, n, mul, tid, i, mid, hit); }
    }

    private final RucRpg plugin;
    private final RpgWorld w;
    private final Combat c;
    private final SkillDefs defs;
    private final Progression prog;
    private final Projectiles shots;
    private final SkillVfx vfx;
    private final JsonObject jobs, awaken, spiritBuff, roll, staminaT;

    public SkillEngine(RucRpg plugin, RpgWorld w, Combat c, SkillDefs defs, Progression prog, Projectiles shots) {
        this.plugin = plugin;
        this.w = w;
        this.c = c;
        this.defs = defs;
        this.prog = prog;
        this.shots = shots;
        this.vfx = new SkillVfx(plugin);
        jobs = plugin.data().file("jobs").getAsJsonObject("JOBS");
        awaken = plugin.data().file("jobs").getAsJsonObject("AWAKEN");
        spiritBuff = plugin.data().file("jobs").getAsJsonObject("SPIRIT_BUFF");
        roll = plugin.data().file("stats").getAsJsonObject("ROLL");
        staminaT = plugin.data().file("stats").getAsJsonObject("STAMINA");
    }

    public SkillVfx vfx() { return vfx; }

    // ── 평타 (무기) ─────────────────────────────────────────────────

    /** 들고 있는 것 → 평타 스킬 (웹 basicOf). M4 에서 RPG 무기 템플릿의 basic 으로 바뀜 */
    public String basicOf(Player p) {
        String tpl = plugin.items() == null ? null : plugin.items().basicOf(p.getInventory().getItemInMainHand());
        if (tpl != null) return tpl;
        Material m = p.getInventory().getItemInMainHand().getType();
        String n = m.name();
        if (n.endsWith("_SWORD") || n.endsWith("_AXE") || m == Material.TRIDENT || m == Material.MACE) return "slash";
        if (m == Material.BOW || m == Material.CROSSBOW) return "shot";
        if (m == Material.STICK || m == Material.BLAZE_ROD || m == Material.BREEZE_ROD) return "bolt";
        return "punch";
    }

    /** Q · F 키가 스킬로 쓰이는 "무기"를 들고 있나 (무기가 아니면 Q 는 원래대로 버리기) */
    public boolean holdsWeapon(Player p) {
        ItemStack it = p.getInventory().getItemInMainHand();
        if (plugin.items() != null && plugin.items().isWeapon(it)) return true;
        return !"punch".equals(basicOf(p));
    }

    // ── 시전 ────────────────────────────────────────────────────────

    /** 조준점(px): 지면 · 대상형은 바라보는 블록(사거리 안), 아니면 바라보는 방향으로 사거리만큼 */
    private double[] aim(Player pl, double rangePx) {
        Location eye = pl.getEyeLocation();
        Vector dir = eye.getDirection();
        double rangeB = rangePx / RpgWorld.PX;
        var hit = pl.getWorld().rayTraceBlocks(eye, dir, rangeB + 2);
        Vector flat = dir.clone().setY(0);
        if (flat.lengthSquared() < 1e-6) flat = new Vector(-Math.sin(Math.toRadians(eye.getYaw())), 0, Math.cos(Math.toRadians(eye.getYaw())));
        flat.normalize();
        if (hit != null) {
            Vector v = hit.getHitPosition();
            return new double[]{v.getX() * RpgWorld.PX, v.getZ() * RpgWorld.PX, 1};
        }
        Location at = pl.getLocation().add(flat.multiply(rangeB));
        return new double[]{at.getX() * RpgWorld.PX, at.getZ() * RpgWorld.PX, 0};
    }

    /** 시선 근처(24px) · 사거리 안의 적 — 웹 enemyNear 의 "커서 근처" */
    private Unit lookTarget(PlayerUnit p, double range, boolean foes, boolean dead) {
        Location eye = p.player.getEyeLocation();
        Vector o = eye.toVector(), d = eye.getDirection();
        Unit best = null;
        double bd = Double.MAX_VALUE;
        for (Unit u : w.all()) {
            if (u == p || (u.dead && !dead) || (!u.dead && dead)) continue;
            if (foes != w.hostile(p, u)) continue;
            if (Math.hypot(u.x - p.x, u.y - p.y) > range + u.r + 8) continue;
            var ent = w.entityOf(u);
            if (ent == null) continue;
            Vector c = ent.getLocation().toVector().add(new Vector(0, ent.getHeight() * 0.5, 0));
            double t = c.clone().subtract(o).dot(d);
            if (t < 0) continue;
            double perp = c.clone().subtract(o.clone().add(d.clone().multiply(t))).length() * RpgWorld.PX;
            if (perp <= 24 + u.r && perp < bd) { bd = perp; best = u; }
        }
        return best;
    }

    /** 시전. 실패하면 이유(HUD 토스트), 성공하면 null */
    public String cast(PlayerUnit p, String slot) {
        RpgChar ch = p.ch;
        String id = "A".equals(slot) ? basicOf(p.player) : Progression.slotSkill(ch, slot);
        JsonObject sk = defs.get(id);
        if (sk == null) return "R".equals(slot) ? "궁극기는 1차 전직(Lv10) 후 열립니다" : "스킬이 없는 슬롯입니다";
        if (p.dead) return "쓰러진 상태입니다";
        if (plugin.safeZones().contains(p.player.getLocation())) return "광장은 안전지대라 공격 · 스킬을 쓸 수 없습니다";
        if ("A".equals(slot) ? p.blockAtk : p.blockSkill) return "지금은 쓸 수 없습니다";
        long now = w.now();
        if (now < p.lockUntil || now < p.dashUntil) return "다른 동작 중입니다";
        RpgChar.Learned l = Progression.learned(ch, id);
        SkillDefs.Nums n = defs.nums(sk, l == null ? "low" : l.grade(), l == null ? 1 : l.lv(), "A".equals(slot) ? 0 : p.st.get("cdr"));
        double cdMs = n.cooldownMs(), gradeMul = n.gradeMul(), power = n.power();
        if (SkillDefs.has(sk, "summon") && "engineer".equals(p.job)) cdMs *= plugin.data().get("pets.ENGINEER.cd").getAsDouble();
        if (ch.awake && "R".equals(sk.get("slot").getAsString()) && ch.job != null && SkillDefs.forJob(sk, ch.job)) {   // 3차 각성
            gradeMul *= awaken.get("ultPower").getAsDouble();
            power *= awaken.get("ultPower").getAsDouble();
            cdMs *= awaken.get("ultCd").getAsDouble();
        }
        n = new SkillDefs.Nums(power, gradeMul, n.lv(), n.fx(), n.range(), n.radius(), n.stamina(), n.mana(), n.energy(), cdMs);
        if (now < p.cd.getOrDefault(id, 0L) - 1) return "재사용 대기 중입니다";
        boolean free = p.gmNoCost;
        if (!free && p.mp < n.mana()) return "마나가 부족합니다";
        if (!free && p.en < n.energy()) return "기력이 부족합니다";
        RpgWorld.place(p, p.player.getLocation());
        String targeting = sk.get("targeting").getAsString();
        double[] a = aim(p.player, n.range());
        int tid = p.id;
        double[] to = null;
        if (targeting.equals("target")) {
            Unit t = lookTarget(p, n.range(), true, false);
            if (t == null) return "대상이 없습니다";
            tid = t.id;
            if (SkillDefs.bool(sk, "blinkTo")) to = behind(p, t);
        } else if (targeting.equals("ally")) {
            Unit t = lookTarget(p, n.range(), false, SkillDefs.has(sk, "revive"));
            if (t == null) t = p;
            tid = t.id;
            to = new double[]{t.x, t.y};
        }
        double mul = 1;
        if (SkillDefs.has(sk, "charge")) mul = SkillDefs.num(sk.getAsJsonObject("charge"), "mul", 1);   // 마크: 키를 누르고 있을 수 없음 → 시전 시간 동안 모아 최대 배율 (계획서 5장)
        if (!free) {
            p.mp -= n.mana();
            p.en -= n.energy();
        }
        if (SkillDefs.has(sk, "throw") && "thrower".equals(p.job)) {   // 투척수 「손재주」: 2회 충전
            long full = Math.max(now, p.cd.getOrDefault(id + "+", 0L)) + (long) n.cooldownMs();
            p.cd.put(id + "+", full);
            p.cd.put(id, Math.max(now, full - (long) n.cooldownMs()));
        } else p.cd.put(id, now + (long) ("A".equals(slot) ? c.formulas().castMs(sk.get("cooldownMs").getAsDouble(), p.st.get("atkSpeed")) : n.cooldownMs()));
        double sx = p.x, sy = p.y;
        castMove(p, sk, n, a[0], a[1], to);
        if (!"A".equals(slot)) prog.gain(p, id, prog.masteryOf("use"), null);
        Shot s = new Shot(p, id, sk, n, mul, tid, 0, id, new HashSet<>());
        long castT = (long) ((SkillDefs.num(sk, "castMs", 0) > 0 ? c.formulas().castMs(sk.get("castMs").getAsDouble(), p.st.get("atkSpeed")) : 0)
                + SkillDefs.num(sk, "delayMs", 0));
        if (SkillDefs.has(sk, "charge")) castT += (long) SkillDefs.num(sk.getAsJsonObject("charge"), "ms", 0);
        final long delay = castT;
        vfx.cast(p, sk, delay, a);
        if (targeting.equals("ground") && SkillDefs.has(sk, "delayMs")) {
            double[] g = groundAt(n, sx, sy, a[0], a[1]);
            Telegraph.circle(plugin, p.player.getWorld(), g[0], g[1], p.player.getLocation().getY(), n.radius(), delay);
        }
        int reps = sk.has("repeat") ? sk.getAsJsonObject("repeat").get("n").getAsInt() : 1;
        long every = sk.has("repeat") ? sk.getAsJsonObject("repeat").get("ms").getAsLong() : 0;
        for (int i = 0; i < reps; i++) {
            Shot r = s.rep(i);
            long at = delay + i * every;
            if (at <= 0) fire(r, sx, sy, a[0], a[1]);
            else w.later(at, () -> { if (!p.dead && p.player.isOnline()) fire(r, sx, sy, a[0], a[1]); });
        }
        if (sk.has("after")) {
            JsonObject af = sk.getAsJsonObject("after");
            String aid = af.get("skill").getAsString();
            JsonObject ask = defs.get(aid);
            SkillDefs.Nums an = defs.nums(ask, l == null ? "low" : l.grade(), l == null ? 1 : l.lv(), 0);
            Shot as = new Shot(p, aid, ask, an, 1, tid, 0, id, s.hit);
            w.later(af.get("ms").getAsLong(), () -> { if (!p.dead && p.player.isOnline()) fire(as, sx, sy, a[0], a[1]); });
        }
        return null;
    }

    /** 대상 뒤 (시전자 반대편) — 막혀 있으면 대상 옆 */
    private double[] behind(PlayerUnit p, Unit t) {
        double dx = t.x - p.x, dy = t.y - p.y, len = Math.max(1, Math.hypot(dx, dy));
        return blinkDest(p, t.x, t.y, t.x + dx / len * (t.r + 12), t.y + dy / len * (t.r + 12), t.r + 12);
    }

    /** 순간이동 도착점: 조준 쪽 range 안, 막힌 곳이면 4px 씩 당겨 옴 (movement.ts blinkDest) */
    private double[] blinkDest(PlayerUnit p, double x, double y, double ax, double ay, double range) {
        double dx = ax - x, dy = ay - y, len = Math.hypot(dx, dy);
        if (len == 0) return new double[]{x, y};
        double baseY = p.player.getLocation().getY();
        for (double t = Math.min(len, range); t > 0; t -= 4) {
            double nx = x + dx / len * t, ny = y + dy / len * t;
            if (standable(p.player.getWorld(), nx / RpgWorld.PX, baseY, ny / RpgWorld.PX) != null) return new double[]{nx, ny};
        }
        return new double[]{x, y};
    }

    private static Location standable(org.bukkit.World world, double x, double baseY, double z) {
        for (int dy = 2; dy >= -3; dy--) {
            Location l = new Location(world, x, Math.floor(baseY) + dy, z);
            if (!l.getBlock().isPassable() && l.clone().add(0, 1, 0).getBlock().isPassable() && l.clone().add(0, 2, 0).getBlock().isPassable())
                return l.add(0, 1, 0);
        }
        return null;
    }

    /** 움직임 쪽 효과 (movement.ts castMove): 스태미나 · 경직 · 돌진 · 순간이동 */
    private void castMove(PlayerUnit p, JsonObject sk, SkillDefs.Nums n, double ax, double ay, double[] to) {
        p.spend(n.stamina());
        long now = w.now();
        double castMs = SkillDefs.num(sk, "castMs", 0) > 0 ? c.formulas().castMs(sk.get("castMs").getAsDouble(), p.st.get("atkSpeed")) : 0;
        if (SkillDefs.has(sk, "charge")) castMs += SkillDefs.num(sk.getAsJsonObject("charge"), "ms", 0);
        p.lockUntil = now + (long) Math.max(castMs, SkillDefs.num(sk, "lockMs", 0));
        String tg = sk.get("targeting").getAsString();
        if (SkillDefs.has(sk, "dashSteps") && (tg.equals("dash") || tg.equals("ally"))) {
            double tx = (to != null ? to[0] : ax) - p.x, ty = (to != null ? to[1] : ay) - p.y, len = Math.hypot(tx, ty);
            double ux = len > 0 ? tx / len : -Math.sin(Math.toRadians(p.player.getLocation().getYaw()));
            double uy = len > 0 ? ty / len : Math.cos(Math.toRadians(p.player.getLocation().getYaw()));
            if (SkillDefs.bool(sk, "back")) { ux = -ux; uy = -uy; }
            double dist = tg.equals("ally") ? Math.max(0, Math.min(n.range(), len - 12)) : n.range();
            long ms = (long) (sk.get("dashSteps").getAsInt() * 1000.0 / 60);
            dash(p, ux, uy, dist, ms);
        }
        if (tg.equals("blink")) {
            double[] d = blinkDest(p, p.x, p.y, ax, ay, n.range());
            teleportPx(p, d[0], d[1]);
        }
        if (SkillDefs.bool(sk, "blinkTo") && to != null) teleportPx(p, to[0], to[1]);
    }

    private void teleportPx(PlayerUnit p, double x, double y) {
        Location now = p.player.getLocation();
        Location dst = standable(p.player.getWorld(), x / RpgWorld.PX, now.getY(), y / RpgWorld.PX);
        if (dst == null) return;
        dst.setYaw(now.getYaw());
        dst.setPitch(now.getPitch());
        vfx.blink(now, dst);
        p.player.teleport(dst);
        RpgWorld.place(p, dst);
    }

    /** 돌진: distPx 를 ms 동안 — 매 틱 속도를 줘서 미끄러지듯 (블록은 바닐라 충돌) */
    public void dash(PlayerUnit p, double ux, double uy, double distPx, long ms) {
        int ticks = (int) Math.max(1, Math.round(ms / 50.0));
        double per = distPx / RpgWorld.PX / ticks;
        p.dashUntil = w.now() + ms;
        for (int i = 0; i < ticks; i++)
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                if (!p.player.isOnline() || p.dead) return;
                Vector v = new Vector(ux * per, Math.min(p.player.getVelocity().getY(), 0.05), uy * per);
                p.player.setVelocity(v);
                vfx.trail(p.player.getLocation());
            }, i);
    }

    /** 지면 스킬 중심: 조준점, 사거리 밖이면 사거리 끝 */
    private static double[] groundAt(SkillDefs.Nums n, double sx, double sy, double ax, double ay) {
        double dx = ax - sx, dy = ay - sy, len = Math.hypot(dx, dy), k = len > n.range() ? n.range() / len : 1;
        return new double[]{sx + dx * k, sy + dy * k};
    }

    // ── 발동 ────────────────────────────────────────────────────────

    /** 시전 속성: 고정 → 보조(원소술사) → 주 속성. alternate 는 반복마다 주 · 보조 번갈아 */
    private String elementOf(Shot s) {
        String el = SkillDefs.str(s.sk, "el");
        if (el != null) return el;
        if (SkillDefs.bool(s.sk, "sub") || ("alternate".equals(SkillDefs.str(s.sk, "special")) && s.rep % 2 == 1)) return s.p.ch.sub != null ? s.p.ch.sub : s.p.el;
        return SkillDefs.bool(s.sk, "elementInherit") ? s.p.el : null;
    }

    private static List<Combat.FxSpec> scaleFx(JsonObject sk, String key, double mul) {
        List<Combat.FxSpec> out = new ArrayList<>();
        if (!sk.has(key)) return out;
        for (JsonElement e : sk.getAsJsonArray(key)) {
            Combat.FxSpec f = Combat.FxSpec.of(e.getAsJsonObject());
            out.add(new Combat.FxSpec(f.id(), f.ms(), f.v() != null ? f.v() * mul : null, f.dot(), f.chance()));
        }
        return out;
    }

    private Combat.HitSpec specOf(Shot s) {
        JsonObject sk = s.sk;
        String el = elementOf(s);
        JsonObject d = sk.has("damage") ? sk.getAsJsonObject("damage") : null;
        double base = d == null ? 0 : d.get("base").getAsDouble(), atk = d == null ? 0 : d.get("atkRatio").getAsDouble(), ap = d == null ? 0 : d.get("apRatio").getAsDouble();
        String cat = sk.get("category").getAsString();
        boolean proc = el != null;
        boolean basic = "A".equals(sk.get("slot").getAsString());
        String job = s.p.ch.job;
        if (basic && job != null && jobs.has(job) && "magic".equals(SkillDefs.str(jobs.getAsJsonObject(job), "kind"))) {   // 마법형 평타 = 주문력 (D80)
            ap = atk + ap;
            atk = 0;
            cat = "magical";
            if ("magic_archer".equals(job)) { el = s.p.el; proc = c.rand() < 0.3; }
        }
        String tg = sk.get("targeting").getAsString();
        Combat.HitSpec h = new Combat.HitSpec();
        h.base = base; h.atkRatio = atk; h.apRatio = ap; h.cat = cat; h.el = el;
        h.gradeMul = s.n.gradeMul(); h.skillLv = s.n.lv(); h.skill = !basic;
        h.melee = tg.equals("melee") || tg.equals("dash") || (tg.equals("self") && SkillDefs.num(sk, "radius", 0) <= 72);
        h.threat = SkillDefs.num(sk, "threat", 1); h.proc = proc; h.fx = scaleFx(sk, "effects", s.n.fx()); h.basic = basic;
        h.crit = SkillDefs.num(sk, "crit", 0); h.execute = SkillDefs.num(sk, "execute", 0); h.mul = s.mul;
        h.ranged = tg.equals("skillshot") && cat.equals("physical"); h.reach = s.n.range();
        return h;
    }

    /** 디버프 해제 · 주술사 「조상의 가호」 */
    private void cleanse(Unit src, Unit a) {
        List<String> bad = new ArrayList<>();
        for (Unit.Effect e : a.fx) { EffectDefs.Def d = c.defs().get(e.id); if (d != null && !d.buff()) bad.add(e.id); }
        for (String id : bad) c.removeEffect(w, a, id);
        if (!bad.isEmpty() && "shaman".equals(src.job)) c.addEffect(w, a, Combat.FxSpec.of("shield", 1500, Formulas.jsRound(a.st.get("hp") * 0.08)), src);
    }

    /** 적 한 명에게: 피해 → 효과 · 넉백 · 숙련도 */
    private void strike(Shot s, Unit t, double fx, double fy) {
        if (t.dead) return;
        Combat.HitSpec spec = specOf(s);
        if (s.sk.has("damage")) {
            c.hit(w, s.p, t, spec);
            credit(s, t);
        } else {
            for (Combat.FxSpec f : spec.fx) c.addEffect(w, t, f, s.p);
            w.damaged(s.p, t, 0, SkillDefs.num(s.sk, "threat", 1), null);
            if (t instanceof MobUnit) credit(s, t);
        }
        if (s.sk.has("knock") && !t.dead) {
            double dx = t.x - fx, dy = t.y - fy, len = Math.max(1, Math.hypot(dx, dy)), k = s.sk.get("knock").getAsDouble();
            w.push(t, dx / len * k, dy / len * k);
        }
    }

    /** 숙련도 적중 · 도움 +2 (시전 한 번에 대상당 한 번, 몹 등급 배율) */
    private void credit(Shot s, Unit t) {
        if ("A".equals(s.sk.get("slot").getAsString()) || s.hit.contains(t.id)) return;
        s.hit.add(t.id);
        boolean mob = t instanceof MobUnit;
        prog.gain(s.p, s.mid, prog.masteryOf(mob ? "hit" : "support"), mob ? ((MobUnit) t).grade : null);
    }

    /** 아군 한 명에게: 치유 · 보호막 · 버프 · 정화 (부활은 M7 쓰러짐 상태와 같이) */
    private void support(Shot s, Unit a) {
        JsonObject sk = s.sk;
        PlayerUnit p = s.p;
        if (a.dead) return;
        if (sk.has("heal")) {
            JsonObject h = sk.getAsJsonObject("heal");
            double total = (h.get("base").getAsDouble() + p.st.get("ap") * h.get("apRatio").getAsDouble() + a.st.get("hp") * h.get("hpPct").getAsDouble()) * s.n.power();
            if (h.has("ms")) {
                double ticks = h.get("ms").getAsDouble() / 500;
                c.addEffect(w, a, new Combat.FxSpec("regen_hp", h.get("ms").getAsDouble(), null, c.healPerTick(total / ticks, p, a), null), p);
            } else c.applyHeal(w, p, a, c.healPerTick(total, p, a), true);
            vfx.heal(w.entityOf(a));
        }
        if (sk.has("shield")) {
            JsonObject sh = sk.getAsJsonObject("shield");
            double v = Formulas.jsRound((sh.get("base").getAsDouble() + p.st.get("ap") * sh.get("apRatio").getAsDouble() + a.st.get("hp") * sh.get("hpPct").getAsDouble()) * s.n.power() * (1 + p.st.get("healPower")));
            c.addEffect(w, a, Combat.FxSpec.of("shield", sh.get("ms").getAsDouble(), v), p);
            vfx.shield(w.entityOf(a));
        }
        for (Combat.FxSpec f : scaleFx(sk, "allyFx", s.n.fx())) c.addEffect(w, a, f, p);
        if (SkillDefs.bool(sk, "cleanse")) cleanse(p, a);
        if ("spiritcaller".equals(p.job) && (sk.has("allyFx") || sk.has("heal") || sk.has("shield")) && spiritBuff.has(p.el)) {
            JsonObject sb = spiritBuff.getAsJsonObject(p.el);
            Double dot = sb.has("dot") ? c.healPerTick(sb.get("dot").getAsDouble() + p.st.get("ap") * 0.05, p, a) : null;
            c.addEffect(w, a, new Combat.FxSpec(sb.get("id").getAsString(), sb.get("ms").getAsDouble(), sb.has("v") ? sb.get("v").getAsDouble() : null, dot, null), p);
        }
        credit(s, a);
    }

    private List<Unit> allies(PlayerUnit p, double x, double y, double r) {
        List<Unit> out = new ArrayList<>();
        for (Unit u : w.around(x, y, r, "p")) if (u == p || !w.hostile(p, u)) out.add(u);
        if (!out.contains(p) && !p.dead) out.add(0, p);
        return out;
    }

    private List<Unit> foes(PlayerUnit p) {
        List<Unit> out = new ArrayList<>();
        for (Unit u : w.all()) if (!u.dead && w.hostile(p, u)) out.add(u);
        return out;
    }

    /** 발동 (skills.ts fire). sx · sy = 시전 시작 위치, ax · ay = 조준 */
    void fire(Shot s, double sx, double sy, double ax, double ay) {
        PlayerUnit p = s.p;
        JsonObject sk = s.sk;
        RpgWorld.place(p, p.player.getLocation());
        double dx = ax - sx, dy = ay - sy, len = Math.hypot(dx, dy);
        if (len == 0) { len = 1; dx = -Math.sin(Math.toRadians(p.player.getLocation().getYaw())); dy = Math.cos(Math.toRadians(p.player.getLocation().getYaw())); }
        double ux = dx / len, uy = dy / len;
        boolean ult = "R".equals(sk.get("slot").getAsString());
        String el = elementOf(s);
        switch (sk.get("targeting").getAsString()) {
            case "skillshot" -> {
                int count = (int) SkillDefs.num(sk, "count", 1);
                double base = Math.atan2(dy, dx), spread = SkillDefs.num(sk, "spread", 0);
                for (int i = 0; i < count; i++) {
                    double a = base + (i - (count - 1) / 2.0) * spread * Math.PI / 180;
                    Projectiles.Shot ps = new Projectiles.Shot(p, p.player.getWorld(), p.x, p.y, p.player.getEyeLocation().getY() - 0.3,
                            Math.cos(a), Math.sin(a), sk.get("speed").getAsDouble() * (1 + p.st.get("projSpeed")), s.n.range(),
                            SkillDefs.num(sk, "width", 4), specOf(s), (int) SkillDefs.num(sk, "pierce", 0), (int) SkillDefs.num(sk, "bounce", 0), vfx.color(el), ult);
                    ps.onHit = (shot, u) -> credit(s, u);
                    shots.fire(ps);
                }
            }
            case "melee" -> {
                double cosHalf = Math.cos(SkillDefs.num(sk, "arc", 90) / 2 * Math.PI / 180);
                for (Unit m : foes(p)) {
                    double d = Math.hypot(m.x - p.x, m.y - p.y);
                    if (d > s.n.range() + m.r) continue;
                    if (d > m.r && ((m.x - p.x) * ux + (m.y - p.y) * uy) / d < cosHalf) continue;
                    strike(s, m, p.x, p.y);
                }
                vfx.swing(p.player, s.n.range(), SkillDefs.num(sk, "arc", 90), el, "A".equals(sk.get("slot").getAsString()));
            }
            case "dash" -> {
                if (!sk.has("damage") || !sk.has("width")) break;
                double vx = SkillDefs.bool(sk, "back") ? -ux : ux, vy = SkillDefs.bool(sk, "back") ? -uy : uy, width = sk.get("width").getAsDouble();
                for (Unit m : foes(p)) {
                    double t = Math.max(0, Math.min(s.n.range(), (m.x - sx) * vx + (m.y - sy) * vy));
                    if (Math.hypot(sx + vx * t - m.x, sy + vy * t - m.y) <= width / 2 + m.r) strike(s, m, sx, sy);
                }
            }
            case "self", "blink" -> {
                double r = s.n.radius();
                if (r > 0) for (Unit m : foes(p)) if (Math.hypot(m.x - p.x, m.y - p.y) <= r + m.r) strike(s, m, p.x, p.y);
                if (sk.has("allyFx") || sk.has("heal") || sk.has("shield") || SkillDefs.bool(sk, "cleanse"))
                    for (Unit a : allies(p, p.x, p.y, r)) support(s, a);
                if (r > 0 || sk.has("damage")) vfx.burst(p.player.getWorld(), p.x, p.y, p.player.getLocation().getY(), r, el, ult, p);
            }
            case "target" -> {
                Unit t = w.unit(s.tid);
                if (t != null && !t.dead) {
                    strike(s, t, p.x, p.y);
                    var e = w.entityOf(t);
                    if (e != null) vfx.burst(e.getWorld(), t.x, t.y, e.getLocation().getY(), Math.max(16, t.r * 2), el, ult, p);
                }
            }
            case "ally" -> {
                Unit a = w.unit(s.tid);
                if (a == null) a = p;
                support(s, a);
                if (sk.has("radius")) for (Unit o : allies(p, p.x, p.y, s.n.radius())) if (o != a) support(s, o);
            }
            case "ground" -> {
                double[] g = groundAt(s.n, sx, sy, ax, ay);
                for (Unit m : foes(p)) if (Math.hypot(m.x - g[0], m.y - g[1]) <= s.n.radius() + m.r) strike(s, m, g[0], g[1]);
                if (sk.has("heal") || sk.has("allyFx"))
                    for (Unit a : allies(p, g[0], g[1], s.n.radius())) if (a != p || Math.hypot(p.x - g[0], p.y - g[1]) <= s.n.radius()) support(s, a);
                vfx.burst(p.player.getWorld(), g[0], g[1], p.player.getLocation().getY(), s.n.radius(), sk.has("heal") ? "heal" : el, ult, p);
            }
            default -> {}
        }
        if (s.rep == 0) {
            for (Combat.FxSpec f : scaleFx(sk, "selfFx", s.n.fx())) c.addEffect(w, p, f, p);
            if (sk.has("selfFx")) credit(s, p);
            if (sk.has("summon")) p.player.sendMessage(net.kyori.adventure.text.Component.text("소환수는 다음 단계(M8)에서 나옵니다.", net.kyori.adventure.text.format.NamedTextColor.GRAY));
            // special "wall" = 적 투사체를 막는 벽 — 몹 투사체 판정에 벽 목록을 넣는 것은 M7 (던전)과 같이
        }
    }

    // ── 입력 ────────────────────────────────────────────────────────

    private void tryCast(Player pl, String slot) {
        PlayerUnit p = plugin.runtime().unit(pl);
        if (p == null) return;
        String err = cast(p, slot);
        if (err != null && !"A".equals(slot)) plugin.hud().toast(pl, err);
    }

    /** Q · 웅크리고 Q (무기를 든 경우만 — 무기는 버려지지 않음) */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDrop(PlayerDropItemEvent e) {
        Player pl = e.getPlayer();
        if (plugin.runtime().unit(pl) == null || pl.getGameMode() == GameMode.SPECTATOR) return;
        ItemStack it = e.getItemDrop().getItemStack();
        if (!(plugin.items() != null && plugin.items().isWeapon(it)) && "punch".equals(basicFor(it))) return;
        e.setCancelled(true);
        tryCast(pl, pl.isSneaking() ? "W" : "Q");
    }

    private String basicFor(ItemStack it) {
        Material m = it.getType();
        String n = m.name();
        if (n.endsWith("_SWORD") || n.endsWith("_AXE") || m == Material.TRIDENT || m == Material.MACE) return "slash";
        if (m == Material.BOW || m == Material.CROSSBOW) return "shot";
        if (m == Material.STICK || m == Material.BLAZE_ROD || m == Material.BREEZE_ROD) return "bolt";
        return "punch";
    }

    /** F (웅크린 F 는 RucCore 메뉴) */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onSwap(PlayerSwapHandItemsEvent e) {
        Player pl = e.getPlayer();
        if (pl.isSneaking() || plugin.runtime().unit(pl) == null) return;
        e.setCancelled(true);
        tryCast(pl, "E");
    }

    /** 좌클릭 = 평타 · 웅크리고 우클릭(무기) = 궁극기 */
    @EventHandler(priority = EventPriority.HIGH)
    public void onInteract(PlayerInteractEvent e) {
        Player pl = e.getPlayer();
        if (e.getHand() != EquipmentSlot.HAND || plugin.runtime().unit(pl) == null) return;
        Action a = e.getAction();
        if ((a == Action.LEFT_CLICK_AIR || a == Action.LEFT_CLICK_BLOCK) && pl.getGameMode() != GameMode.CREATIVE) {
            tryCast(pl, "A");
            return;
        }
        if ((a == Action.RIGHT_CLICK_AIR || a == Action.RIGHT_CLICK_BLOCK) && pl.isSneaking() && holdsWeapon(pl)) {
            e.setCancelled(true);
            tryCast(pl, "R");
        }
    }

    /** 몹을 직접 때린 좌클릭 (MobRuntime 이 바닐라 피해를 취소한 뒤 부름) */
    public void basicFromHit(Player pl) { tryCast(pl, "A"); }

    // ── 구르기 (더블 점프) ───────────────────────────────────────────

    /** 땅에 있으면 비행 허용을 켜 둠 → 공중에서 Space = PlayerToggleFlightEvent (서버 이벤트) */
    @EventHandler(ignoreCancelled = true)
    public void onMove(PlayerMoveEvent e) {
        Player pl = e.getPlayer();
        if (pl.getGameMode() != GameMode.SURVIVAL && pl.getGameMode() != GameMode.ADVENTURE) return;
        PlayerUnit p = plugin.runtime().unit(pl);
        if (p == null) return;
        if (((org.bukkit.entity.Entity) pl).isOnGround() && !pl.getAllowFlight()) pl.setAllowFlight(true);
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onFlight(PlayerToggleFlightEvent e) {
        Player pl = e.getPlayer();
        if (pl.getGameMode() != GameMode.SURVIVAL && pl.getGameMode() != GameMode.ADVENTURE) return;
        PlayerUnit p = plugin.runtime().unit(pl);
        if (p == null) return;
        e.setCancelled(true);
        pl.setAllowFlight(false);
        pl.setFlying(false);
        roll(p);
    }

    /** 구르기 (§5): 0.3초에 56px, 앞 0.2초 무적, 스태미나 20, 끝나고 0.2초 쿨 */
    private void roll(PlayerUnit p) {
        long now = w.now();
        boolean safe = plugin.safeZones().contains(p.player.getLocation());
        if (p.dead || p.blockMove || p.exhausted || (!safe && p.stamina <= 0) || now < p.rollReady || now < p.lockUntil || now < p.dashUntil) return;
        if (!safe) p.spend(staminaT.get("dodge").getAsDouble());
        long ms = (long) (roll.get("steps").getAsInt() * 1000.0 / 60);
        long ifr = (long) (roll.get("iframeSteps").getAsInt() * 1000.0 / 60);
        p.rollReady = now + ms + (long) (roll.get("cdSteps").getAsInt() * 1000.0 / 60);
        Vector look = p.player.getLocation().getDirection().setY(0);
        Vector vel = p.player.getVelocity().setY(0);
        Vector dir = vel.lengthSquared() > 0.001 ? vel.normalize() : look.lengthSquared() > 0.001 ? look.normalize() : new Vector(0, 0, 1);
        p.iframes = true;
        Bukkit.getScheduler().runTaskLater(plugin, () -> p.iframes = false, Math.max(1, ifr / 50));
        dash(p, dir.getX(), dir.getZ(), roll.get("dist").getAsDouble(), ms);
        vfx.roll(p.player);
    }
}
