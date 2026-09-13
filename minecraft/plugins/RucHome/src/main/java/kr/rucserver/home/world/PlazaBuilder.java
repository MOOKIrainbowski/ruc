package kr.rucserver.home.world;

import org.bukkit.Axis;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Levelled;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.type.Slab;
import org.bukkit.block.data.type.Stairs;
import org.bukkit.block.data.type.Wall;

/**
 * 허브 광장 생성.
 *
 * 설계 근거: docs/04-MAP-DESIGN.md
 *
 * 이 버전에서 고친 것 (피드백 반영)
 *  1. 구멍 원천 차단 — 전체를 덮는 solid 기반판을 먼저 깔고 그 위에만 짓습니다.
 *     이전 버전은 보도(r25)와 파사드(r27) 사이가 통째로 비어 있었고,
 *     보도 가장자리에는 제가 일부러 랜덤 구멍까지 뚫어놨습니다.
 *  2. 블록 다양성 — Palette 의 그라데이션 램프로 디더링 전환을 씁니다.
 *     단색 면이 남지 않도록 그라데이션 + 동심 띠 + 격자 줄눈을 겹칩니다.
 *  3. 규모 확대 — 광장 반경 26, 기반판 반경 80 (이전 19 / 없음).
 *  4. 디테일 — 계단·슬랩·벽·구리 지붕·창살·이끼로 면을 잘게 나눕니다.
 *
 * 경계 밖 낙하는 RucHome 의 VoidGuard 가 처리합니다.
 */
public class PlazaBuilder {

    // ── 높이 체계 ──────────────────────────────────────────────────────
    public static final int GROUND_Y = 64;               // 광장에서 서는 높이
    private static final int PLAZA_TOP = GROUND_Y - 1;   // 63 광장 바닥면
    private static final int RIM_TOP = GROUND_Y;         // 64 보도 바닥면 (한 단 위)
    private static final int FACADE_BASE = GROUND_Y + 1; // 65 벽 시작
    private static final int FOUND_TOP = PLAZA_TOP - 1;  // 62 기반판 최상단
    private static final int FOUND_DEPTH = 6;

    // ── 반경 ───────────────────────────────────────────────────────────
    private static final int PLAZA_R = 26;
    private static final int WALK_R = 36;
    private static final int FACADE_IN = 36;
    private static final int FACADE_OUT = 44;
    private static final int TERRACE_R = 56;
    private static final int FOUND_R = 80;      // 전부 덮는 기반판

    private static final int[] GATE_ANGLES = {90, 210, 330};
    private static final int GATE_HALF = 5;
    private static final int GATE_SPREAD = 11;

    /** 전실 중심 거리 — 생성 코드와 podiumLocation 이 같은 값을 써야 합니다. */
    private static final int CHAMBER_DIST = 62;
    private static final int CHAMBER_R = 11;

    // 인증 안뜰 (D10)
    public static final int VERIFY_X = 0;
    public static final int VERIFY_Y = 64;
    public static final int VERIFY_Z = 560;
    public static final int VERIFY_R = 14;

    // ── 진입점 ─────────────────────────────────────────────────────────

    public void buildAll(World world) {
        clearArea(world);
        buildFoundation(world);     // 먼저 통판 — 이후 어떤 구조물도 구멍을 못 만듭니다
        buildPlazaFloor(world);
        buildWalkway(world);
        buildTerrace(world);
        buildOuterGrounds(world);
        buildFacade(world);
        buildGates(world);
        buildChambers(world);
        buildMonument(world);
        buildGardens(world);
        buildLampPosts(world);
        buildVerificationCourtyard(world);
    }

