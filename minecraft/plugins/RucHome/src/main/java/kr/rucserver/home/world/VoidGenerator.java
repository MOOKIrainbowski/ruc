package kr.rucserver.home.world;

import org.bukkit.World;
import org.bukkit.generator.BiomeProvider;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.generator.WorldInfo;
import org.bukkit.block.Biome;
import org.jetbrains.annotations.NotNull;

import java.util.List;
import java.util.Random;

/**
 * 아무것도 생성하지 않는 청크 생성기.
 *
 * 허브는 지형이 필요 없고, 오히려 지형이 있으면 광장 밖으로 나가서 돌아다니게
 * 됩니다. 빈 월드에 광장만 지어 올리는 편이 §2.3의 "안전한 사회적 공간"에
 * 맞고, 청크 생성 부하도 없습니다.
 */
public class VoidGenerator extends ChunkGenerator {

    @Override
    public void generateNoise(@NotNull WorldInfo worldInfo, @NotNull Random random,
                              int chunkX, int chunkZ, @NotNull ChunkData chunkData) {
        // 의도적으로 비워 둡니다.
    }

    @Override
    public boolean shouldGenerateNoise() { return false; }

    @Override
    public boolean shouldGenerateSurface() { return false; }

    @Override
    public boolean shouldGenerateCaves() { return false; }

    @Override
    public boolean shouldGenerateDecorations() { return false; }

    @Override
    public boolean shouldGenerateMobs() { return false; }

    @Override
    public boolean shouldGenerateStructures() { return false; }

    @Override
    public BiomeProvider getDefaultBiomeProvider(@NotNull WorldInfo worldInfo) {
        return new BiomeProvider() {
            @Override
            public @NotNull Biome getBiome(@NotNull WorldInfo worldInfo, int x, int y, int z) {
                // 평원으로 고정 — 하늘색과 날씨가 안정적입니다.
                return Biome.PLAINS;
            }

            @Override
            public @NotNull List<Biome> getBiomes(@NotNull WorldInfo worldInfo) {
                return List.of(Biome.PLAINS);
            }
        };
    }

    @Override
    public @NotNull org.bukkit.Location getFixedSpawnLocation(@NotNull World world, @NotNull Random random) {
        return new org.bukkit.Location(world, 0.5, 65, 0.5);
    }
}
