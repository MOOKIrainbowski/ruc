package kr.rucserver.home.world;

import org.bukkit.Axis;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.BlockFace;

/**
 * 개별 구조물.
 *
 * 재료 제약 (요청): 구리 계열 금지, 화강암·섬록암·안산암 금지.
 * 대신 프리즈머린 / 석재벽돌 / 석영 / 심층암 / 블랙스톤 / 응회암 / 사암 계열을 씁니다.
 */
public final class Structures {

    private Structures() {}

    // ── 유기적인 벚나무 ────────────────────────────────────────────────

    /**
     * 벚나무.
     *
     * 이전 버전은 구 방정식으로 잎을 채워서 "덩어리"로 보였습니다.
     * 여기서는 실제 나무처럼 만듭니다 —
     *   1) 줄기가 살짝 기울고 휘어짐
     *   2) 3~5개의 가지가 서로 다른 방향·길이로 뻗음
     *   3) 잎은 가지 끝마다 작은 뭉치로 달리고, 뭉치끼리 겹쳐 큰 수관을 이룸
     *   4) 가장자리를 노이즈로 갉아내 윤곽이 매끈하지 않게
     */
    public static void cherryTree(World world, int cx, int groundY, int cz, int height) {
        long seed = (long) cx * 73856093 ^ (long) cz * 19349663;

        // 줄기 — 위로 갈수록 살짝 기웁니다
        double leanX = (Palette.noise(cx, 1, cz) - 0.5) * 0.35;
        double leanZ = (Palette.noise(cx, 2, cz) - 0.5) * 0.35;

        int tipX = cx, tipZ = cz;
        for (int i = 1; i <= height; i++) {
            int x = cx + (int) Math.round(leanX * i);
            int z = cz + (int) Math.round(leanZ * i);
            Brush.pillar(world, x, groundY + i, z, Material.CHERRY_LOG, Axis.Y);
            // 굵은 밑동
            if (i <= 2) {
                for (int[] o : new int[][]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
                    if (Palette.noise(x + o[0], i, z + o[1]) > 0.6) {
                        Brush.setIfAir(world, x + o[0], groundY + i, z + o[1], Material.CHERRY_LOG);
                    }
                }
            }
            tipX = x; tipZ = z;
        }
        int tipY = groundY + height;

        // 가지 3~5개
        int branches = 3 + (int) (Palette.noise(cx, 5, cz) * 3);
        double baseAngle = Palette.noise(cx, 6, cz) * 360;

        for (int b = 0; b < branches; b++) {
            double ang = Math.toRadians(baseAngle + b * (360.0 / branches)
                    + (Palette.noise(cx, b, cz) - 0.5) * 40);
            int len = 3 + (int) (Palette.noise(cx, b + 10, cz) * 4);
            int startDown = (int) (Palette.noise(cx, b + 20, cz) * 3);

            int bx = tipX, bz = tipZ, by = tipY - startDown;
            for (int i = 1; i <= len; i++) {
                bx = tipX + (int) Math.round(Math.cos(ang) * i);
                bz = tipZ + (int) Math.round(Math.sin(ang) * i);
                by = tipY - startDown + (int) Math.round(i * 0.55);
                Brush.setIfAir(world, bx, by, bz, Material.CHERRY_LOG);
            }
            // 가지 끝 잎 뭉치
            leafCluster(world, bx, by, bz, 2.6 + Palette.noise(bx, b, bz) * 1.2);
        }

        // 꼭대기 뭉치
        leafCluster(world, tipX, tipY + 1, tipZ, 3.0 + Palette.noise(cx, 9, cz) * 1.0);

        // 떨어진 꽃잎
        for (int dx = -6; dx <= 6; dx++) {
            for (int dz = -6; dz <= 6; dz++) {
                if (Palette.noise(cx + dx, 31, cz + dz) < 0.72) continue;
                if (Math.hypot(dx, dz) > 5.5) continue;
                Material g = Brush.typeAt(world, cx + dx, groundY, cz + dz);
                if ((g == Material.GRASS_BLOCK || g == Material.MOSS_BLOCK
                        || g == Material.PODZOL || g == Material.COARSE_DIRT)
                        && Brush.typeAt(world, cx + dx, groundY + 1, cz + dz).isAir()) {
                    Brush.set(world, cx + dx, groundY + 1, cz + dz, Material.PINK_PETALS);
                }
            }
        }
    }