    private void clearArea(World world) {
        int r = FOUND_R + 4;
        for (int x = -r; x <= r; x++) {
            for (int z = -r; z <= r; z++) {
                for (int y = FOUND_TOP - FOUND_DEPTH - 2; y <= GROUND_Y + 44; y++) {
                    world.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }
    }

    // ── 1. 기반판 ──────────────────────────────────────────────────────

    /**
     * 허브 전체를 덮는 단일 통판.
     *
     * 구멍 문제의 근본 해결책입니다. 위에 무엇을 짓든 아래는 항상 막혀 있습니다.
     */
    private void buildFoundation(World world) {
        for (int x = -FOUND_R; x <= FOUND_R; x++) {
            for (int z = -FOUND_R; z <= FOUND_R; z++) {
                double d = Math.sqrt(x * x + z * z);
                // 가장자리에 요철 — 완벽한 원은 인공적으로 보입니다
                double edge = FOUND_R - 4 + Palette.noise(x >> 2, z >> 2) * 5;
                if (d > edge) continue;

                for (int i = 0; i < FOUND_DEPTH; i++) {
                    int y = FOUND_TOP - i;
                    double t = 1.0 - (i / (double) FOUND_DEPTH);
                    world.getBlockAt(x, y, z).setType(
                            Palette.gradient(Palette.FOUNDATION_RAMP, t, x, y, z), false);
                }
                world.getBlockAt(x, FOUND_TOP - FOUND_DEPTH, z)
                        .setType(Material.DEEPSLATE_TILES, false);
            }
        }
    }

    // ── 2. 광장 바닥 ───────────────────────────────────────────────────

    private void buildPlazaFloor(World world) {
        for (int x = -PLAZA_R; x <= PLAZA_R; x++) {
            for (int z = -PLAZA_R; z <= PLAZA_R; z++) {
                double d = Math.sqrt(x * x + z * z);
                if (d > PLAZA_R) continue;
                world.getBlockAt(x, PLAZA_TOP, z).setType(plazaFloor(x, z, d), false);
            }
        }

        // 광장 → 보도 계단 띠
        for (int x = -PLAZA_R - 2; x <= PLAZA_R + 2; x++) {
            for (int z = -PLAZA_R - 2; z <= PLAZA_R + 2; z++) {
                double d = Math.sqrt(x * x + z * z);
                if (d <= PLAZA_R || d > PLAZA_R + 1.4) continue;
                setStairs(world, x, RIM_TOP, z,
                        Material.POLISHED_ANDESITE_STAIRS, facing(x, z, true), false);
            }
        }
    }

    /** 그라데이션 + 방사 스포크 + 동심 띠를 겹쳐 단색 면을 없앱니다. */
    private Material plazaFloor(int x, int z, double d) {
        double angle = Math.toDegrees(Math.atan2(z, x));
        double spoke = ((angle % 30) + 30) % 30;
        if (d > 10 && (spoke < 2.0 || spoke > 28.0)) {
            return Palette.gradient(Palette.WARM_RAMP, 0.3 + d / (PLAZA_R * 2.2), x, z);
        }

        int ring = (int) d % 8;
        if (ring == 0) return Material.DEEPSLATE_TILES;
        if (ring == 1) return Palette.mix(Palette.TUFF_MIX, x, z);

        double t = 0.25 + (d / PLAZA_R) * 0.6;
        return Palette.gradient(Palette.STONE_RAMP, t, x, z);
    }

    // ── 3. 보도 · 테라스 ───────────────────────────────────────────────

    private void buildWalkway(World world) {
        for (int x = -WALK_R; x <= WALK_R; x++) {
            for (int z = -WALK_R; z <= WALK_R; z++) {
                double d = Math.sqrt(x * x + z * z);
                if (d <= PLAZA_R || d > WALK_R) continue;

                Material m = Palette.gradient(Palette.STONE_RAMP,
                        0.55 + Palette.noise(x, z) * 0.25, x, z);
                if (x % 6 == 0 || z % 6 == 0) m = Material.POLISHED_DEEPSLATE;
                if ((int) d % 9 == 0) m = Palette.mix(Palette.TUFF_MIX, x, z);

                world.getBlockAt(x, RIM_TOP, z).setType(m, false);
                world.getBlockAt(x, PLAZA_TOP, z).setType(Material.COBBLED_DEEPSLATE, false);
            }
        }
    }

    private void buildTerrace(World world) {
        for (int x = -TERRACE_R; x <= TERRACE_R; x++) {
            for (int z = -TERRACE_R; z <= TERRACE_R; z++) {
                double d = Math.sqrt(x * x + z * z);
                if (d <= FACADE_OUT || d > TERRACE_R) continue;

                Material m = Palette.gradient(Palette.STONE_RAMP,
                        0.30 + Palette.noise(x, z) * 0.3, x, z);
                if ((int) d % 7 == 0) m = Material.TUFF_BRICKS;

                world.getBlockAt(x, RIM_TOP, z).setType(m, false);
                world.getBlockAt(x, PLAZA_TOP, z).setType(Material.TUFF, false);

                if (d > TERRACE_R - 1) {
                    setWall(world, x, RIM_TOP + 1, z, Material.TUFF_BRICK_WALL);
                }
            }
        }
    }

    // ── 4. 파사드 ──────────────────────────────────────────────────────

    /**
     * 각도로 순회하면 반경이 커질수록 칸이 비어 구멍이 생깁니다.
     * x,z 를 전부 훑고 반경으로 판정하는 래스터 방식이라 빈틈이 없습니다.
     */
    private void buildFacade(World world) {
        for (int x = -FACADE_OUT - 2; x <= FACADE_OUT + 2; x++) {
            for (int z = -FACADE_OUT - 2; z <= FACADE_OUT + 2; z++) {
                double d = Math.sqrt(x * x + z * z);
                if (d < FACADE_IN || d > FACADE_OUT) continue;

                int deg = (int) ((Math.toDegrees(Math.atan2(z, x)) + 360) % 360);
                if (nearGate(deg, GATE_SPREAD)) continue;

                int seg = deg / 18;
                int height = 10 + (seg % 3) * 3;          // 10 / 13 / 16
                double inner = (d - FACADE_IN) / (double) (FACADE_OUT - FACADE_IN);

                for (int y = FACADE_BASE; y < FACADE_BASE + height; y++) {
                    int rel = y - FACADE_BASE;

                    boolean arcade = inner < 0.3 && rel < 4
                            && (deg % 12) >= 4 && (deg % 12) <= 8;
                    if (arcade) {
                        if (rel == 3) {
                            world.getBlockAt(x, y, z).setType(Material.POLISHED_TUFF, false);
                        }
                        continue;
                    }
                    world.getBlockAt(x, y, z)
                            .setType(wallMaterial(x, y, z, rel, inner, seg), false);
                }

                buildRoof(world, x, z, FACADE_BASE + height, inner, seg);

                if (inner < 0.25 && (deg % 12) == 6 && height >= 13) {
                    world.getBlockAt(x, FACADE_BASE + 6, z).setType(Material.COPPER_GRATE, false);
                    world.getBlockAt(x, FACADE_BASE + 7, z)
                            .setType(Material.LIGHT_GRAY_STAINED_GLASS_PANE, false);
                    world.getBlockAt(x, FACADE_BASE + 8, z)
                            .setType(Material.LIGHT_GRAY_STAINED_GLASS_PANE, false);
                }
            }
        }
    }

    private Material wallMaterial(int x, int y, int z, int rel, double inner, int seg) {
        if (rel < 2) return Palette.gradient(Palette.STONE_RAMP, 0.05 + inner * 0.1, x, y, z);
        if (rel == 5 || rel == 9 || rel == 13) return Material.POLISHED_DEEPSLATE;
        if (inner < 0.4) return Palette.mix(Palette.WALL_MIX, x, y, z);
        if (inner < 0.75) return Palette.mix(Palette.TUFF_MIX, x, y, z);
        return seg % 3 == 0
                ? Palette.gradient(Palette.WARM_RAMP, 0.3 + Palette.noise(x, y, z) * 0.4, x, y, z)
                : Palette.mix(Palette.TUFF_MIX, x, y, z);
    }

    /** 구리 지붕 — 산화 청록이 브랜드 그린과 이어집니다. */
    private void buildRoof(World world, int x, int z, int roofY, double inner, int seg) {
        world.getBlockAt(x, roofY, z)
                .setType(Palette.gradient(Palette.COPPER_RAMP, 0.35 + inner * 0.6, x, z), false);

        if (inner < 0.16) {
            setStairs(world, x, roofY + 1, z,
                    Material.OXIDIZED_CUT_COPPER_STAIRS, facing(x, z, true), false);
        } else if (inner > 0.84) {
            setStairs(world, x, roofY + 1, z,
                    Material.WEATHERED_CUT_COPPER_STAIRS, facing(x, z, false), false);
        } else if (seg % 2 == 0 && Palette.noise(x, z) > 0.6) {
            setSlab(world, x, roofY + 1, z, Material.OXIDIZED_CUT_COPPER_SLAB, false);
        }
    }

    // ── 5. 관문 ────────────────────────────────────────────────────────

    private void buildGates(World world) {
        for (int deg : GATE_ANGLES) buildGate(world, deg);
    }

    private void buildGate(World world, int deg) {
        double rad = Math.toRadians(deg);
        double cos = Math.cos(rad), sin = Math.sin(rad);
        double px = -sin, pz = cos;
        int archHeight = 12;

        for (int r = FACADE_IN - 2; r <= CHAMBER_DIST - CHAMBER_R + 2; r++) {
            for (int w = -GATE_HALF - 2; w <= GATE_HALF + 2; w++) {
                int x = (int) Math.round(cos * r + px * w);
                int z = (int) Math.round(sin * r + pz * w);
                int aw = Math.abs(w);

                // 바닥은 무조건 채웁니다 (구멍 방지)
                world.getBlockAt(x, RIM_TOP, z).setType(
                        aw > GATE_HALF ? Material.POLISHED_DEEPSLATE
                                : Palette.gradient(Palette.WARM_RAMP,
                                        0.45 + Palette.noise(x, z) * 0.3, x, z), false);
                world.getBlockAt(x, PLAZA_TOP, z).setType(Material.TUFF, false);

                boolean inFacade = r >= FACADE_IN && r <= FACADE_OUT;

                if (aw > GATE_HALF) {
                    int h = inFacade ? archHeight + 3 : 2;
                    for (int i = 1; i <= h; i++) {
                        int y = RIM_TOP + i;
                        world.getBlockAt(x, y, z).setType(
                                i > archHeight ? Material.OXIDIZED_CUT_COPPER
                                        : Palette.mix(Palette.WALL_MIX, x, y, z), false);
                    }
                    if (!inFacade && r % 6 == 0) {
                        world.getBlockAt(x, RIM_TOP + 3, z).setType(Material.LANTERN, false);
                    }
                } else if (inFacade) {
                    int arch = archHeight - (GATE_HALF - aw);
                    for (int y = RIM_TOP + 1; y < RIM_TOP + arch; y++) {
                        world.getBlockAt(x, y, z).setType(Material.AIR, false);
                    }
                    world.getBlockAt(x, RIM_TOP + arch, z)
                            .setType(Palette.mix(Palette.TUFF_MIX, x, arch, z), false);
                    if (aw < GATE_HALF) {
                        world.getBlockAt(x, RIM_TOP + arch + 1, z)
                                .setType(Material.POLISHED_DEEPSLATE, false);
                    }
                }
            }
        }
    }

    // ── 6. 전실 ────────────────────────────────────────────────────────

    private void buildChambers(World world) {
        for (int deg : GATE_ANGLES) {
            double rad = Math.toRadians(deg);
            buildChamber(world,
                    (int) Math.round(Math.cos(rad) * CHAMBER_DIST),
                    (int) Math.round(Math.sin(rad) * CHAMBER_DIST), deg);
        }
    }

    private void buildChamber(World world, int cx, int cz, int deg) {
        for (int dx = -CHAMBER_R - 1; dx <= CHAMBER_R + 1; dx++) {
            for (int dz = -CHAMBER_R - 1; dz <= CHAMBER_R + 1; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > CHAMBER_R + 1) continue;
                int x = cx + dx, z = cz + dz;

                Material floor = Palette.gradient(Palette.STONE_RAMP,
                        0.35 + (d / CHAMBER_R) * 0.35, x, z);
                if ((int) d % 4 == 0) floor = Palette.mix(Palette.TUFF_MIX, x, z);
                world.getBlockAt(x, RIM_TOP, z).setType(floor, false);
                world.getBlockAt(x, PLAZA_TOP, z).setType(Material.COBBLED_DEEPSLATE, false);

                if (d > CHAMBER_R - 1) {
                    double toC = Math.toDegrees(Math.atan2(dz, dx));
                    double diff = Math.abs(((toC - deg) % 360 + 540) % 360 - 180);
                    boolean back = diff > 100;

                    int h = back ? 6 : 2;
                    for (int i = 1; i <= h; i++) {
                        int y = RIM_TOP + i;
                        world.getBlockAt(x, y, z).setType(
                                i == h ? Material.OXIDIZED_CUT_COPPER
                                        : Palette.mix(Palette.WALL_MIX, x, y, z), false);
                    }
                    if (!back) setWall(world, x, RIM_TOP + 3, z, Material.TUFF_BRICK_WALL);
                }
            }
        }

        // NPC 단상 2단
        for (int tier = 0; tier < 2; tier++) {
            int s = 2 - tier;
            for (int dx = -s; dx <= s; dx++) {
                for (int dz = -s; dz <= s; dz++) {
                    boolean edge = Math.abs(dx) == s || Math.abs(dz) == s;
                    world.getBlockAt(cx + dx, RIM_TOP + 1 + tier, cz + dz).setType(
                            edge ? Material.POLISHED_DEEPSLATE
                                 : Material.CHISELED_TUFF_BRICKS, false);
                }
            }
        }

        double rad = Math.toRadians(deg);
        for (int side = -1; side <= 1; side += 2) {
            int ox = (int) Math.round(cx + Math.cos(rad) * 4 - Math.sin(rad) * 4 * side);
            int oz = (int) Math.round(cz + Math.sin(rad) * 4 + Math.cos(rad) * 4 * side);
            for (int y = RIM_TOP + 1; y <= RIM_TOP + 5; y++) {
                setPillar(world, ox, y, oz, Material.QUARTZ_PILLAR, Axis.Y);
            }
            world.getBlockAt(ox, RIM_TOP + 6, oz).setType(Material.COPPER_BULB, false);
            world.getBlockAt(ox, RIM_TOP + 7, oz).setType(Material.OXIDIZED_CUT_COPPER_SLAB, false);
        }
    }

    // ── 7. 기념탑 ──────────────────────────────────────────────────────

    private void buildMonument(World world) {
        int[] sizes = {6, 5, 4, 3};
        for (int tier = 0; tier < sizes.length; tier++) {
            int s = sizes[tier];
            int y = PLAZA_TOP + 1 + tier;
            for (int dx = -s - 1; dx <= s + 1; dx++) {
                for (int dz = -s - 1; dz <= s + 1; dz++) {
                    double d = Math.sqrt(dx * dx + dz * dz);
                    if (d <= s + 0.4) {
                        world.getBlockAt(dx, y, dz).setType(
                                d > s - 0.7 ? Material.POLISHED_DEEPSLATE
                                        : Palette.gradient(Palette.STONE_RAMP, 0.8, dx, y, dz), false);
                    } else if (d <= s + 1.3) {
                        setStairs(world, dx, y, dz, Material.TUFF_BRICK_STAIRS,
                                facing(dx, dz, true), false);
                    }
                }
            }
        }

        int baseY = PLAZA_TOP + 1 + sizes.length;
        for (int y = baseY; y < baseY + 16; y++) {
            int rel = y - baseY;
            int s = rel < 6 ? 1 : 0;
            for (int dx = -s; dx <= s; dx++) {
                for (int dz = -s; dz <= s; dz++) {
                    setPillar(world, dx, y, dz,
                            (dx == 0 && dz == 0) ? Material.QUARTZ_PILLAR
                                    : Palette.mix(Palette.TUFF_MIX, dx, y, dz), Axis.Y);
                }
            }
            if (rel >= 6 && rel < 14) {
                for (int[] o : new int[][]{{2, 0}, {-2, 0}, {0, 2}, {0, -2}}) {
                    world.getBlockAt(o[0], y, o[1]).setType(Material.IRON_CHAIN, false);
                }
            }
            if (rel % 5 == 4) {
                for (int[] o : new int[][]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
                    world.getBlockAt(o[0], y, o[1]).setType(Material.CHISELED_COPPER, false);
                }
            }
        }

        int topY = baseY + 16;
        world.getBlockAt(0, topY, 0).setType(Material.SEA_LANTERN, false);
        for (int[] o : new int[][]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
            world.getBlockAt(o[0], topY, o[1]).setType(Material.OXIDIZED_CUT_COPPER, false);
            setStairs(world, o[0] * 2, topY, o[1] * 2, Material.OXIDIZED_CUT_COPPER_STAIRS,
                    o[0] != 0 ? (o[0] > 0 ? BlockFace.WEST : BlockFace.EAST)
                              : (o[1] > 0 ? BlockFace.NORTH : BlockFace.SOUTH), false);
        }
        world.getBlockAt(0, topY + 1, 0).setType(Material.OXIDIZED_CUT_COPPER, false);
        world.getBlockAt(0, topY + 2, 0).setType(Material.SEA_LANTERN, false);

        // 기단 둘레 수로
        for (int dx = -11; dx <= 11; dx++) {
            for (int dz = -11; dz <= 11; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d < 7.5 || d > 9.6) continue;
                if (d > 9.0) {
                    world.getBlockAt(dx, PLAZA_TOP, dz).setType(Material.PRISMARINE_BRICKS, false);
                } else {
                    world.getBlockAt(dx, PLAZA_TOP - 1, dz).setType(Material.DARK_PRISMARINE, false);
                    setWater(world.getBlockAt(dx, PLAZA_TOP, dz));
                }
            }
        }
    }

