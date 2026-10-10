package kr.rucserver.war.service;

import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.generator.BlockPopulator;
import org.bukkit.generator.LimitedRegion;
import org.bukkit.generator.WorldInfo;
import org.jetbrains.annotations.NotNull;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * 광물이 풍부한 국가전 오버월드 (2026-10-10). 바닐라 생성 위에 광맥을 더 박습니다.
 *
 * <b>새로 생성되는 청크에만</b> 적용됩니다 — 이미 탐험한 땅은 그대로. 맵 전체에 쓰려면 월드를 새로 만들고
 * 미리 생성(Chunky 등)하세요. 돌 · 심층암만 바꾸므로 동굴 공기나 구조물은 건드리지 않습니다.
 */
public class RichOrePopulator extends BlockPopulator {

    private record Vein(Material stone, Material deepslate, int perChunk, int minY, int maxY, int size) {}

    private final List<Vein> veins = new ArrayList<>();

    /** config 한 줄: {@code DIAMOND: "3 -64 16 4"} = 청크당 광맥 수 · 최저 y · 최고 y · 광맥 크기. */
    public RichOrePopulator(ConfigurationSection section, java.util.logging.Logger log) {
        if (section == null) return;
        for (String ore : section.getKeys(false)) {
            String[] p = String.valueOf(section.getString(ore)).trim().split("\\s+");
            Material stone = Material.matchMaterial(ore + "_ORE");
            Material deep = Material.matchMaterial("DEEPSLATE_" + ore + "_ORE");
            if (p.length != 4 || stone == null) {
                log.warning("rich-ores." + ore + " 을 읽을 수 없습니다 (\"청크당수 최저y 최고y 크기\")");
                continue;
            }
            veins.add(new Vein(stone, deep == null ? stone : deep, Integer.parseInt(p[0]),
                    Integer.parseInt(p[1]), Integer.parseInt(p[2]), Integer.parseInt(p[3])));
        }
    }

    @Override
    public void populate(@NotNull WorldInfo world, @NotNull Random random, int chunkX, int chunkZ,
                         @NotNull LimitedRegion region) {
        for (Vein vein : veins) {
            for (int n = 0; n < vein.perChunk; n++) {
                int x = (chunkX << 4) + random.nextInt(16);
                int z = (chunkZ << 4) + random.nextInt(16);
                int y = vein.minY + random.nextInt(Math.max(1, vein.maxY - vein.minY));
                // 작은 덩어리: 시작점에서 한 칸씩 무작위로 걸으며 바꿉니다
                for (int i = 0; i < vein.size; i++) {
                    if (region.isInRegion(x, y, z)) {
                        Material here = region.getType(x, y, z);
                        if (here == Material.STONE) region.setType(x, y, z, vein.stone);
                        else if (here == Material.DEEPSLATE || here == Material.TUFF) region.setType(x, y, z, vein.deepslate);
                    }
                    switch (random.nextInt(6)) {
                        case 0 -> x++; case 1 -> x--; case 2 -> y++; case 3 -> y--; case 4 -> z++; default -> z--;
                    }
                }
            }
        }
    }
}
