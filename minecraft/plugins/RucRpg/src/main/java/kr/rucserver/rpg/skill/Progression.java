package kr.rucserver.rpg.skill;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.Data;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.character.RpgChar;
import kr.rucserver.rpg.engine.Formulas;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 성장 (§7 · §9 · §10-3): 스킬 습득 · 숙련도 · 스킬 레벨 · 잠재력 · 전직 · 슬롯 장착 · 스킬북.
 * 웹 RUC_RPG/server/src/progress.ts + shared/progress.ts 이식. 저장은 CharService 가 캐릭터째로 (스킬 목록 포함).
 */
public final class Progression {

    private final SkillDefs skills;
    private final JsonObject mastery, potGain, jobLv, lines, jobs, potShift;
    private final JsonArray masteryMob;
    private final int jobPotential;
    private final java.util.List<String> gradeOrder;
    /** 습득 · 레벨업 알림 (HUD 토스트 · 채팅) */
    public Notify notify = (u, id, lv, kind) -> {};

    public interface Notify { void on(PlayerUnit u, String skill, int lv, String kind); }

    public Progression(Data d, SkillDefs skills) {
        this.skills = skills;
        JsonObject pr = d.file("progress");
        mastery = pr.getAsJsonObject("MASTERY");
        masteryMob = pr.getAsJsonArray("MASTERY_MOB");
        potGain = pr.getAsJsonObject("POT_GAIN");
        JsonObject j = d.file("jobs");
        jobLv = j.getAsJsonObject("JOB_LV");
        lines = j.getAsJsonObject("LINES");
        jobs = j.getAsJsonObject("JOBS");
        jobPotential = j.get("JOB_POTENTIAL").getAsInt();
        potShift = j.getAsJsonObject("JOB_POT_SHIFT");
        gradeOrder = new java.util.ArrayList<>(d.file("mobs").getAsJsonObject("GRADES").keySet());
    }

    public SkillDefs defs() { return skills; }
    public double masteryOf(String k) { return mastery.get(k).getAsDouble(); }

    public static RpgChar.Learned learned(RpgChar c, String id) {
        for (RpgChar.Learned l : c.skills) if (l.id().equals(id)) return l;
        return null;
    }

    private static void replace(RpgChar c, RpgChar.Learned old, RpgChar.Learned now) {
        synchronized (c) { c.skills.set(c.skills.indexOf(old), now); }
    }

    /** 잠재력 (물리 · 마법 · 혼합 = 평균) */
    public static double potOf(JsonObject sk, RpgChar c) {
        String cat = sk.get("category").getAsString();
        return cat.equals("physical") ? c.potPhys : cat.equals("magical") ? c.potMag : (c.potPhys + c.potMag) / 2.0;
    }

    /** 숙련도 더하기 → 연속 레벨업 (shared/progress.ts addMastery). 반환 = 오른 레벨 수, 새 Learned 는 out[0] */
    public static int addMastery(RpgChar.Learned[] l, double amount, int playerLv) {
        RpgChar.Learned x = l[0];
        double m = x.mastery() + amount;
        int lv = x.lv(), up = 0;
        while (lv < playerLv && m >= Formulas.needMastery(lv)) {
            m -= Formulas.needMastery(lv);
            lv++;
            up++;
        }
        if (lv >= playerLv) m = Math.min(m, Formulas.needMastery(lv));
        m = Math.round(m * 100) / 100.0;
        l[0] = new RpgChar.Learned(x.id(), x.grade(), lv, m, x.slot());
        return up;
    }

