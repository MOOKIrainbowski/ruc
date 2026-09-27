package kr.rucserver.core.model;

/**
 * 길드 직위 (§3.5).
 *
 * 권한은 {@link #weight()} 하나로 비교합니다. "부길드장 이상만 가능" 같은 조건이
 * 코드 곳곳에 흩어지면 나중에 직위를 추가할 때 전부 찾아 고쳐야 하기 때문입니다.
 */
public enum GuildRank {

    /** 길드장. 길드당 정확히 한 명. 해산·직위 임명·코어 설치 권한. */
    MASTER("guild.rank.master", 3),

    /** 부길드장. 초대·추방·코어 설치까지. 해산과 임명은 못 합니다. */
    VICE("guild.rank.vice", 2),

    /** 일반 길드원. */
    MEMBER("guild.rank.member", 1);

    private final String key;
    private final int weight;

    GuildRank(String key, int weight) {
        this.key = key;
        this.weight = weight;
    }

    /** messages_*.yml 의 표시명 키. */
    public String key() { return key; }

    public int weight() { return weight; }

    /** 이 직위가 {@code other} 이상인지. */
    public boolean atLeast(GuildRank other) {
        return weight >= other.weight;
    }

    /** DB에 저장된 문자열을 되돌립니다. 모르는 값은 일반 길드원으로 봅니다. */
    public static GuildRank of(String raw) {
        if (raw == null) return MEMBER;
        try {
            return valueOf(raw.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return MEMBER;
        }
    }
}
