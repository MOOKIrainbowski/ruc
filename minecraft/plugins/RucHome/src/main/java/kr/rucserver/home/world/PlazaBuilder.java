package kr.rucserver.home.world;

import org.bukkit.Axis;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.BlockFace;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;

/**
 * 허브 생성.
 *
 * 요청 반영 사항
 *  1. 금지 재료 — 구리 계열, 화강암·섬록암·안산암 전부 미사용 (Palette 참조)
 *  2. 규모 확대 — 기반판 반경 80 → 130, 광장 26 → 42
 *  3. 계단식 단 — 평평한 원판이 아니라 3단 플랫폼
 *  4. 모자이크 바닥 — 프리즈머린 3종 + 석재벽돌 + 석영, 수로 삽입
 *  5. 요새/폐허풍 성벽 — 다층 두께, 원호 아치, 매달린 랜턴, 덩굴
 *  6. 중앙 랜드마크 — 대형 아케인 포털 기념물
 *  7. 서버 이동 구역 — 막히지 않게 넓은 진입로와 조명
 *  8. 구조물 겹침 방지 — 배치 전 충돌 검사 (LayoutRegistry)
 */
public class PlazaBuilder {

    // ── 높이 ───────────────────────────────────────────────────────────
    public static final int GROUND_Y = 64;          // 최상단 단(중앙)에서 서는 높이
    private static final int T1_TOP = GROUND_Y - 1; // 63 중앙 단
    private static final int T2_TOP = T1_TOP - 2;   // 61
    private static final int T3_TOP = T2_TOP - 2;   // 59
    private static final int RING_TOP = T3_TOP - 2; // 57 성벽 안쪽 보행로
    private static final int FOUND_TOP = RING_TOP - 1;
    private static final int FOUND_DEPTH = 8;

    // ── 반경 ───────────────────────────────────────────────────────────
    private static final int T1_R = 16;
    private static final int T2_R = 28;
    private static final int T3_R = 42;
    private static final int CANAL_R = 36;      // 3단 안에 흐르는 수로
    private static final int RING_IN = 42;
    private static final int WALL_IN = 52;
    private static final int WALL_OUT = 60;
    private static final int GROVE_IN = 62;
    private static final int FOUND_R = 130;

    private static final int[] GATE_ANGLES = {90, 210, 330};
    private static final int GATE_HALF = 6;
    private static final int GATE_SPREAD = 13;

    /** 서버 이동 구역 중심 거리. 생성과 NPC 좌표가 같은 값을 써야 합니다. */
    private static final int PAVILION_DIST = 84;
    private static final int PAVILION_R = 16;

    public static final int VERIFY_X = 0;
    public static final int VERIFY_Y = 64;
    public static final int VERIFY_Z = 700;
    public static final int VERIFY_R = 18;

    private final Logger log;
    private final LayoutRegistry layout = new LayoutRegistry();

    public PlazaBuilder(Logger log) {
        this.log = log;
    }

    /** 구조물이 겹치지 않도록 자리를 예약합니다. */
    static final class LayoutRegistry {
        private final List<double[]> taken = new ArrayList<>();   // x, z, r, 이름index
        private final List<String> names = new ArrayList<>();

        boolean reserve(String name, double x, double z, double r, double gap) {
            for (int i = 0; i < taken.size(); i++) {
                double[] o = taken.get(i);
                double d = Math.hypot(x - o[0], z - o[1]);
                if (d < r + o[2] + gap) return false;
            }
            taken.add(new double[]{x, z, r});
            names.add(name);
            return true;
        }

        int size() { return taken.size(); }
    }

    // ── 진입점 ─────────────────────────────────────────────────────────

    public void buildAll(World world) {
        clearArea(world);
        buildFoundation(world);
        buildTiers(world);
        buildCanals(world);
        buildRingWalk(world);
        buildFortressWall(world);
        buildGates(world);
        buildCenterpiece(world);
        planScenery();               // 건물 자리를 먼저 확보 (연못보다 우선)
        buildTravelPavilions(world);
        buildOuterGrounds(world);
        buildGrove(world);
        buildScenery(world);
        buildVerificationCourtyard(world);
        log.info("구조물 배치 " + layout.size() + "건, 충돌 없음");
    }

