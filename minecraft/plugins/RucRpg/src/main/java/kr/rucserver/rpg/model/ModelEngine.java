package kr.rucserver.rpg.model;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.ui.Gui;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.util.Transformation;
import org.joml.Matrix4f;
import org.joml.Quaternionf;
import org.joml.Vector3f;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 몹 · NPC · 소환수 3D 모델 엔진 (사용자 결정 Q3, 유료 ModelEngine 없이).
 * 모델 = 뼈 트리. 뼈마다 ItemDisplay 하나(아이템 모델 ruc:mob/<id>/<뼈>) — 보이지 않는 기준 디스플레이(anchor)에 탑승.
 * anchor 는 몸(바닐라 몹)을 매 틱 따라가고(teleportDuration 2 로 부드럽게), 뼈 디스플레이의 변환 = 방향(yaw) × 부모 × 피벗 × 애니메이션.
 * 애니메이션: models.json 키프레임(ms · rot 도 · pos 블록 · scale) 을 선형 보간, 2틱마다 interpolationDuration 2 로 보냄.
 * 계약 · 모델 내용은 Codex 작업 6 (RUC_RPG/scripts/mc-models.ts → models.json + 리소스팩).
 */
public final class ModelEngine {

    record Key(double t, float[] rot, float[] pos, float[] scale) {}
    record Anim(double ms, boolean loop, Map<String, List<Key>> keys) {}
    record Bone(String name, String parent, float[] pivot, String model) {}
    record Def(String id, float scale, double height, List<Bone> bones, Map<String, Anim> anims) {}

    /** 살아 있는 모델 하나 */
    public final class Instance {
        final Def def;
        final Entity body;
        final ItemDisplay anchor;
        final Map<String, ItemDisplay> parts = new LinkedHashMap<>();
        String anim = "idle";
        long animAt = System.currentTimeMillis();
        long hurtUntil;
        boolean dying;
        float yaw;

        Instance(Def def, Entity body, ItemDisplay anchor) { this.def = def; this.body = body; this.anchor = anchor; }

        /** 동작 바꾸기 (attack · cast · hurt · death 는 한 번, idle · walk 는 반복) */
        public void play(String name) {
            if (dying || !def.anims.containsKey(name)) return;
            if (name.equals(anim) && def.anims.get(name).loop()) return;
            anim = name;
            animAt = System.currentTimeMillis();
        }

        public void hurt() { hurtUntil = System.currentTimeMillis() + 150; swapHurt(true); }

        public void die(Runnable after) {
            if (!def.anims.containsKey("death")) { remove(); after.run(); return; }
            anim = "death";
            animAt = System.currentTimeMillis();
            dying = true;
            Bukkit.getScheduler().runTaskLater(plugin, () -> { remove(); after.run(); }, Math.max(1, (long) (def.anims.get("death").ms() / 50) + 4));
        }

        public void remove() {
            for (ItemDisplay d : parts.values()) d.remove();
            anchor.remove();
            live.remove(this);
        }

        private boolean hurtShown;

        private void swapHurt(boolean on) {
            if (hurtShown == on) return;
            hurtShown = on;
            for (Bone b : def.bones) {
                ItemDisplay d = parts.get(b.name());
                if (d == null) continue;
                String model = b.model() + (on ? "_hurt" : "");
                if (on && !Gui.hasModel(model)) continue;
                d.setItemStack(item(model));
            }
        }
    }

    private final RucRpg plugin;
    private final Map<String, Def> defs = new HashMap<>();
    private final List<Instance> live = new ArrayList<>();
    private final NamespacedKey tag;
    private long tick;

