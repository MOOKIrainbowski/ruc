package kr.rucserver.core.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 길드 (§3.5). 길드원 수가 임계치를 넘으면 <b>국가</b>로 인정됩니다 (§2.6).
 *
 * 이 객체는 4개 서버가 각자 캐시로 들고 있고 원본은 DB입니다. 따라서 여기서
 * 값을 바꾸는 것만으로는 다른 서버에 전달되지 않습니다 — 변경은 반드시
 * {@code GuildService} 를 통해서 하세요.
 */
public class Guild {

    private final int id;
    private String name;
    private String tag;
    private UUID master;

    /** 길드 금고. 코어 부품 구입(국가 인장)과 주간 보상의 재원입니다. */
    private long bank;

    /** 시즌 점수. 랭킹 보상 산정 기준 (§3.5). */
    private long points;

    /** §2.6 — 국가로 인정된 상태. 길드원 수로 판정되며 DB에 저장됩니다. */
    private boolean nation;

    private final long createdAt;

    /** 마지막 시즌 정산 시각. 0이면 아직 한 번도 정산하지 않았습니다. */
    private long lastSeasonAt;

    private final Map<UUID, GuildMember> members = new LinkedHashMap<>();

    public Guild(int id, String name, String tag, UUID master, long bank, long points,
                 boolean nation, long createdAt, long lastSeasonAt) {
        this.id = id;
        this.name = name;
        this.tag = tag;
        this.master = master;
        this.bank = bank;
        this.points = points;
        this.nation = nation;
        this.createdAt = createdAt;
        this.lastSeasonAt = lastSeasonAt;
    }

    public int getId() { return id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getTag() { return tag; }
    public void setTag(String tag) { this.tag = tag; }

    public UUID getMaster() { return master; }
    public void setMaster(UUID master) { this.master = master; }

    public long getBank() { return bank; }
    public void setBank(long bank) { this.bank = Math.max(0, bank); }

    public long getPoints() { return points; }
    public void setPoints(long points) { this.points = Math.max(0, points); }

    public boolean isNation() { return nation; }
    public void setNation(boolean nation) { this.nation = nation; }

    public long getCreatedAt() { return createdAt; }

    public long getLastSeasonAt() { return lastSeasonAt; }
    public void setLastSeasonAt(long lastSeasonAt) { this.lastSeasonAt = lastSeasonAt; }

    // ── 길드원 ────────────────────────────────────────────────────────

    /** 캐시를 채울 때만 씁니다. 가입 처리는 GuildService.join() 입니다. */
    public void putMember(GuildMember member) {
        members.put(member.getUuid(), member);
    }

    public void removeMember(UUID uuid) {
        members.remove(uuid);
    }

    public GuildMember member(UUID uuid) {
        return members.get(uuid);
    }

    public boolean contains(UUID uuid) {
        return members.containsKey(uuid);
    }

    public int size() {
        return members.size();
    }

    /** 가입 순서를 유지한 사본. */
    public List<GuildMember> members() {
        return Collections.unmodifiableList(new ArrayList<>(members.values()));
    }

    /** 직위 내림차순 → 기여도 내림차순. 목록 표시용. */
    public List<GuildMember> membersSorted() {
        List<GuildMember> list = new ArrayList<>(members.values());
        list.sort((a, b) -> {
            int byRank = Integer.compare(b.getRank().weight(), a.getRank().weight());
            if (byRank != 0) return byRank;
            return Long.compare(b.getContribution(), a.getContribution());
        });
        return list;
    }

    public GuildRank rankOf(UUID uuid) {
        GuildMember member = members.get(uuid);
        return member == null ? null : member.getRank();
    }

    /** 표시용 이름. 태그가 있으면 `[태그] 이름`. */
    public String display() {
        return tag == null || tag.isEmpty() ? name : "[" + tag + "] " + name;
    }
}
