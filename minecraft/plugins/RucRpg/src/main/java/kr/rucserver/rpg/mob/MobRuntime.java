package kr.rucserver.rpg.mob;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.engine.Combat;
import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.engine.Unit;
import kr.rucserver.rpg.world.Projectiles;
import kr.rucserver.rpg.world.RpgWorld;
import kr.rucserver.rpg.world.Telegraph;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.TextComponent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Husk;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityCombustEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityTargetEvent;
import org.bukkit.persistence.PersistentDataType;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 몹 AI (웹 RUC_RPG/server/src/mobs.ts): 대기 → 순찰 → 추적 → 공격(선딜 · 바닥 경고) → 귀환(리쉬), 위협 수치 · 도발, 보스 타임라인.
 * 몸 = 바닐라 Husk(햇빛에 안 탐) — 바닐라 AI 목표는 다 지우고 길찾기만 빌려 씀(웹보다 나음: 진짜 경로). 크기는 SCALE 로 피격 반지름에 맞춤.
 * 바닐라 피해는 전부 취소하고 RPG 피해만. 3D 모델(사용자 결정 Q3)이 붙으면 몸은 투명해짐.
 */
public final class MobRuntime implements Listener {

    public static final long RESPAWN_MS = 15_000;

    private final RucRpg plugin;
    private final RpgWorld w;
    private final Combat c;
    private final MobDefs defs;
    private final Projectiles shots;
    private final NamespacedKey tag;
    private final Map<java.util.UUID, MobUnit> byEntity = new ConcurrentHashMap<>();
    private final List<MobUnit.Zone> zones = new ArrayList<>();