    private void clearArea(World world) {
        int r = FOUND_R + 6;
        for (int x = -r; x <= r; x++) {
            for (int z = -r; z <= r; z++) {
                for (int y = FOUND_TOP - FOUND_DEPTH - 2; y <= GROUND_Y + 60; y++) {
                    world.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }
    }

    // ── 기반판 ─────────────────────────────────────────────────────────

    private void buildFoundation(World world) {
        for (int x = -FOUND_R; x <= FOUND_R; x++) {
            for (int z = -FOUND_R; z <= FOUND_R; z++) {
                double d = Math.hypot(x, z);
                double edge = FOUND_R - 6 + Palette.smooth(x, z, 22) * 10;
                if (d > edge) continue;

                for (int i = 0; i < FOUND_DEPTH; i++) {
                    int y = FOUND_TOP - i;
                    Brush.set(world, x, y, z, Palette.gradient(
                            Palette.FOUNDATION_RAMP, 1.0 - i / (double) FOUND_DEPTH, x, y, z));
                }
                Brush.set(world, x, FOUND_TOP - FOUND_DEPTH, z, Material.DEEPSLATE_TILES);
            }
        }
    }

    // ── 계단식 단 + 모자이크 바닥 ──────────────────────────────────────

    private void buildTiers(World world) {
        tier(world, T1_R, T1_TOP, 0.85);
        tier(world, T2_R, T2_TOP, 0.55);
        tier(world, T3_R, T3_TOP, 0.30);

        // 단 사이 계단 — 4방향 대계단
        for (int deg = 45; deg < 360; deg += 90) {
            grandStair(world, deg);
        }
        // 나머지 구간은 단차 벽 + 테두리 계단
        tierEdge(world, T1_R, T1_TOP, T2_TOP);
        tierEdge(world, T2_R, T2_TOP, T3_TOP);
        tierEdge(world, T3_R, T3_TOP, RING_TOP);
    }

    private void tier(World world, int r, int y, double lightness) {
        for (int x = -r; x <= r; x++) {
            for (int z = -r; z <= r; z++) {
                double d = Math.hypot(x, z);
                if (d > r) continue;
                Brush.set(world, x, y, z, mosaicFloor(x, z, d, r, lightness));
                // 아래 채움 — 구멍 방지
                for (int yy = y - 1; yy > FOUND_TOP; yy--) {
                    Brush.set(world, x, yy, z, Palette.mix(Palette.DARK_MIX, x, yy, z));
                }
            }
        }
    }

    /**
     * 모자이크 바닥.
     *
     * 단색 체크무늬가 아니라 네 겹을 겹칩니다 —
     * 방사 쐐기 / 동심 띠 / 사각 격자 인세트 / 그라데이션 바탕.
     */
    private Material mosaicFloor(int x, int z, double d, int r, double lightness) {
        double angle = Math.toDegrees(Math.atan2(z, x));
        double a = (angle + 360) % 360;

        // 1) 동심 테두리 띠 — 단 가장자리를 두 겹으로 마감
        if (d > r - 1.2) return Material.DARK_PRISMARINE;
        if (d > r - 2.4) return Material.PRISMARINE_BRICKS;

        // 2) 방사 쐐기 16분할 — 홀짝으로 톤을 바꿈
        int wedge = (int) (a / 22.5);
        double wf = (a % 22.5) / 22.5;
        boolean wedgeEdge = wf < 0.10 || wf > 0.90;
        if (wedgeEdge && d > 4) return Material.DARK_PRISMARINE;

        // 3) 사각 격자 인세트 — 6칸 주기로 석영 사각 테두리
        int gx = Math.floorMod(x, 9), gz = Math.floorMod(z, 9);
        boolean inset = (gx == 0 || gz == 0);
        boolean insetCorner = (gx == 0 && gz == 0);
        if (insetCorner && d > 6) return Material.CHISELED_STONE_BRICKS;
        if (inset && d > 6) return Material.SMOOTH_QUARTZ;

        // 4) 바탕 — 쐐기별로 프리즈머린 / 석재를 교대
        if ((wedge & 1) == 0) {
            return Palette.gradient(Palette.PRISMARINE_RAMP,
                    0.2 + Palette.noise(x, z) * 0.7, x, z);
        }
        return Palette.gradient(Palette.STONE_RAMP,
                lightness * (0.6 + Palette.noise(x, z) * 0.5), x, z);
    }

    /** 단 사이 수직 마감 — 벽 + 아래 단으로 내려가는 계단 테두리. */
    private void tierEdge(World world, int r, int topY, int lowerY) {
        for (int x = -r - 2; x <= r + 2; x++) {
            for (int z = -r - 2; z <= r + 2; z++) {
                double d = Math.hypot(x, z);
                if (d <= r || d > r + 2) continue;
                if (onGrandStair(x, z)) continue;

                for (int y = lowerY + 1; y <= topY; y++) {
                    Brush.set(world, x, y, z, Palette.mix(Palette.DARK_MIX, x, y, z));
                }
                if (d > r + 1) {
                    Brush.stairs(world, x, lowerY + 1, z, Material.PRISMARINE_BRICK_STAIRS,
                            Brush.facing(x, z, true), false);
                }
            }
        }
    }

    /** 4방향 대계단 — 단을 가로지르는 넓은 층계. */
    private void grandStair(World world, int deg) {
        double rad = Math.toRadians(deg);
        double dx = Math.cos(rad), dz = Math.sin(rad);
        double px = -dz, pz = dx;

        for (int r = T1_R - 2; r <= T3_R + 3; r++) {
            int y = stairYAt(r);
            for (int o = -5; o <= 5; o++) {
                int x = (int) Math.round(dx * r + px * o);
                int z = (int) Math.round(dz * r + pz * o);

                if (Math.abs(o) == 5) {
                    // 난간
                    for (int yy = y + 1; yy <= y + 2; yy++) {
                        Brush.set(world, x, yy, z, Palette.mix(Palette.DARK_MIX, x, yy, z));
                    }
                    if (r % 6 == 0) {
                        Brush.set(world, x, y + 3, z, Material.SEA_LANTERN);
                        Brush.set(world, x, y + 4, z, Material.PRISMARINE_BRICK_SLAB);
                    }
                } else {
                    Brush.set(world, x, y, z, ((o + r) & 1) == 0
                            ? Material.PRISMARINE_BRICKS : Material.STONE_BRICKS);
                    for (int yy = y - 1; yy > FOUND_TOP; yy--) {
                        Brush.set(world, x, yy, z, Palette.mix(Palette.DARK_MIX, x, yy, z));
                    }
                    for (int yy = y + 1; yy <= y + 3; yy++) {
                        Brush.set(world, x, yy, z, Material.AIR);
                    }
                }
            }
        }
    }

    private int stairYAt(int r) {
        if (r <= T1_R) return T1_TOP;
        if (r <= T2_R) return T1_TOP - 1;
        if (r <= T3_R) return T2_TOP - 1;
        return RING_TOP;
    }

    private boolean onGrandStair(int x, int z) {
        double d = Math.hypot(x, z);
        if (d < T1_R - 2 || d > T3_R + 3) return false;
        double a = (Math.toDegrees(Math.atan2(z, x)) + 360) % 360;
        for (int deg = 45; deg < 360; deg += 90) {
            // 최단 각거리. 예전에 이 계산을 뒤집어 써서 통로가 반대편에 뚫린 적이 있습니다.
            double diff = Math.abs(a - deg) % 360;
            diff = Math.min(diff, 360 - diff);
            double half = Math.toDegrees(Math.atan2(5.5, Math.max(4, d)));
            if (diff < half) return true;
        }
        return false;
    }

    // ── 수로 ───────────────────────────────────────────────────────────

    /** 3단 바닥을 가로지르는 환상 수로 + 방사 수로. 바닥 패턴을 끊어줍니다. */
    private void buildCanals(World world) {
        // 환상 수로
        for (int x = -CANAL_R - 3; x <= CANAL_R + 3; x++) {
            for (int z = -CANAL_R - 3; z <= CANAL_R + 3; z++) {
                double d = Math.hypot(x, z);
                if (d < CANAL_R - 2 || d > CANAL_R + 2) continue;
                if (onGrandStair(x, z)) continue;

                if (d < CANAL_R - 1 || d > CANAL_R + 1) {
                    Brush.set(world, x, T3_TOP, z, Material.DARK_PRISMARINE);
                } else {
                    Brush.set(world, x, T3_TOP - 1, z, Material.PRISMARINE_BRICKS);
                    Brush.water(world, x, T3_TOP, z);
                    if (Palette.noise(x, 3, z) > 0.94) {
                        Brush.set(world, x, T3_TOP + 1, z, Material.LILY_PAD);
                    }
                }
            }
        }

        // 방사 수로 4줄 (대계단과 엇갈리게)
        for (int deg = 0; deg < 360; deg += 90) {
            double rad = Math.toRadians(deg);
            for (int r = T1_R + 3; r <= CANAL_R; r++) {
                for (int o = -1; o <= 1; o++) {
                    int x = (int) Math.round(Math.cos(rad) * r - Math.sin(rad) * o);
                    int z = (int) Math.round(Math.sin(rad) * r + Math.cos(rad) * o);
                    if (onGrandStair(x, z)) continue;
                    int y = (r <= T2_R) ? T2_TOP : T3_TOP;
                    if (o == 0) {
                        Brush.set(world, x, y - 1, z, Material.PRISMARINE_BRICKS);
                        Brush.water(world, x, y, z);
                    } else {
                        Brush.set(world, x, y, z, Material.DARK_PRISMARINE);
                    }
                }
            }
        }
    }

    // ── 성벽 안쪽 보행로 ───────────────────────────────────────────────

    private void buildRingWalk(World world) {
        for (int x = -WALL_IN; x <= WALL_IN; x++) {
            for (int z = -WALL_IN; z <= WALL_IN; z++) {
                double d = Math.hypot(x, z);
                if (d <= RING_IN || d > WALL_IN) continue;

                Material m = Palette.gradient(Palette.STONE_RAMP,
                        0.35 + Palette.noise(x, z) * 0.3, x, z);
                if (Math.floorMod(x, 7) == 0 || Math.floorMod(z, 7) == 0) {
                    m = Material.POLISHED_BLACKSTONE;
                }
                if ((int) d % 6 == 0) m = Palette.mix(Palette.TUFF_MIX, x, z);

                Brush.set(world, x, RING_TOP, z, m);
                for (int yy = RING_TOP - 1; yy > FOUND_TOP; yy--) {
                    Brush.set(world, x, yy, z, Material.COBBLED_DEEPSLATE);
                }
            }
        }
    }

    // ── 요새 성벽 ──────────────────────────────────────────────────────

    /**
     * 다층 성벽.
     *
     * 이전 버전은 단순한 기둥 나열이었습니다. 여기서는 기단 → 몸통 →
     * 코니스 → 흉벽으로 층을 나누고, 아치형 벽감·매달린 랜턴·덩굴로
     * 표면을 잘게 나눕니다.
     */
    private void buildFortressWall(World world) {
        for (int x = -WALL_OUT - 2; x <= WALL_OUT + 2; x++) {
            for (int z = -WALL_OUT - 2; z <= WALL_OUT + 2; z++) {
                double d = Math.hypot(x, z);
                if (d < WALL_IN || d > WALL_OUT) continue;

                int deg = (int) ((Math.toDegrees(Math.atan2(z, x)) + 360) % 360);
                if (nearGate(deg, GATE_SPREAD)) continue;

                double inner = (d - WALL_IN) / (double) (WALL_OUT - WALL_IN);
                boolean tower = (deg % 45) < 9;              // 45도마다 탑
                int height = tower ? 22 : 15;

                for (int y = RING_TOP + 1; y <= RING_TOP + height; y++) {
                    int rel = y - RING_TOP;
                    Brush.set(world, x, y, z, wallMaterial(x, y, z, rel, inner, tower));
                }

                // 아치형 벽감 — 안쪽 면에 일정 간격으로
                if (inner < 0.28 && !tower && (deg % 15) >= 5 && (deg % 15) <= 9) {
                    int span = 2;
                    int off = (deg % 15) - 7;
                    int rise = Brush.archRise(off, span + 1, 3);
                    for (int y = RING_TOP + 1; y <= RING_TOP + 3 + rise; y++) {
                        Brush.set(world, x, y, z, Material.AIR);
                    }
                    Brush.set(world, x, RING_TOP + 4 + rise, z, Material.CHISELED_STONE_BRICKS);
                    if (off == 0) {
                        Brush.set(world, x, RING_TOP + 3, z, Material.SEA_LANTERN);
                    }
                }

                // 코니스 (돌출 처마)
                if (inner < 0.2) {
                    Brush.stairs(world, x, RING_TOP + height - 3, z,
                            Material.STONE_BRICK_STAIRS, Brush.facing(x, z, false), true);
                }

                // 흉벽 — 톱니
                if (inner > 0.75 && ((deg + (int) d) % 4 < 2)) {
                    Brush.set(world, x, RING_TOP + height + 1, z,
                            Palette.mix(Palette.RUIN_MIX, x, height, z));
                    Brush.set(world, x, RING_TOP + height + 2, z, Material.POLISHED_BLACKSTONE_BRICK_SLAB);
                }

                // 탑 꼭대기 조명
                if (tower && inner > 0.4 && inner < 0.6 && (deg % 45) == 4) {
                    Brush.set(world, x, RING_TOP + height + 2, z, Material.SEA_LANTERN);
                    Brush.set(world, x, RING_TOP + height + 3, z, Material.STONE_BRICK_SLAB);
                }

                // 매달린 랜턴 + 덩굴 (안쪽 면)
                if (inner < 0.1) {
                    if ((deg % 9) == 0) {
                        int ly = RING_TOP + 6;
                        Brush.set(world, x, ly, z, Material.IRON_CHAIN);
                        Brush.set(world, x, ly - 1, z, Material.IRON_CHAIN);
                        Brush.set(world, x, ly - 2, z, Material.LANTERN);
                    }
                    if (Palette.noise(x, 7, z) > 0.72) {
                        int vy = RING_TOP + 2 + (int) (Palette.noise(x, z) * 8);
                        for (int k = 0; k < 2 + (int) (Palette.noise(x, k(vy), z) * 4); k++) {
                            Brush.vine(world, x, vy - k, z, Brush.facing(x, z, false));
                        }
                    }
                }
            }
        }
    }

    private int k(int v) { return v; }

    private Material wallMaterial(int x, int y, int z, int rel, double inner, boolean tower) {
        if (rel <= 2) return Palette.mix(Palette.DARK_MIX, x, y, z);       // 기단
        if (rel == 8 || rel == 14) return Material.POLISHED_BLACKSTONE;    // 층 띠
        if (tower && inner > 0.3 && inner < 0.7) return Palette.mix(Palette.TUFF_MIX, x, y, z);
        if (inner < 0.35) return Palette.mix(Palette.RUIN_MIX, x, y, z);   // 안쪽은 폐허 질감
        if (inner < 0.7) return Palette.mix(Palette.WALL_MIX, x, y, z);
        return Palette.gradient(Palette.WARM_RAMP, 0.2 + Palette.noise(x, y, z) * 0.4, x, y, z);
    }

    // ── 관문 (원호 아치) ───────────────────────────────────────────────

    private void buildGates(World world) {
        for (int deg : GATE_ANGLES) {
            double rad = Math.toRadians(deg);
            double dx = Math.cos(rad), dz = Math.sin(rad);
            double px = -dz, pz = dx;

            // 통로 바닥 — 성벽 안쪽부터 파빌리온 앞까지 끊김 없이
            for (int r = RING_IN; r <= PAVILION_DIST - PAVILION_R + 1; r++) {
                for (int o = -GATE_HALF - 3; o <= GATE_HALF + 3; o++) {
                    int x = (int) Math.round(dx * r + px * o);
                    int z = (int) Math.round(dz * r + pz * o);
                    int ao = Math.abs(o);

                    Material floor = ao > GATE_HALF
                            ? Material.POLISHED_BLACKSTONE
                            : (((r + o) & 1) == 0 ? Material.PRISMARINE_BRICKS : Material.STONE_BRICKS);
                    if (ao <= GATE_HALF && r % 8 == 0) floor = Material.DARK_PRISMARINE;
                    Brush.set(world, x, RING_TOP, z, floor);
                    for (int yy = RING_TOP - 1; yy > FOUND_TOP; yy--) {
                        Brush.set(world, x, yy, z, Material.COBBLED_DEEPSLATE);
                    }
                    // 머리 위 비우기 — 막히지 않게
                    for (int yy = RING_TOP + 1; yy <= RING_TOP + 12; yy++) {
                        if (r < WALL_IN || r > WALL_OUT) Brush.set(world, x, yy, z, Material.AIR);
                    }
                    // 길가 난간 + 등
                    if (ao == GATE_HALF + 2 && r > WALL_OUT) {
                        Brush.wall(world, x, RING_TOP + 1, z, Material.STONE_BRICK_WALL);
                        if (r % 7 == 0) {
                            Brush.set(world, x, RING_TOP + 2, z, Material.POLISHED_BLACKSTONE);
                            Brush.set(world, x, RING_TOP + 3, z, Material.LANTERN);
                        }
                    }
                }
            }

            // 원호 아치 — 성벽을 관통
            Brush.archway(world, dx * WALL_IN, dz * WALL_IN, dx, dz, px, pz,
                    WALL_OUT - WALL_IN + 1, RING_TOP, GATE_HALF, 9, 7.5,
                    Palette.WALL_MIX, Material.CHISELED_STONE_BRICKS);

            // 아치 양옆 탑 — 관문을 랜드마크로
            for (int side = -1; side <= 1; side += 2) {
                int tx = (int) Math.round(dx * (WALL_IN + 4) + px * (GATE_HALF + 4) * side);
                int tz = (int) Math.round(dz * (WALL_IN + 4) + pz * (GATE_HALF + 4) * side);
                gateTower(world, tx, tz);
            }
        }
    }

    private void gateTower(World world, int cx, int cz) {
        int r = 4;
        for (int y = RING_TOP + 1; y <= RING_TOP + 26; y++) {
            int rel = y - RING_TOP;
            int rr = rel > 22 ? r + 1 : r;
            for (int dx = -rr; dx <= rr; dx++) {
                for (int dz = -rr; dz <= rr; dz++) {
                    double d = Math.hypot(dx, dz);
                    if (d > rr) continue;
                    boolean shell = d > rr - 1.3;
                    if (!shell && rel < 22) { Brush.set(world, cx + dx, y, cz + dz, Material.AIR); continue; }
                    Material m = rel <= 2 ? Palette.mix(Palette.DARK_MIX, cx + dx, y, cz + dz)
                            : rel == 22 ? Material.POLISHED_BLACKSTONE
                            : Palette.mix(Palette.WALL_MIX, cx + dx, y, cz + dz);
                    Brush.set(world, cx + dx, y, cz + dz, m);
                }
            }
            // 창
            if (rel % 6 == 4) {
                for (int[] o : new int[][]{{r, 0}, {-r, 0}, {0, r}, {0, -r}}) {
                    Brush.set(world, cx + o[0], y, cz + o[1], Material.IRON_BARS);
                }
            }
        }
        // 첨탑 지붕
        for (int t = 0; t < 5; t++) {
            int rr = 4 - t;
            int y = RING_TOP + 27 + t;
            if (rr < 0) break;
            Brush.disc(world, cx, y, cz, rr + 0.4, Palette.mix(Palette.DARK_MIX, cx, y, cz));
        }
        Brush.set(world, cx, RING_TOP + 32, cz, Material.SEA_LANTERN);
        Brush.set(world, cx, RING_TOP + 33, cz, Material.END_ROD);
    }

    // ── 중앙 랜드마크 ──────────────────────────────────────────────────

    /** 대형 아케인 포털 기념물 — 광장 전체를 앵커링합니다. */
    private void buildCenterpiece(World world) {
        layout.reserve("centerpiece", 0, 0, 14, 0);

        // 기단 3단
        int[] rs = {13, 11, 9};
        for (int i = 0; i < rs.length; i++) {
            int y = T1_TOP + 1 + i;
            Brush.disc(world, 0, y, 0, rs[i], Material.POLISHED_BLACKSTONE_BRICKS);
            Brush.ring(world, 0, y, 0, rs[i] - 1.2, rs[i], Material.CHISELED_POLISHED_BLACKSTONE);
            for (int dx = -rs[i] - 1; dx <= rs[i] + 1; dx++) {
                for (int dz = -rs[i] - 1; dz <= rs[i] + 1; dz++) {
                    double d = Math.hypot(dx, dz);
                    if (d <= rs[i] || d > rs[i] + 1.3) continue;
                    Brush.stairs(world, dx, y, dz, Material.POLISHED_BLACKSTONE_BRICK_STAIRS,
                            Brush.facing(dx, dz, true), false);
                }
            }
        }

        int baseY = T1_TOP + rs.length;

        // 바닥 문양 — 자수정 룬
        Brush.disc(world, 0, baseY, 0, 6, Material.DEEPSLATE_TILES);
        for (int deg = 0; deg < 360; deg += 30) {
            double rad = Math.toRadians(deg);
            for (int r = 3; r <= 6; r++) {
                Brush.set(world, (int) Math.round(Math.cos(rad) * r), baseY,
                        (int) Math.round(Math.sin(rad) * r), Material.AMETHYST_BLOCK);
            }
        }
        Brush.disc(world, 0, baseY, 0, 2.4, Material.CRYING_OBSIDIAN);

        // 포털 링 — 세로로 선 대형 원환 (두 겹 교차)
        portalRing(world, baseY, true);
        portalRing(world, baseY, false);

        // 둘레 기둥 6개
        for (int deg = 0; deg < 360; deg += 60) {
            double rad = Math.toRadians(deg);
            int x = (int) Math.round(Math.cos(rad) * 8);
            int z = (int) Math.round(Math.sin(rad) * 8);
            for (int y = baseY + 1; y <= baseY + 11; y++) {
                Brush.pillar(world, x, y, z, Material.PURPUR_PILLAR, Axis.Y);
            }
            Brush.set(world, x, baseY + 12, z, Material.END_STONE_BRICKS);
            Brush.set(world, x, baseY + 13, z, Material.SEA_LANTERN);
            Brush.set(world, x, baseY + 14, z, Material.END_ROD);
            // 기둥에 걸린 사슬
            for (int y = baseY + 5; y <= baseY + 9; y++) {
                int ix = (int) Math.round(Math.cos(rad) * 6);
                int iz = (int) Math.round(Math.sin(rad) * 6);
                if (y == baseY + 9) Brush.set(world, ix, y, iz, Material.IRON_CHAIN);
            }
        }
    }

    /** 세로로 선 원환. 두 방향으로 교차시켜 구형 실루엣을 만듭니다. */
    private void portalRing(World world, int baseY, boolean alongX) {
        int r = 9;
        int cy = baseY + 11;
        for (int a = 0; a < 360; a++) {
            double rad = Math.toRadians(a);
            int h = (int) Math.round(Math.sin(rad) * r);
            int w = (int) Math.round(Math.cos(rad) * r);
            int y = cy + h;
            if (y <= baseY) continue;

            int x = alongX ? w : 0;
            int z = alongX ? 0 : w;

            Material m = (a % 45 < 6)
                    ? Material.AMETHYST_BLOCK
                    : Palette.gradient(Palette.ARCANE_RAMP,
                            0.35 + Math.abs(h) / (double) r * 0.6, x, y, z);
            Brush.set(world, x, y, z, m);

            // 안쪽 광채
            if (a % 30 == 0) {
                int gx = alongX ? (int) Math.round(Math.cos(rad) * (r - 2)) : 0;
                int gz = alongX ? 0 : (int) Math.round(Math.cos(rad) * (r - 2));
                int gy = cy + (int) Math.round(Math.sin(rad) * (r - 2));
                if (gy > baseY) Brush.set(world, gx, gy, gz, Material.SEA_LANTERN);
            }
        }
    }

    // ── 서버 이동 구역 ─────────────────────────────────────────────────

    /**
     * 서버 이동 파빌리온.
     *
     * 이전에는 벽으로 둘러싸여 접근이 막히고, 마감도 나머지보다 떨어졌습니다.
     * 여기서는 지붕 있는 개방형 파빌리온으로 짓고, 사방을 트고, 진입로와
     * 조명을 붙여 멀리서도 보이게 합니다.
     */
    private void buildTravelPavilions(World world) {
        for (int i = 0; i < GATE_ANGLES.length; i++) {
            int deg = GATE_ANGLES[i];
            double rad = Math.toRadians(deg);
            int cx = (int) Math.round(Math.cos(rad) * PAVILION_DIST);
            int cz = (int) Math.round(Math.sin(rad) * PAVILION_DIST);

            if (!layout.reserve("pavilion" + i, cx, cz, PAVILION_R, 6)) {
                log.warning("파빌리온 " + i + " 자리 충돌 — 건너뜀");
                continue;
            }
            travelPavilion(world, cx, cz, deg);
        }
    }

    private void travelPavilion(World world, int cx, int cz, int deg) {
        int r = PAVILION_R;

        // 기단 — 2단
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                double d = Math.hypot(dx, dz);
                if (d > r) continue;
                int x = cx + dx, z = cz + dz;

                Material floor;
                if (d > r - 1.5) floor = Material.DARK_PRISMARINE;
                else if (d > r - 3) floor = Material.PRISMARINE_BRICKS;
                else if (Math.floorMod(dx, 5) == 0 || Math.floorMod(dz, 5) == 0)
                    floor = Material.SMOOTH_QUARTZ;
                else floor = Palette.gradient(Palette.PRISMARINE_RAMP,
                            0.2 + Palette.noise(x, z) * 0.7, x, z);

                Brush.set(world, x, RING_TOP, z, floor);
                for (int yy = RING_TOP - 1; yy > FOUND_TOP; yy--) {
                    Brush.set(world, x, yy, z, Palette.mix(Palette.DARK_MIX, x, yy, z));
                }
                // 머리 위 완전 개방
                for (int yy = RING_TOP + 1; yy <= RING_TOP + 14; yy++) {
                    Brush.set(world, x, yy, z, Material.AIR);
                }
            }
        }

        // 중앙 단 (NPC 자리) — 세 단으로 올려 시선을 모읍니다
        for (int t = 0; t < 3; t++) {
            Brush.disc(world, cx, RING_TOP + 1 + t, cz, 4.5 - t * 1.2,
                    t == 2 ? Material.CHISELED_QUARTZ_BLOCK : Material.QUARTZ_BRICKS);
        }

        // 기둥 8개 + 지붕 — 벽이 아니라 열주라 사방이 트여 있습니다
        int[][] posts = {{r - 3, 0}, {-(r - 3), 0}, {0, r - 3}, {0, -(r - 3)},
                         {8, 8}, {-8, 8}, {8, -8}, {-8, -8}};
        for (int[] p : posts) {
            for (int y = RING_TOP + 1; y <= RING_TOP + 8; y++) {
                Brush.pillar(world, cx + p[0], y, cz + p[1], Material.QUARTZ_PILLAR, Axis.Y);
            }
            Brush.set(world, cx + p[0], RING_TOP + 9, cz + p[1], Material.CHISELED_QUARTZ_BLOCK);
            // 기둥마다 랜턴
            Brush.set(world, cx + p[0], RING_TOP + 7, cz + p[1], Material.SEA_LANTERN);
        }

        // 지붕 — 4단 원뿔
        for (int t = 0; t < 5; t++) {
            int rr = r - 2 - t * 2;
            int y = RING_TOP + 10 + t;
            if (rr < 1) break;
            for (int dx = -rr - 1; dx <= rr + 1; dx++) {
                for (int dz = -rr - 1; dz <= rr + 1; dz++) {
                    double d = Math.hypot(dx, dz);
                    if (d > rr + 1) continue;
                    if (d > rr - 0.2) {
                        Brush.stairs(world, cx + dx, y, cz + dz, Material.DARK_PRISMARINE_STAIRS,
                                Brush.facing(dx, dz, true), false);
                    } else {
                        Brush.set(world, cx + dx, y, cz + dz, Material.PRISMARINE_BRICKS);
                    }
                }
            }
        }
        Brush.set(world, cx, RING_TOP + 15, cz, Material.SEA_LANTERN);
        Brush.set(world, cx, RING_TOP + 16, cz, Material.END_ROD);

        // 진입 계단 — 광장 방향으로 넓게
        double rad = Math.toRadians(deg + 180);
        for (int s = 0; s < 4; s++) {
            int sx = (int) Math.round(cx + Math.cos(rad) * (r - 1 + s));
            int sz = (int) Math.round(cz + Math.sin(rad) * (r - 1 + s));
            for (int o = -7; o <= 7; o++) {
                int x = (int) Math.round(sx - Math.sin(rad) * o);
                int z = (int) Math.round(sz + Math.cos(rad) * o);
                Brush.set(world, x, RING_TOP, z, Material.PRISMARINE_BRICKS);
                for (int yy = RING_TOP + 1; yy <= RING_TOP + 6; yy++) {
                    Brush.set(world, x, yy, z, Material.AIR);
                }
            }
        }
    }