    public ModelEngine(RucRpg plugin) {
        this.plugin = plugin;
        this.tag = new NamespacedKey(plugin, "model");
        load();
        for (org.bukkit.World w : Bukkit.getWorlds()) for (Entity e : w.getEntities()) if (e.getPersistentDataContainer().has(tag)) e.remove();
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1L, 1L);
    }

    public boolean has(String id) { return defs.containsKey(id); }
    public int count() { return defs.size(); }

    private static float[] f3(JsonElement e) {
        if (e == null || !e.isJsonArray()) return null;
        JsonArray a = e.getAsJsonArray();
        return new float[]{a.get(0).getAsFloat(), a.get(1).getAsFloat(), a.get(2).getAsFloat()};
    }

    private void load() {
        try (var in = plugin.getClass().getClassLoader().getResourceAsStream("models.json")) {
            if (in == null) { plugin.getLogger().info("모델: models.json 없음 — 몹은 바닐라 몸으로 보임"); return; }
            JsonObject root = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
            for (Map.Entry<String, JsonElement> e : root.entrySet()) {
                if (!e.getValue().isJsonObject()) continue;
                JsonObject o = e.getValue().getAsJsonObject();
                if (!o.has("bones")) continue;
                List<Bone> bones = new ArrayList<>();
                for (JsonElement b : o.getAsJsonArray("bones")) {
                    JsonObject bo = b.getAsJsonObject();
                    bones.add(new Bone(bo.get("name").getAsString(), bo.has("parent") && !bo.get("parent").isJsonNull() ? bo.get("parent").getAsString() : null,
                            f3(bo.get("pivot")) == null ? new float[3] : f3(bo.get("pivot")), bo.get("model").getAsString()));
                }
                Map<String, Anim> anims = new HashMap<>();
                if (o.has("anims")) for (Map.Entry<String, JsonElement> a : o.getAsJsonObject("anims").entrySet()) {
                    JsonObject ao = a.getValue().getAsJsonObject();
                    Map<String, List<Key>> keys = new HashMap<>();
                    if (ao.has("keys")) for (Map.Entry<String, JsonElement> k : ao.getAsJsonObject("keys").entrySet()) {
                        List<Key> list = new ArrayList<>();
                        for (JsonElement ke : k.getValue().getAsJsonArray()) {
                            JsonObject ko = ke.getAsJsonObject();
                            list.add(new Key(ko.get("t").getAsDouble(), f3(ko.get("rot")), f3(ko.get("pos")), f3(ko.get("scale"))));
                        }
                        list.sort((x, y) -> Double.compare(x.t(), y.t()));
                        keys.put(k.getKey(), list);
                    }
                    anims.put(a.getKey(), new Anim(ao.has("ms") ? ao.get("ms").getAsDouble() : 1000, ao.has("loop") && ao.get("loop").getAsBoolean(), keys));
                }
                defs.put(e.getKey(), new Def(e.getKey(), o.has("scale") ? o.get("scale").getAsFloat() : 1f, o.has("height") ? o.get("height").getAsDouble() : 1, bones, anims));
            }
            plugin.getLogger().info("모델 " + defs.size() + "개");
        } catch (Exception ex) {
            plugin.getLogger().warning("models.json 을 읽지 못함: " + ex.getMessage());
        }
    }

    private static ItemStack item(String model) {
        ItemStack it = new ItemStack(Material.PAPER);
        ItemMeta m = it.getItemMeta();
        m.setItemModel(new NamespacedKey("ruc", model));
        it.setItemMeta(m);
        return it;
    }

    /** 몸(바닐라 몹 · 마네킹)에 모델 붙이기 — 모델이 없으면 null (몸이 그대로 보임) */
    public Instance attach(String id, Entity body) {
        Def def = defs.get(id);
        if (def == null) return null;
        for (Bone b : def.bones) if (!Gui.hasModel(b.model())) return null;   // 리소스팩에 없는 뼈 = 붙이지 않음 (보라 검정 방지)
        Location at = body.getLocation();
        ItemDisplay anchor = at.getWorld().spawn(at, ItemDisplay.class, d -> {
            d.setPersistent(false);
            d.setTeleportDuration(2);
            d.getPersistentDataContainer().set(tag, PersistentDataType.STRING, id);
        });
        Instance inst = new Instance(def, body, anchor);
        for (Bone b : def.bones) {
            ItemDisplay d = at.getWorld().spawn(at, ItemDisplay.class, x -> {
                x.setItemStack(item(b.model()));
                x.setItemDisplayTransform(ItemDisplay.ItemDisplayTransform.NONE);
                x.setPersistent(false);
                x.setInterpolationDuration(2);
                x.setBrightness(null);
                x.setShadowRadius(0);
                x.setViewRange(1.2f);
                x.getPersistentDataContainer().set(tag, PersistentDataType.STRING, id);
            });
            anchor.addPassenger(d);
            inst.parts.put(b.name(), d);
        }
        if (body instanceof org.bukkit.entity.LivingEntity le) le.setInvisible(true);
        live.add(inst);
        pose(inst, 0);
        return inst;
    }

    // ── 매 틱 ───────────────────────────────────────────────────────

    private void tick() {
        tick++;
        for (Instance inst : new ArrayList<>(live)) {
            if (!inst.anchor.isValid() || (!inst.dying && (inst.body == null || !inst.body.isValid()))) { inst.remove(); continue; }
            if (!inst.dying) {
                Location l = inst.body.getLocation();
                inst.yaw = l.getYaw();
                l.setYaw(0);
                l.setPitch(0);
                inst.anchor.teleport(l);
            }
            if (inst.hurtShown && System.currentTimeMillis() > inst.hurtUntil) inst.swapHurt(false);
            if (tick % 2 == 0) pose(inst, System.currentTimeMillis() - inst.animAt);
        }
    }

    /** 키프레임 사이 선형 보간 */
    private static float[] sample(List<Key> keys, double t, int which) {
        Key prev = null, next = null;
        for (Key k : keys) {
            float[] v = which == 0 ? k.rot() : which == 1 ? k.pos() : k.scale();
            if (v == null) continue;
            if (k.t() <= t) prev = k;
            if (k.t() >= t && next == null) next = k;
        }
        if (prev == null && next == null) return null;
        Key a = prev != null ? prev : next, b = next != null ? next : prev;
        float[] va = which == 0 ? a.rot() : which == 1 ? a.pos() : a.scale(), vb = which == 0 ? b.rot() : which == 1 ? b.pos() : b.scale();
        double span = b.t() - a.t(), f = span <= 0 ? 0 : (t - a.t()) / span;
        return new float[]{(float) (va[0] + (vb[0] - va[0]) * f), (float) (va[1] + (vb[1] - va[1]) * f), (float) (va[2] + (vb[2] - va[2]) * f)};
    }

    private void pose(Instance inst, long elapsed) {
        Def def = inst.def;
        Anim anim = def.anims.get(inst.anim);
        double t = 0;
        if (anim != null) {
            t = anim.loop() ? elapsed % Math.max(1, anim.ms()) : Math.min(elapsed, anim.ms());
            if (!anim.loop() && elapsed > anim.ms() && !inst.dying) { inst.anim = "idle"; inst.animAt = System.currentTimeMillis(); }
        }
        Map<String, Matrix4f> world = new HashMap<>();
        Map<String, float[]> pivots = new HashMap<>();
        for (Bone b : def.bones) pivots.put(b.name(), b.pivot());
        Matrix4f root = new Matrix4f().rotateY((float) Math.toRadians(-inst.yaw)).scale(def.scale());
        for (Bone b : def.bones) {   // 부모가 먼저 나오는 순서라고 봄 (계약)
            Matrix4f parent = b.parent() == null ? root : world.getOrDefault(b.parent(), root);
            float[] rot = anim == null ? null : anim.keys().containsKey(b.name()) ? sample(anim.keys().get(b.name()), t, 0) : null;
            float[] pos = anim == null ? null : anim.keys().containsKey(b.name()) ? sample(anim.keys().get(b.name()), t, 1) : null;
            float[] scl = anim == null ? null : anim.keys().containsKey(b.name()) ? sample(anim.keys().get(b.name()), t, 2) : null;
            float[] pv = b.pivot();   // 계약: 몸 바닥 가운데 기준 절대 좌표 → 부모 피벗과의 차이만큼 옮김
            float[] pp = b.parent() == null ? new float[3] : pivots.getOrDefault(b.parent(), new float[3]);
            Matrix4f m = new Matrix4f(parent).translate(pv[0] - pp[0] + (pos == null ? 0 : pos[0]), pv[1] - pp[1] + (pos == null ? 0 : pos[1]), pv[2] - pp[2] + (pos == null ? 0 : pos[2]));
            if (rot != null) m.rotateXYZ((float) Math.toRadians(rot[0]), (float) Math.toRadians(rot[1]), (float) Math.toRadians(rot[2]));
            if (scl != null) m.scale(scl[0], scl[1], scl[2]);
            world.put(b.name(), m);
            // 자식 피벗은 부모 피벗 기준 → 다음 뼈 계산엔 이 행렬을, 그림은 모델 원점(8,8,8 = 피벗)이 피벗에 오게
            ItemDisplay d = inst.parts.get(b.name());
            if (d == null) continue;
            Matrix4f draw = new Matrix4f(m);
            Vector3f tr = draw.getTranslation(new Vector3f());
            Quaternionf q = draw.getUnnormalizedRotation(new Quaternionf());
            Vector3f sc = draw.getScale(new Vector3f());
            d.setInterpolationDelay(0);
            d.setInterpolationDuration(2);
            d.setTransformation(new Transformation(tr, q, sc, new Quaternionf()));
        }
    }
}
