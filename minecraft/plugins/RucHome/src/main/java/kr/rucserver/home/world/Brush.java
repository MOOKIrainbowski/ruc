package kr.rucserver.home.world;

import org.bukkit.Axis;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Levelled;
import org.bukkit.block.data.MultipleFacing;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.type.Slab;
import org.bukkit.block.data.type.Stairs;
import org.bukkit.block.data.type.Wall;

/**
 * 블록 배치 유틸.
 *
 * 아치가 핵심입니다. 이전 게이트는 폭에 비례해 높이를 선형으로 줄여서
 * 삼각형(M자) 윤곽이 나왔습니다. 참고 맵(Red City)의 아치를 단면으로
 * 떠 보니 실제로는 **원호**였습니다. 그래서 원 방정식으로 다시 만듭니다.
 */
public final class Brush {

    private Brush() {}

    public static void set(World w, int x, int y, int z, Material m) {
        w.getBlockAt(x, y, z).setType(m, false);
    }

    public static void setIfAir(World w, int x, int y, int z, Material m) {
        Block b = w.getBlockAt(x, y, z);
        if (b.getType().isAir()) b.setType(m, false);
    }

    public static Material typeAt(World w, int x, int y, int z) {
        return w.getBlockAt(x, y, z).getType();
    }

    public static void stairs(World w, int x, int y, int z, Material m, BlockFace face, boolean top) {
        Block b = w.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData d = b.getBlockData();
        if (d instanceof Stairs s) {
            s.setFacing(face);
            s.setHalf(top ? Bisected.Half.TOP : Bisected.Half.BOTTOM);
            b.setBlockData(s, false);
        }
    }

    public static void slab(World w, int x, int y, int z, Material m, boolean top) {
        Block b = w.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData d = b.getBlockData();
        if (d instanceof Slab s) {
            s.setType(top ? Slab.Type.TOP : Slab.Type.BOTTOM);
            b.setBlockData(s, false);
        }
    }

    public static void wall(World w, int x, int y, int z, Material m) {
        Block b = w.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData d = b.getBlockData();
        if (d instanceof Wall wl) {
            wl.setUp(true);
            b.setBlockData(wl, false);
        }
    }

    public static void pillar(World w, int x, int y, int z, Material m, Axis axis) {
        Block b = w.getBlockAt(x, y, z);
        b.setType(m, false);
        BlockData d = b.getBlockData();
        if (d instanceof Orientable o) {
            o.setAxis(axis);
            b.setBlockData(o, false);
        }
    }

    public static void water(World w, int x, int y, int z) {
        Block b = w.getBlockAt(x, y, z);
        b.setType(Material.WATER, false);
        if (b.getBlockData() instanceof Levelled l) {
            l.setLevel(0);
            b.setBlockData(l, false);
        }
    }

    /** 벽면에 붙는 덩굴. face 는 덩굴이 붙는 면의 반대쪽(지지 블록 방향). */
    public static void vine(World w, int x, int y, int z, BlockFace attachedTo) {
        Block b = w.getBlockAt(x, y, z);
        if (!b.getType().isAir()) return;
        b.setType(Material.VINE, false);
        BlockData d = b.getBlockData();
        if (d instanceof MultipleFacing mf) {
            for (BlockFace f : mf.getAllowedFaces()) mf.setFace(f, false);
            if (mf.getAllowedFaces().contains(attachedTo)) mf.setFace(attachedTo, true);
            b.setBlockData(mf, false);
        }
    }

    // ── 아치 ───────────────────────────────────────────────────────────

    /**
     * 원호 아치의 높이.
     *
     * @param offset   중심에서의 수평 거리
     * @param halfSpan 아치 반폭
     * @param rise     아치 꼭대기 상승량 (halfSpan 과 같으면 반원)
     * @return 해당 위치에서 아치 안쪽 천장까지의 높이 (0 이면 기둥 높이와 같음)
     */
    public static int archRise(int offset, int halfSpan, double rise) {
        if (Math.abs(offset) >= halfSpan) return 0;
        // 타원 방정식 — rise 를 halfSpan 과 다르게 주면 납작한 아치가 됩니다
        double t = offset / (double) halfSpan;
        return (int) Math.round(rise * Math.sqrt(Math.max(0, 1 - t * t)));
    }

    /**
     * 아치 통로를 뚫고 테두리를 두릅니다.
     *
     * @param dirX,dirZ  통로가 뻗는 방향 (단위벡터)
     * @param perpX,perpZ 통로 폭 방향
     */
    public static void archway(World w, double cx, double cz, double dirX, double dirZ,
                               double perpX, double perpZ, int depth,
                               int floorY, int halfSpan, int pierHeight, double rise,
                               Material[] frameMix, Material keystone) {
        for (int t = 0; t < depth; t++) {
            for (int o = -halfSpan - 1; o <= halfSpan + 1; o++) {
                int x = (int) Math.round(cx + dirX * t + perpX * o);
                int z = (int) Math.round(cz + dirZ * t + perpZ * o);
                int ao = Math.abs(o);

                if (ao > halfSpan) {
                    // 교각 — 통로 양옆 기둥
                    for (int y = floorY + 1; y <= floorY + pierHeight + (int) rise + 1; y++) {
                        set(w, x, y, z, Palette.mix(frameMix, x, y, z));
                    }
                    continue;
                }

                // 통로 비우기
                int ceil = floorY + pierHeight + archRise(o, halfSpan, rise);
                for (int y = floorY + 1; y < ceil; y++) {
                    set(w, x, y, z, Material.AIR);
                }
                // 아치 안쪽 테두리
                set(w, x, ceil, z, Palette.mix(frameMix, x, ceil, z));
                // 위쪽 한 겹 더 — 두께감
                set(w, x, ceil + 1, z, Palette.mix(frameMix, x, ceil + 1, z));

                // 이맛돌 (키스톤)
                if (o == 0 && keystone != null) {
                    set(w, x, ceil + 1, z, keystone);
                }
            }
        }
    }

    /** 중심을 향하거나 등지는 방향. */
    public static BlockFace facing(int dx, int dz, boolean inward) {
        BlockFace f;
        if (Math.abs(dx) > Math.abs(dz)) f = dx > 0 ? BlockFace.WEST : BlockFace.EAST;
        else f = dz > 0 ? BlockFace.NORTH : BlockFace.SOUTH;
        return inward ? f : f.getOppositeFace();
    }

    /** 원판 채우기. */
    public static void disc(World w, int cx, int y, int cz, double r, Material m) {
        int ri = (int) Math.ceil(r);
        for (int dx = -ri; dx <= ri; dx++) {
            for (int dz = -ri; dz <= ri; dz++) {
                if (dx * dx + dz * dz > r * r) continue;
                set(w, cx + dx, y, cz + dz, m);
            }
        }
    }

    /** 원기둥(속 빈) 한 층. */
    public static void ring(World w, int cx, int y, int cz, double rIn, double rOut, Material m) {
        int ri = (int) Math.ceil(rOut);
        for (int dx = -ri; dx <= ri; dx++) {
            for (int dz = -ri; dz <= ri; dz++) {
                double d2 = dx * dx + dz * dz;
                if (d2 < rIn * rIn || d2 > rOut * rOut) continue;
                set(w, cx + dx, y, cz + dz, m);
            }
        }
    }
}
