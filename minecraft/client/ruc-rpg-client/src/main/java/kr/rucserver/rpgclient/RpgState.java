package kr.rucserver.rpgclient;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** 서버가 보낸 RPG 상태 (렌더 스레드에서만 읽고 씀). 형식은 서버 ClientBridge 주석과 같음. */
public final class RpgState {

    public record Skill(String key, String model, int cdLeft, int cdTotal, boolean noRes, long at) {}
    public record Effect(String model, int left, int stacks, boolean buff, long at) {}

    public static boolean active;
    public static String map = "";
    public static String res = "both";
    public static float mana, manaMax, energy, energyMax, stamina, staminaMax;
    public static boolean exhausted, showStats = true, showMinimap = true;
    public static final List<Skill> skills = new ArrayList<>();
    public static final List<Effect> effects = new ArrayList<>();
    public static final List<String> stats = new ArrayList<>();
    public static String toast = "";
    public static final Set<String> party = new HashSet<>();
    public static final List<int[]> markBlocks = new ArrayList<>();
    public static final Set<UUID> markEntities = new HashSet<>();

    public static void reset() {
        active = false; map = ""; skills.clear(); effects.clear(); stats.clear(); party.clear(); markBlocks.clear(); markEntities.clear(); toast = "";
    }

    static void read(byte[] data) throws IOException {
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(data));
        long now = System.currentTimeMillis();
        switch (in.readByte()) {
            case 1 -> active = true;   // HELLO
            case 2 -> {
                res = in.readUTF();
                mana = in.readFloat(); manaMax = in.readFloat();
                energy = in.readFloat(); energyMax = in.readFloat();
                stamina = in.readFloat(); staminaMax = in.readFloat();
                exhausted = in.readBoolean();
                skills.clear();
                for (int i = 0, n = in.readByte(); i < n; i++) skills.add(new Skill(in.readUTF(), in.readUTF(), in.readInt(), in.readInt(), in.readBoolean(), now));
                effects.clear();
                for (int i = 0, n = in.readByte(); i < n; i++) effects.add(new Effect(in.readUTF(), in.readInt(), in.readByte(), in.readBoolean(), now));
                stats.clear();
                for (int i = 0, n = in.readByte(); i < n; i++) stats.add(in.readUTF());
                showStats = in.readBoolean();
                showMinimap = in.readBoolean();
                toast = in.readUTF();
            }
            case 3 -> map = in.readUTF();
            case 4 -> { party.clear(); for (int i = 0, n = in.readByte(); i < n; i++) party.add(in.readUTF()); }
            case 5 -> {
                markBlocks.clear();
                for (int i = 0, n = in.readShort(); i < n; i++) markBlocks.add(new int[]{in.readInt(), in.readInt(), in.readInt()});
                markEntities.clear();
                for (int i = 0, n = in.readShort(); i < n; i++) markEntities.add(new UUID(in.readLong(), in.readLong()));
                Marks.refresh();
            }
            case 6 -> {   // 장신구 칸
                AccessoryPanel.slots.clear();
                for (int i = 0, n = in.readByte(); i < n; i++) {
                    String key = in.readUTF(), model = in.readUTF(), name = in.readUTF();
                    java.util.List<String> lore = new java.util.ArrayList<>();
                    for (int k = 0, m = in.readByte(); k < m; k++) lore.add(in.readUTF());
                    AccessoryPanel.slots.add(new AccessoryPanel.Slot(key, model, name, lore));
                }
            }
            default -> {}
        }
    }
}
