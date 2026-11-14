package kr.rucserver.rpg.engine;

import java.util.List;

/**
 * 전투 엔진이 바깥(마크 월드)에 묻는 것 (웹 combat.ts World). 마크 쪽 RpgWorld 가 구현, 테스트는 가짜로.
 * 좌표 · 반경은 px (1블록 = 16px).
 */
public interface World {
    long now();
    Unit unit(int id);
    /** (x, y) 반경 r 안의 살아 있는 플레이어("p") · 몹("m") */
    List<Unit> around(double x, double y, double r, String kind);
    /** 적대 관계 (플레이어 ↔ 몹 기본, 결투 · 결투장은 M7) */
    boolean hostile(Unit a, Unit b);
    /** 쓰러지기 직전: true 면 죽이지 않음 (결투 패배) */
    default boolean spare(Unit src, Unit u) { return false; }
    /** 피해 기록 (몹 위협 · 처치 기여) — HP 깎기 전 */
    void damaged(Unit src, Unit tgt, double amount, double threat, Combat.HitSpec h);
    /** 직접 타격 뒤 (내구도 · 장비 발동) */
    default void struck(Unit src, Unit tgt, double amount, Combat.HitSpec h) {}
    void killed(Unit u, Unit by);
    /** 강제 이동 (px) */
    void push(Unit u, double dx, double dy);
    /** 화면 표시: 피해 숫자 · 치유 · 면역 · 빗나감 … (flag = Combat.H_*) */
    void show(Unit src, Unit tgt, double amount, int flag, String el);
    default void reaction(Unit tgt, String name) {}
    default void revived(Unit u) {}
    /** 효과 목록이 바뀜 (HUD 효과 줄 다시 그리기) */
    default void fxChanged(Unit u) {}
}