    // ── 8. 화단 ────────────────────────────────────────────────────────

    private void buildGardens(World world) {
        for (int deg : new int[]{30, 150, 270}) {
            double rad = Math.toRadians(deg);
            int cx = (int) Math.round(Math.cos(rad) * 31);
            int cz = (int) Math.round(Math.sin(rad) * 31);

            for (int dx = -5; dx <= 5; dx++) {
                for (int dz = -5; dz <= 5; dz++) {
                    double d = Math.sqrt(dx * dx + dz * dz);
                    if (d > 5) continue;
                    int x = cx + dx, z = cz + dz;

                    if (d > 4) {
                        setStairs(world, x, RIM_TOP + 1, z, Material.POLISHED_TUFF_STAIRS,
                                facing(dx, dz, false), false);
                    } else {
                        world.getBlockAt(x, RIM_TOP + 1, z).setType(
                                Palette.noise(x, z) > 0.35 ? Material.MOSS_BLOCK
                                        : Material.ROOTED_DIRT, false);
                        double n = Palette.noise(x, 7, z);
                        if (n > 0.72) {
                            world.getBlockAt(x, RIM_TOP + 2, z).setType(Material.SHORT_GRASS, false);
                        } else if (n > 0.62) {
                            world.getBlockAt(x, RIM_TOP + 2, z).setType(Material.AZURE_BLUET, false);
                        } else if (n > 0.55) {
                            world.getBlockAt(x, RIM_TOP + 2, z).setType(Material.MOSS_CARPET, false);
                        }
                    }
                }
            }
            tree(world, cx - 1, cz - 1, 6);
            tree(world, cx + 2, cz + 2, 4);
        }
    }