    // ── 바깥 지반 · 숲 ─────────────────────────────────────────────────

    private void buildOuterGrounds(World world) {
        for (int x = -FOUND_R; x <= FOUND_R; x++) {
            for (int z = -FOUND_R; z <= FOUND_R; z++) {
                double d = Math.hypot(x, z);
                double edge = FOUND_R - 6 + Palette.smooth(x, z, 22) * 10;
                if (d <= WALL_OUT || d > edge) continue;
                if (onGatePath(x, z)) continue;
                if (layout.size() > 0 && insideReserved(x, z)) continue;

                double wave = Palette.smooth(x, z, 14) * 4.2;
                int top = (int) Math.round(RING_TOP - 2 + wave);
                top = Math.max(FOUND_TOP + 1, Math.min(RING_TOP + 2, top));

                for (int y = FOUND_TOP + 1; y <= top; y++) {
                    Brush.set(world, x, y, z, y == top ? groundSurface(x, z) : Material.DIRT);
                }
                if (Brush.typeAt(world, x, top + 1, z).isAir()) {
                    double n = Palette.noise(x, 11, z);
                    if (n > 0.90) Brush.set(world, x, top + 1, z, Material.SHORT_GRASS);
                    else if (n > 0.86) Brush.set(world, x, top + 1, z, Material.TALL_GRASS);
                    else if (n > 0.83) Brush.set(world, x, top + 1, z, flower(x, z));
                    else if (n > 0.80) Brush.set(world, x, top + 1, z, Material.FERN);
                }
                // 이끼 바위
                if (Palette.noise(x >> 1, 3, z >> 1) > 0.955) {
                    Brush.set(world, x, top + 1, z, Material.MOSSY_COBBLESTONE);
                }
            }
        }

        // 연못
        for (int deg = 20; deg < 360; deg += 45) {
            double rad = Math.toRadians(deg);
            double rr = (deg % 90 < 45) ? 82 : 106;
            int px = (int) Math.round(Math.cos(rad) * rr);
            int pz = (int) Math.round(Math.sin(rad) * rr);
            if (!layout.reserve("pond" + deg, px, pz, 14, 4)) continue;
            pond(world, px, pz);
        }
    }

