package kr.rucserver.core.menu;

/**
 * 큰 상자(6줄) 목록 화면의 칸 배치.
 *
 * <h2>왜 따로 두는가</h2>
 * 우편함(Phase 5.5)과 유저 상점(Phase 10)이 같은 배치를 씁니다 — 맨 윗줄과
 * 좌·우 끝열을 비우고, 좌하단/우하단에 이전·다음. 배치 계산이 두 군데에 적히면
 * 한쪽만 고쳐졌을 때 "상점에서는 되는데 우편함에서는 안 되는" 클릭이 생깁니다.
 *
 * <h2>테두리를 비우는 이유</h2>
 * 목록이 인벤토리 벽에 붙어 있으면 창 밖을 클릭하려다 물건을 누릅니다.
 * 상점에서는 그 오클릭이 곧 돈입니다.
 */
public final class Pages {

    private Pages() { }

    /** 6줄 = 54칸. 목록 화면은 전부 이 크기입니다. */
    public static final int SIZE = 54;

    public static final int ROWS = 6;
    public static final int COLUMNS = 9;

    /** 좌하단 = 이전 장, 우하단 = 다음 장. */
    public static final int SLOT_PREV = 45;
    public static final int SLOT_NEXT = 53;

    /** 맨 아랫줄 가운데. 우편함은 '모두 받기', 상점은 안내에 씁니다. */
    public static final int SLOT_ACTION = 49;

    /** 맨 아랫줄에서 이전·다음 사이의 칸들 (46~52). */
    public static final int BOTTOM_ROW_START = 46;
    public static final int BOTTOM_ROW_END = 52;

    /**
     * 목록이 들어가는 칸.
     *
     * @param rows 위에서 몇 줄을 쓸지. 맨 윗줄(0번 줄)은 항상 비우므로 1번 줄부터
     *             셉니다. 4 면 1~4번 줄을 쓰고 맨 아랫줄은 조작 줄로 남습니다.
     */
    public static int[] content(int rows) {
        int[] slots = new int[rows * (COLUMNS - 2)];
        int i = 0;
        for (int row = 1; row <= rows; row++) {
            for (int column = 1; column <= COLUMNS - 2; column++) {
                slots[i++] = row * COLUMNS + column;
            }
        }
        return slots;
    }

    /** 몇 장이 되는가. 항목이 0개여도 1장입니다 (빈 우편함도 열려야 합니다). */
    public static int pageCount(int total, int perPage) {
        if (total <= 0) return 1;
        return (total + perPage - 1) / perPage;
    }
}