    /** 스킬 습득: 시작 레벨 = 1 + 잠재력/40, 계열 잠재력 + 난이도, 빈 슬롯이면 바로 장착 */
    public RpgChar.Learned learn(PlayerUnit u, String id, String grade) {
        RpgChar c = u.ch;
        JsonObject sk = skills.get(id);
        int start = Formulas.startLevel((int) Math.floor(potOf(sk, c)), c.level);
        int gain = potGain.get(sk.get("difficulty").getAsString()).getAsInt();
        String cat = sk.get("category").getAsString();
        if (cat.equals("hybrid")) { c.potPhys += gain / 2; c.potMag += gain - gain / 2; }
        else if (cat.equals("physical")) c.potPhys += gain;
        else c.potMag += gain;
        String slot = sk.get("slot").getAsString();
        boolean free = c.skills.stream().noneMatch(x -> slot.equals(x.slot()));
        RpgChar.Learned l = new RpgChar.Learned(id, grade, start, 0, free ? slot : null);
        synchronized (c) { c.skills.add(l); }
        notify.on(u, id, start, "learn");
        return l;
    }

    /** 레벨업 · 전직 뒤: 자동 습득 + 견습 기본 슬롯 + 쌓아 둔 숙련도로 레벨업 */
    public void sync(PlayerUnit u) {
        RpgChar c = u.ch;
        Set<String> known = new HashSet<>();
        for (RpgChar.Learned l : c.skills) known.add(l.id());
        for (String id : skills.autoLearn(c.line, c.job, c.level, known)) learn(u, id, "low");
        JsonObject app = skills.apprenticeSlots();
        for (String slot : app.keySet()) {
            RpgChar.Learned l = learned(c, app.get(slot).getAsString());
            if (l != null && l.slot() == null && c.skills.stream().noneMatch(x -> slot.equals(x.slot())))
                replace(c, l, new RpgChar.Learned(l.id(), l.grade(), l.lv(), l.mastery(), slot));
        }
        for (RpgChar.Learned l : List.copyOf(c.skills)) {
            RpgChar.Learned[] box = {l};
            if (addMastery(box, 0, c.level) > 0) {
                replace(c, l, box[0]);
                notify.on(u, l.id(), box[0].lv(), "lv");
            }
        }
    }

    /** 숙련도 (§10-3): × 몹 등급 배율 × (1 + 계열 잠재력/100) */
    public void gain(PlayerUnit u, String id, double base, String mobGrade) {
        RpgChar c = u.ch;
        RpgChar.Learned l = learned(c, id);
        JsonObject sk = skills.get(id);
        if (l == null || sk == null) return;
        int gi = mobGrade == null ? 0 : Math.max(0, gradeOrder.indexOf(mobGrade));
        RpgChar.Learned[] box = {l};
        int up = addMastery(box, base * masteryMob.get(Math.min(gi, masteryMob.size() - 1)).getAsDouble() * (1 + potOf(sk, c) / 100), c.level);
        replace(c, l, box[0]);
        if (up > 0) notify.on(u, id, box[0].lv(), "lv");
    }

    /** 전직 (§9-1). 성공하면 null, 아니면 이유 */
    public String changeLine(PlayerUnit u, String line) {
        RpgChar c = u.ch;
        if (!lines.has(line)) return "없는 계열입니다";
        if (c.line != null) return "이미 1차 전직을 했습니다";
        int need = jobLv.get("tier1").getAsInt();
        if (c.level < need) return "1차 전직은 Lv" + need + " 부터입니다";
        c.line = line;
        if ("phys".equals(lines.getAsJsonObject(line).get("pot").getAsString())) c.potPhys += jobPotential; else c.potMag += jobPotential;
        afterJob(u);
        return null;
    }

    public String changeJob(PlayerUnit u, String job, String sub) {
        RpgChar c = u.ch;
        JsonObject j = jobs.getAsJsonObject(job);
        if (j == null) return "없는 직업입니다";
        if (c.line == null || !j.get("line").getAsString().equals(c.line)) return "그 계열의 직업이 아닙니다";
        if (c.job != null) return "이미 2차 전직을 했습니다";
        int need = jobLv.get("tier2").getAsInt();
        if (c.level < need) return "2차 전직은 Lv" + need + " 부터입니다";
        if (job.equals("elementalist")) {
            if (sub == null || sub.equals(c.element) || sub.equals("none")) return "주 속성과 다른 보조 속성을 골라 주세요";
            c.sub = sub;
        }
        c.job = job;
        if (j.has("kind")) {
            int k = Math.min(potShift.get(j.get("kind").getAsString()).getAsInt(), c.potPhys);
            c.potPhys -= k;
            c.potMag += k;
        }
        afterJob(u);
        return null;
    }