    private void tree(World world, int cx, int cz, int height) {
        for (int i = 1; i <= height; i++) {
            setPillar(world, cx, RIM_TOP + 1 + i, cz, Material.OAK_LOG, Axis.Y);
        }
        int top = RIM_TOP + 1 + height;
        for (int dx = -3; dx <= 3; dx++) {
            for (int dz = -3; dz <= 3; dz++) {
                for (int dy = -2; dy <= 2; dy++) {
                    double d = Math.sqrt(dx * dx + dz * dz + dy * dy * 1.8);
                    if (d > 3.0 - Palette.noise(cx + dx, dy, cz + dz) * 0.9) continue;
                    if (dx == 0 && dz == 0 && dy < 0) continue;
                    Block b = world.getBlockAt(cx + dx, top + dy, cz + dz);
                    if (!b.getType().isAir()) continue;
                    b.setType(Palette.noise(cx + dx, dy, cz + dz) > 0.82
                            ? Material.FLOWERING_AZALEA_LEAVES : Material.OAK_LEAVES, false);
                }
            }
        }
    }

    // ── 9. 가로등 ──────────────────────────────────────────────────────

    private void buildLampPosts(World world) {
        for (int deg = 0; deg < 360; deg += 20) {
            if (nearGate(deg, GATE_SPREAD + 4)) continue;
            double rad = Math.toRadians(deg);
            int x = (int) Math.round(Math.cos(rad) * (PLAZA_R + 4));
            int z = (int) Math.round(Math.sin(rad) * (PLAZA_R + 4));

            world.getBlockAt(x, RIM_TOP + 1, z).setType(Material.POLISHED_DEEPSLATE, false);
            for (int y = RIM_TOP + 2; y <= RIM_TOP + 4; y++) {
                setWall(world, x, y, z, Material.DEEPSLATE_BRICK_WALL);
            }
            world.getBlockAt(x, RIM_TOP + 5, z).setType(Material.COPPER_BULB, false);
            world.getBlockAt(x, RIM_TOP + 6, z).setType(Material.OXIDIZED_CUT_COPPER_SLAB, false);
        }
    }