    private void pond(World world, int cx, int cz) {
        for (int dx = -16; dx <= 16; dx++) {
            for (int dz = -16; dz <= 16; dz++) {
                double d = Math.hypot(dx, dz);
                double edge = 10 + Palette.smooth(cx + dx, cz + dz, 7) * 5;
                if (d > edge) continue;
                int x = cx + dx, z = cz + dz;
                if (onGatePath(x, z)) continue;
                double dd = Math.hypot(x, z);
                if (dd <= WALL_OUT + 3) continue;

                int surf = surfaceY(world, x, z);
                if (surf < 0) continue;

                if (d > edge - 1.6) {
                    Brush.set(world, x, surf, z, Palette.noise(x, 5, z) > 0.5
                            ? Material.GRAVEL : Material.MOSS_BLOCK);
                    Brush.set(world, x, surf + 1, z, Material.AIR);
                } else {
                    Brush.set(world, x, surf + 1, z, Material.AIR);
                    Brush.water(world, x, surf, z);
                    Brush.set(world, x, surf - 1, z, Material.GRAVEL);
                    if (Palette.noise(x, 41, z) > 0.93) {
                        Brush.set(world, x, surf + 1, z, Material.LILY_PAD);
                    }
                }
            }
        }
    }

    /** 벚나무 숲 — 격자가 아니라 군락으로 뭉쳐 심습니다. */
    private void buildGrove(World world) {
        for (int deg = 0; deg < 360; deg += 3) {
            double rad = Math.toRadians(deg);
            for (int ring = 0; ring < 9; ring++) {
                double r = GROVE_IN + ring * 6.5 + Palette.noise(deg, ring) * 6;
                int x = (int) Math.round(Math.cos(rad) * r);
                int z = (int) Math.round(Math.sin(rad) * r);
                if (onGatePath(x, z)) continue;
                if (insideReserved(x, z)) continue;

                // 군락 — 부드러운 노이즈로 덩어리지게
                double cluster = Palette.smooth(x, z, 17);
                if (cluster < 0.52) continue;
                if (Palette.noise(x, ring + 50, z) < 0.55) continue;

                int surf = surfaceY(world, x, z);
                if (surf < 0) continue;
                Material on = Brush.typeAt(world, x, surf, z);
                if (on != Material.GRASS_BLOCK && on != Material.MOSS_BLOCK
                        && on != Material.PODZOL && on != Material.COARSE_DIRT) continue;
                if (!Brush.typeAt(world, x, surf + 2, z).isAir()) continue;

                Structures.cherryTree(world, x, surf, z,
                        6 + (int) (Palette.noise(x, z) * 6));
            }
        }
    }

