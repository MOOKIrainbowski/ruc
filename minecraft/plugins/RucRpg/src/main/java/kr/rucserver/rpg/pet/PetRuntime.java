package kr.rucserver.rpg.pet;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.engine.Combat;
import kr.rucserver.rpg.engine.Unit;
import kr.rucserver.rpg.model.ModelEngine;
import kr.rucserver.rpg.mob.MobRuntime;
import kr.rucserver.rpg.world.Projectiles;
import kr.rucserver.rpg.world.RpgWorld;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.entity.ArmorStand;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 소환수 · 설치물 (웹 server/pets.ts · P9 D81 · P13 D95).
 * 피해 · 치유는 주인 스탯 + 소환수 계수, 주인이 한 것으로(경험치 · 기여). HP = 주인 최대 HP × hp, 몹이 노리고 때릴 수 있음.
 * 소환수가 준 피해 × taunt 만큼 위협이 소환수에게, 주인은 30%만(HitSpec.threat 0.3 · pet · taunt).
 * 마크: 몸 = 보이지 않는 갑옷 거치대(중력 없음, 매 틱 순간이동) + Codex 모델(models.json 의 pet_* · turret …), 모델이 없으면 머리 블록으로 대신 보임.
 */
public final class PetRuntime {

    public static final class PetUnit extends Unit {
        public final PlayerUnit owner;
        public final JsonObject def;
        public final String key;
        public final long until;
        public long next;
        public final double ox, oy;
        public ArmorStand body;
        public ModelEngine.Instance model;

        PetUnit(PlayerUnit owner, JsonObject def, String key, long until, double ox, double oy) {
            super("p");
            this.owner = owner; this.def = def; this.key = key; this.until = until; this.ox = ox; this.oy = oy;
        }
    }

    /** 모델이 없을 때 머리에 씌울 블록 */
    private static final Map<String, Material> HEAD = Map.of("pet_spirit", Material.SEA_LANTERN, "pet_golem", Material.MOSSY_COBBLESTONE, "pet_wolf", Material.BROWN_WOOL,
            "turret", Material.DISPENSER, "mend_station", Material.BEACON, "totem_heal", Material.LIME_GLAZED_TERRACOTTA, "totem_storm", Material.YELLOW_GLAZED_TERRACOTTA, "decoy", Material.GLASS);

    private final RucRpg plugin;
    private final RpgWorld w;
    private final Combat c;
    private final JsonObject defs, engineer;
    private final List<PetUnit> pets = new ArrayList<>();

    public long countOf(PlayerUnit p) { return pets.stream().filter(q -> q.owner == p).count(); }
    public void removeOf(PlayerUnit p) { for (PetUnit q : new ArrayList<>(pets)) if (q.owner == p) unsummon(q); }