    /** 작은 잎 뭉치. 가장자리를 노이즈로 갉아 유기적으로. */
    private static void leafCluster(World world, int cx, int cy, int cz, double r) {
        int ri = (int) Math.ceil(r) + 1;
        for (int dx = -ri; dx <= ri; dx++) {
            for (int dz = -ri; dz <= ri; dz++) {
                for (int dy = -ri; dy <= ri; dy++) {
                    // 세로로 납작하게 (수관은 옆으로 퍼짐)
                    double d = Math.sqrt(dx * dx + dz * dz + dy * dy * 2.4);
                    double edge = r + Palette.noise(cx + dx, cy + dy, cz + dz) * 1.5 - 0.6;
                    if (d > edge) continue;
                    Brush.setIfAir(world, cx + dx, cy + dy, cz + dz, Material.CHERRY_LEAVES);
                }
            }
        }
    }

    // ── 정자 (쉼터) ────────────────────────────────────────────────────

    public static void gazebo(World world, int cx, int y, int cz) {
        int r = 7;

        // 기단 2단
        for (int t = 0; t < 2; t++) {
            int rr = r + 1 - t;
            for (int dx = -rr - 1; dx <= rr + 1; dx++) {
                for (int dz = -rr - 1; dz <= rr + 1; dz++) {
                    double d = Math.hypot(dx, dz);
                    if (d > rr + 1.2) continue;
                    int x = cx + dx, z = cz + dz, yy = y + t;
                    if (d > rr + 0.3) {
                        Brush.stairs(world, x, yy, z, Material.STONE_BRICK_STAIRS,
                                Brush.facing(dx, dz, true), false);
                    } else {
                        Brush.set(world, x, yy, z, d > rr - 1
                                ? Material.DEEPSLATE_BRICKS
                                : (((dx + dz) & 1) == 0 ? Material.STONE_BRICKS
                                                        : Material.SMOOTH_QUARTZ));
                    }
                }
            }
        }
        int floorY = y + 1;

        // 기둥 8개
        int[][] posts = {{r, 0}, {-r, 0}, {0, r}, {0, -r}, {5, 5}, {-5, 5}, {5, -5}, {-5, -5}};
        for (int[] p : posts) {
            for (int yy = floorY + 1; yy <= floorY + 5; yy++) {
                Brush.pillar(world, cx + p[0], yy, cz + p[1], Material.CHERRY_LOG, Axis.Y);
            }
            Brush.set(world, cx + p[0], floorY + 1, cz + p[1], Material.QUARTZ_PILLAR);
            Brush.set(world, cx + p[0], floorY + 5, cz + p[1], Material.CHISELED_QUARTZ_BLOCK);
            Brush.set(world, cx + p[0], floorY + 4, cz + p[1], Material.LANTERN);
        }

        // 보 + 원뿔 지붕
        int beamY = floorY + 6;
        Brush.ring(world, cx, beamY, cz, r - 1.4, r + 0.4, Material.CHERRY_PLANKS);
        for (int t = 0; t < 5; t++) {
            int rr = r - t * 2 + 1;
            int yy = beamY + 1 + t;
            if (rr < 1) break;
            for (int dx = -rr - 1; dx <= rr + 1; dx++) {
                for (int dz = -rr - 1; dz <= rr + 1; dz++) {
                    double d = Math.hypot(dx, dz);
                    if (d > rr + 1.0) continue;
                    if (d > rr - 0.2) {
                        Brush.stairs(world, cx + dx, yy, cz + dz, Material.CHERRY_STAIRS,
                                Brush.facing(dx, dz, true), false);
                    } else {
                        Brush.set(world, cx + dx, yy, cz + dz, Material.CHERRY_PLANKS);
                    }
                }
            }
        }
        Brush.set(world, cx, beamY + 6, cz, Material.GLOWSTONE);

        // 내부 — 화로와 앉는 계단
        Brush.set(world, cx, floorY + 1, cz, Material.CAMPFIRE);
        for (int[] o : new int[][]{{3, 0}, {-3, 0}, {0, 3}, {0, -3}}) {
            Brush.stairs(world, cx + o[0], floorY + 1, cz + o[1], Material.CHERRY_STAIRS,
                    Brush.facing(o[0], o[1], true), false);
        }
    }