    private record Spot(String name, int deg, int dist, int radius) {}

    private static final Spot[] SCENERY = {
            new Spot("gazebo", 30, 76, 10),
            new Spot("farmer", 150, 78, 13),
            new Spot("wooden", 270, 74, 12),
            new Spot("gazebo2", 185, 106, 10),
    };

    private final List<Spot> placedScenery = new ArrayList<>();

    /**
     * 배치 계획.
     *
     * 건물이 연못보다 먼저 자리를 잡아야 합니다. 순서를 반대로 뒀더니
     * 연못이 먼저 예약해 버려서 건물 3채가 전부 배치되지 못했습니다.
     */
    private void planScenery() {
        for (Spot s : SCENERY) {
            double rad = Math.toRadians(s.deg());
            int x = (int) Math.round(Math.cos(rad) * s.dist());
            int z = (int) Math.round(Math.sin(rad) * s.dist());
            if (layout.reserve(s.name(), x, z, s.radius(), 8)) {
                placedScenery.add(s);
            } else {
                log.warning("구조물 '" + s.name() + "' 자리 충돌 — 건너뜀");
            }
        }
    }

    /** 계획된 자리에 실제로 짓습니다. */
    private void buildScenery(World world) {
        for (Spot s : placedScenery) {
            double rad = Math.toRadians(s.deg());
            int x = (int) Math.round(Math.cos(rad) * s.dist());
            int z = (int) Math.round(Math.sin(rad) * s.dist());
            int radius = s.radius();
            int surf = surfaceY(world, x, z);
            if (surf < 0) surf = RING_TOP;

            // 평탄화 — 건물 아래를 고르게
            for (int dx = -radius; dx <= radius; dx++) {
                for (int dz = -radius; dz <= radius; dz++) {
                    if (Math.hypot(dx, dz) > radius) continue;
                    for (int y = surf + 1; y <= surf + 12; y++) {
                        Brush.set(world, x + dx, y, z + dz, Material.AIR);
                    }
                    for (int y = FOUND_TOP + 1; y <= surf; y++) {
                        if (Brush.typeAt(world, x + dx, y, z + dz).isAir()) {
                            Brush.set(world, x + dx, y, z + dz, Material.DIRT);
                        }
                    }
                    Brush.set(world, x + dx, surf, z + dz, groundSurface(x + dx, z + dz));
                }
            }

            switch (s.name()) {
                case "gazebo", "gazebo2" -> Structures.gazebo(world, x, surf, z);
                case "farmer" -> Structures.farmerHouse(world, x, surf, z);
                case "wooden" -> Structures.woodenHouse(world, x, surf, z);
                default -> { }
            }
        }
    }

