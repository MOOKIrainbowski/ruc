package kr.rucserver.rpg.world;

import org.bukkit.Bukkit;
import org.bukkit.DyeColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.TreeType;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Directional;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.type.Leaves;
import org.bukkit.block.data.type.Slab;
import org.bukkit.block.data.type.Stairs;
import org.bukkit.block.sign.Side;
import org.bukkit.plugin.Plugin;

import java.util.Random;

/**
 * 웹 RPG 맵 → 마크 블록 (계획서 7장). 1타일 = 2×2 블록, 언덕 1층 = 2블록, 바닥 y = 64.
 * 지형(타일 · 물 · 언덕 · 계단 · 막힌 칸) → 오브젝트(나무 · 바위 · 반목조 건물 · 천막 · 분수 · 우물 · 포털 아치 · 가로등 · 소품 · 표지판).
 * 같은 맵을 다시 지으면 덮어씀(멱등). 한 틱에 타일 몇 줄씩 — 서버가 멈추지 않게.
 */
public final class MapBuilder {

    public static final int BASE_Y = 64;
    public static final int LEVEL_H = 2;
    /** 한 틱에 지을 타일 줄 (줄 하나 ≈ 맵 폭 × 4 기둥 — Codex 리뷰 4: 틱마다 수만 블록이면 TPS 가 튐) */
    private static final int ROWS_PER_TICK = 1;
    private final int clearTop;

    private final Plugin plugin;
    private final RpgMap map;
    private final World w;
    private final Random rnd;

    public MapBuilder(Plugin plugin, RpgMap map, World w) {
        this.plugin = plugin;
        this.map = map;
        this.w = w;
        this.rnd = new Random(map.kind.hashCode());
        int maxL = 0;
        for (int y = 0; y < map.h; y++) for (int x = 0; x < map.w; x++) maxL = Math.max(maxL, map.level(x, y));
        clearTop = BASE_Y + maxL * LEVEL_H + 16;   // 다시 지을 때 비울 높이 (언덕 · 나무 · 집 지붕까지)
    }

    /** 타일 (tx, ty) 바닥 높이 (블록 y, 서 있는 블록) */
    public int surfaceY(int tx, int ty) {
        int L = map.level(tx, ty);
        return BASE_Y + (L > 0 && !map.stairs(tx, ty) ? L * LEVEL_H : 0);
    }

    /** 맵 px → 그 자리 바닥 바로 위 (서 있을 곳) */
    public Location at(double px, double py) {
        int tx = (int) Math.floor(px / 16), ty = (int) Math.floor(py / 16);
        return new Location(w, px / 8, surfaceY(tx, ty) + 1, py / 8);
    }