    // ── 농부의 집 ──────────────────────────────────────────────────────

    public static void farmerHouse(World world, int cx, int y, int cz) {
        int w = 6, l = 7;

        for (int dx = -w - 2; dx <= w + 2; dx++) {
            for (int dz = -l - 2; dz <= l + 2; dz++) {
                Brush.set(world, cx + dx, y, cz + dz,
                        Palette.mix(Palette.TUFF_MIX, cx + dx, cz + dz));
            }
        }

        for (int yy = y + 1; yy <= y + 5; yy++) {
            for (int dx = -w; dx <= w; dx++) {
                for (int dz = -l; dz <= l; dz++) {
                    boolean edge = Math.abs(dx) == w || Math.abs(dz) == l;
                    if (!edge) continue;
                    boolean corner = Math.abs(dx) == w && Math.abs(dz) == l;
                    Material m = corner ? Material.DARK_OAK_LOG
                            : yy == y + 1 ? Palette.mix(Palette.RUIN_MIX, cx + dx, yy, cz + dz)
                            : yy == y + 5 ? Material.DARK_OAK_LOG
                            : ((dx + dz + yy) % 3 == 0 ? Material.SPRUCE_PLANKS
                                                       : Material.WHITE_TERRACOTTA);
                    Brush.set(world, cx + dx, yy, cz + dz, m);
                }
            }
        }

        for (int dx = -w + 1; dx <= w - 1; dx++) {
            for (int dz = -l + 1; dz <= l - 1; dz++) {
                Brush.set(world, cx + dx, y, cz + dz, Material.SPRUCE_PLANKS);
                for (int yy = y + 1; yy <= y + 5; yy++) {
                    Brush.set(world, cx + dx, yy, cz + dz, Material.AIR);
                }
            }
        }

        // 아치형 출입구 (원호)
        for (int o = -2; o <= 2; o++) {
            int rise = Brush.archRise(o, 3, 2);
            for (int yy = y + 1; yy <= y + 2 + rise; yy++) {
                Brush.set(world, cx + o, yy, cz - l, Material.AIR);
            }
            Brush.set(world, cx + o, y + 3 + rise, cz - l, Material.CHISELED_STONE_BRICKS);
        }

        for (int[] win : new int[][]{{-4, -l}, {4, -l}, {-4, l}, {4, l}, {-w, -3}, {-w, 3}, {w, -3}, {w, 3}}) {
            Brush.set(world, cx + win[0], y + 2, cz + win[1], Material.GLASS_PANE);
            Brush.set(world, cx + win[0], y + 3, cz + win[1], Material.GLASS_PANE);
        }

        roofGable(world, cx, y + 6, cz, w, l, Material.DARK_OAK_STAIRS, Material.DARK_OAK_SLAB);

        Brush.set(world, cx - w + 1, y + 1, cz - l + 1, Material.CRAFTING_TABLE);
        Brush.set(world, cx - w + 2, y + 1, cz - l + 1, Material.BARREL);
        Brush.set(world, cx + w - 1, y + 1, cz + l - 1, Material.COMPOSTER);
        Brush.set(world, cx, y + 5, cz, Material.LANTERN);

        // 밭
        for (int dx = -5; dx <= 5; dx++) {
            for (int dz = 0; dz <= 6; dz++) {
                int x = cx + dx, z = cz + l + 4 + dz;
                if (dx == 0) Brush.water(world, x, y, z);
                else {
                    Brush.set(world, x, y, z, Material.FARMLAND);
                    Brush.set(world, x, y + 1, z, Material.WHEAT);
                }
            }
        }
        for (int i = 0; i < 3; i++) {
            Brush.set(world, cx - w - 3, y + 1 + i, cz, Material.HAY_BLOCK);
        }
    }

    // ── 목조 주택 ──────────────────────────────────────────────────────