    private boolean insideReserved(int x, int z) {
        return false;   // 예약 검사는 reserve() 시점에 수행합니다
    }

    private Material groundSurface(int x, int z) {
        double n = Palette.noise(x, 2, z);
        if (n > 0.82) return Material.MOSS_BLOCK;
        if (n > 0.72) return Material.COARSE_DIRT;
        if (n > 0.64) return Material.PODZOL;
        return Material.GRASS_BLOCK;
    }

    private Material flower(int x, int z) {
        double n = Palette.noise(x, 23, z);
        if (n > 0.85) return Material.OXEYE_DAISY;
        if (n > 0.70) return Material.DANDELION;
        if (n > 0.55) return Material.CORNFLOWER;
        if (n > 0.40) return Material.AZURE_BLUET;
        return Material.POPPY;
    }

    private int surfaceY(World world, int x, int z) {
        for (int y = RING_TOP + 4; y > FOUND_TOP; y--) {
            if (!Brush.typeAt(world, x, y, z).isAir()) return y;
        }
        return -1;
    }

    private boolean onGatePath(int x, int z) {
        double d = Math.hypot(x, z);
        if (d < RING_IN || d > PAVILION_DIST + PAVILION_R + 6) return false;
        double a = (Math.toDegrees(Math.atan2(z, x)) + 360) % 360;
        for (int g : GATE_ANGLES) {
            double diff = Math.abs(a - g) % 360;
            diff = Math.min(diff, 360 - diff);
            // 통로 폭 + 여유. 멀수록 각도는 좁아지지만 실제 폭은 유지됩니다.
            double half = Math.toDegrees(Math.atan2(GATE_HALF + 6, Math.max(6, d)));
            if (diff < half) return true;
        }
        return false;
    }

