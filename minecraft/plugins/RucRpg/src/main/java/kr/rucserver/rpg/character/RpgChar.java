package kr.rucserver.rpg.character;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 한 플레이어의 RPG 캐릭터 (웹 RPG rpg_characters + Progress 와 같은 내용).
 * 주 스레드에서만 고침. 저장은 비동기로 복사본을 씀(CharStore.save 가 스킬 목록을 복사).
 * 자원(hp · mana · energy · stamina)이 -1 이면 "가득"(처음 · 저장 전).
 */
public final class RpgChar {

    public record Learned(String id, String grade, int lv, double mastery, String slot) {}

    public final UUID uuid;
    public String element;
    public int level = 1;
    public long exp;
    /** 1차 전직 계열 (tank · warrior · assassin · mage · ranged · support), 전직 전 null */
    public String line;
    /** 2차 전직 세부 직업 id, 전직 전 null */
    public String job;
    /** 원소술사 보조 속성 */
    public String sub;
    public int potPhys = 10, potMag = 10;
    public boolean awake;
    public double hp = -1, mana = -1, energy = -1, stamina = -1;
    public final List<Learned> skills = new ArrayList<>();

    public RpgChar(UUID uuid, String element) {
        this.uuid = uuid;
        this.element = element;
    }
}
