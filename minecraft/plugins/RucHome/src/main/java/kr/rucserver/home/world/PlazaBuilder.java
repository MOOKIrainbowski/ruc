package kr.rucserver.home.world;

import org.bukkit.Axis;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Levelled;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.Rotatable;
import org.bukkit.block.data.type.Slab;
import org.bukkit.block.data.type.Stairs;
import org.bukkit.block.data.type.Wall;

import java.util.Random;

/**
 * 허브 광장 생성.
 *
 * 설계 근거는 docs/04-MAP-DESIGN.md — mapfile/ 의 실제 맵(Red City 등)을
 * 파싱·렌더링해서 뽑은 원칙을 따릅니다.
 *
 *   1. 베이스 재료는 한 계열(안산암/화강암)로 통일하고 변형으로 질감을 만든다
 *   2. 강조색은 전체의 1% 미만으로만 쓴다
 *   3. 광장은 둘러싸여야 공간이 된다 — 아케이드 파사드 링
 *   4. 분기점(서버 선택)에는 랜드마크 건축 — 관문 아치
 *   5. 평면을 피한다 — 광장을 한 단 낮추고 계단으로 진입
 *   6. 완벽한 원은 인공적이다 — 외곽에 요철을 준다
 */
public class PlazaBuilder {

    // ── 치수 ───────────────────────────────────────────────────────────

    // 높이 체계 — 광장이 보도보다 한 단 낮아야 "평면 회피" 원칙이 성립합니다.
    //   광장 바닥면 63  → 플레이어는 64 에 섬
    //   보도 바닥면  64  → 플레이어는 65 에 섬 (한 단 위)
    //   파사드 벽    65 부터 위로
    public static final int GROUND_Y = 64;              // 광장에서 플레이어가 서는 높이
    private static final int PLAZA_TOP = GROUND_Y - 1;  // 63
    private static final int RIM_TOP = GROUND_Y;        // 64
    private static final int FACADE_BASE = GROUND_Y + 1;// 65

    private static final int PLAZA_R = 19;       // 낮은 광장 반경
    private static final int WALK_R = 25;        // 보도 바깥 반경
    private static final int FACADE_R = 27;      // 파사드 안쪽 면
    private static final int FACADE_DEPTH = 5;   // 파사드 두께

    /** 관문(서버 선택) 방위 — 3기 */
    private static final int[] GATE_ANGLES = {90, 210, 330};

    /**
     * 광장 중심에서 관문 전실 중심까지의 거리.
     * 생성 코드와 podiumLocation() 이 반드시 같은 값을 써야 합니다 —
     * 예전에 두 곳이 어긋나 NPC가 허공에 떠 있었습니다.
     */
    private static final int CHAMBER_DIST = FACADE_R + FACADE_DEPTH + 9;

    // 인증 섬 (D10) — 광장에서 멀리
    public static final int VERIFY_X = 0;
    public static final int VERIFY_Y = 64;
    public static final int VERIFY_Z = 512;
    public static final int VERIFY_R = 11;

    // ── 팔레트 ─────────────────────────────────────────────────────────
    // 베이스는 안산암 계열, 따뜻한 대비로 화강암 계열. Red City 팔레트 구조를
    // 그대로 가져오되 색조만 서버 정체성(차분한 회녹)에 맞췄습니다.

    private static final Material BASE = Material.POLISHED_ANDESITE;
    private static final Material BASE_ROUGH = Material.ANDESITE;
    private static final Material BASE_BRICK = Material.STONE_BRICKS;
    private static final Material BASE_DARK = Material.DEEPSLATE_BRICKS;
    private static final Material WARM = Material.POLISHED_GRANITE;
    private static final Material WARM_ROUGH = Material.GRANITE;
    private static final Material LIGHT = Material.SMOOTH_QUARTZ;
    private static final Material PILLAR = Material.QUARTZ_PILLAR;

    private static final Material WALK_A = Material.POLISHED_DIORITE;
    private static final Material WALK_B = Material.ANDESITE;

