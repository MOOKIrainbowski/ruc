package kr.rucserver.rpg;

import org.bukkit.Location;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 안전 구역(광장) — 스태미나 소모 없음 · PvP 없음 (웹 RPG 광장 규칙, 베타 피드백 1차).
 * config.yml safe-zones: [{world, x1, z1, x2, z2}] — M6 에서 광장을 지으면 그 범위가 들어감.
 */
public final class SafeZones {

    private record Box(String world, double x1, double z1, double x2, double z2) {
        boolean has(Location l) {
            return l.getWorld() != null && l.getWorld().getName().equals(world)
                    && l.getX() >= x1 && l.getX() <= x2 && l.getZ() >= z1 && l.getZ() <= z2;
        }
    }

    private final List<Box> boxes = new ArrayList<>();

    public SafeZones(List<Map<?, ?>> raw) {
        for (Map<?, ?> m : raw) {
            double x1 = num(m.get("x1")), x2 = num(m.get("x2")), z1 = num(m.get("z1")), z2 = num(m.get("z2"));
            boxes.add(new Box(String.valueOf(m.get("world")), Math.min(x1, x2), Math.min(z1, z2), Math.max(x1, x2), Math.max(z1, z2)));
        }
    }

    private static double num(Object o) { return o instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(o)); }

    /** 광장 월드 전체 (RpgWorlds 가 채움) */
    public java.util.function.Predicate<Location> plaza = l -> false;

    public boolean contains(Location l) {
        if (plaza.test(l)) return true;
        for (Box b : boxes) if (b.has(l)) return true;
        return false;
    }
}