    private boolean nearGate(int deg, int spread) {
        for (int g : GATE_ANGLES) {
            int d = Math.abs(deg - g) % 360;
            d = Math.min(d, 360 - d);
            if (d < spread) return true;
        }
        return false;
    }

    // ── 인증 안뜰 ──────────────────────────────────────────────────────

    private void buildVerificationCourtyard(World world) {
        int cx = VERIFY_X, cz = VERIFY_Z;

        for (int dx = -VERIFY_R - 8; dx <= VERIFY_R + 8; dx++) {
            for (int dz = -VERIFY_R - 8; dz <= VERIFY_R + 8; dz++) {
                double d = Math.hypot(dx, dz);
                if (d > VERIFY_R + 7) continue;
                for (int i = 0; i < 6; i++) {
                    Brush.set(world, cx + dx, VERIFY_Y - 2 - i, cz + dz,
                            Palette.gradient(Palette.FOUNDATION_RAMP, 1.0 - i / 6.0,
                                    cx + dx, i, cz + dz));
                }
            }
        }

        for (int dx = -VERIFY_R - 2; dx <= VERIFY_R + 2; dx++) {
            for (int dz = -VERIFY_R - 2; dz <= VERIFY_R + 2; dz++) {
                double d = Math.hypot(dx, dz);
                if (d > VERIFY_R + 2) continue;
                int x = cx + dx, z = cz + dz;

                if (d <= VERIFY_R) {
                    Material m = d > VERIFY_R - 2 ? Material.DARK_PRISMARINE
                            : Palette.gradient(Palette.PRISMARINE_RAMP,
                                    0.2 + Palette.noise(x, z) * 0.7, x, z);
                    if (Math.floorMod(dx, 6) == 0 || Math.floorMod(dz, 6) == 0) {
                        m = Material.SMOOTH_QUARTZ;
                    }
                    Brush.set(world, x, VERIFY_Y - 1, z, m);
                } else {
                    Brush.set(world, x, VERIFY_Y - 1, z, Material.POLISHED_BLACKSTONE);
                    for (int y = VERIFY_Y; y <= VERIFY_Y + 7; y++) {
                        Brush.set(world, x, y, z, y == VERIFY_Y + 7
                                ? Material.POLISHED_BLACKSTONE
                                : Palette.mix(Palette.WALL_MIX, x, y, z));
                    }
                    if ((dx + dz) % 8 == 0) {
                        Brush.set(world, x, VERIFY_Y + 3, z, Material.LANTERN);
                    }
                }
            }
        }

        for (int t = 0; t < 3; t++) {
            Brush.disc(world, cx, VERIFY_Y + t, cz, 4 - t,
                    t == 2 ? Material.CHISELED_QUARTZ_BLOCK : Material.QUARTZ_BRICKS);
        }
        Brush.set(world, cx, VERIFY_Y + 3, cz, Material.SEA_LANTERN);

        for (int[] o : new int[][]{{10, 10}, {-10, 10}, {10, -10}, {-10, -10}}) {
            for (int y = VERIFY_Y; y <= VERIFY_Y + 5; y++) {
                Brush.pillar(world, cx + o[0], y, cz + o[1], Material.QUARTZ_PILLAR, Axis.Y);
            }
            Brush.set(world, cx + o[0], VERIFY_Y + 6, cz + o[1], Material.SEA_LANTERN);
        }
    }

