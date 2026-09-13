package kr.rucserver.home.world;

import org.bukkit.Material;

/**
 * 블록 팔레트와 그라데이션.
 *
 * docs/04-MAP-DESIGN.md 에서 뽑은 원칙 — "베이스 한 계열 + 변형, 강조는 희소하게" —
 * 를 지키되, 단조로움을 피하려고 **그라데이션 램프**를 씁니다.
 *
 * 그라데이션이 핵심입니다. 두 재료를 딱 잘라 붙이면 경계선이 보이지만,
 * 해시 노이즈로 디더링하면 자연스럽게 섞입니다. 손으로 지은 맵이 좋아 보이는
 * 이유의 상당 부분이 이 "섞임"에 있습니다.
 */
public final class Palette {

    private Palette() {}

    // ── 회색 석재 램프 (어두움 → 밝음) ───────────────────────────────
    // 바닥 그라데이션의 주축입니다.
    public static final Material[] STONE_RAMP = {
            Material.DEEPSLATE_TILES,
            Material.POLISHED_DEEPSLATE,
            Material.COBBLED_DEEPSLATE,
            Material.TUFF_BRICKS,
            Material.POLISHED_TUFF,
            Material.ANDESITE,
            Material.POLISHED_ANDESITE,
            Material.STONE,
            Material.SMOOTH_STONE,
            Material.DIORITE,
            Material.POLISHED_DIORITE,
            Material.CALCITE,
            Material.SMOOTH_QUARTZ,
    };

    // ── 따뜻한 램프 (벽면 대비용) ────────────────────────────────────
    public static final Material[] WARM_RAMP = {
            Material.PACKED_MUD,
            Material.MUD_BRICKS,
            Material.BRICKS,
            Material.GRANITE,
            Material.POLISHED_GRANITE,
            Material.BROWN_TERRACOTTA,
            Material.TERRACOTTA,
            Material.LIGHT_GRAY_TERRACOTTA,
            Material.WHITE_TERRACOTTA,
    };

    // ── 구리 산화 램프 (지붕) ────────────────────────────────────────
    // 산화 구리의 청록은 브랜드 그린과 이어집니다. 지붕에 쓰면
    // 회색 석재 벽과 확실히 분리되면서도 튀지 않습니다.
    public static final Material[] COPPER_RAMP = {
            Material.COPPER_BLOCK,
            Material.EXPOSED_COPPER,
            Material.WEATHERED_COPPER,
            Material.OXIDIZED_COPPER,
    };

    public static final Material[] COPPER_CUT_RAMP = {
            Material.CUT_COPPER,
            Material.EXPOSED_CUT_COPPER,
            Material.WEATHERED_CUT_COPPER,
            Material.OXIDIZED_CUT_COPPER,
    };

    // ── 벽면 석재 (질감 섞기용) ──────────────────────────────────────
    public static final Material[] WALL_MIX = {
            Material.STONE_BRICKS,
            Material.STONE_BRICKS,
            Material.STONE_BRICKS,
            Material.CRACKED_STONE_BRICKS,
            Material.MOSSY_STONE_BRICKS,
            Material.CHISELED_STONE_BRICKS,
    };

    public static final Material[] TUFF_MIX = {
            Material.TUFF_BRICKS,
            Material.TUFF_BRICKS,
            Material.POLISHED_TUFF,
            Material.TUFF,
            Material.CHISELED_TUFF_BRICKS,
    };

    /** 기반부 — 밑에서 올려다봐도 자연스럽게. */
    public static final Material[] FOUNDATION_RAMP = {
            Material.DEEPSLATE,
            Material.COBBLED_DEEPSLATE,
            Material.DEEPSLATE_BRICKS,
            Material.TUFF,
            Material.STONE,
    };

    // ── 해시 노이즈 ──────────────────────────────────────────────────

    /** 좌표 기반 결정적 노이즈 0.0~1.0. 같은 좌표면 항상 같은 값. */
    public static double noise(int x, int z) {
        int h = x * 374761393 + z * 668265263;
        h = (h ^ (h >>> 13)) * 1274126177;
        h = h ^ (h >>> 16);
        return (h & 0x7fffffff) / (double) 0x7fffffff;
    }

    /** 3D 버전 — 벽면 질감에 씁니다. */
    public static double noise(int x, int y, int z) {
        int h = x * 374761393 + y * 1103515245 + z * 668265263;
        h = (h ^ (h >>> 13)) * 1274126177;
        h = h ^ (h >>> 16);
        return (h & 0x7fffffff) / (double) 0x7fffffff;
    }

    // ── 그라데이션 ───────────────────────────────────────────────────

    /**
     * 램프에서 위치 t(0~1)에 해당하는 재료를 디더링해서 고릅니다.
     *
     * 경계에서 두 재료가 확률적으로 섞이므로 딱 잘린 줄이 생기지 않습니다.
     */
    public static Material gradient(Material[] ramp, double t, int x, int z) {
        t = Math.max(0, Math.min(1, t));
        double pos = t * (ramp.length - 1);
        int i = (int) Math.floor(pos);
        double frac = pos - i;

        int idx = (noise(x, z) < frac) ? i + 1 : i;
        return ramp[Math.max(0, Math.min(ramp.length - 1, idx))];
    }

    public static Material gradient(Material[] ramp, double t, int x, int y, int z) {
        t = Math.max(0, Math.min(1, t));
        double pos = t * (ramp.length - 1);
        int i = (int) Math.floor(pos);
        double frac = pos - i;

        int idx = (noise(x, y, z) < frac) ? i + 1 : i;
        return ramp[Math.max(0, Math.min(ramp.length - 1, idx))];
    }

    /** 가중치 없이 섞기 — 같은 톤의 변형들을 흩뿌릴 때. */
    public static Material mix(Material[] set, int x, int y, int z) {
        int i = (int) (noise(x, y, z) * set.length);
        return set[Math.min(set.length - 1, i)];
    }

    public static Material mix(Material[] set, int x, int z) {
        int i = (int) (noise(x, z) * set.length);
        return set[Math.min(set.length - 1, i)];
    }
}
