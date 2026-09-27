package kr.rucserver.core.model;

import java.util.UUID;

/**
 * 길드 소속 한 줄.
 *
 * 이름을 여기에도 들고 있는 이유: 오프라인 길드원 목록을 보여줄 때마다
 * ruc_player 를 조인하면 목록 조회가 무거워집니다. 소속될 때와 접속할 때
 * 갱신되는 사본으로 충분합니다.
 */
public class GuildMember {

    private final UUID uuid;
    private String name;
    private GuildRank rank;
    private final long joinedAt;

    /** 길드 금고에 넣은 누적액. 주간 보상 분배와 기여도 표시에 씁니다. */
    private long contribution;

    /**
     * 주간 보상을 마지막으로 받은 시각.
     *
     * 길드가 아니라 <b>길드원마다</b> 두는 이유: 길드 단위로 한 번에 지급하면
     * 접속하지 않은 사람의 잔고를 건드려야 하는데, 그건 캐시를 우회해 DB를 직접
     * 쓰는 길이라 접속 중인 사본과 충돌합니다. 각자 접속했을 때 정산하면
     * 그 문제가 통째로 사라집니다.
     */
    private long lastWeeklyAt;

    public GuildMember(UUID uuid, String name, GuildRank rank, long joinedAt, long contribution,
                       long lastWeeklyAt) {
        this.uuid = uuid;
        this.name = name;
        this.rank = rank;
        this.joinedAt = joinedAt;
        this.contribution = contribution;
        this.lastWeeklyAt = lastWeeklyAt;
    }

    public UUID getUuid() { return uuid; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public GuildRank getRank() { return rank; }
    public void setRank(GuildRank rank) { this.rank = rank; }

    public long getJoinedAt() { return joinedAt; }

    public long getContribution() { return contribution; }
    public void setContribution(long contribution) { this.contribution = Math.max(0, contribution); }

    public long getLastWeeklyAt() { return lastWeeklyAt; }
    public void setLastWeeklyAt(long lastWeeklyAt) { this.lastWeeklyAt = lastWeeklyAt; }
}