    public PetRuntime(RucRpg plugin) {
        this.plugin = plugin;
        this.w = plugin.world();
        this.c = plugin.combat();
        this.defs = plugin.data().file("pets").getAsJsonObject("PETS");
        this.engineer = plugin.data().file("pets").getAsJsonObject("ENGINEER");
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1L, 1L);
    }

    /** 부르기 (스킬 summon {pet, ms, max?, n?}): max 를 넘으면 오래된 것부터. 엔지니어 「정비」 = 설치물 지속 +30% */
    public void summon(PlayerUnit p, JsonObject s) {
        String key = s.get("pet").getAsString();
        JsonObject def = defs.getAsJsonObject(key);
        if (def == null) return;
        boolean follow = def.get("follow").getAsBoolean();
        double life = s.get("ms").getAsDouble() * ("engineer".equals(p.job) && !follow ? engineer.get("life").getAsDouble() : 1);
        int max = s.has("max") ? s.get("max").getAsInt() : 1, n = s.has("n") ? s.get("n").getAsInt() : 1;
        for (int i = 0; i < n; i++) {
            List<PetUnit> mine = pets.stream().filter(q -> q.owner == p && q.key.equals(key)).toList();
            if (mine.size() >= max) unsummon(mine.get(0));
            double a = Math.random() * Math.PI * 2;
            PetUnit q = new PetUnit(p, def, key, System.currentTimeMillis() + (long) life, Math.cos(a) * 24, Math.sin(a) * 16);
            q.petOf = p.id;
            q.name = def.get("name").getAsString();
            q.el = p.el;
            q.lv = p.lv;
            q.r = 6;
            q.job = null;
            q.base = p.base.copy();
            q.base.set("hp", Math.max(1, Math.round(p.st.get("hp") * def.get("hp").getAsDouble())));
            c.recalc(q);
            q.hp = q.st.get("hp");
            q.next = System.currentTimeMillis() + 400;
            Location at = p.player.getLocation();
            Location g = MobRuntime.ground(at.getWorld(), at.getX() + q.ox / RpgWorld.PX, at.getY(), at.getZ() + q.oy / RpgWorld.PX);
            if (g == null) g = at.clone();
            RpgWorld.place(q, g);
            Location spawnAt = g;
            q.body = at.getWorld().spawn(spawnAt, ArmorStand.class, b -> {
                b.setPersistent(false);
                b.setInvisible(true);
                b.setGravity(false);
                b.setSmall(true);
                b.setInvulnerable(true);
                b.setSilent(true);
                b.customName(net.kyori.adventure.text.Component.text(p.player.getName() + "의 " + q.name, net.kyori.adventure.text.format.NamedTextColor.GRAY));
                b.setCustomNameVisible(false);
            });
            q.model = plugin.models() == null ? null : plugin.models().attach(key, q.body);
            if (q.model == null) q.body.getEquipment().setHelmet(new ItemStack(HEAD.getOrDefault(key, Material.GLASS)));
            pets.add(q);
            w.add(q);
            at.getWorld().spawnParticle(Particle.END_ROD, spawnAt.clone().add(0, 0.6, 0), 12, 0.3, 0.4, 0.3, 0.02);
        }
    }

    public void unsummon(PetUnit q) {
        if (!pets.remove(q)) return;
        q.dead = true;
        w.remove(q);
        if (q.body != null && q.body.isValid()) q.body.getWorld().spawnParticle(Particle.POOF, q.body.getLocation().add(0, 0.5, 0), 8, 0.2, 0.3, 0.2, 0.02);
        if (q.model != null) { var m = q.model; q.model = null; m.die(() -> { if (q.body != null) q.body.remove(); }); }
        else if (q.body != null) q.body.remove();
    }

    public void removeAll() { for (PetUnit q : new ArrayList<>(pets)) { if (q.model != null) q.model.remove(); if (q.body != null) q.body.remove(); pets.remove(q); w.remove(q); } }

    private Combat.HitSpec spec(PetUnit q) {
        JsonObject d = q.def, dmg = d.getAsJsonObject("damage");
        Combat.HitSpec h = new Combat.HitSpec();
        h.base = dmg.get("base").getAsDouble();
        h.atkRatio = dmg.get("atkRatio").getAsDouble();
        h.apRatio = dmg.get("apRatio").getAsDouble();
        h.cat = d.has("category") ? d.get("category").getAsString() : "physical";
        String el = d.has("el") ? d.get("el").getAsString() : null;
        h.el = "owner".equals(el) ? q.owner.el : el;
        h.threat = 0.3;
        h.proc = h.el != null && !"none".equals(h.el);
        h.melee = "melee".equals(d.get("act").getAsString());
        if (d.has("fx")) { List<Combat.FxSpec> fx = new ArrayList<>(); for (JsonElement e : d.getAsJsonArray("fx")) fx.add(Combat.FxSpec.of(e.getAsJsonObject())); h.fx = fx; }
        h.pet = q.id;
        h.taunt = d.get("taunt").getAsDouble();
        return h;
    }

    /** 주인과 싸우는 대상 중 소환수에서 가장 가까운 것 (주인에게서 220px 안) */
    private Unit nearestFoe(PetUnit q, double range) {
        Unit best = null;
        double bd = range;
        for (Unit u : w.all()) {
            if (u.dead || !w.hostile(q.owner, u)) continue;
            double d = Math.hypot(u.x - q.x, u.y - q.y) - u.r;
            if (d <= bd && Math.hypot(u.x - q.owner.x, u.y - q.owner.y) <= 220) { bd = d; best = u; }
        }
        return best;
    }

    private void moveTo(PetUnit q, double tx, double ty, double stop, double dt) {
        double d = Math.hypot(tx - q.x, ty - q.y);
        if (d <= stop) return;
        if (d > 260) { q.x = tx; q.y = ty; }   // 너무 멀어지면 주인 곁으로
        else {
            double s = Math.min(d - stop, q.owner.st.get("moveSpeed") * 0.64 * 1.25 * dt);   // 이동 속도 100 = 초당 64px
            q.x += (tx - q.x) / d * s;
            q.y += (ty - q.y) / d * s;
        }
        q.moving = true;
        Location cur = q.body.getLocation();
        Location g = MobRuntime.ground(cur.getWorld(), q.x / RpgWorld.PX, q.owner.player.getLocation().getY(), q.y / RpgWorld.PX);
        if (g == null) { RpgWorld.place(q, cur); return; }   // 막힌 곳 — 제자리
        g.setYaw((float) Math.toDegrees(Math.atan2(-(tx - q.x), ty - q.y)));
        q.body.teleport(g);
    }

    private void tick() {
        long now = System.currentTimeMillis();
        for (PetUnit q : new ArrayList<>(pets)) {
            PlayerUnit o = q.owner;
            if (now >= q.until || o.dead || q.dead || !o.player.isOnline() || q.body == null || !q.body.isValid() || !o.player.getWorld().equals(q.body.getWorld())) { unsummon(q); continue; }
            q.moving = false;
            c.tickEffects(w, q);
            JsonObject d = q.def;
            String act = d.get("act").getAsString();
            double range = d.get("range").getAsDouble();
            boolean follow = d.get("follow").getAsBoolean();
            Unit tgt = act.equals("melee") || act.equals("shot") ? nearestFoe(q, follow ? 150 : range) : null;
            if (follow) {
                if (tgt != null && act.equals("melee")) moveTo(q, tgt.x, tgt.y, range + tgt.r - 4, 0.05);
                else moveTo(q, o.x + q.ox, o.y + q.oy, 6, 0.05);
            }
            if (q.model != null) q.model.play(q.moving ? "walk" : "idle");
            if (now < q.next || act.equals("decoy")) continue;
            q.next = now + d.get("cdMs").getAsLong();
            if (act.equals("melee") && tgt != null && Math.hypot(tgt.x - q.x, tgt.y - q.y) <= range + tgt.r) {
                c.hit(w, o, tgt, spec(q));
                if (q.model != null) q.model.play("attack");
            } else if (act.equals("shot") && tgt != null && Math.hypot(tgt.x - q.x, tgt.y - q.y) <= range + tgt.r) {
                Combat.HitSpec s = spec(q);
                plugin.projectiles().fire(new Projectiles.Shot(o, q.body.getWorld(), q.x, q.y, q.body.getLocation().getY() + 0.7, tgt.x - q.x, tgt.y - q.y,
                        260, range + 20, 4, s, 0, 0, plugin.skills().vfx().color(s.el), false));
                if (q.model != null) q.model.play("cast");
            } else if (act.equals("aura")) {
                Combat.HitSpec s = spec(q);
                boolean any = false;
                for (Unit u : w.all()) if (!u.dead && w.hostile(o, u) && Math.hypot(u.x - q.x, u.y - q.y) <= range + u.r) { c.hit(w, o, u, s); any = true; }
                if (any) { plugin.skills().vfx().burst(q.body.getWorld(), q.x, q.y, q.body.getLocation().getY(), range, s.el, false, o); if (q.model != null) q.model.play("cast"); }
            } else if (act.equals("heal") && d.has("heal")) {
                JsonObject h = d.getAsJsonObject("heal");
                for (Unit a : w.around(q.x, q.y, range, "p")) {
                    if (!(a instanceof PlayerUnit pa) || pa.dead || w.hostile(o, pa)) continue;
                    c.applyHeal(w, o, pa, c.healPerTick(h.get("base").getAsDouble() + o.st.get("ap") * h.get("apRatio").getAsDouble() + pa.st.get("hp") * h.get("hpPct").getAsDouble(), o, pa), true);
                    if (d.has("cleanse") && d.get("cleanse").getAsBoolean()) plugin.skills().cleanse(o, pa);
                }
            } else q.next = now + 200;   // 대상이 없으면 곧 다시 봄
        }
    }
}
