package kr.rucserver.core.model;

import java.util.UUID;

/**
 * 네트워크 전역 플레이어 데이터.
 *
 * 이 객체 하나가 4개 서버에서 공유됩니다 (§3.1 "Ruc는 모든 서버 공용").
 * 따라서 서버별로 달라지는 값(현재 위치, 인벤토리 등)은 여기 넣지 않습니다.
 */
public class RucPlayer {

    private final UUID uuid;
    private String name;

    private long ruc;
    private long xp;
    private int level;

    /** 평판 점수. 신규는 100 = "빨강" 구간에서 시작합니다 (D4). */
    private int reputation;

    /** 연동된 디스코드 계정 ID. null이면 미인증 (D10). */
    private String discordId;
    private Long verifiedAt;

    private long kills;
    private long deaths;
    private long assists;

    private String language;

    private final long firstJoin;
    private long lastSeen;

    public RucPlayer(UUID uuid, String name, long ruc, long xp, int level, int reputation,
                     String discordId, Long verifiedAt, long kills, long deaths, long assists,
                     String language, long firstJoin, long lastSeen) {
        this.uuid = uuid;
        this.name = name;
        this.ruc = ruc;
        this.xp = xp;
        this.level = level;
        this.reputation = reputation;
        this.discordId = discordId;
        this.verifiedAt = verifiedAt;
        this.kills = kills;
        this.deaths = deaths;
        this.assists = assists;
        this.language = language;
        this.firstJoin = firstJoin;
        this.lastSeen = lastSeen;
    }

    /** 신규 플레이어 기본값. */
    public static RucPlayer createNew(UUID uuid, String name, long startingBalance, String language) {
        long now = System.currentTimeMillis();
        return new RucPlayer(uuid, name, startingBalance, 0L, 1, 100,
                null, null, 0L, 0L, 0L, language, now, now);
    }

    public UUID getUuid() { return uuid; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public long getRuc() { return ruc; }
    public void setRuc(long ruc) { this.ruc = Math.max(0, ruc); }

    public long getXp() { return xp; }
    public void setXp(long xp) { this.xp = Math.max(0, xp); }

    public int getLevel() { return level; }
    public void setLevel(int level) { this.level = Math.max(1, level); }

    public int getReputation() { return reputation; }
    public void setReputation(int reputation) { this.reputation = reputation; }

    public String getDiscordId() { return discordId; }
    public void setDiscordId(String discordId) { this.discordId = discordId; }

    /** D10 — 디스코드 인증을 마쳤는지. 미인증이면 홈 인증 구역에 격리됩니다. */
    public boolean isVerified() { return discordId != null && !discordId.isEmpty(); }

    public Long getVerifiedAt() { return verifiedAt; }
    public void setVerifiedAt(Long verifiedAt) { this.verifiedAt = verifiedAt; }

    public long getKills() { return kills; }
    public void setKills(long kills) { this.kills = kills; }
    public void addKill() { this.kills++; }

    public long getDeaths() { return deaths; }
    public void setDeaths(long deaths) { this.deaths = deaths; }
    public void addDeath() { this.deaths++; }

    public long getAssists() { return assists; }
    public void setAssists(long assists) { this.assists = assists; }
    public void addAssist() { this.assists++; }

    public String getLanguage() { return language; }
    public void setLanguage(String language) { this.language = language; }

    public long getFirstJoin() { return firstJoin; }

    public long getLastSeen() { return lastSeen; }
    public void setLastSeen(long lastSeen) { this.lastSeen = lastSeen; }
}