    private final Random random = new Random(20260913L);   // 고정 시드 = 재현 가능

    // ── 진입점 ─────────────────────────────────────────────────────────

    public void buildAll(World world) {
        clearArea(world);
        buildPlazaFloor(world);
        buildRimWalk(world);
        buildFacadeRing(world);
        buildGates(world);
        buildMonument(world);
        buildGardens(world);
        buildLampPosts(world);
        buildVerificationCourtyard(world);
    }

    /** 재생성 시 이전 구조물을 지웁니다. */
    private void clearArea(World world) {
        for (int x = -FACADE_R - FACADE_DEPTH - 12; x <= FACADE_R + FACADE_DEPTH + 12; x++) {
            for (int z = -FACADE_R - FACADE_DEPTH - 12; z <= FACADE_R + FACADE_DEPTH + 12; z++) {
                for (int y = GROUND_Y - 6; y <= GROUND_Y + 26; y++) {
                    world.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }
    }

    // ── 1. 광장 바닥 ───────────────────────────────────────────────────

    /**
     * 한 단 낮춘 원형 광장.
     * 동심원 + 방사 스포크 패턴으로 중심을 강조하고, 가장자리는 계단으로 올라갑니다.
     */
    private void buildPlazaFloor(World world) {
        for (int x = -PLAZA_R - 1; x <= PLAZA_R + 1; x++) {
            for (int z = -PLAZA_R - 1; z <= PLAZA_R + 1; z++) {
                double d = Math.sqrt(x * x + z * z);
                if (d > PLAZA_R + 0.5) continue;

                Material floor = plazaPattern(x, z, d);
                setBlock(world, x, PLAZA_TOP, z, floor);
                fillBelow(world, x, PLAZA_TOP, z);

                // 가장자리 — 보도(한 단 위)로 올라가는 계단
                if (d > PLAZA_R - 0.5) {
                    setStairs(world, x, RIM_TOP, z, Material.POLISHED_ANDESITE_STAIRS,
                            facing(x, z, true), false);
                }
            }
        }
    }

    /** 동심원 + 8방향 스포크. */
    private Material plazaPattern(int x, int z, double d) {
        // 중앙 원 (기념탑 기단 주변)
        if (d < 7) return (x + z & 1) == 0 ? LIGHT : WALK_A;

        // 방사 스포크 — 8방향
        double angle = Math.toDegrees(Math.atan2(z, x));
        double mod = ((angle % 45) + 45) % 45;
        if (mod < 3.2 || mod > 41.8) return WARM;

        // 동심 링 — 대비를 주어 바닥이 밋밋해 보이지 않게
        int ring = (int) (d) % 7;
        if (ring == 0) return BASE_DARK;      // 진한 띠
        if (ring == 1) return BASE_BRICK;
        if (ring == 4) return WALK_A;         // 밝은 띠
        return BASE;
    }

    // ── 2. 둘레 보도 ───────────────────────────────────────────────────

    /** 광장보다 한 단 높은 보도. 파사드와 광장 사이를 잇습니다. */
    private void buildRimWalk(World world) {
        for (int x = -WALK_R - 1; x <= WALK_R + 1; x++) {
            for (int z = -WALK_R - 1; z <= WALK_R + 1; z++) {
                double d = Math.sqrt(x * x + z * z);
                if (d <= PLAZA_R + 0.5 || d > WALK_R + 0.5) continue;

                // 완벽한 원을 피하려고 가장자리에 약간의 요철
                if (d > WALK_R - 1.2 && random.nextInt(5) == 0) continue;

                Material m = ((x / 2 + z / 2) & 1) == 0 ? WALK_A : WALK_B;
                if ((int) d % 5 == 0) m = BASE_BRICK;

                // 광장보다 한 단 높습니다
                setBlock(world, x, RIM_TOP, z, m);
                setBlock(world, x, PLAZA_TOP, z, BASE_ROUGH);
                fillBelow(world, x, PLAZA_TOP, z);
            }
        }
    }

    // ── 3. 파사드 링 (폐쇄감) ──────────────────────────────────────────

    /**
     * 광장을 둘러싸는 건물 벽면.
     *
     * 이게 이 설계의 핵심입니다. 벽이 없으면 광장은 그냥 바닥입니다.
     * 아케이드(아치 열주)를 뚫어 답답하지 않게 하고, 지붕 높이를 구간마다
     * 바꿔 실루엣에 리듬을 줍니다.
     */
    private void buildFacadeRing(World world) {
        for (int deg = 0; deg < 360; deg++) {
            if (nearGate(deg, 9)) continue;    // 관문 자리만 비웁니다 (좁게)

            // 구간마다 높이를 바꿔 지붕선에 변화를 줍니다
            int segment = deg / 30;
            int height = 7 + (segment % 3) * 2;          // 7 / 9 / 11
            boolean bay = (deg / 10) % 3 == 0;           // 돌출부
            int inner = FACADE_R - (bay ? 1 : 0);

            double rad = Math.toRadians(deg);
            for (int t = 0; t < FACADE_DEPTH + (bay ? 1 : 0); t++) {
                int r = inner + t;
                int x = (int) Math.round(Math.cos(rad) * r);
                int z = (int) Math.round(Math.sin(rad) * r);

                Material wall = (t == 0) ? BASE_BRICK
                        : (t == 1) ? BASE
                        : (segment % 2 == 0 ? WARM_ROUGH : BASE_ROUGH);

                for (int y = FACADE_BASE; y < FACADE_BASE + height; y++) {
                    // 아케이드 — 지상 1~3층은 일정 간격으로 뚫어 기둥만 남김
                    boolean arcadeOpening = t <= 1
                            && y < FACADE_BASE + 4
                            && (deg % 9) >= 3 && (deg % 9) <= 7;
                    if (arcadeOpening) {
                        // 아치 상단만 채움
                        if (y == FACADE_BASE + 3) setBlock(world, x, y, z, BASE);
                        continue;
                    }
                    setBlock(world, x, y, z, wall);
                }

                // 지붕 — 바깥으로 한 단씩 내려가는 계단
                int roofY = FACADE_BASE + height;
                if (t == 0) {
                    setBlock(world, x, roofY, z, BASE_DARK);
                } else {
                    setStairs(world, x, roofY - Math.min(t, 2), z,
                            Material.DEEPSLATE_BRICK_STAIRS, facing(x, z, false), false);
                }

                // 창문 — 아치 위층에 유리판
                if (t == 0 && height >= 9 && (deg % 9) == 5) {
                    setBlock(world, x, FACADE_BASE + 5, z, Material.WHITE_STAINED_GLASS_PANE);
                    setBlock(world, x, FACADE_BASE + 6, z, Material.WHITE_STAINED_GLASS_PANE);
                }
            }
        }
    }

    // ── 4. 관문 3기 (랜드마크) ─────────────────────────────────────────

    /**
     * 서버 선택 지점.
     *
     * 분기점에는 랜드마크가 있어야 한다는 원칙(§2-3)을 적용했습니다.
     * 3x3 단상 대신 아치 관문 + 안쪽 전실 구조입니다.
     */
    private void buildGates(World world) {
        for (int i = 0; i < GATE_ANGLES.length; i++) {
            buildGate(world, GATE_ANGLES[i]);
        }
    }

    private void buildGate(World world, int deg) {
        double rad = Math.toRadians(deg);
        double cos = Math.cos(rad), sin = Math.sin(rad);
        // 관문 정면 방향의 수직 벡터 (아치 폭 방향)
        double px = -sin, pz = cos;

        int archHalf = 3;        // 폭 7
        int archHeight = 9;

        for (int t = -1; t <= FACADE_DEPTH + 1; t++) {
            int r = FACADE_R + t;

            for (int w = -archHalf - 1; w <= archHalf + 1; w++) {
                int x = (int) Math.round(cos * r + px * w);
                int z = (int) Math.round(sin * r + pz * w);

                boolean jamb = Math.abs(w) > archHalf;       // 기둥
                boolean inside = Math.abs(w) <= archHalf;

                if (jamb) {
                    for (int y = RIM_TOP + 1; y <= RIM_TOP + archHeight + 1; y++) {
                        setBlock(world, x, y, z, y >= RIM_TOP + archHeight ? LIGHT : BASE_BRICK);
                    }
                    // 기둥 상단 랜턴
                    if (t == 0 || t == FACADE_DEPTH) {
                        setBlock(world, x, RIM_TOP + archHeight + 2, z, Material.SEA_LANTERN);
                    }
                } else if (inside) {
                    // 통로 바닥 (보도와 같은 높이)
                    setBlock(world, x, RIM_TOP, z, WARM);
                    fillBelow(world, x, RIM_TOP, z);
                    // 통로 비우기
                    for (int y = RIM_TOP + 1; y < RIM_TOP + archHeight; y++) {
                        setBlock(world, x, y, z, Material.AIR);
                    }
                    // 아치 천장 — 가장자리로 갈수록 낮아지는 곡선
                    int arch = archHeight - (archHalf - Math.abs(w));
                    setBlock(world, x, RIM_TOP + arch, z, BASE);
                    if (Math.abs(w) < archHalf) {
                        setBlock(world, x, RIM_TOP + arch + 1, z, BASE_BRICK);
                    }
                }
            }
        }

        // 관문 밖으로 이어지는 가로 — 전실이 떠 있는 섬처럼 보이지 않게
        // 바닥과 양옆 난간으로 연결합니다.
        for (int t = FACADE_DEPTH + 1; t <= FACADE_DEPTH + 7; t++) {
            int r = FACADE_R + t;
            for (int w = -archHalf - 1; w <= archHalf + 1; w++) {
                int x = (int) Math.round(cos * r + px * w);
                int z = (int) Math.round(sin * r + pz * w);

                setBlock(world, x, RIM_TOP, z, Math.abs(w) > archHalf ? BASE_BRICK : WARM);
                fillBelow(world, x, RIM_TOP, z);

                if (Math.abs(w) > archHalf) {
                    setWall(world, x, RIM_TOP + 1, z, Material.ANDESITE_WALL);
                    if (t % 3 == 0) {
                        setBlock(world, x, RIM_TOP + 2, z, Material.LANTERN);
                    }
                }
            }
        }

        // 관문 안쪽 전실 — NPC가 서는 자리
        int cx = (int) Math.round(cos * CHAMBER_DIST);
        int cz = (int) Math.round(sin * CHAMBER_DIST);
        buildGateChamber(world, cx, cz, deg);
    }

    /** 관문 너머의 작은 전실. NPC 단상과 조명. */
    private void buildGateChamber(World world, int cx, int cz, int deg) {
        int r = 6;
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > r) continue;
                int x = cx + dx, z = cz + dz;

                Material m = d > r - 1 ? BASE_BRICK : (((dx + dz) & 1) == 0 ? BASE : WALK_A);
                setBlock(world, x, RIM_TOP, z, m);
                fillBelow(world, x, RIM_TOP, z);

                // 둘레 낮은 벽
                if (d > r - 1 && d <= r) {
                    setWall(world, x, RIM_TOP + 1, z, Material.STONE_BRICK_WALL);
                }
            }
        }

