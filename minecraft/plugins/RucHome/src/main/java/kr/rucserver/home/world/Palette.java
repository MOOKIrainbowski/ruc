package kr.rucserver.home.world;

import org.bukkit.Material;

/**
 * 허브 팔레트.
 *
 * 금지 (요청):
 *   - 구리 계열 전부 (구리/잘린구리/산화·풍화 변형)
 *   - 화강암 · 섬록암 · 안산암 전부 (원석/광택/계단/슬랩 포함)
 *
 * 대체로 쓰는 축:
 *   - 프리즈머린 등 바다/청록 계열 (허브 분위기와 겉돌아 제거)
 *
 * 주 재료:
 *   조약돌 · 심층암벽돌 · 석재벽돌 4종 · 돌 · 가문비 목재
 *   보조: 석영 · 블랙스톤 · 응회암 · 사암 · 진흙벽돌 · 테라코타
 *
 * 그라데이션은 좌표 해시 디더링으로 섞습니다. 두 재료를 딱 자르면 경계선이
 * 보이지만, 전환 구간을 흩뿌리면 자연스럽게 이어집니다.
 */
public final class Palette {

    private Palette() {}

    // ── 석재 램프 (어두움 → 밝음) ────────────────────────────────────
    public static final Material[] STONE_RAMP = {
            Material.DEEPSLATE_TILES,
            Material.POLISHED_DEEPSLATE,
            Material.DEEPSLATE_BRICKS,
            Material.COBBLED_DEEPSLATE,
            Material.TUFF_BRICKS,
            Material.POLISHED_TUFF,
            Material.STONE_BRICKS,
            Material.STONE,
            Material.SMOOTH_STONE,
            Material.CALCITE,
            Material.SMOOTH_QUARTZ,
            Material.QUARTZ_BLOCK,
    };

    // ── 석공 램프 (바닥 모자이크 주축) ───────────────────────────────
    // 프리즈머린 계열은 청록이 강해 허브 분위기와 겉돌아 걷어냈습니다.
    // 요청대로 조약돌 · 심층암벽돌 · 석재벽돌 · 돌 계열로 대체합니다.
    public static final Material[] MASONRY_RAMP = {
            Material.DEEPSLATE_BRICKS,
            Material.POLISHED_DEEPSLATE,
            Material.COBBLESTONE,
            Material.STONE_BRICKS,
            Material.STONE,
            Material.SMOOTH_STONE,
    };

    /** 바닥 모자이크. */
    public static final Material[] MOSAIC = {
            Material.STONE_BRICKS,
            Material.COBBLESTONE,
            Material.DEEPSLATE_BRICKS,
            Material.STONE,
            Material.SMOOTH_QUARTZ,
            Material.CHISELED_STONE_BRICKS,
            Material.MOSSY_COBBLESTONE,
            Material.CALCITE,
    };

    /** 목재 포인트 — 가문비. 석재 일색을 깨는 용도로만 씁니다. */
    public static final Material[] TIMBER_MIX = {
            Material.SPRUCE_PLANKS,
            Material.SPRUCE_LOG,
            Material.STRIPPED_SPRUCE_LOG,
    };

    // ── 벽면 질감 ────────────────────────────────────────────────────
    public static final Material[] WALL_MIX = {
            Material.STONE_BRICKS,
            Material.STONE_BRICKS,
            Material.STONE_BRICKS,
            Material.CRACKED_STONE_BRICKS,
            Material.MOSSY_STONE_BRICKS,
            Material.CHISELED_STONE_BRICKS,
    };

    /** 폐허 느낌 — 이끼와 균열을 더 많이. */
    public static final Material[] RUIN_MIX = {
            Material.MOSSY_STONE_BRICKS,
            Material.MOSSY_STONE_BRICKS,
            Material.CRACKED_STONE_BRICKS,
            Material.STONE_BRICKS,
            Material.COBBLED_DEEPSLATE,
            Material.MOSSY_COBBLESTONE,
    };

    /** 어두운 기단·테두리. */
    public static final Material[] DARK_MIX = {
            Material.POLISHED_BLACKSTONE_BRICKS,
            Material.POLISHED_BLACKSTONE_BRICKS,
            Material.BLACKSTONE,
            Material.POLISHED_BLACKSTONE,
            Material.DEEPSLATE_BRICKS,
    };

    public static final Material[] TUFF_MIX = {
            Material.TUFF_BRICKS,
            Material.TUFF_BRICKS,
            Material.POLISHED_TUFF,
            Material.TUFF,
            Material.CHISELED_TUFF_BRICKS,
    };

    /** 따뜻한 대비 (구리·화강암 대체). */
    public static final Material[] WARM_RAMP = {
            Material.PACKED_MUD,
            Material.MUD_BRICKS,
            Material.BRICKS,
            Material.SMOOTH_SANDSTONE,
            Material.CUT_SANDSTONE,
            Material.WHITE_TERRACOTTA,
    };


    public static final Material[] FOUNDATION_RAMP = {
            Material.DEEPSLATE,
            Material.COBBLED_DEEPSLATE,
            Material.DEEPSLATE_BRICKS,
            Material.TUFF,
            Material.STONE,
    };

    // ── 노이즈 ───────────────────────────────────────────────────────

    public static double noise(int x, int z) {
        int h = x * 374761393 + z * 668265263;
        h = (h ^ (h >>> 13)) * 1274126177;
        h = h ^ (h >>> 16);
        return (h & 0x7fffffff) / (double) 0x7fffffff;
    }

    public static double noise(int x, int y, int z) {
        int h = x * 374761393 + y * 1103515245 + z * 668265263;
        h = (h ^ (h >>> 13)) * 1274126177;
        h = h ^ (h >>> 16);
        return (h & 0x7fffffff) / (double) 0x7fffffff;
    }

    /** 부드러운 값 노이즈 — 유기적인 윤곽에 씁니다. */
    public static double smooth(double x, double z, double scale) {
        double sx = x / scale, sz = z / scale;
        int x0 = (int) Math.floor(sx), z0 = (int) Math.floor(sz);
        double fx = sx - x0, fz = sz - z0;
        double u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);

        double n00 = noise(x0, z0), n10 = noise(x0 + 1, z0);
        double n01 = noise(x0, z0 + 1), n11 = noise(x0 + 1, z0 + 1);
        return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
    }

    // ── 그라데이션 ───────────────────────────────────────────────────

    public static Material gradient(Material[] ramp, double t, int x, int z) {
        t = Math.max(0, Math.min(1, t));
        double pos = t * (ramp.length - 1);
        int i = (int) Math.floor(pos);
        int idx = (noise(x, z) < pos - i) ? i + 1 : i;
        return ramp[Math.max(0, Math.min(ramp.length - 1, idx))];
    }

    public static Material gradient(Material[] ramp, double t, int x, int y, int z) {
        t = Math.max(0, Math.min(1, t));
        double pos = t * (ramp.length - 1);
        int i = (int) Math.floor(pos);
        int idx = (noise(x, y, z) < pos - i) ? i + 1 : i;
        return ramp[Math.max(0, Math.min(ramp.length - 1, idx))];
    }

    public static Material mix(Material[] set, int x, int y, int z) {
        return set[Math.min(set.length - 1, (int) (noise(x, y, z) * set.length))];
    }

    public static Material mix(Material[] set, int x, int z) {
        return set[Math.min(set.length - 1, (int) (noise(x, z) * set.length))];
    }
}
