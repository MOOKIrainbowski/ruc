package kr.rucserver.rpg.world;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 웹 RPG 맵 JSON (Tiled, web/rpg/shared/data/maps — Gradle 이 jar 의 maps/ 로 그대로 넣음).
 * 좌표: 맵 px (1타일 16px) → 마크 블록 = px / 8 (1타일 = 2×2 블록, 계획서 R3), 전투 px = 블록 × 16 = 맵 px × 2.
 */
public final class RpgMap {

    public record Obj(int id, String name, String type, double x, double y, double w, double h, Map<String, String> props) {
        public String prop(String k) { return props.get(k); }
        /** 중심 (맵 px) */
        public double cx() { return x + w / 2; }
        public double cy() { return y + h / 2; }
    }

    public static final int STAIRS = 16;

    public final String kind;
    public final int w, h;
    public final String[] tileNames;
    public final int[] ground, water, collision, height, decorBelow, decorAbove;
    public final List<Obj> objects = new ArrayList<>();

    public RpgMap(String kind, ClassLoader cl) throws Exception {
        this.kind = kind;
        JsonObject j;
        try (var in = cl.getResourceAsStream("maps/" + kind + ".json")) {
            if (in == null) throw new IllegalArgumentException("맵 없음: " + kind);
            j = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
        }
        w = j.get("width").getAsInt();
        h = j.get("height").getAsInt();
        JsonArray tiles = j.getAsJsonArray("tilesets").get(0).getAsJsonObject().getAsJsonArray("tiles");
        tileNames = new String[tiles.size() + 1];
        for (JsonElement t : tiles) {
            JsonObject o = t.getAsJsonObject();
            tileNames[o.get("id").getAsInt() + 1] = o.getAsJsonArray("properties").get(0).getAsJsonObject().get("value").getAsString();
        }
        Map<String, int[]> layers = new HashMap<>();
        for (JsonElement le : j.getAsJsonArray("layers")) {
            JsonObject l = le.getAsJsonObject();
            if (l.has("data")) {
                JsonArray d = l.getAsJsonArray("data");
                int[] a = new int[d.size()];
                for (int i = 0; i < a.length; i++) a[i] = d.get(i).getAsInt();
                layers.put(l.get("name").getAsString(), a);
            } else if (l.has("objects")) {
                for (JsonElement oe : l.getAsJsonArray("objects")) {
                    JsonObject o = oe.getAsJsonObject();
                    Map<String, String> props = new HashMap<>();
                    if (o.has("properties")) for (JsonElement p : o.getAsJsonArray("properties")) props.put(p.getAsJsonObject().get("name").getAsString(), p.getAsJsonObject().get("value").getAsString());
                    objects.add(new Obj(o.get("id").getAsInt(), o.has("name") ? o.get("name").getAsString() : "", o.has("type") ? o.get("type").getAsString() : "",
                            o.get("x").getAsDouble(), o.get("y").getAsDouble(), o.has("width") ? o.get("width").getAsDouble() : 0, o.has("height") ? o.get("height").getAsDouble() : 0, props));
                }
            }
        }
        int n = w * h;
        ground = layers.getOrDefault("ground", new int[n]);
        water = layers.getOrDefault("water", new int[n]);
        collision = layers.getOrDefault("collision", new int[n]);
        height = layers.getOrDefault("height", new int[n]);
        decorBelow = layers.getOrDefault("decor_below", new int[n]);
        decorAbove = layers.getOrDefault("decor_above", new int[n]);
    }

    public String tile(int[] layer, int x, int y) {
        if (x < 0 || y < 0 || x >= w || y >= h) return null;
        int g = layer[y * w + x];
        return g > 0 && g < tileNames.length ? tileNames[g] : null;
    }

    public int level(int x, int y) { return x < 0 || y < 0 || x >= w || y >= h ? 0 : height[y * w + x] & 15; }
    public boolean stairs(int x, int y) { return x >= 0 && y >= 0 && x < w && y < h && (height[y * w + x] & STAIRS) != 0; }

    /** 웹 shared/map.ts heightKind: 1 앞면 · 2 가장자리 · 4 계단 · 8 언덕 위 · 0 평지 */
    public int heightKind(int x, int y) {
        int L = level(x, y);
        if (L == 0) return 0;
        if (stairs(x, y)) return 4;
        if (level(x, y + 1) < L || level(x, y + 2) < L) return 1;
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) if (level(x + dx, y + dy) < L) return 2;
        return 8;
    }

    public Obj first(String type) {
        for (Obj o : objects) if (o.type().equals(type)) return o;
        return null;
    }
}