    public MobRuntime(RucRpg plugin, RpgWorld w, Combat c, MobDefs defs, Projectiles shots) {
        this.plugin = plugin;
        this.w = w;
        this.c = c;
        this.defs = defs;
        this.shots = shots;
        this.tag = new NamespacedKey(plugin, "mob");
        // 지난 실행에서 남은 몹 몸 정리 (persistent=false 라 보통 없음)
        for (org.bukkit.World world : Bukkit.getWorlds())
            for (Entity e : world.getEntities()) if (e.getPersistentDataContainer().has(tag)) e.remove();
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1L, 1L);
    }

    public MobDefs defs() { return defs; }

    public MobUnit of(Entity e) { return e == null ? null : byEntity.get(e.getUniqueId()); }
    public int count() { return byEntity.size(); }

    public MobUnit.Zone addZone(MobUnit.Zone z) { zones.add(z); return z; }

    /** 맵을 지은 뒤: 그 월드 구역을 다시 채움 */
    public void refill(String world) {
        long now = w.now();
        for (MobUnit.Zone z : zones)
            if (z.world.equals(world)) for (int i = z.alive + z.respawn.size(); i < z.count; i++) z.respawn.add(now + 500 + i * 200L);
    }

    // ── 소환 ────────────────────────────────────────────────────────

    public MobUnit spawn(MobUnit.Zone z, org.bukkit.World world) {
        JsonObject def = defs.def(z.mob);
        if (def == null) return null;
        for (int i = 0; i < 12; i++) {
            double a = c.rand() * Math.PI * 2, r = Math.sqrt(c.rand()) * z.r;
            double x = z.x + Math.cos(a) * r, y = z.y + Math.sin(a) * r;
            Location at = ground(world, x / RpgWorld.PX, z.baseY, y / RpgWorld.PX);
            if (at == null) continue;
            int lv = z.lvMin + (int) Math.floor(c.rand() * (z.lvMax - z.lvMin + 1));
            MobUnit m = new MobUnit(z.mob, def, z.grade, z, x, y);
            m.lv = lv;
            m.base = defs.mobStats(def, lv, z.grade);
            c.recalc(m);
            m.hp = m.st.get("hp");
            m.mp = m.st.get("mana");
            m.en = m.st.get("energy");
            m.wait = w.now() + (long) (c.rand() * 3000);
            m.body = world.spawn(at, Husk.class, h -> body(h, m));
            m.plate = world.spawn(at, TextDisplay.class, t -> {
                t.setBillboard(Display.Billboard.CENTER);
                t.setPersistent(false);
                t.setShadowed(true);
                t.setBackgroundColor(Color.fromARGB(90, 0, 0, 0));
                t.setLineWidth(200);
            });
            m.body.addPassenger(m.plate);
            if (plugin.models() != null) m.model = plugin.models().attach(m.key, m.body);
            byEntity.put(m.body.getUniqueId(), m);
            w.add(m);
            z.alive++;
            updatePlate(m);
            return m;
        }
        return null;
    }

    private void body(Husk h, MobUnit m) {
        h.setPersistent(false);
        h.setRemoveWhenFarAway(false);
        h.setSilent(true);
        h.setCanPickupItems(false);
        h.setShouldBurnInDay(false);
        h.setAdult();
        h.getEquipment().clear();
        h.getPersistentDataContainer().set(tag, PersistentDataType.STRING, m.key);
        Bukkit.getMobGoals().removeAllGoals(h);
        AttributeInstance sc = h.getAttribute(Attribute.SCALE);
        if (sc != null) sc.setBaseValue(Math.max(0.35, Math.min(4, (m.r * 2 / RpgWorld.PX) / 0.6)));   // 피격 지름에 맞춤
        AttributeInstance kb = h.getAttribute(Attribute.KNOCKBACK_RESISTANCE);
        if (kb != null) kb.setBaseValue(m.boss() ? 1 : 0.3);
        setSpeed(h, m);
        h.customName(null);
    }

    private void setSpeed(org.bukkit.entity.Mob h, MobUnit m) {
        AttributeInstance ms = h.getAttribute(Attribute.MOVEMENT_SPEED);
        // 이동 속도 100 = 초당 64px = 4블록 ≈ 바닐라 속성 0.093
        if (ms != null) ms.setBaseValue(0.093 * Math.min(m.st.get("moveSpeed"), 200) / 100);
    }

    /** (x, z) 의 서 있을 수 있는 땅 높이 — baseY 근처 위아래 8칸에서 */
    private static Location ground(org.bukkit.World world, double x, double baseY, double z) {
        for (int dy = 12; dy >= -12; dy--) {
            Location l = new Location(world, x, Math.floor(baseY) + dy, z);
            if (!l.getBlock().isPassable() && l.clone().add(0, 1, 0).getBlock().isPassable() && l.clone().add(0, 2, 0).getBlock().isPassable())
                return l.add(0, 1, 0);
        }
        return null;
    }

    private void updatePlate(MobUnit m) {
        if (m.plate == null || !m.plate.isValid()) return;
        if (Math.abs(m.plateHp - m.hp) < 0.5 && m.plateHp >= 0) return;
        m.plateHp = m.hp;
        JsonObject g = defs.grade(m.grade);
        TextColor gc = TextColor.fromHexString(g.get("color").getAsString());
        TextComponent.Builder b = Component.text();
        b.append(Component.text("Lv." + m.lv + " ", NamedTextColor.GRAY));
        if (!"normal".equals(m.grade)) b.append(Component.text("[" + g.get("name").getAsString() + "] ", gc));
        b.append(Component.text(m.name, m.boss() ? TextColor.color(0xFF5A5A) : NamedTextColor.WHITE));
        b.append(Component.newline());
        int cells = m.boss() ? 30 : 20;
        int full = (int) Math.ceil(cells * Math.max(0, m.hp) / m.st.get("hp"));
        b.append(Component.text("|".repeat(full), TextColor.color(0xE5484D)));
        b.append(Component.text("|".repeat(cells - full), TextColor.color(0x3A2A2A)));
        m.plate.text(b.build());
    }

    // ── 틱 ──────────────────────────────────────────────────────────

    private void tick() {
        long now = w.now();
        for (MobUnit.Zone z : zones) {   // 리젠 — 근처(구역 + 80블록)에 플레이어가 있을 때만 (안 그러면 청크가 내려가 몹이 바로 사라짐)
            if (z.respawn.isEmpty()) continue;
            org.bukkit.World world = Bukkit.getWorld(z.world);
            if (world == null || !active(world, z)) continue;
            for (LongCursor it = new LongCursor(z.respawn); it.hasNext(); ) {
                long at = it.next();
                if (now >= at) {
                    it.remove();
                    if (spawn(z, world) == null) z.respawn.add(now + 5000);   // 자리가 없으면 나중에
                }
            }
        }
        for (MobUnit m : new ArrayList<>(byEntity.values())) {
            if (m.dead) {
                if (now >= m.removeAt) despawn(m);
                continue;
            }
            if (m.body == null || !m.body.isValid()) {   // 청크가 내려가 사라짐 → 구역이 다시 채움
                despawn(m);
                m.zone.alive--;
                if (m.zone.count > 0) m.zone.respawn.add(now + 1000);
                continue;
            }
            RpgWorld.place(m, m.body.getLocation());
            c.tickEffects(w, m);
            if (m.dead) continue;
            ai(m, now);
            if (m.model != null) m.model.play(m.moving ? "walk" : "idle");
            updatePlate(m);
        }
    }

    private static boolean active(org.bukkit.World world, MobUnit.Zone z) {
        double cx = z.x / RpgWorld.PX, cz = z.y / RpgWorld.PX, r = z.r / RpgWorld.PX + 80;
        for (Player p : world.getPlayers()) if (Math.hypot(p.getLocation().getX() - cx, p.getLocation().getZ() - cz) <= r) return true;
        return false;
    }

    /** 리스트 위에서 지우기 쉽게 */
    private static final class LongCursor {
        private final List<Long> list; private int i = -1;
        LongCursor(List<Long> l) { list = l; }
        boolean hasNext() { return i + 1 < list.size(); }
        long next() { return list.get(++i); }
        void remove() { list.remove(i--); }
    }

    private void despawn(MobUnit m) {
        if (m.model != null) m.model.remove();
        byEntity.remove(m.body == null ? null : m.body.getUniqueId());
        w.remove(m);
        if (m.plate != null) m.plate.remove();
        if (m.body != null) m.body.remove();
    }

    public void despawnAll() {
        for (MobUnit m : new ArrayList<>(byEntity.values())) despawn(m);
    }

    private static double dist(double ax, double ay, double bx, double by) { return Math.hypot(ax - bx, ay - by); }

    /** 목표 쪽으로 (길찾기). 도착하면 true */
    private boolean moveTo(MobUnit m, double tx, double ty, double mul) {
        if (dist(m.x, m.y, tx, ty) < 6) { m.body.getPathfinder().stopPathfinding(); return true; }
        if (m.blockMove) { m.body.getPathfinder().stopPathfinding(); return false; }
        Location to = new Location(m.body.getWorld(), tx / RpgWorld.PX, m.body.getLocation().getY(), ty / RpgWorld.PX);
        m.body.getPathfinder().moveTo(to, mul);
        m.moving = true;
        return false;
    }

    private void face(MobUnit m, double tx, double ty) {
        Location l = m.body.getLocation();
        l.setYaw((float) Math.toDegrees(Math.atan2(-(tx - m.x), ty - m.y)));
        m.body.setRotation(l.getYaw(), 0);
    }

    private Unit topThreat(MobUnit m, long now) {
        Unit best = null;
        double bv = -1;
        for (java.util.Iterator<Map.Entry<Integer, Double>> it = m.threat.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<Integer, Double> e = it.next();
            Unit p = w.unit(e.getKey());
            if (p == null || p.dead) { it.remove(); continue; }
            if (p.has("stealth") || now < p.icd.getOrDefault("decoy", 0L)) continue;
            if (e.getValue() > bv) { bv = e.getValue(); best = p; }
        }
        return best;
    }

    private void ai(MobUnit m, long now) {
        m.moving = false;
        if (m.passive()) return;
        if (m.blockMove && m.blockAtk) { m.wind = null; m.body.getPathfinder().stopPathfinding(); return; }
        Unit.Effect fear = m.find("fear");
        if (fear != null) {
            Unit s = w.unit(fear.src);
            if (s != null) moveTo(m, m.x * 2 - s.x, m.y * 2 - s.y, 0.6);
            return;
        }
        if (m.state.equals("leash")) {
            if (moveTo(m, m.homeX, m.homeY, 1.6)) {
                m.state = "idle";
                m.evade = false;
                m.hp = m.st.get("hp");
                m.wait = now + 1000;
            }
            return;
        }
        Unit.Effect taunt = m.find("taunt");
        Unit tgt = taunt != null ? w.unit(taunt.src) : topThreat(m, now);
        if (tgt != null && tgt.dead) tgt = null;
        double aggro = m.def.get("aggro").getAsDouble();
        if (tgt == null && aggro > 0) {
            double bd = aggro;
            for (Unit p : w.around(m.x, m.y, aggro, "p")) {
                double d = dist(m.x, m.y, p.x, p.y);
                if (!p.has("stealth") && now >= p.icd.getOrDefault("decoy", 0L) && d < bd && !gmHidden(p)) { bd = d; tgt = p; }
            }
            if (tgt != null) m.threat.put(tgt.id, 1.0);
        }
        if (tgt == null) { m.wind = null; m.tl = null; wander(m, now); return; }
        if (m.boss()) bossTick(m, tgt, now);
        if (dist(m.x, m.y, m.zone.x, m.zone.y) > m.zone.r + m.def.get("leash").getAsDouble()) {
            m.state = "leash";
            m.evade = true;
            m.threat.clear();
            m.dmgBy.clear();
            m.wind = null;
            return;
        }
        if (m.wind != null) {
            if (now >= m.wind.until()) resolve(m);
            return;
        }
        double d = dist(m.x, m.y, tgt.x, tgt.y);
        JsonObject sp = m.def.has("special") ? m.def.getAsJsonObject("special") : null;
        if (sp != null && sp.has("cdMs") && now >= m.spReady && !m.blockAtk && d >= num(sp, "minRange", 0) && d <= num(sp, "maxRange", 1e9)) {
            startWind(m, tgt, true, now);
            return;
        }
        JsonObject a = m.def.getAsJsonObject("attack");
        double reach = a.get("range").getAsDouble() + tgt.r;
        if (d <= reach && now >= m.atkReady && !m.blockAtk) {
            m.swings++;
            boolean every = sp != null && sp.has("every") && m.swings % sp.get("every").getAsInt() == 0;
            startWind(m, tgt, every, now);
            return;
        }
        boolean shot = "shot".equals(a.get("kind").getAsString());
        if (d > (shot ? a.get("range").getAsDouble() * 0.8 : reach * 0.7)) moveTo(m, tgt.x, tgt.y, 1);
        else { m.body.getPathfinder().stopPathfinding(); face(m, tgt.x, tgt.y); }
    }

    private static boolean gmHidden(Unit p) { return p instanceof PlayerUnit pu && pu.player.getGameMode() == org.bukkit.GameMode.SPECTATOR; }

    private static double num(JsonObject o, String k, double d) { return o.has(k) ? o.get(k).getAsDouble() : d; }

    private void wander(MobUnit m, long now) {
        if (m.state.equals("patrol")) {
            boolean done = moveTo(m, m.tx, m.ty, 0.5);
            if (done || now > m.wait) { m.state = "idle"; m.body.getPathfinder().stopPathfinding(); m.wait = now + 2000 + (long) (c.rand() * 3000); }
            return;
        }
        if (now < m.wait) return;
        double a = c.rand() * Math.PI * 2, r = Math.sqrt(c.rand()) * m.zone.r;
        m.tx = m.zone.x + Math.cos(a) * r;
        m.ty = m.zone.y + Math.sin(a) * r;
        m.state = "patrol";
        m.wait = now + 6000;
    }

    private double baseY(MobUnit m) { return m.body.getLocation().getY(); }

    private void startWind(MobUnit m, Unit tgt, boolean special, long now) {
        double ang = Math.atan2(tgt.y - m.y, tgt.x - m.x);
        JsonObject sp = m.def.has("special") ? m.def.getAsJsonObject("special") : null;
        JsonObject a = m.def.getAsJsonObject("attack");
        long ms = special && sp != null ? sp.get("windMs").getAsLong() : a.get("windMs").getAsLong();
        double x = tgt.x, y = tgt.y;
        if (special && sp != null) {
            boolean circle = "circle".equals(sp.get("shape").getAsString());
            x = circle ? m.x + Math.cos(ang) * 14 : m.x;
            y = circle ? m.y + Math.sin(ang) * 14 : m.y;
            if (circle) Telegraph.circle(plugin, m.body.getWorld(), x, y, baseY(m), sp.get("size").getAsDouble(), ms);
            else Telegraph.line(plugin, m.body.getWorld(), x, y, baseY(m), ang, sp.get("size").getAsDouble(), num(sp, "width", 16), ms);
            if (sp.has("cdMs")) m.spReady = now + sp.get("cdMs").getAsLong();
        }
        m.wind = new MobUnit.Wind(now + ms, special, x, y, ang, tgt.id);
        m.body.getPathfinder().stopPathfinding();
        face(m, tgt.x, tgt.y);
        m.atkReady = now + ms + a.get("cdMs").getAsLong();
        m.body.swingMainHand();
        if (m.model != null) m.model.play(special && m.def.has("special") ? "cast" : "attack");
        if (special) m.body.getWorld().playSound(m.body.getLocation(), Sound.ENTITY_RAVAGER_ROAR, 0.5f, 1.6f);
    }

    private Combat.HitSpec baseSpec(MobUnit m, double mul) {
        Combat.HitSpec h = new Combat.HitSpec();
        h.atkRatio = mul;
        h.cat = "physical";
        h.el = m.el;
        h.threat = 0;
        return h;
    }

    private static List<Combat.FxSpec> fxOf(JsonObject o) {
        return o != null && o.has("fx") ? List.of(Combat.FxSpec.of(o.getAsJsonObject("fx"))) : List.of();
    }

    private void resolve(MobUnit m) {
        MobUnit.Wind wd = m.wind;
        m.wind = null;
        JsonObject a = m.def.getAsJsonObject("attack");
        boolean melee = "melee".equals(a.get("kind").getAsString());
        if (!wd.sp()) {
            Unit t = w.unit(wd.tgt());
            if (t == null || t.dead) return;
            Combat.HitSpec h = baseSpec(m, 1);
            h.melee = melee;
            h.basic = true;
            if (!melee) {
                h.cat = "magical";
                h.melee = false;
                Color col = elColor(m.el);
                shots.fire(new Projectiles.Shot(m, m.body.getWorld(), m.x, m.y, m.body.getLocation().getY() + m.body.getHeight() * 0.6,
                        t.x - m.x, t.y - m.y, num(a, "speed", 150), a.get("range").getAsDouble() * 1.3, 5, h, -1, 0, col, false));
            } else if (dist(m.x, m.y, t.x, t.y) <= a.get("range").getAsDouble() + t.r + 6) {
                h.fx = fxOf(a);
                c.hit(w, m, t, h);
            }
            return;
        }
        JsonObject sp = m.def.getAsJsonObject("special");
        Combat.HitSpec h = baseSpec(m, sp.get("mul").getAsDouble());
        h.fx = fxOf(sp);
        if ("circle".equals(sp.get("shape").getAsString())) {
            for (Unit p : w.around(wd.x(), wd.y(), sp.get("size").getAsDouble(), "p")) c.hit(w, m, p, h);
            burst(m, wd.x(), wd.y());
            return;
        }
        double ux = Math.cos(wd.ang()), uy = Math.sin(wd.ang()), sx = m.x, sy = m.y, size = sp.get("size").getAsDouble();
        if (sp.has("lunge") && sp.get("lunge").getAsBoolean()) lunge(m, ux, uy, size);
        for (Unit p : w.around(sx + ux * size / 2, sy + uy * size / 2, size, "p")) {
            double t = Math.max(0, Math.min(size, (p.x - sx) * ux + (p.y - sy) * uy));
            if (Math.hypot(sx + ux * t - p.x, sy + uy * t - p.y) <= num(sp, "width", 16) / 2 + p.r) c.hit(w, m, p, h);
        }
    }

    /** 경고선 끝까지 돌진 (블록에 막히면 멈춤) */
    private void lunge(MobUnit m, double ux, double uy, double sizePx) {
        Location l = m.body.getLocation();
        double step = sizePx / RpgWorld.PX / 10;
        for (int i = 0; i < 10; i++) {
            Location n = l.clone().add(ux * step, 0, uy * step);
            if (!n.getBlock().isPassable() || !n.clone().add(0, 1, 0).getBlock().isPassable()) break;
            l = n;
        }
        m.body.teleport(l);
        m.body.getWorld().spawnParticle(Particle.CLOUD, l, 10, 0.3, 0.1, 0.3, 0.02);
        RpgWorld.place(m, l);
    }

    private void burst(MobUnit m, double x, double y) {
        Location l = new Location(m.body.getWorld(), x / RpgWorld.PX, baseY(m) + 0.2, y / RpgWorld.PX);
        l.getWorld().spawnParticle(Particle.EXPLOSION, l, 1);
        l.getWorld().spawnParticle(Particle.BLOCK, l, 30, 0.6, 0.1, 0.6, 0, l.clone().add(0, -1, 0).getBlock().getBlockData());
        l.getWorld().playSound(l, Sound.ENTITY_GENERIC_EXPLODE, 0.5f, 1.4f);
    }

    private Color elColor(String el) {
        JsonElement c = plugin.data().get("elements.ELEMENTS." + el + ".color");
        return c == null ? Color.WHITE : Color.fromRGB(Integer.parseInt(c.getAsString().substring(1), 16));
    }

    // ── 보스 (타임라인) ─────────────────────────────────────────────

    private void bossTick(MobUnit m, Unit tgt, long now) {
        JsonArray phases = m.def.getAsJsonObject("boss").getAsJsonArray("phases");
        int ph = m.phase;
        while (ph + 1 < phases.size() && m.hp / m.st.get("hp") <= phases.get(ph + 1).getAsJsonObject().get("hp").getAsDouble()) ph++;
        if (ph != m.phase) announce(m, phases.get(ph).getAsJsonObject().get("name").getAsString());
        if (ph != m.phase || m.tl == null) {
            m.phase = ph;
            m.tl = new long[]{0, now};
        }
        JsonObject P = phases.get(ph).getAsJsonObject();
        JsonArray tl = P.getAsJsonArray("timeline");
        for (int guard = 0; guard < tl.size() && now >= m.tl[1] + tl.get((int) m.tl[0]).getAsJsonObject().get("at").getAsLong(); guard++) {
            bossMove(m, tgt, tl.get((int) m.tl[0]).getAsJsonObject().getAsJsonObject("move"));
            if (++m.tl[0] >= tl.size()) { m.tl[0] = 0; m.tl[1] += P.get("loopMs").getAsLong(); }
        }
    }

    private void announce(MobUnit m, String text) {
        for (Unit u : w.around(m.x, m.y, 600, "p"))
            if (u instanceof PlayerUnit p) p.player.showTitle(net.kyori.adventure.title.Title.title(Component.empty(), Component.text(text, TextColor.color(0xFF5A5A))));
    }

    private List<Unit> alivePlayers(MobUnit m) { return w.around(m.x, m.y, 800, "p"); }

    private void circleAttack(MobUnit m, double x, double y, double r, long ms, double mul, JsonObject fx) {
        Telegraph.circle(plugin, m.body.getWorld(), x, y, baseY(m), r, ms);
        w.later(ms, () -> {
            if (m.dead) return;
            Combat.HitSpec h = baseSpec(m, mul);
            if (fx != null) h.fx = List.of(Combat.FxSpec.of(fx));
            for (Unit p : w.around(x, y, r, "p")) c.hit(w, m, p, h);
            burst(m, x, y);
        });
    }

    private void bossMove(MobUnit m, Unit tgt, JsonObject mv) {
        String kind = mv.get("kind").getAsString();
        List<Unit> alive = alivePlayers(m);
        JsonObject fx = mv.has("fx") ? mv.getAsJsonObject("fx") : null;
        switch (kind) {
            case "slam" -> {
                List<Unit> ts = new ArrayList<>(alive);
                Collections.shuffle(ts);
                List<Unit> pick = mv.has("count") ? ts.subList(0, Math.min(ts.size(), mv.get("count").getAsInt())) : List.of(tgt);
                for (Unit t : pick) circleAttack(m, t.x, t.y, mv.get("r").getAsDouble(), mv.get("windMs").getAsLong(), mv.get("mul").getAsDouble(), fx);
            }
            case "nova" -> circleAttack(m, m.x, m.y, mv.get("r").getAsDouble(), mv.get("windMs").getAsLong(), mv.get("mul").getAsDouble(), fx);
            case "line" -> {
                double ang = Math.atan2(tgt.y - m.y, tgt.x - m.x), len = mv.get("len").getAsDouble(), width = mv.get("width").getAsDouble();
                long ms = mv.get("windMs").getAsLong();
                Telegraph.line(plugin, m.body.getWorld(), m.x, m.y, baseY(m), ang, len, width, ms);
                m.wind = null;
                w.later(ms, () -> {
                    if (m.dead) return;
                    double ux = Math.cos(ang), uy = Math.sin(ang), sx = m.x, sy = m.y;
                    if (mv.has("lunge") && mv.get("lunge").getAsBoolean()) lunge(m, ux, uy, len);
                    Combat.HitSpec h = baseSpec(m, mv.get("mul").getAsDouble());
                    if (fx != null) h.fx = List.of(Combat.FxSpec.of(fx));
                    for (Unit p : alivePlayers(m)) {
                        double t = Math.max(0, Math.min(len, (p.x - sx) * ux + (p.y - sy) * uy));
                        if (Math.hypot(sx + ux * t - p.x, sy + uy * t - p.y) <= width / 2 + p.r) c.hit(w, m, p, h);
                    }
                });
            }
            case "summon" -> {
                for (int i = 0; i < mv.get("n").getAsInt(); i++) {
                    MobUnit.Zone z = new MobUnit.Zone(mv.get("mob").getAsString(), 0, m.lv, m.lv, mv.get("grade").getAsString(), m.body.getWorld().getName(), m.x, m.y, 48, baseY(m));
                    MobUnit a = spawn(z, m.body.getWorld());
                    if (a != null) a.threat.put(tgt.id, 1.0);
                }
            }
            case "spread" -> {
                double r = mv.get("r").getAsDouble();
                long ms = mv.get("windMs").getAsLong();
                for (Unit p : alive) Telegraph.circle(plugin, m.body.getWorld(), p.x, p.y, baseY(m), r, ms);
                w.later(ms, () -> {
                    if (m.dead) return;
                    List<Unit> now = alivePlayers(m);
                    for (Unit p : now) {
                        long near = now.stream().filter(o -> o != p && dist(o.x, o.y, p.x, p.y) <= r).count();
                        c.hit(w, m, p, baseSpec(m, mv.get("mul").getAsDouble() * (1 + near)));
                    }
                });
            }
            case "stack" -> {
                Unit t = alive.isEmpty() ? tgt : alive.get((int) Math.floor(c.rand() * alive.size()));
                double ax = t.x, ay = t.y, r = mv.get("r").getAsDouble();
                long ms = mv.get("windMs").getAsLong();
                Telegraph.circle(plugin, m.body.getWorld(), ax, ay, baseY(m), r, ms);
                w.later(ms, () -> {
                    if (m.dead) return;
                    List<Unit> now = alivePlayers(m);
                    List<Unit> inside = now.stream().filter(p -> dist(p.x, p.y, ax, ay) <= r + p.r).toList();
                    double mul = mv.get("mul").getAsDouble();
                    if (!inside.isEmpty()) for (Unit p : inside) c.hit(w, m, p, baseSpec(m, mul / inside.size()));
                    else for (Unit p : now) c.hit(w, m, p, baseSpec(m, mul / 2));
                });
            }
            case "orbs" -> {
                int n = mv.get("n").getAsInt();
                long ms = mv.get("ms").getAsLong();
                announce(m, "정화의 구슬을 모두 부수세요!");
                List<MobUnit> orbs = new ArrayList<>();
                for (int i = 0; i < n; i++) {
                    double a = (double) i / n * Math.PI * 2 + c.rand();
                    MobUnit.Zone z = new MobUnit.Zone("purify_orb", 0, m.lv, m.lv, "normal", m.body.getWorld().getName(), m.x + Math.cos(a) * 96, m.y + Math.sin(a) * 80, 0, baseY(m));
                    MobUnit o = spawn(z, m.body.getWorld());
                    if (o != null) orbs.add(o);
                }
                w.later(ms, () -> {
                    List<MobUnit> left = orbs.stream().filter(o -> !o.dead).toList();
                    if (left.isEmpty() || m.dead) return;
                    for (MobUnit o : left) c.die(w, o, null);
                    announce(m, "정화 실패! (남은 구슬 " + left.size() + "개)");
                    for (Unit p : alivePlayers(m)) c.dotDamage(w, m, p, p.st.get("hp") * mv.get("pct").getAsDouble() * left.size());
                });
            }
            default -> {}
        }
    }

    // ── 처치 · 피해 기록 ─────────────────────────────────────────────

    /** RpgWorld.onDamaged — 위협 · 기여 기록 */
    public void damaged(Unit src, Unit tgt, double amount, double threat) {
        if (tgt instanceof MobUnit m && src.isPlayer()) {
            m.threat.merge(src.id, amount * Math.max(threat, 0.1), Double::sum);
            m.dmgBy.merge(src.id, amount, Double::sum);
        }
    }

    /** RpgWorld.onKilled 의 몹 쪽 */
    public void killed(MobUnit m, Unit by) {
        m.removeAt = w.now() + 1000;
        m.zone.alive--;
        if (m.zone.count > 0) m.zone.respawn.add(w.now() + RESPAWN_MS);
        if (m.body != null) {
            m.body.getPathfinder().stopPathfinding();
            Location l = m.body.getLocation().add(0, m.body.getHeight() / 2, 0);
            l.getWorld().spawnParticle(Particle.POOF, l, 16, 0.3, 0.3, 0.3, 0.05);
            l.getWorld().playSound(l, Sound.ENTITY_GENERIC_DEATH, 0.6f, 1.2f);
            m.body.setAI(false);
        }
        if (m.plate != null) m.plate.remove();
        if (m.model != null) { var model = m.model; m.model = null; model.die(() -> {}); }
        PlayerUnit best = null;
        double bv = 0;
        for (Map.Entry<Integer, Double> e : m.dmgBy.entrySet())
            if (w.unit(e.getKey()) instanceof PlayerUnit p && e.getValue() > bv) { bv = e.getValue(); best = p; }
        if (best == null) return;
        // 파티 분배 (§21-2): 경험치 = 20칸 안 파티원 균등 + 인원당 5%, Gold = 파티장 1.5 : 1
        List<Player> near = plugin.parties().expShare(best.player, m.x, m.y);
        for (Player q : near) {
            PlayerUnit qu = plugin.runtime().unit(q);
            if (qu == null) continue;
            plugin.runtime().gainExp(q, plugin.parties().partyExp(defs.mobExp(m.def, m.lv, m.grade, qu.ch.level), near.size()));
            if (q != best.player) plugin.quests().quest(q, "kill", m.key);
        }
        JsonArray ruc = m.def.getAsJsonArray("ruc");
        int lo = ruc.get(0).getAsInt(), hi = ruc.get(1).getAsInt();
        long gold = (lo + (long) Math.floor(c.rand() * (hi - lo + 1))) * (1 + defs.gradeIndex(m.grade));
        if (gold > 0) for (var e : plugin.parties().goldShare(best.player, gold).entrySet()) {
            if (e.getValue() <= 0) continue;
            plugin.core().getEconomy().deposit(e.getKey().getUniqueId(), e.getValue());
            plugin.hud().toast(e.getKey(), "+" + e.getValue() + " " + plugin.core().getEconomy().symbol());
        }
        plugin.mobKilled(m, best);
    }

    // ── 바닐라 이벤트 ────────────────────────────────────────────────

    /** 몹 몸에 오는 바닐라 피해는 전부 취소 — 플레이어 평타만 RPG 피해로 (M3 스킬 엔진이 대신할 때까지 임시 평타) */
    @EventHandler(priority = EventPriority.HIGH)
    public void onDamage(EntityDamageEvent e) {
        MobUnit m = of(e.getEntity());
        if (m == null) return;
        e.setCancelled(true);
        if (!(e instanceof EntityDamageByEntityEvent be) || !(be.getDamager() instanceof Player p)) return;
        if (plugin.runtime().unit(p) == null || m.dead) return;
        plugin.skills().basicFromHit(p);   // 평타 = 무기 평타 스킬 (스킬 엔진의 부채꼴 판정 · 쿨 · 스태미나)
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onTarget(EntityTargetEvent e) { if (of(e.getEntity()) != null) e.setCancelled(true); }

    @EventHandler
    public void onCombust(EntityCombustEvent e) { if (of(e.getEntity()) != null) e.setCancelled(true); }

    @EventHandler
    public void onDeath(EntityDeathEvent e) {
        if (of(e.getEntity()) != null) { e.getDrops().clear(); e.setDroppedExp(0); }
    }

    /** /rpgadmin spawn — 플레이어 앞에 몹 (일회성 구역) */
    public MobUnit spawnAt(Player p, String key, int lv, String grade) {
        Location l = p.getLocation().add(p.getLocation().getDirection().setY(0).normalize().multiply(4));
        MobUnit.Zone z = new MobUnit.Zone(key, 0, lv, lv, grade, l.getWorld().getName(), l.getX() * RpgWorld.PX, l.getZ() * RpgWorld.PX, 16, l.getY());
        return spawn(z, l.getWorld());
    }
}