    public void buildAsync(Runnable done) {
        final int[] row = {0};
        final org.bukkit.scheduler.BukkitTask[] task = new org.bukkit.scheduler.BukkitTask[1];
        task[0] = Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            for (int k = 0; k < ROWS_PER_TICK && row[0] < map.h; k++, row[0]++) terrainRow(row[0]);
            if (row[0] >= map.h) {
                task[0].cancel();
                border();
                objects();
                collision();
                done.run();
            }
        }, 1L, 1L);
    }

    // ── 지형 ────────────────────────────────────────────────────────

    private void set(int x, int y, int z, Material m) { w.getBlockAt(x, y, z).setType(m, false); }
    private void set(int x, int y, int z, BlockData d) { w.getBlockAt(x, y, z).setBlockData(d, false); }

    private void terrainRow(int ty) {
        for (int tx = 0; tx < map.w; tx++) {
            String g = map.tile(map.ground, tx, ty);
            String deco = map.tile(map.decorBelow, tx, ty);   // hedge · bridge · flowers (웹 decor_below)
            boolean bridge = "bridge".equals(g) || "bridge".equals(deco);
            boolean water = !bridge && (map.tile(map.water, tx, ty) != null || "water".equals(g) || "fountain_water".equals(g));
            int L = map.level(tx, ty);
            boolean stairs = map.stairs(tx, ty);
            for (int bx = 0; bx < 2; bx++)
                for (int bz = 0; bz < 2; bz++) {
                    int x = tx * 2 + bx, z = ty * 2 + bz;
                    for (int y = clearTop; y > BASE_Y; y--) set(x, y, z, Material.AIR);   // 다시 지을 때 위를 비움
                    int top = BASE_Y + (L > 0 && !stairs ? L * LEVEL_H : 0);
                    if (stairs) top = BASE_Y + stairRise(tx, ty, bz, L);
                    for (int y = BASE_Y - 4; y < top; y++) set(x, y, z, y < top - 3 ? Material.STONE : Material.DIRT);
                    if (L > 0 && !stairs && top > BASE_Y) for (int y = BASE_Y; y < top; y++) set(x, y, z, cliff());   // 언덕 옆면
                    if (water) {
                        set(x, top - 1, z, Material.SAND);
                        set(x, top, z, Material.WATER);
                        continue;
                    }
                    if (bridge) { set(x, top - 1, z, Material.WATER); set(x, top, z, Material.SPRUCE_PLANKS); continue; }
                    if (stairs) {
                        Stairs s = (Stairs) Material.STONE_BRICK_STAIRS.createBlockData();
                        s.setFacing(BlockFace.NORTH);
                        set(x, top, z, s);
                        set(x, top - 1, z, Material.STONE_BRICKS);
                        continue;
                    }
                    set(x, top, z, surface(g));
                    decorate(deco != null ? deco : g, x, top + 1, z);
                }
        }
    }

    /** 계단 칸: 남쪽(아래)에서 북쪽(위)으로 블록 줄마다 1씩 오름 */
    private int stairRise(int tx, int ty, int bz, int L) {
        int below = 0;
        for (int y = ty + 1; map.stairs(tx, y); y++) below++;
        int rowFromBottom = below * 2 + (1 - bz);
        return Math.min(L * LEVEL_H, rowFromBottom + 1);
    }

    private Material cliff() {
        int r = rnd.nextInt(10);
        return r < 5 ? Material.STONE : r < 7 ? Material.ANDESITE : r < 9 ? Material.COBBLESTONE : Material.MOSSY_COBBLESTONE;
    }

    private Material surface(String g) {
        if (g == null) return Material.GRASS_BLOCK;
        int r = rnd.nextInt(100);
        return switch (g) {
            case "grass", "flowers" -> Material.GRASS_BLOCK;
            case "grass_dark" -> r < 35 ? Material.MOSS_BLOCK : Material.GRASS_BLOCK;
            case "sand" -> r < 85 ? Material.SAND : Material.SANDSTONE;
            case "cobble" -> r < 55 ? Material.STONE_BRICKS : r < 75 ? Material.COBBLESTONE : r < 88 ? Material.MOSSY_STONE_BRICKS : Material.CRACKED_STONE_BRICKS;
            case "stone_edge" -> r < 70 ? Material.POLISHED_ANDESITE : Material.ANDESITE;
            case "dirt" -> r < 70 ? Material.DIRT_PATH : Material.COARSE_DIRT;
            case "bridge" -> Material.SPRUCE_PLANKS;
            case "fountain_rim" -> Material.SMOOTH_STONE;
            case "hedge" -> Material.GRASS_BLOCK;
            case "solid" -> Material.STONE;
            default -> Material.GRASS_BLOCK;
        };
    }

    private void decorate(String g, int x, int y, int z) {
        if (g == null) return;
        int r = rnd.nextInt(100);
        switch (g) {
            case "grass" -> { if (r < 12) set(x, y, z, Material.SHORT_GRASS); else if (r < 14) set(x, y, z, flower()); }
            case "grass_dark" -> { if (r < 25) set(x, y, z, Material.SHORT_GRASS); else if (r < 30) set(x, y, z, Material.FERN); }
            case "flowers" -> { if (r < 55) set(x, y, z, flower()); else if (r < 70) set(x, y, z, Material.SHORT_GRASS); }
            case "hedge" -> { leaves(x, y, z, Material.OAK_LEAVES); leaves(x, y + 1, z, Material.OAK_LEAVES); }
            case "fountain_rim" -> set(x, y, z, Material.STONE_BRICK_WALL);
            case "solid" -> { for (int k = 0; k < 3; k++) set(x, y + k, z, Material.STONE); }
            default -> {}
        }
    }

    private Material flower() {
        Material[] f = {Material.DANDELION, Material.POPPY, Material.CORNFLOWER, Material.OXEYE_DAISY, Material.AZURE_BLUET, Material.ALLIUM, Material.PINK_TULIP, Material.LILY_OF_THE_VALLEY};
        return f[rnd.nextInt(f.length)];
    }

    private void leaves(int x, int y, int z, Material m) {
        Leaves l = (Leaves) m.createBlockData();
        l.setPersistent(true);
        set(x, y, z, l);
    }

    /**
     * 웹 collision(solid) 칸 중 오브젝트가 막지 않은 곳: 던전 = 이끼 낀 돌벽 4칸(웹의 벽 그림), 그 밖 = 보이지 않는 벽 2칸
     * (나무 밑동 · 바위 · 건물 테두리처럼 웹에서 못 지나가는 곳이 마크에서 뚫리지 않게 — Codex 리뷰 4).
     */
    private void collision() {
        for (int ty = 0; ty < map.h; ty++)
            for (int tx = 0; tx < map.w; tx++) {
                if (!"solid".equals(map.tile(map.collision, tx, ty))) continue;
                if (map.tile(map.water, tx, ty) != null || map.stairs(tx, ty)) continue;
                for (int bx = 0; bx < 2; bx++)
                    for (int bz = 0; bz < 2; bz++) {
                        int x = tx * 2 + bx, z = ty * 2 + bz, top = surfaceY(tx, ty);
                        Block head = w.getBlockAt(x, top + 1, z);
                        if (!head.isPassable() || head.getType().name().endsWith("_LEAVES")) continue;
                        if (map.kind.equals("dungeon")) {
                            for (int k = 1; k <= 4; k++) set(x, top + k, z, k == 4 ? Material.MOSSY_STONE_BRICKS : rnd.nextInt(4) == 0 ? Material.CRACKED_STONE_BRICKS : Material.STONE_BRICKS);
                        } else if (head.getType().isAir()) { set(x, top + 1, z, Material.BARRIER); set(x, top + 2, z, Material.BARRIER); }
                    }
            }
    }

    /** 맵 가장자리: 보이지 않는 벽 4칸 (웹 맵 밖으로 못 나감) */
    private void border() {
        int W = map.w * 2, H = map.h * 2;
        for (int i = -1; i <= W; i++)
            for (int y = BASE_Y - 4; y < BASE_Y + 14; y++) { set(i, y, -1, Material.BARRIER); set(i, y, H, Material.BARRIER); }
        for (int i = -1; i <= H; i++)
            for (int y = BASE_Y - 4; y < BASE_Y + 14; y++) { set(-1, y, i, Material.BARRIER); set(W, y, i, Material.BARRIER); }
    }

    // ── 오브젝트 ────────────────────────────────────────────────────

    private void objects() {
        for (RpgMap.Obj o : map.objects) {
            try { object(o); } catch (Exception e) { plugin.getLogger().warning("오브젝트 " + o.type() + " #" + o.id() + ": " + e.getMessage()); }
        }
    }

    private int bx(double px) { return (int) Math.floor(px / 8); }

    private int groundAt(int x, int z) {
        int tx = Math.floorDiv(x, 2), ty = Math.floorDiv(z, 2);
        return surfaceY(Math.max(0, Math.min(map.w - 1, tx)), Math.max(0, Math.min(map.h - 1, ty))) + 1;
    }

    private void object(RpgMap.Obj o) {
        int x0 = bx(o.x()), z0 = bx(o.y()), x1 = bx(o.x() + o.w()) - 1, z1 = bx(o.y() + o.h()) - 1;
        int cx = bx(o.cx()), cz = bx(o.cy());
        int bottomZ = bx(o.y() + o.h()) - 1;   // 3/4 시점 그림은 아래가 발밑
        int gy = groundAt(cx, bottomZ);
        switch (o.type()) {
            case "tree" -> tree(cx, gy, bottomZ);
            case "rock" -> rock(cx, gy, bottomZ);
            case "stump" -> { set(cx, gy, bottomZ, Material.OAK_LOG); if (rnd.nextBoolean()) set(cx, gy + 1, bottomZ, Material.MOSS_CARPET); }
            case "bush" -> { for (int dx = 0; dx < 2; dx++) for (int dz = 0; dz < 2; dz++) leaves(cx + dx, gy, bottomZ - dz, rnd.nextBoolean() ? Material.AZALEA_LEAVES : Material.FLOWERING_AZALEA_LEAVES); }
            case "log" -> { for (int i = -1; i <= 1; i++) { Orientable l = (Orientable) Material.OAK_LOG.createBlockData(); l.setAxis(org.bukkit.Axis.X); set(cx + i, gy, bottomZ, l); } }
            case "mushroom" -> set(cx, gy, bottomZ, rnd.nextBoolean() ? Material.RED_MUSHROOM : Material.BROWN_MUSHROOM);
            case "haystack" -> { for (int dx = 0; dx < 2; dx++) for (int dz = 0; dz < 2; dz++) set(cx + dx, gy, bottomZ - dz, Material.HAY_BLOCK); set(cx, gy + 1, bottomZ, Material.HAY_BLOCK); }
            case "fence" -> { if (o.w() >= o.h()) for (int x = x0; x <= x1; x++) set(x, groundAt(x, bottomZ), bottomZ, Material.OAK_FENCE); else for (int z = z0; z <= z1; z++) set(cx, groundAt(cx, z), z, Material.OAK_FENCE); }
            case "campfire" -> { set(cx, gy, cz, Material.CAMPFIRE); for (int[] d : new int[][]{{2, 0}, {-2, 0}, {0, 2}, {0, -2}}) { Orientable l = (Orientable) Material.SPRUCE_LOG.createBlockData(); l.setAxis(d[0] == 0 ? org.bukkit.Axis.X : org.bukkit.Axis.Z); set(cx + d[0], gy, cz + d[1], l); } }
            case "barrel" -> set(cx, gy, bottomZ, Material.BARREL);
            case "crate" -> set(cx, gy, bottomZ, Material.STRIPPED_SPRUCE_WOOD);
            case "crate_stack" -> { set(cx, gy, bottomZ, Material.STRIPPED_SPRUCE_WOOD); set(cx + 1, gy, bottomZ, Material.BARREL); set(cx, gy + 1, bottomZ, Material.STRIPPED_SPRUCE_WOOD); }
            case "sack" -> set(cx, gy, bottomZ, Material.DECORATED_POT);
            case "flowerpot" -> set(cx, gy, bottomZ, new Material[]{Material.POTTED_POPPY, Material.POTTED_DANDELION, Material.POTTED_CORNFLOWER, Material.POTTED_AZURE_BLUET, Material.POTTED_RED_TULIP}[rnd.nextInt(5)]);
            case "banner" -> set(cx, gy, bottomZ, new Material[]{Material.RED_BANNER, Material.BLUE_BANNER, Material.YELLOW_BANNER}[rnd.nextInt(3)]);
            case "lamp" -> { set(cx, gy, bottomZ, Material.DARK_OAK_FENCE); set(cx, gy + 1, bottomZ, Material.DARK_OAK_FENCE); set(cx, gy + 2, bottomZ, Material.DARK_OAK_FENCE); set(cx, gy + 3, bottomZ, Material.LANTERN); }
            case "bench" -> bench(x0, x1, gy, bottomZ);
            case "sign", "mailbox", "board" -> signish(o, cx, gy, bottomZ);
            case "anvil" -> set(cx, gy, bottomZ, Material.ANVIL);
            case "workbench" -> { set(cx, gy, bottomZ, Material.CRAFTING_TABLE); set(cx + 1, gy, bottomZ, Material.BREWING_STAND); }
            case "well" -> well(cx, gy, cz);
            case "fountain" -> fountain(cx, gy, cz, Math.max(4, (int) (o.w() / 8 / 2)));
            case "portal" -> portal(cx, gy, bottomZ);
            case "building" -> house(x0, z0, x1, z1);
            case "tent_shop" -> tent(x0, z0, x1, z1, DyeColor.RED, DyeColor.WHITE);
            case "tent_market" -> tent(x0, z0, x1, z1, DyeColor.BLUE, DyeColor.LIGHT_BLUE);
            case "pillar" -> { for (int y = 0; y < 4; y++) set(cx, gy + y, bottomZ, y == 3 ? Material.CHISELED_STONE_BRICKS : Material.STONE_BRICKS); }
            case "statue" -> { set(cx, gy, bottomZ, Material.CHISELED_STONE_BRICKS); set(cx, gy + 1, bottomZ, Material.MOSSY_STONE_BRICK_WALL); set(cx, gy + 2, bottomZ, Material.CARVED_PUMPKIN); }
            default -> {}   // npc · spawn · spawn_zone · stage_area 는 RpgWorlds 가 (블록 없음)
        }
    }

    private void tree(int x, int y, int z) {
        TreeType t = switch (map.kind) {
            case "highland" -> rnd.nextInt(3) == 0 ? TreeType.TALL_REDWOOD : TreeType.REDWOOD;
            case "dungeon" -> rnd.nextInt(3) == 0 ? TreeType.DARK_OAK : rnd.nextInt(2) == 0 ? TreeType.JUNGLE_BUSH : TreeType.TREE;
            case "plaza" -> rnd.nextInt(3) == 0 ? TreeType.BIRCH : TreeType.TREE;
            default -> rnd.nextInt(5) == 0 ? TreeType.BIG_TREE : rnd.nextInt(4) == 0 ? TreeType.BIRCH : TreeType.TREE;
        };
        Location l = new Location(w, x, y, z);
        if (!w.generateTree(l, t)) w.generateTree(l, TreeType.TREE);
    }

    private void rock(int x, int y, int z) {
        Material[] m = {Material.STONE, Material.ANDESITE, Material.COBBLESTONE, Material.MOSSY_COBBLESTONE, Material.TUFF};
        int r = 1 + rnd.nextInt(2);
        for (int dx = -r; dx <= r; dx++) for (int dz = -r; dz <= r; dz++) for (int dy = 0; dy <= r; dy++)
            if (dx * dx + dz * dz + dy * dy * 2 <= r * r + 1) set(x + dx, y + dy, z + dz, m[rnd.nextInt(m.length)]);
    }

    private void bench(int x0, int x1, int y, int z) {
        for (int x = x0; x <= Math.max(x0 + 1, x1); x++) {
            Stairs s = (Stairs) Material.SPRUCE_STAIRS.createBlockData();
            s.setFacing(BlockFace.NORTH);
            set(x, y, z, s);
        }
    }

    private void signish(RpgMap.Obj o, int x, int y, int z) {
        if (o.type().equals("mailbox")) { set(x, y, z, Material.BARREL); y++; }
        if (o.type().equals("board")) { for (int dx = -1; dx <= 1; dx++) { set(x + dx, y, z, Material.SPRUCE_FENCE); set(x + dx, y + 1, z, Material.SPRUCE_PLANKS); set(x + dx, y + 2, z, Material.SPRUCE_PLANKS); } y += 1; z += 1; }
        Block b = w.getBlockAt(x, y, z);
        b.setType(o.type().equals("board") ? Material.OAK_WALL_SIGN : Material.OAK_SIGN, false);
        if (b.getState() instanceof Sign s) {
            String name = o.name().isEmpty() ? o.type() : o.name();
            s.getSide(Side.FRONT).line(1, net.kyori.adventure.text.Component.text(name.length() > 15 ? name.substring(0, 15) : name));
            if (name.length() > 15) s.getSide(Side.FRONT).line(2, net.kyori.adventure.text.Component.text(name.substring(15, Math.min(30, name.length()))));
            s.setWaxed(true);
            s.update(true, false);
        }
    }

    private void well(int x, int y, int z) {
        for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) {
            set(x + dx, y - 1, z + dz, Material.COBBLESTONE);
            set(x + dx, y, z + dz, dx == 0 && dz == 0 ? Material.WATER : Material.COBBLESTONE);
        }
        for (int[] c : new int[][]{{-1, -1}, {1, -1}, {-1, 1}, {1, 1}}) { set(x + c[0], y + 1, z + c[1], Material.OAK_FENCE); set(x + c[0], y + 2, z + c[1], Material.OAK_FENCE); }
        for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) {
            Slab s = (Slab) Material.SPRUCE_SLAB.createBlockData();
            set(x + dx, y + 3, z + dz, s);
        }
    }

    /** 3단 분수 (웹 3단 이탈리아식) */
    private void fountain(int x, int y, int z, int r) {
        for (int dx = -r; dx <= r; dx++) for (int dz = -r; dz <= r; dz++) {
            double d = Math.sqrt(dx * dx + dz * dz * 1.0);
            if (d > r + 0.5) continue;
            set(x + dx, y - 1, z + dz, Material.SMOOTH_STONE);
            if (d > r - 0.7) set(x + dx, y, z + dz, Material.STONE_BRICK_WALL);
            else set(x + dx, y, z + dz, Material.WATER);
        }
        for (int k = 0; k < 4; k++) set(x, y + k, z, Material.CHISELED_STONE_BRICKS);
        for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) if (dx != 0 || dz != 0) {
            set(x + dx, y + 2, z + dz, Material.SMOOTH_STONE_SLAB);
        }
        set(x, y + 4, z, Material.WATER);   // 꼭대기에서 흘러내림
    }

    /** 포털: 돌 아치 + 안쪽 보라 유리 (밟으면 RpgWorlds 가 옮김, 입자도 거기서) */
    private void portal(int x, int y, int z) {
        for (int dy = 0; dy < 5; dy++) { set(x - 2, y + dy, z, Material.STONE_BRICKS); set(x + 2, y + dy, z, Material.STONE_BRICKS); }
        for (int dx = -2; dx <= 2; dx++) set(x + dx, y + 5, z, dx == 0 ? Material.CHISELED_STONE_BRICKS : Material.STONE_BRICKS);
        for (int dx = -1; dx <= 1; dx++) for (int dy = 0; dy < 5; dy++) set(x + dx, y + dy, z, Material.PURPLE_STAINED_GLASS_PANE);
        for (int dx = -2; dx <= 2; dx++) set(x + dx, y - 1, z, Material.POLISHED_DEEPSLATE);
        set(x, y, z, Material.AIR);   // 가운데는 걸어 들어갈 수 있게 (유리 아래 두 칸 비움)
        set(x, y + 1, z, Material.AIR);
    }

    /** 반목조 집 (웹 buildings.ts): 돌 기단 · 나무 기둥 틀 · 흰 회벽 · 창 · 문 · 박공 지붕 */
    private void house(int x0, int z0, int x1, int z1) {
        int y = groundAt((x0 + x1) / 2, z1);
        int wallH = 5;
        for (int x = x0; x <= x1; x++) for (int z = z0; z <= z1; z++) {
            set(x, y - 1, z, Material.COBBLESTONE);
            boolean edge = x == x0 || x == x1 || z == z0 || z == z1;
            boolean corner = (x == x0 || x == x1) && (z == z0 || z == z1);
            for (int dy = 0; dy < wallH; dy++) {
                Material m;
                if (!edge) m = dy == 0 ? Material.SPRUCE_PLANKS : Material.AIR;
                else if (dy == 0) m = Material.COBBLESTONE;
                else if (corner || dy == wallH - 1 || (x - x0) % 3 == 0 && (z == z0 || z == z1) || (z - z0) % 3 == 0 && (x == x0 || x == x1)) m = Material.STRIPPED_DARK_OAK_LOG;
                else if (dy == 2 && ((x + z) % 2 == 0)) m = Material.GLASS_PANE;
                else m = Material.WHITE_TERRACOTTA;
                set(x, y + dy, z, m);
            }
        }
        int door = (x0 + x1) / 2;   // 남쪽 문
        set(door, y + 1, z1, Material.AIR);
        set(door, y + 2, z1, Material.AIR);
        Directional dd = (Directional) Material.SPRUCE_DOOR.createBlockData();
        dd.setFacing(BlockFace.SOUTH);
        ((Bisected) dd).setHalf(Bisected.Half.BOTTOM);
        set(door, y + 1, z1, dd);
        Directional du = (Directional) Material.SPRUCE_DOOR.createBlockData();
        du.setFacing(BlockFace.SOUTH);
        ((Bisected) du).setHalf(Bisected.Half.TOP);
        set(door, y + 2, z1, du);
        set(door, y + 3, z1 + 1, Material.LANTERN);
        // 박공 지붕 (동서 방향 용마루)
        int depth = z1 - z0 + 1;
        for (int i = 0; i <= depth / 2; i++) {
            for (int x = x0 - 1; x <= x1 + 1; x++) {
                Stairs n = (Stairs) Material.DARK_OAK_STAIRS.createBlockData();
                n.setFacing(BlockFace.SOUTH);
                set(x, y + wallH + i, z0 - 1 + i, n);
                Stairs s = (Stairs) Material.DARK_OAK_STAIRS.createBlockData();
                s.setFacing(BlockFace.NORTH);
                set(x, y + wallH + i, z1 + 1 - i, s);
                if (z1 + 1 - i - (z0 - 1 + i) <= 1) set(x, y + wallH + i, z0 - 1 + i, Material.DARK_OAK_SLAB);
                for (int z = z0 + i; z <= z1 - i; z++) if (x == x0 || x == x1) set(x, y + wallH + i, z, Material.WHITE_TERRACOTTA);
            }
        }
    }

    /** 천막: 기둥 4 + 줄무늬 양모 지붕 */
    private void tent(int x0, int z0, int x1, int z1, DyeColor a, DyeColor b) {
        int y = groundAt((x0 + x1) / 2, z1);
        for (int[] c : new int[][]{{x0, z0}, {x1, z0}, {x0, z1}, {x1, z1}}) for (int dy = 0; dy < 3; dy++) set(c[0], y + dy, c[1], Material.SPRUCE_FENCE);
        Material wa = Material.valueOf(a.name() + "_WOOL"), wb = Material.valueOf(b.name() + "_WOOL");
        int mid = (z0 + z1) / 2;
        for (int x = x0 - 1; x <= x1 + 1; x++)
            for (int z = z0 - 1; z <= z1 + 1; z++) {
                int dy = 3 + Math.max(0, (Math.min(z - z0, z1 - z) + 1) / 2);
                set(x, y + dy, z, ((x - x0) % 2 == 0) ? wa : wb);
            }
        for (int x = x0; x <= x1; x++) set(x, y, mid, Material.SPRUCE_SLAB);   // 진열대
        set((x0 + x1) / 2, y + 1, mid, Material.BARREL);
    }
}