        // NPC 단상 (중앙, 한 단 높임)
        for (int dx = -1; dx <= 1; dx++) {
            for (int dz = -1; dz <= 1; dz++) {
                setBlock(world, cx + dx, RIM_TOP + 1, cz + dz,
                        (dx == 0 && dz == 0) ? WARM : BASE_BRICK);
            }
        }

        // 뒤편 기둥 2개 + 랜턴
        double rad = Math.toRadians(deg);
        int bx = (int) Math.round(cx + Math.cos(rad) * 3);
        int bz = (int) Math.round(cz + Math.sin(rad) * 3);
        for (int side = -1; side <= 1; side += 2) {
            int ox = bx + (int) Math.round(-Math.sin(rad) * 3 * side);
            int oz = bz + (int) Math.round(Math.cos(rad) * 3 * side);
            for (int y = RIM_TOP + 1; y <= RIM_TOP + 5; y++) {
                setPillar(world, ox, y, oz, PILLAR, Axis.Y);
            }
            setBlock(world, ox, RIM_TOP + 6, oz, Material.SEA_LANTERN);
        }
    }

    // ── 5. 중앙 기념탑 ─────────────────────────────────────────────────

    /** 광장의 초점. 3단 기단 + 기둥 + 발광 정상. */
    private void buildMonument(World world) {
        // 3단 기단 (7→5→3)
        int[] sizes = {3, 2, 1};
        for (int tier = 0; tier < sizes.length; tier++) {
            int s = sizes[tier];
            int y = PLAZA_TOP + 1 + tier;
            for (int x = -s; x <= s; x++) {
                for (int z = -s; z <= s; z++) {
                    boolean edge = Math.abs(x) == s || Math.abs(z) == s;
                    setBlock(world, x, y, z, edge ? BASE_BRICK : LIGHT);
                }
            }
            // 각 단 모서리에 계단 장식
            for (int x = -s; x <= s; x++) {
                setStairs(world, x, y, -s - 1, Material.POLISHED_ANDESITE_STAIRS, BlockFace.SOUTH, false);
                setStairs(world, x, y, s + 1, Material.POLISHED_ANDESITE_STAIRS, BlockFace.NORTH, false);
            }
            for (int z = -s; z <= s; z++) {
                setStairs(world, -s - 1, y, z, Material.POLISHED_ANDESITE_STAIRS, BlockFace.EAST, false);
                setStairs(world, s + 1, y, z, Material.POLISHED_ANDESITE_STAIRS, BlockFace.WEST, false);
            }
        }

        // 기둥
        int baseY = PLAZA_TOP + 1 + sizes.length;
        for (int y = baseY; y < baseY + 9; y++) {
            setPillar(world, 0, y, 0, PILLAR, Axis.Y);
            // 네 모서리 체인 장식
            if (y > baseY + 1 && y < baseY + 8) {
                for (int[] o : new int[][]{{1,0},{-1,0},{0,1},{0,-1}}) {
                    if ((y + o[0] + o[1]) % 3 == 0) {
                        // 1.21.9에서 구리 사슬이 추가되며 CHAIN -> IRON_CHAIN 으로 개명되었습니다.
                        setBlock(world, o[0], y, o[1], Material.IRON_CHAIN);
                    }
                }
            }
        }

        // 정상 — 발광 + 관(冠)
        int topY = baseY + 9;
        setBlock(world, 0, topY, 0, Material.SEA_LANTERN);
        for (int[] o : new int[][]{{1,0},{-1,0},{0,1},{0,-1}}) {
            setBlock(world, o[0], topY, o[1], LIGHT);
            setStairs(world, o[0] * 2, topY, o[1] * 2, Material.QUARTZ_STAIRS,
                    o[0] != 0 ? (o[0] > 0 ? BlockFace.WEST : BlockFace.EAST)
                              : (o[1] > 0 ? BlockFace.NORTH : BlockFace.SOUTH), false);
        }
        setBlock(world, 0, topY + 1, 0, Material.SEA_LANTERN);

        // 기단 둘레 수로 — 물을 넣어 생기를 줍니다
        for (int x = -5; x <= 5; x++) {
            for (int z = -5; z <= 5; z++) {
                double d = Math.sqrt(x * x + z * z);
                if (d < 4.2 || d > 5.2) continue;
                setBlock(world, x, PLAZA_TOP - 1, z, Material.PRISMARINE_BRICKS);
                setWater(world.getBlockAt(x, PLAZA_TOP, z));
            }
        }
    }

    // ── 6. 화단 ────────────────────────────────────────────────────────

    /** 관문 사이 빈 구간에 녹지. 돌만 깔린 면을 피합니다 (§2-5). */
    private void buildGardens(World world) {
        int[] gardenAngles = {30, 150, 270};
        for (int deg : gardenAngles) {
            double rad = Math.toRadians(deg);
            int cx = (int) Math.round(Math.cos(rad) * 22);
            int cz = (int) Math.round(Math.sin(rad) * 22);
            // 화단은 보도 위에 얹습니다 (광장 경계에 걸치지 않게)

            for (int dx = -3; dx <= 3; dx++) {
                for (int dz = -3; dz <= 3; dz++) {
                    double d = Math.sqrt(dx * dx + dz * dz);
                    if (d > 3.2) continue;
                    int x = cx + dx, z = cz + dz;

                    if (d > 2.2) {
                        setBlock(world, x, RIM_TOP + 1, z, BASE_BRICK);   // 화단 테두리
                    } else {
                        setBlock(world, x, RIM_TOP + 1, z, Material.MOSS_BLOCK);
                        if (random.nextInt(3) == 0) {
                            setBlock(world, x, RIM_TOP + 2, z,
                                    random.nextBoolean() ? Material.SHORT_GRASS : Material.AZURE_BLUET);
                        }
                    }
                }
            }
            // 가운데 나무
            for (int y = RIM_TOP + 2; y <= RIM_TOP + 5; y++) {
                setPillar(world, cx, y, cz, Material.OAK_LOG, Axis.Y);
            }
            for (int dx = -2; dx <= 2; dx++) {
                for (int dz = -2; dz <= 2; dz++) {
                    for (int dy = 0; dy <= 2; dy++) {
                        double d = Math.sqrt(dx * dx + dz * dz + dy * dy * 1.6);
                        if (d > 2.6 || (dx == 0 && dz == 0 && dy == 0)) continue;
                        setBlock(world, cx + dx, RIM_TOP + 5 + dy, cz + dz, Material.OAK_LEAVES);
                    }
                }
            }
        }
    }

    // ── 7. 조명 ────────────────────────────────────────────────────────

    private void buildLampPosts(World world) {
        for (int deg = 0; deg < 360; deg += 30) {
            if (nearGate(deg, 20)) continue;
            double rad = Math.toRadians(deg);
            int x = (int) Math.round(Math.cos(rad) * (PLAZA_R + 2));
            int z = (int) Math.round(Math.sin(rad) * (PLAZA_R + 2));

            for (int y = RIM_TOP + 1; y <= RIM_TOP + 3; y++) {
                setWall(world, x, y, z, Material.ANDESITE_WALL);
            }
            setBlock(world, x, RIM_TOP + 4, z, Material.LANTERN);
        }
    }

    // ── 8. 인증 안뜰 (D10) ─────────────────────────────────────────────

    /**
     * 미인증자가 머무는 곳.
     *
     * 예전에는 검은 원반에 벽만 둘렀는데, 첫인상이 감옥 같았습니다.
     * 같은 격리 효과를 유지하되 "대기실"로 읽히도록 안뜰 형태로 바꿨습니다.
     */
    private void buildVerificationCourtyard(World world) {
        int cx = VERIFY_X, cz = VERIFY_Z;

        for (int dx = -VERIFY_R - 2; dx <= VERIFY_R + 2; dx++) {
            for (int dz = -VERIFY_R - 2; dz <= VERIFY_R + 2; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > VERIFY_R + 2) continue;
                int x = cx + dx, z = cz + dz;

                if (d <= VERIFY_R) {
                    Material m = d < 3 ? LIGHT
                            : ((dx + dz) & 1) == 0 ? BASE : WALK_A;
                    setBlock(world, x, VERIFY_Y - 1, z, m);
                    fillBelow(world, x, VERIFY_Y - 1, z);
                } else {
                    // 둘레 건물 벽
                    setBlock(world, x, VERIFY_Y - 1, z, BASE_BRICK);
                    fillBelow(world, x, VERIFY_Y - 1, z);
                    for (int y = VERIFY_Y; y <= VERIFY_Y + 4; y++) {
                        setBlock(world, x, y, z, y == VERIFY_Y + 4 ? BASE_DARK : BASE_BRICK);
                    }
                }
            }
        }

        // 중앙 안내 단상
        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                if (Math.abs(dx) == 2 || Math.abs(dz) == 2) {
                    setStairs(world, cx + dx, VERIFY_Y, cz + dz, Material.POLISHED_ANDESITE_STAIRS,
                            facing(dx, dz, true), false);
                } else {
                    setBlock(world, cx + dx, VERIFY_Y, cz + dz, WARM);
                }
            }
        }

        // 네 모서리 조명 기둥
        for (int[] o : new int[][]{{6,6},{-6,6},{6,-6},{-6,-6}}) {
            for (int y = VERIFY_Y; y <= VERIFY_Y + 3; y++) {
                setPillar(world, cx + o[0], y, cz + o[1], PILLAR, Axis.Y);
            }
            setBlock(world, cx + o[0], VERIFY_Y + 4, cz + o[1], Material.SEA_LANTERN);
        }
    }

    // ── 보조 ───────────────────────────────────────────────────────────

    /** deg 가 관문 방위에서 spread 도 이내인가. */
    private boolean nearGate(int deg, int spread) {
        for (int g : GATE_ANGLES) {
            int d = Math.abs(deg - g) % 360;
            d = Math.min(d, 360 - d);        // 최단 각거리
            if (d < spread) return true;
        }
        return false;
    }

    /** 중심을 향하거나(inward) 등지는 방향. */
    private BlockFace facing(int x, int z, boolean inward) {
        BlockFace f;
        if (Math.abs(x) > Math.abs(z)) f = x > 0 ? BlockFace.WEST : BlockFace.EAST;
        else f = z > 0 ? BlockFace.NORTH : BlockFace.SOUTH;
        return inward ? f : f.getOppositeFace();
    }

    private void setBlock(World world, int x, int y, int z, Material m) {
        world.getBlockAt(x, y, z).setType(m, false);
    }

    /** 바닥 아래를 몇 겹 채워 밑에서 봐도 비지 않게. */
    private void fillBelow(World world, int x, int y, int z) {
        setBlock(world, x, y - 1, z, Material.STONE);
        setBlock(world, x, y - 2, z, Material.DEEPSLATE);
        setBlock(world, x, y - 3, z, Material.DEEPSLATE);
    }

    private void setStairs(World world, int x, int y, int z, Material m,
                           BlockFace face, boolean top) {
        Block b = world.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData data = b.getBlockData();
        if (data instanceof Stairs stairs) {
            stairs.setFacing(face);
            stairs.setHalf(top ? org.bukkit.block.data.Bisected.Half.TOP
                              : org.bukkit.block.data.Bisected.Half.BOTTOM);
            b.setBlockData(stairs, false);
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

    // ── 외부에서 쓰는 좌표 ─────────────────────────────────────────────

    /** 서버 선택 NPC 위치 — 관문 전실 중앙. */
    public static Location podiumLocation(World world, int index) {
        int deg = GATE_ANGLES[index % GATE_ANGLES.length];
        double rad = Math.toRadians(deg);
        int x = (int) Math.round(Math.cos(rad) * CHAMBER_DIST);
        int z = (int) Math.round(Math.sin(rad) * CHAMBER_DIST);
        // 단상 블록은 RIM_TOP+1 에 있으므로 그 위(+2)에 세웁니다.
        // 광장 쪽을 바라보게 yaw 를 돌립니다.
        float yaw = (float) (deg + 90);
        return new Location(world, x + 0.5, RIM_TOP + 2, z + 0.5, yaw, 0f);
    }

    /** 스폰 — 광장 남쪽, 기념탑을 바라보는 자리. */
    public static Location spawnLocation(World world) {
        return new Location(world, 0.5, GROUND_Y, 12.5, 180f, 0f);
    }

    public static Location verificationLocation(World world) {
        return new Location(world, VERIFY_X + 0.5, VERIFY_Y + 1, VERIFY_Z + 0.5, 0f, 0f);
    }

    /** RucHome 이 "이미 지어졌는지" 판단할 때 쓰는 기준점. */
    public static int groundY() { return GROUND_Y; }
}