    // ── 10. 인증 안뜰 ──────────────────────────────────────────────────

    private void buildVerificationCourtyard(World world) {
        int cx = VERIFY_X, cz = VERIFY_Z;

        for (int dx = -VERIFY_R - 6; dx <= VERIFY_R + 6; dx++) {
            for (int dz = -VERIFY_R - 6; dz <= VERIFY_R + 6; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > VERIFY_R + 5) continue;
                for (int i = 0; i < 5; i++) {
                    world.getBlockAt(cx + dx, VERIFY_Y - 2 - i, cz + dz).setType(
                            Palette.gradient(Palette.FOUNDATION_RAMP,
                                    1.0 - i / 5.0, cx + dx, i, cz + dz), false);
                }
            }
        }

        for (int dx = -VERIFY_R - 2; dx <= VERIFY_R + 2; dx++) {
            for (int dz = -VERIFY_R - 2; dz <= VERIFY_R + 2; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > VERIFY_R + 2) continue;
                int x = cx + dx, z = cz + dz;

                if (d <= VERIFY_R) {
                    Material m = Palette.gradient(Palette.STONE_RAMP,
                            0.3 + (d / VERIFY_R) * 0.4, x, z);
                    if ((int) d % 5 == 0) m = Palette.mix(Palette.TUFF_MIX, x, z);
                    world.getBlockAt(x, VERIFY_Y - 1, z).setType(m, false);
                } else {
                    world.getBlockAt(x, VERIFY_Y - 1, z).setType(Material.POLISHED_DEEPSLATE, false);
                    for (int y = VERIFY_Y; y <= VERIFY_Y + 6; y++) {
                        world.getBlockAt(x, y, z).setType(
                                y == VERIFY_Y + 6 ? Material.OXIDIZED_CUT_COPPER
                                        : Palette.mix(Palette.WALL_MIX, x, y, z), false);
                    }
                    if ((dx + dz) % 7 == 0) {
                        world.getBlockAt(x, VERIFY_Y + 3, z).setType(Material.LANTERN, false);
                    }
                }
            }
        }

        for (int dx = -3; dx <= 3; dx++) {
            for (int dz = -3; dz <= 3; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > 3.2) continue;
                world.getBlockAt(cx + dx, VERIFY_Y, cz + dz).setType(
                        d > 2.3 ? Material.POLISHED_DEEPSLATE
                                : Material.CHISELED_TUFF_BRICKS, false);
            }
        }
        world.getBlockAt(cx, VERIFY_Y + 1, cz).setType(Material.SEA_LANTERN, false);

        for (int[] o : new int[][]{{8, 8}, {-8, 8}, {8, -8}, {-8, -8}}) {
            for (int y = VERIFY_Y; y <= VERIFY_Y + 4; y++) {
                setPillar(world, cx + o[0], y, cz + o[1], Material.QUARTZ_PILLAR, Axis.Y);
            }
            world.getBlockAt(cx + o[0], VERIFY_Y + 5, cz + o[1])
                    .setType(Material.COPPER_BULB, false);
        }
    }


    // ── 바깥 지반 (자연 경계) ──────────────────────────────────────────

    /**
     * 테라스 바깥 ~ 기반판 가장자리를 자연 지형으로 채웁니다.
     *
     * 이 구간을 비워두면 회색 통판이 그대로 드러나 "잘라낸 판때기"처럼 보입니다.
     * 완만한 기복 + 풀·이끼·자갈 혼합 + 나무와 바위로 가장자리를 흐려줍니다.
     * 체감 규모를 키우는 역할도 합니다.
     */
    private void buildOuterGrounds(World world) {
        for (int x = -FOUND_R; x <= FOUND_R; x++) {
            for (int z = -FOUND_R; z <= FOUND_R; z++) {
                double d = Math.sqrt(x * x + z * z);
                double edge = FOUND_R - 4 + Palette.noise(x >> 2, z >> 2) * 5;
                if (d <= TERRACE_R || d > edge) continue;

                // 기복 — 평평한 판이 아니라 땅처럼 보이게
                double wave = Palette.noise(x >> 2, z >> 2) * 3.2
                            + Palette.noise(x >> 3, 5, z >> 3) * 1.8;
                int top = (int) Math.round(RIM_TOP - 2 + wave - 1.6);
                top = Math.max(FOUND_TOP + 1, Math.min(RIM_TOP + 2, top));

                for (int y = FOUND_TOP + 1; y <= top; y++) {
                    world.getBlockAt(x, y, z).setType(
                            y == top ? groundSurface(x, z) : Material.DIRT, false);
                }

                Block above = world.getBlockAt(x, top + 1, z);
                if (above.getType().isAir()) {
                    double n = Palette.noise(x, 11, z);
                    if (Palette.noise(x >> 1, 3, z >> 1) > 0.94) {
                        above.setType(Material.MOSSY_COBBLESTONE, false);
                    } else if (n > 0.88) {
                        above.setType(Material.SHORT_GRASS, false);
                    } else if (n > 0.85) {
                        above.setType(Material.FERN, false);
                    } else if (n > 0.82) {
                        above.setType(Material.AZURE_BLUET, false);
                    }
                }
            }
        }

        // 나무 흩뿌리기 — 격자로 심으면 인공적이라 노이즈로 걸러냅니다
        for (int deg = 0; deg < 360; deg += 7) {
            double rad = Math.toRadians(deg);
            for (int ring = 0; ring < 3; ring++) {
                double r = TERRACE_R + 5 + ring * 7 + Palette.noise(deg, ring) * 6;
                int x = (int) Math.round(Math.cos(rad) * r);
                int z = (int) Math.round(Math.sin(rad) * r);
                if (Palette.noise(x, ring, z) < 0.66) continue;
                int gy = surfaceY(world, x, z);
                if (gy < 0) continue;
                outerTree(world, x, gy, z, 4 + (int) (Palette.noise(x, z) * 4));
            }
        }
    }

    /** 바깥 지반 표면 재료 — 풀/이끼/자갈/흙길을 노이즈로 섞습니다. */
    private Material groundSurface(int x, int z) {
        double n = Palette.noise(x, 2, z);
        if (n > 0.80) return Material.MOSS_BLOCK;
        if (n > 0.70) return Material.COARSE_DIRT;
        if (n > 0.62) return Material.GRAVEL;
        if (n > 0.55) return Material.PODZOL;
        return Material.GRASS_BLOCK;
    }

    /** 해당 좌표의 지표면 Y. 없으면 -1. */
    private int surfaceY(World world, int x, int z) {
        for (int y = RIM_TOP + 3; y > FOUND_TOP; y--) {
            if (!world.getBlockAt(x, y, z).getType().isAir()) return y;
        }
        return -1;
    }

    private void outerTree(World world, int cx, int groundY, int cz, int height) {
        Material log = Palette.noise(cx, 1, cz) > 0.5 ? Material.OAK_LOG : Material.BIRCH_LOG;
        Material leaf = log == Material.OAK_LOG ? Material.OAK_LEAVES : Material.BIRCH_LEAVES;

        for (int i = 1; i <= height; i++) {
            setPillar(world, cx, groundY + i, cz, log, Axis.Y);
        }
        int top = groundY + height;
        for (int dx = -3; dx <= 3; dx++) {
            for (int dz = -3; dz <= 3; dz++) {
                for (int dy = -2; dy <= 2; dy++) {
                    double d = Math.sqrt(dx * dx + dz * dz + dy * dy * 1.7);
                    if (d > 3.1 - Palette.noise(cx + dx, dy, cz + dz)) continue;
                    if (dx == 0 && dz == 0 && dy < 0) continue;
                    Block b = world.getBlockAt(cx + dx, top + dy, cz + dz);
                    if (!b.getType().isAir()) continue;
                    b.setType(leaf, false);
                }
            }
        }
    }

    // ── 보조 ───────────────────────────────────────────────────────────

    private boolean nearGate(int deg, int spread) {
        for (int g : GATE_ANGLES) {
            int d = Math.abs(deg - g) % 360;
            d = Math.min(d, 360 - d);
            if (d < spread) return true;
        }
        return false;
    }

    private BlockFace facing(int x, int z, boolean inward) {
        BlockFace f;
        if (Math.abs(x) > Math.abs(z)) f = x > 0 ? BlockFace.WEST : BlockFace.EAST;
        else f = z > 0 ? BlockFace.NORTH : BlockFace.SOUTH;
        return inward ? f : f.getOppositeFace();
    }

    private void setStairs(World world, int x, int y, int z, Material m,
                           BlockFace face, boolean top) {
        Block b = world.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData data = b.getBlockData();
        if (data instanceof Stairs stairs) {
            stairs.setFacing(face);
            stairs.setHalf(top ? Bisected.Half.TOP : Bisected.Half.BOTTOM);
            b.setBlockData(stairs, false);
        }
    }

    private void setSlab(World world, int x, int y, int z, Material m, boolean top) {
        Block b = world.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData data = b.getBlockData();
        if (data instanceof Slab slab) {
            slab.setType(top ? Slab.Type.TOP : Slab.Type.BOTTOM);
            b.setBlockData(slab, false);
        }
    }

    private void setWall(World world, int x, int y, int z, Material m) {
        Block b = world.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData data = b.getBlockData();
        if (data instanceof Wall wall) {
            wall.setUp(true);
            b.setBlockData(wall, false);
        }
    }

    private void setPillar(World world, int x, int y, int z, Material m, Axis axis) {
        Block b = world.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData data = b.getBlockData();
        if (data instanceof Orientable orientable) {
            orientable.setAxis(axis);
            b.setBlockData(orientable, false);
        }
    }

    private void setWater(Block block) {
        block.setType(Material.WATER, false);
        if (block.getBlockData() instanceof Levelled levelled) {
            levelled.setLevel(0);
            block.setBlockData(levelled, false);
        }
    }

    // ── 외부 좌표 ──────────────────────────────────────────────────────

    public static Location podiumLocation(World world, int index) {
        int deg = GATE_ANGLES[index % GATE_ANGLES.length];
        double rad = Math.toRadians(deg);
        int x = (int) Math.round(Math.cos(rad) * CHAMBER_DIST);
        int z = (int) Math.round(Math.sin(rad) * CHAMBER_DIST);
        // 단상 최상단이 RIM_TOP+2 이므로 그 위에 섭니다
        return new Location(world, x + 0.5, RIM_TOP + 3, z + 0.5, (float) (deg + 90), 0f);
    }

    public static Location spawnLocation(World world) {
        return new Location(world, 0.5, GROUND_Y, 18.5, 180f, 0f);
    }

    public static Location verificationLocation(World world) {
        return new Location(world, VERIFY_X + 0.5, VERIFY_Y + 1, VERIFY_Z + 0.5, 0f, 0f);
    }

    public static int groundY() { return GROUND_Y; }

    /** 이 Y 아래로 떨어지면 낙사 대신 스폰으로 돌려보냅니다 (VoidGuard). */
    public static int voidThreshold() { return FOUND_TOP - FOUND_DEPTH - 12; }
}