    public String awaken(PlayerUnit u) {
        RpgChar c = u.ch;
        if (c.job == null) return "2차 전직을 먼저 하세요";
        if (c.awake) return "이미 각성했습니다";
        int need = jobLv.get("tier3").getAsInt();
        if (c.level < need) return "3차 각성은 Lv" + need + " 부터입니다";
        c.awake = true;
        return null;
    }

    /** 전직으로 새로 배운 스킬은 자기 슬롯에 바로 (슬롯마다 하나) */
    private void afterJob(PlayerUnit u) {
        RpgChar c = u.ch;
        Set<String> before = new HashSet<>();
        for (RpgChar.Learned l : c.skills) before.add(l.id());
        sync(u);
        for (RpgChar.Learned l : List.copyOf(c.skills)) {
            String slot = skills.get(l.id()).get("slot").getAsString();
            if (before.contains(l.id()) || l.slot() != null) continue;
            boolean otherNew = c.skills.stream().anyMatch(o -> slot.equals(o.slot()) && !before.contains(o.id()));
            if (otherNew) continue;
            for (RpgChar.Learned o : List.copyOf(c.skills)) if (slot.equals(o.slot())) replace(c, o, new RpgChar.Learned(o.id(), o.grade(), o.lv(), o.mastery(), null));
            RpgChar.Learned cur = learned(c, l.id());
            replace(c, cur, new RpgChar.Learned(cur.id(), cur.grade(), cur.lv(), cur.mastery(), slot));
        }
    }

    /** 슬롯 장착 · 해제 (비전투만, 자기 슬롯에만) */
    public String equip(PlayerUnit u, String id, String slot, boolean inCombat) {
        RpgChar c = u.ch;
        RpgChar.Learned l = learned(c, id);
        if (l == null) return "배우지 않은 스킬입니다";
        if (slot != null && !slot.equals(skills.get(id).get("slot").getAsString())) return "그 슬롯에는 넣을 수 없습니다";
        if (inCombat) return "전투 중에는 슬롯을 바꿀 수 없습니다";
        if (slot != null) for (RpgChar.Learned o : List.copyOf(c.skills))
            if (slot.equals(o.slot()) && !o.id().equals(id)) replace(c, o, new RpgChar.Learned(o.id(), o.grade(), o.lv(), o.mastery(), null));
        RpgChar.Learned cur = learned(c, id);
        replace(c, cur, new RpgChar.Learned(cur.id(), cur.grade(), cur.lv(), cur.mastery(), slot));
        return null;
    }

    private static final List<String> GRADE_ORDER = List.of("low", "mid", "high", "trans");

    /** 스킬북: 안 배웠으면 배움, 배웠으면 등급 올림(숙련도 유지) */
    public String readBook(PlayerUnit u, String id, String grade) {
        JsonObject sk = skills.get(id);
        RpgChar c = u.ch;
        if (sk == null || !SkillDefs.canLearn(sk, c.line, c.job)) return "지금 직업으로는 배울 수 없는 스킬입니다";
        RpgChar.Learned l = learned(c, id);
        if (l != null && GRADE_ORDER.indexOf(grade) <= GRADE_ORDER.indexOf(l.grade())) return "이미 같거나 높은 등급으로 배운 스킬입니다";
        if (l == null) learn(u, id, grade);
        else {
            replace(c, l, new RpgChar.Learned(l.id(), grade, l.lv(), l.mastery(), l.slot()));
            notify.on(u, id, l.lv(), "grade");
        }
        return null;
    }

    /** 장착된 슬롯 → 스킬 id (A = 무기 평타) */
    public static String slotSkill(RpgChar c, String slot) {
        for (RpgChar.Learned l : c.skills) if (slot.equals(l.slot())) return l.id();
        return null;
    }
}
