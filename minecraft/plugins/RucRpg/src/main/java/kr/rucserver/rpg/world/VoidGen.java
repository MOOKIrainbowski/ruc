package kr.rucserver.rpg.world;

import org.bukkit.generator.ChunkGenerator;

/** 빈 월드 (RPG 맵은 MapBuilder 가 블록으로 지음) */
public final class VoidGen extends ChunkGenerator {
    @Override public boolean shouldGenerateNoise() { return false; }
    @Override public boolean shouldGenerateSurface() { return false; }
    @Override public boolean shouldGenerateCaves() { return false; }
    @Override public boolean shouldGenerateDecorations() { return false; }
    @Override public boolean shouldGenerateMobs() { return false; }
    @Override public boolean shouldGenerateStructures() { return false; }
}
