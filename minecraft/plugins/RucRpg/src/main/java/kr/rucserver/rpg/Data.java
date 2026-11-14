package kr.rucserver.rpg;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * RPG 콘텐츠 데이터 (웹 RPG 의 TS 가 원본 → {@code RUC_RPG/scripts/export-mc.ts} 가 jar 안 data/*.json 으로 뽑음).
 * 여기서는 읽기만 합니다. 숫자를 고치려면 웹 RPG 의 shared/data 를 고치고 다시 export.
 */
public final class Data {

    /** export-mc.ts 가 만드는 파일들. 하나라도 없으면 플러그인을 켜지 않음 (반쯤 켜진 RPG 는 위험) */
    public static final List<String> FILES = List.of(
            "items", "skills", "jobs", "mobs", "effects", "elements", "stats",
            "economy", "quests", "dungeons", "party", "pets", "realm", "progress");

    private final Map<String, JsonObject> files = new LinkedHashMap<>();

    public static Data load(ClassLoader cl) throws IOException {
        Data d = new Data();
        for (String name : FILES) {
            try (InputStream in = cl.getResourceAsStream("data/" + name + ".json")) {
                if (in == null) throw new IOException("data/" + name + ".json 이 jar 에 없습니다 — node RUC_RPG/scripts/export-mc.ts 를 먼저 실행하세요");
                JsonElement e = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                if (!e.isJsonObject()) throw new IOException("data/" + name + ".json 이 객체가 아닙니다");
                d.files.put(name, e.getAsJsonObject());
            }
        }
        return d;
    }

    public JsonObject file(String name) {
        JsonObject o = files.get(name);
        if (o == null) throw new IllegalArgumentException("데이터 파일 없음: " + name);
        return o;
    }

    /** "stats.BASE_STATS" 처럼 점으로 이은 경로 */
    public JsonElement get(String path) {
        String[] parts = path.split("\\.");
        JsonElement cur = file(parts[0]);
        for (int i = 1; i < parts.length; i++) {
            if (cur == null || !cur.isJsonObject()) return null;
            cur = cur.getAsJsonObject().get(parts[i]);
        }
        return cur;
    }

    public int count(String path) {
        JsonElement e = get(path);
        if (e == null) return 0;
        return e.isJsonObject() ? e.getAsJsonObject().size() : e.isJsonArray() ? e.getAsJsonArray().size() : 1;
    }
}