    public static void woodenHouse(World world, int cx, int y, int cz) {
        int w = 5, l = 6;

        for (int dx = -w - 2; dx <= w + 2; dx++) {
            for (int dz = -l - 2; dz <= l + 2; dz++) {
                Brush.set(world, cx + dx, y, cz + dz,
                        Palette.mix(Palette.TUFF_MIX, cx + dx, cz + dz));
            }
        }

        for (int yy = y + 1; yy <= y + 5; yy++) {
            for (int dx = -w; dx <= w; dx++) {
                for (int dz = -l; dz <= l; dz++) {
                    boolean edge = Math.abs(dx) == w || Math.abs(dz) == l;
                    if (!edge) continue;
                    boolean corner = Math.abs(dx) == w && Math.abs(dz) == l;
                    Material m = corner ? Material.SPRUCE_LOG
                            : yy == y + 5 ? Material.SPRUCE_LOG
                            : yy == y + 1 ? Palette.mix(Palette.RUIN_MIX, cx + dx, yy, cz + dz)
                            : ((dx + dz) % 2 == 0 ? Material.CHERRY_PLANKS : Material.SPRUCE_PLANKS);
                    Brush.set(world, cx + dx, yy, cz + dz, m);
                }
            }
        }

        for (int dx = -w + 1; dx <= w - 1; dx++) {
            for (int dz = -l + 1; dz <= l - 1; dz++) {
                Brush.set(world, cx + dx, y, cz + dz, Material.CHERRY_PLANKS);
                for (int yy = y + 1; yy <= y + 5; yy++) {
                    Brush.set(world, cx + dx, yy, cz + dz, Material.AIR);
                }
            }
        }

        for (int o = -1; o <= 1; o++) {
            int rise = Brush.archRise(o, 2, 1);
            for (int yy = y + 1; yy <= y + 2 + rise; yy++) {
                Brush.set(world, cx + o, yy, cz - l, Material.AIR);
            }
        }
        for (int[] win : new int[][]{{-3, -l}, {3, -l}, {-3, l}, {3, l}, {-w, 0}, {w, 0}}) {
            Brush.set(world, cx + win[0], y + 2, cz + win[1], Material.GLASS_PANE);
            Brush.set(world, cx + win[0], y + 3, cz + win[1], Material.GLASS_PANE);
        }

        roofGable(world, cx, y + 6, cz, w, l, Material.SPRUCE_STAIRS, Material.SPRUCE_SLAB);

        // 현관 차양
        for (int dx = -2; dx <= 2; dx++) {
            Brush.stairs(world, cx + dx, y + 5, cz - l - 1, Material.SPRUCE_STAIRS,
                    BlockFace.NORTH, false);
        }
        for (int side : new int[]{-2, 2}) {
            for (int yy = y + 1; yy <= y + 4; yy++) {
                Brush.set(world, cx + side, yy, cz - l - 1, Material.SPRUCE_FENCE);
            }
        }

        Brush.set(world, cx, y + 5, cz, Material.LANTERN);
        Brush.set(world, cx - w + 1, y + 1, cz + l - 1, Material.BOOKSHELF);
        Brush.set(world, cx + w - 1, y + 1, cz - l + 1, Material.LOOM);
    }

    /** 박공 지붕 — 두 집이 공유합니다. */
    private static void roofGable(World world, int cx, int baseY, int cz,
                                  int w, int l, Material stair, Material slab) {
        for (int tier = 0; tier <= w + 1; tier++) {
            int yy = baseY + tier;
            int span = w + 1 - tier;
            if (span < 0) break;
            for (int dz = -l - 2; dz <= l + 2; dz++) {
                if (span > 0) {
                    Brush.stairs(world, cx - span, yy, cz + dz, stair, BlockFace.EAST, false);
                    Brush.stairs(world, cx + span, yy, cz + dz, stair, BlockFace.WEST, false);
                    for (int dx = -span + 1; dx <= span - 1; dx++) {
                        Brush.set(world, cx + dx, yy, cz + dz, Material.AIR);
                    }
                } else {
                    Brush.set(world, cx, yy, cz + dz, slab);
                }
            }
        }
    }
}
