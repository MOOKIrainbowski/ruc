package kr.rucserver.rpg.mob;

import com.google.gson.JsonObject;
import kr.rucserver.rpg.engine.Unit;
import org.bukkit.entity.Mob;
import org.bukkit.entity.TextDisplay;

import java.util.HashMap;
import java.util.Map;

/** 몹 한 마리 (웹 mobs.ts Mob). 몸 = 보이지 않는(모델이 생기면) 바닐라 몹, 머리 위 = 이름 · 체력 바 */
public final class MobUnit extends Unit {

    /** 리젠 구역 (웹 Zone). count 0 = 소환 · 명령으로 만든 일회성 */
    public static final class Zone {
        public final String mob, grade, world;
        public final int count, lvMin, lvMax;
        public final double x, y, r;
        public int alive;
        public final java.util.List<Long> respawn = new java.util.ArrayList<>();
        public double baseY;

        public Zone(String mob, int count, int lvMin, int lvMax, String grade, String world, double x, double y, double r, double baseY) {
            this.mob = mob; this.count = count; this.lvMin = lvMin; this.lvMax = lvMax; this.grade = grade;
            this.world = world; this.x = x; this.y = y; this.r = r; this.baseY = baseY;
        }
    }

    /** 선딜 중인 공격 (바닥 경고) */
    public record Wind(long until, boolean sp, double x, double y, double ang, int tgt) {}

    public final String key;
    public final JsonObject def;
    public final String grade;
    public final Zone zone;
    public final double homeX, homeY;
    public Mob body;
    public TextDisplay plate;
    /** 3D 모델 (사용자 결정 Q3) — 없으면 바닐라 몸이 보임 */
    public kr.rucserver.rpg.model.ModelEngine.Instance model;
    /** idle · patrol · leash */
    public String state = "idle";
    public long wait;
    public double tx, ty;
    public final Map<Integer, Double> threat = new HashMap<>();
    public final Map<Integer, Double> dmgBy = new HashMap<>();
    public long atkReady, spReady;
    public int swings;
    public Wind wind;
    public int phase;
    /** 보스 타임라인 위치 [i, base] — 전투가 끝나면 null */
    public long[] tl;
    public long removeAt;
    double plateHp = -1;

    MobUnit(String key, JsonObject def, String grade, Zone zone, double x, double y) {
        super("m");
        this.key = key;
        this.def = def;
        this.grade = grade;
        this.zone = zone;
        this.homeX = x;
        this.homeY = y;
        this.x = x;
        this.y = y;
        this.tx = x;
        this.ty = y;
        this.name = def.get("name").getAsString();
        this.el = def.get("el").getAsString();
        this.r = def.get("r").getAsDouble();
    }

    public boolean passive() { return def.has("passive") && def.get("passive").getAsBoolean(); }
    public boolean boss() { return def.has("boss"); }
}
