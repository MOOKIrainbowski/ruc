package kr.rucserver.home.world;

import org.bukkit.Axis;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Levelled;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.Rotatable;
import org.bukkit.block.data.type.Slab;
import org.bukkit.block.data.type.Stairs;
import org.bukkit.block.data.type.Wall;

/**
 * 허브에 놓는 개별 구조물.
 *
 * 참고한 것
 *  - `mapfile/꿀렘 로비` (1.10.2) 를 파싱해 뽑은 팔레트가 근거입니다.
 *    표면 기준 물 22% / 잔디 19% / 분홍·흰 캐노피 26% / 석재 15% —
 *    돌 광장이 아니라 **정원 섬**이고, 석재는 길과 중앙 단상에만 씁니다.
 *  - 원본은 1.10 이라 벚꽃이 없어서 분홍양털+흰유리로 캐노피를 만들었습니다.
 *    1.21 에는 실제 벚꽃 블록이 있으므로 그쪽을 씁니다.
 *
 * ⚠️ 영상 4편(쉼터/분수대/농부의 집/목조주택)은 제목만 확인했고 내용은 보지
 *    못했습니다. 아래 구조물은 그 제목이 가리키는 대상을, 위 팔레트 분석과
 *    일반적인 건축 관례에 맞춰 제가 설계한 것입니다.
 */
public final class Structures {

    private Structures() {}

    // ── 1. 작동하는 분수대 ─────────────────────────────────────────────

    /**
     * 중앙 분수.
     *
     * "작동하는"의 핵심은 물이 위에서 흘러내리는 것입니다.
     * 상단 수반에서 물이 넘쳐 아래 수조로 떨어지도록 단을 나눴습니다.
     */
    public static void fountain(World world, int cx, int y, int cz) {
        // 하단 수조 (반지름 7)
        for (int dx = -8; dx <= 8; dx++) {
            for (int dz = -8; dz <= 8; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > 8.2) continue;
                int x = cx + dx, z = cz + dz;

                if (d > 7.0) {
                    // 테두리 — 계단을 바깥으로 돌려 앉을 수 있는 단
                    setStairs(world, x, y, z, Material.STONE_BRICK_STAIRS, facing(dx, dz, true), false);
                    world.getBlockAt(x, y - 1, z).setType(Material.STONE_BRICKS, false);
                } else if (d > 6.2) {
                    world.getBlockAt(x, y, z).setType(Material.CHISELED_STONE_BRICKS, false);
                } else {
                    // 수조 바닥 + 물
                    world.getBlockAt(x, y - 1, z).setType(Material.STONE_BRICKS, false);
                    setWater(world.getBlockAt(x, y, z));
                }
            }
        }

        // 중단 기둥과 수반
        for (int yy = y + 1; yy <= y + 3; yy++) {
            for (int dx = -2; dx <= 2; dx++) {
                for (int dz = -2; dz <= 2; dz++) {
                    double d = Math.sqrt(dx * dx + dz * dz);
                    if (d > 2.4) continue;
                    world.getBlockAt(cx + dx, yy, cz + dz).setType(
                            d > 1.6 ? Material.QUARTZ_BLOCK : Material.CHISELED_QUARTZ_BLOCK, false);
                }
            }
        }