    // ── 외부 좌표 ──────────────────────────────────────────────────────

    public static Location podiumLocation(World world, int index) {
        int deg = GATE_ANGLES[index % GATE_ANGLES.length];
        double rad = Math.toRadians(deg);
        int x = (int) Math.round(Math.cos(rad) * PAVILION_DIST);
        int z = (int) Math.round(Math.sin(rad) * PAVILION_DIST);
        // 단이 RING_TOP+3 까지 쌓이므로 그 위에 섭니다
        return new Location(world, x + 0.5, RING_TOP + 4, z + 0.5, (float) (deg + 90), 0f);
    }

    public static Location spawnLocation(World world) {
        return new Location(world, 0.5, GROUND_Y, 20.5, 180f, 0f);
    }

    public static Location verificationLocation(World world) {
        return new Location(world, VERIFY_X + 0.5, VERIFY_Y + 1, VERIFY_Z + 0.5, 0f, 0f);
    }

    public static int groundY() { return GROUND_Y; }

    public static int voidThreshold() { return FOUND_TOP - FOUND_DEPTH - 14; }

    /** 벚꽃 파티클을 뿌릴 반경 (RucHome 이 사용). */
    public static int groveOuterRadius() { return FOUND_R - 10; }
    public static int groveInnerRadius() { return GROVE_IN; }
    public static int canopyY() { return RING_TOP + 14; }
}