        // 중단 수반 (반지름 4) — 여기서 물이 넘쳐 아래로 떨어집니다
        int basinY = y + 4;
        for (int dx = -5; dx <= 5; dx++) {
            for (int dz = -5; dz <= 5; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > 5.2) continue;
                int x = cx + dx, z = cz + dz;

                if (d > 4.2) {
                    setStairs(world, x, basinY, z, Material.QUARTZ_STAIRS, facing(dx, dz, false), false);
                } else if (d > 3.4) {
                    world.getBlockAt(x, basinY, z).setType(Material.QUARTZ_BLOCK, false);
                    // 네 방향으로 물이 떨어지는 구멍
                    if ((Math.abs(dx) <= 1 && Math.abs(dz) > 3) || (Math.abs(dz) <= 1 && Math.abs(dx) > 3)) {
                        setWater(world.getBlockAt(x, basinY, z));
                        for (int fy = basinY - 1; fy > y; fy--) {
                            setWater(world.getBlockAt(x, fy, z));
                        }
                    }
                } else {
                    world.getBlockAt(x, basinY - 1, z).setType(Material.QUARTZ_BLOCK, false);
                    setWater(world.getBlockAt(x, basinY, z));
                }
            }
        }

        // 상단 기둥 + 관
        for (int yy = basinY + 1; yy <= basinY + 4; yy++) {
            setPillar(world, cx, yy, cz, Material.QUARTZ_PILLAR, Axis.Y);
        }
        int topY = basinY + 5;
        for (int[] o : new int[][]{{0, 0}, {1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
            world.getBlockAt(cx + o[0], topY, cz + o[1]).setType(Material.QUARTZ_BLOCK, false);
        }
        setWater(world.getBlockAt(cx, topY + 1, cz));
        world.getBlockAt(cx, topY + 2, cz).setType(Material.SEA_LANTERN, false);

        // 상단에서 중단 수반으로 떨어지는 물줄기
        for (int[] o : new int[][]{{2, 0}, {-2, 0}, {0, 2}, {0, -2}}) {
            for (int fy = topY; fy > basinY; fy--) {
                setWater(world.getBlockAt(cx + o[0], fy, cz + o[1]));
            }
        }

        // 조명 — 수조 테두리 랜턴
        for (int[] o : new int[][]{{7, 0}, {-7, 0}, {0, 7}, {0, -7}}) {
            for (int yy = y + 1; yy <= y + 2; yy++) {
                setWall(world, cx + o[0], yy, cz + o[1], Material.COBBLESTONE_WALL);
            }
            world.getBlockAt(cx + o[0], y + 3, cz + o[1]).setType(Material.LANTERN, false);
        }
    }

    // ── 2. 쉼터 (정자) ─────────────────────────────────────────────────

    /**
     * 팔각 정자.
     *
     * 허브에서 사람이 모여 서 있을 자리가 필요합니다. 지붕이 있으면
     * "머무는 곳"으로 읽히고, 없으면 그냥 지나가는 바닥입니다.
     */
    public static void gazebo(World world, int cx, int y, int cz) {
        int r = 6;

        // 바닥 — 한 단 올린 기단
        for (int dx = -r - 1; dx <= r + 1; dx++) {
            for (int dz = -r - 1; dz <= r + 1; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > r + 1.2) continue;
                int x = cx + dx, z = cz + dz;

                if (d > r + 0.3) {
                    setStairs(world, x, y, z, Material.STONE_BRICK_STAIRS, facing(dx, dz, true), false);
                } else {
                    world.getBlockAt(x, y, z).setType(
                            d > r - 0.8 ? Material.CHISELED_STONE_BRICKS
                                    : (((dx + dz) & 1) == 0 ? Material.STONE_BRICKS
                                                            : Material.CHERRY_PLANKS), false);
                }
                world.getBlockAt(x, y - 1, z).setType(Material.COBBLESTONE, false);
            }
        }

        // 기둥 8개
        int[][] posts = {{r, 0}, {-r, 0}, {0, r}, {0, -r},
                         {4, 4}, {-4, 4}, {4, -4}, {-4, -4}};
        for (int[] p : posts) {
            for (int yy = y + 1; yy <= y + 4; yy++) {
                setPillar(world, cx + p[0], yy, cz + p[1], Material.CHERRY_LOG, Axis.Y);
            }
            // 기둥 하단 장식
            world.getBlockAt(cx + p[0], y + 1, cz + p[1]).setType(Material.STRIPPED_CHERRY_LOG, false);
        }

        // 처마 — 기둥 사이를 잇는 보
        int beamY = y + 5;
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d < r - 1.2 || d > r + 0.4) continue;
                world.getBlockAt(cx + dx, beamY, cz + dz).setType(Material.CHERRY_PLANKS, false);
            }
        }

        // 지붕 — 원뿔형 3단
        for (int tier = 0; tier < 4; tier++) {
            int rr = r - tier * 2 + 1;
            int yy = beamY + 1 + tier;
            if (rr < 1) break;
            for (int dx = -rr - 1; dx <= rr + 1; dx++) {
                for (int dz = -rr - 1; dz <= rr + 1; dz++) {
                    double d = Math.sqrt(dx * dx + dz * dz);
                    if (d > rr + 1.0) continue;
                    int x = cx + dx, z = cz + dz;
                    if (d > rr - 0.2) {
                        setStairs(world, x, yy, z, Material.CHERRY_STAIRS, facing(dx, dz, true), false);
                    } else {
                        world.getBlockAt(x, yy, z).setType(Material.CHERRY_PLANKS, false);
                    }
                }
            }
        }
        world.getBlockAt(cx, beamY + 5, cz).setType(Material.CHERRY_SLAB, false);

        // 내부 — 가운데 화로와 앉는 자리
        world.getBlockAt(cx, y + 1, cz).setType(Material.CAMPFIRE, false);
        for (int[] o : new int[][]{{3, 0}, {-3, 0}, {0, 3}, {0, -3}}) {
            setStairs(world, cx + o[0], y + 1, cz + o[1], Material.CHERRY_STAIRS,
                    facing(o[0], o[1], true), false);
        }

        // 처마 아래 매다는 랜턴
        for (int[] p : new int[][]{{r, 0}, {-r, 0}, {0, r}, {0, -r}}) {
            world.getBlockAt(cx + p[0], beamY - 1, cz + p[1]).setType(Material.LANTERN, false);
        }
    }

    // ── 3. 농부의 집 ───────────────────────────────────────────────────

    /**
     * 농부의 집 — 밭과 건초가 딸린 소박한 집.
     * 정원 로비의 "마을" 분위기를 만드는 역할입니다.
     */
    public static void farmerHouse(World world, int cx, int y, int cz) {
        int w = 5, l = 6;

        // 기단
        for (int dx = -w - 1; dx <= w + 1; dx++) {
            for (int dz = -l - 1; dz <= l + 1; dz++) {
                world.getBlockAt(cx + dx, y, cz + dz).setType(
                        Math.abs(dx) > w || Math.abs(dz) > l
                                ? Material.COBBLESTONE : Material.COBBLESTONE, false);
            }
        }

        // 벽
        for (int yy = y + 1; yy <= y + 4; yy++) {
            for (int dx = -w; dx <= w; dx++) {
                for (int dz = -l; dz <= l; dz++) {
                    boolean edge = Math.abs(dx) == w || Math.abs(dz) == l;
                    if (!edge) continue;
                    boolean corner = Math.abs(dx) == w && Math.abs(dz) == l;

                    Material m;
                    if (corner) m = Material.SPRUCE_LOG;
                    else if (yy == y + 1) m = Material.COBBLESTONE;
                    else if (yy == y + 4) m = Material.SPRUCE_LOG;
                    else m = ((dx + dz + yy) % 3 == 0) ? Material.SPRUCE_PLANKS
                                                       : Material.WHITE_TERRACOTTA;
                    world.getBlockAt(cx + dx, yy, cz + dz).setType(m, false);
                }
            }
        }

        // 바닥 · 천장
        for (int dx = -w + 1; dx <= w - 1; dx++) {
            for (int dz = -l + 1; dz <= l - 1; dz++) {
                world.getBlockAt(cx + dx, y, cz + dz).setType(Material.SPRUCE_PLANKS, false);
                for (int yy = y + 1; yy <= y + 4; yy++) {
                    world.getBlockAt(cx + dx, yy, cz + dz).setType(Material.AIR, false);
                }
            }
        }

        // 문과 창
        world.getBlockAt(cx, y + 1, cz - l).setType(Material.AIR, false);
        world.getBlockAt(cx, y + 2, cz - l).setType(Material.AIR, false);
        for (int[] win : new int[][]{{-3, -l}, {3, -l}, {-3, l}, {3, l}, {-w, -2}, {-w, 2}, {w, -2}, {w, 2}}) {
            world.getBlockAt(cx + win[0], y + 2, cz + win[1]).setType(Material.GLASS_PANE, false);
            world.getBlockAt(cx + win[0], y + 3, cz + win[1]).setType(Material.GLASS_PANE, false);
        }

        // 박공 지붕
        for (int tier = 0; tier <= w + 1; tier++) {
            int yy = y + 5 + tier;
            int span = w + 1 - tier;
            if (span < 0) break;
            for (int dz = -l - 1; dz <= l + 1; dz++) {
                if (span > 0) {
                    setStairs(world, cx - span, yy, cz + dz, Material.DARK_OAK_STAIRS, BlockFace.EAST, false);
                    setStairs(world, cx + span, yy, cz + dz, Material.DARK_OAK_STAIRS, BlockFace.WEST, false);
                    for (int dx = -span + 1; dx <= span - 1; dx++) {
                        world.getBlockAt(cx + dx, yy, cz + dz).setType(Material.AIR, false);
                    }
                } else {
                    world.getBlockAt(cx, yy, cz + dz).setType(Material.DARK_OAK_SLAB, false);
                }
            }
        }

        // 내부 가구
        world.getBlockAt(cx - w + 1, y + 1, cz - l + 1).setType(Material.CRAFTING_TABLE, false);
        world.getBlockAt(cx - w + 2, y + 1, cz - l + 1).setType(Material.BARREL, false);
        world.getBlockAt(cx + w - 1, y + 1, cz + l - 1).setType(Material.COMPOSTER, false);
        world.getBlockAt(cx, y + 4, cz).setType(Material.LANTERN, false);

        // 바깥 밭
        for (int dx = -4; dx <= 4; dx++) {
            for (int dz = 0; dz <= 5; dz++) {
                int x = cx + dx, z = cz + l + 3 + dz;
                if (dx == 0) {
                    world.getBlockAt(x, y, z).setType(Material.WATER, false);
                } else {
                    world.getBlockAt(x, y, z).setType(Material.FARMLAND, false);
                    world.getBlockAt(x, y + 1, z).setType(Material.WHEAT, false);
                }
            }
        }
        // 건초 더미와 울타리
        world.getBlockAt(cx - w - 2, y + 1, cz).setType(Material.HAY_BLOCK, false);
        world.getBlockAt(cx - w - 2, y + 2, cz).setType(Material.HAY_BLOCK, false);
        world.getBlockAt(cx - w - 3, y + 1, cz).setType(Material.HAY_BLOCK, false);
    }

    // ── 4. 목조 주택 ───────────────────────────────────────────────────

    /** 단층 목조주택 — 농부의 집보다 밝고 아담합니다. */
    public static void woodenHouse(World world, int cx, int y, int cz) {
        int w = 4, l = 5;

        for (int dx = -w - 1; dx <= w + 1; dx++) {
            for (int dz = -l - 1; dz <= l + 1; dz++) {
                world.getBlockAt(cx + dx, y, cz + dz).setType(Material.COBBLESTONE, false);
            }
        }

        for (int yy = y + 1; yy <= y + 4; yy++) {
            for (int dx = -w; dx <= w; dx++) {
                for (int dz = -l; dz <= l; dz++) {
                    boolean edge = Math.abs(dx) == w || Math.abs(dz) == l;
                    if (!edge) continue;
                    boolean corner = Math.abs(dx) == w && Math.abs(dz) == l;
                    Material m = corner ? Material.OAK_LOG
                            : yy == y + 4 ? Material.OAK_LOG
                            : ((dx + dz) % 2 == 0 ? Material.OAK_PLANKS : Material.BIRCH_PLANKS);
                    world.getBlockAt(cx + dx, yy, cz + dz).setType(m, false);
                }
            }
        }

        for (int dx = -w + 1; dx <= w - 1; dx++) {
            for (int dz = -l + 1; dz <= l - 1; dz++) {
                world.getBlockAt(cx + dx, y, cz + dz).setType(Material.OAK_PLANKS, false);
                for (int yy = y + 1; yy <= y + 4; yy++) {
                    world.getBlockAt(cx + dx, yy, cz + dz).setType(Material.AIR, false);
                }
            }
        }

        // 문 · 창
        world.getBlockAt(cx, y + 1, cz - l).setType(Material.AIR, false);
        world.getBlockAt(cx, y + 2, cz - l).setType(Material.AIR, false);
        for (int[] win : new int[][]{{-2, -l}, {2, -l}, {-2, l}, {2, l}, {-w, 0}, {w, 0}}) {
            world.getBlockAt(cx + win[0], y + 2, cz + win[1]).setType(Material.GLASS_PANE, false);
        }

        // 지붕
        for (int tier = 0; tier <= w + 1; tier++) {
            int yy = y + 5 + tier;
            int span = w + 1 - tier;
            if (span < 0) break;
            for (int dz = -l - 1; dz <= l + 1; dz++) {
                if (span > 0) {
                    setStairs(world, cx - span, yy, cz + dz, Material.SPRUCE_STAIRS, BlockFace.EAST, false);
                    setStairs(world, cx + span, yy, cz + dz, Material.SPRUCE_STAIRS, BlockFace.WEST, false);
                    for (int dx = -span + 1; dx <= span - 1; dx++) {
                        world.getBlockAt(cx + dx, yy, cz + dz).setType(Material.AIR, false);
                    }
                } else {
                    world.getBlockAt(cx, yy, cz + dz).setType(Material.SPRUCE_SLAB, false);
                }
            }
        }

        // 현관 차양
        for (int dx = -2; dx <= 2; dx++) {
            setStairs(world, cx + dx, y + 4, cz - l - 1, Material.SPRUCE_STAIRS, BlockFace.NORTH, false);
        }
        world.getBlockAt(cx - 2, y + 1, cz - l - 1).setType(Material.OAK_FENCE, false);
        world.getBlockAt(cx - 2, y + 2, cz - l - 1).setType(Material.OAK_FENCE, false);
        world.getBlockAt(cx - 2, y + 3, cz - l - 1).setType(Material.OAK_FENCE, false);
        world.getBlockAt(cx + 2, y + 1, cz - l - 1).setType(Material.OAK_FENCE, false);
        world.getBlockAt(cx + 2, y + 2, cz - l - 1).setType(Material.OAK_FENCE, false);
        world.getBlockAt(cx + 2, y + 3, cz - l - 1).setType(Material.OAK_FENCE, false);

        world.getBlockAt(cx, y + 4, cz).setType(Material.LANTERN, false);
        world.getBlockAt(cx - w + 1, y + 1, cz + l - 1).setType(Material.BOOKSHELF, false);
        world.getBlockAt(cx + w - 1, y + 1, cz - l + 1).setType(Material.LOOM, false);
    }

    // ── 5. 벚나무 ──────────────────────────────────────────────────────

    /**
     * 벚나무.
     *
     * 꿀렘 로비는 1.10 이라 분홍양털+흰유리로 캐노피를 흉내냈습니다.
     * 1.21 에는 진짜 벚꽃 블록이 있어 그대로 씁니다. 바닥에 분홍 꽃잎을
     * 깔아 떨어진 꽃잎까지 표현합니다.
     */
    public static void cherryTree(World world, int cx, int y, int cz, int height) {
        for (int i = 1; i <= height; i++) {
            setPillar(world, cx, y + i, cz, Material.CHERRY_LOG, Axis.Y);
        }
        // 위쪽에서 살짝 갈라지는 가지
        int forkY = y + height - 1;
        for (int[] dir : new int[][]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
            if (Palette.noise(cx + dir[0], forkY, cz + dir[1]) < 0.45) continue;
            setPillar(world, cx + dir[0], forkY, cz + dir[1], Material.CHERRY_LOG,
                    dir[0] != 0 ? Axis.X : Axis.Z);
        }

        int top = y + height;
        int r = 4;
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                for (int dy = -2; dy <= 2; dy++) {
                    double d = Math.sqrt(dx * dx + dz * dz + dy * dy * 2.0);
                    if (d > r - 0.4 + Palette.noise(cx + dx, dy, cz + dz) * 1.3) continue;
                    if (dx == 0 && dz == 0 && dy < 0) continue;
                    Block b = world.getBlockAt(cx + dx, top + dy, cz + dz);
                    if (!b.getType().isAir()) continue;
                    b.setType(Material.CHERRY_LEAVES, false);
                }
            }
        }

        // 떨어진 꽃잎
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                if (Palette.noise(cx + dx, 31, cz + dz) < 0.62) continue;
                Block ground = world.getBlockAt(cx + dx, y, cz + dz);
                Block above = world.getBlockAt(cx + dx, y + 1, cz + dz);
                if (ground.getType() == Material.GRASS_BLOCK && above.getType().isAir()) {
                    above.setType(Material.PINK_PETALS, false);
                }
            }
        }
    }

    // ── 보조 ───────────────────────────────────────────────────────────

    private static BlockFace facing(int x, int z, boolean inward) {
        BlockFace f;
        if (Math.abs(x) > Math.abs(z)) f = x > 0 ? BlockFace.WEST : BlockFace.EAST;
        else f = z > 0 ? BlockFace.NORTH : BlockFace.SOUTH;
        return inward ? f : f.getOppositeFace();
    }

    private static void setStairs(World world, int x, int y, int z, Material m,
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

    private static void setWall(World world, int x, int y, int z, Material m) {
        Block b = world.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData data = b.getBlockData();
        if (data instanceof Wall wall) {
            wall.setUp(true);
            b.setBlockData(wall, false);
        }
    }

    private static void setPillar(World world, int x, int y, int z, Material m, Axis axis) {
        Block b = world.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData data = b.getBlockData();
        if (data instanceof Orientable o) {
            o.setAxis(axis);
            b.setBlockData(o, false);
        }
    }

    private static void setWater(Block block) {
        block.setType(Material.WATER, false);
        if (block.getBlockData() instanceof Levelled levelled) {
            levelled.setLevel(0);
            block.setBlockData(levelled, false);
        }
    }
}
