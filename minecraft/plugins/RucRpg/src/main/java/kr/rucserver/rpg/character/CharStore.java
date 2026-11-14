package kr.rucserver.rpg.character;

import kr.rucserver.core.storage.Database;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 캐릭터 저장 (RucCore 공용 DB 의 rpg_ 테이블). RPG 레벨은 RucCore 레벨과 별개(사용자 결정 Q4, R7).
 * H2(MySQL 모드) · MySQL 둘 다 되는 SQL 만 씀.
 */
public final class CharStore {

    private final Database db;

    public CharStore(Database db) { this.db = db; }

    public void createSchema() throws SQLException {
        try (Connection c = db.getConnection(); Statement s = c.createStatement()) {
            s.execute("""
                    CREATE TABLE IF NOT EXISTS rpg_chars (
                      uuid       VARCHAR(36) PRIMARY KEY,
                      element    VARCHAR(16) NOT NULL,
                      level      INT NOT NULL DEFAULT 1,
                      exp        BIGINT NOT NULL DEFAULT 0,
                      line       VARCHAR(16),
                      job        VARCHAR(32),
                      sub        VARCHAR(16),
                      pot_phys   INT NOT NULL DEFAULT 10,
                      pot_mag    INT NOT NULL DEFAULT 10,
                      awake      BOOLEAN NOT NULL DEFAULT FALSE,
                      hp         DOUBLE,
                      mana       DOUBLE,
                      energy     DOUBLE,
                      stamina    DOUBLE,
                      created_at BIGINT NOT NULL
                    )""");
            s.execute("""
                    CREATE TABLE IF NOT EXISTS rpg_skills (
                      uuid     VARCHAR(36) NOT NULL,
                      skill_id VARCHAR(48) NOT NULL,
                      grade    VARCHAR(8)  NOT NULL,
                      lv       INT NOT NULL,
                      mastery  DOUBLE NOT NULL DEFAULT 0,
                      slot     VARCHAR(2),
                      PRIMARY KEY (uuid, skill_id)
                    )""");
        }
    }

    /** 없으면 null (= 처음 온 사람 → 주 속성 고르기) */
    public RpgChar load(UUID uuid) throws SQLException {
        try (Connection c = db.getConnection()) {
            RpgChar ch;
            try (PreparedStatement ps = c.prepareStatement("SELECT * FROM rpg_chars WHERE uuid = ?")) {
                ps.setString(1, uuid.toString());
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) return null;
                    ch = new RpgChar(uuid, rs.getString("element"));
                    ch.level = rs.getInt("level");
                    ch.exp = rs.getLong("exp");
                    ch.line = rs.getString("line");
                    ch.job = rs.getString("job");
                    ch.sub = rs.getString("sub");
                    ch.potPhys = rs.getInt("pot_phys");
                    ch.potMag = rs.getInt("pot_mag");
                    ch.awake = rs.getBoolean("awake");
                    ch.hp = nullable(rs, "hp");
                    ch.mana = nullable(rs, "mana");
                    ch.energy = nullable(rs, "energy");
                    ch.stamina = nullable(rs, "stamina");
                }
            }
            try (PreparedStatement ps = c.prepareStatement("SELECT skill_id, grade, lv, mastery, slot FROM rpg_skills WHERE uuid = ?")) {
                ps.setString(1, uuid.toString());
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) ch.skills.add(new RpgChar.Learned(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getDouble(4), rs.getString(5)));
                }
            }
            return ch;
        }
    }

    private static double nullable(ResultSet rs, String col) throws SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? -1 : v;
    }

    /** 전체 저장 — 한 트랜잭션 (캐릭터 줄 + 스킬 전부 다시 씀) */
    public void save(RpgChar ch) throws SQLException {
        List<RpgChar.Learned> skills;
        synchronized (ch) { skills = new ArrayList<>(ch.skills); }
        try (Connection c = db.getConnection()) {
            c.setAutoCommit(false);
            try {
                try (PreparedStatement ps = c.prepareStatement("UPDATE rpg_chars SET element=?, level=?, exp=?, line=?, job=?, sub=?, pot_phys=?, pot_mag=?, awake=?, hp=?, mana=?, energy=?, stamina=? WHERE uuid=?")) {
                    bind(ps, ch);
                    if (ps.executeUpdate() == 0) {
                        try (PreparedStatement ins = c.prepareStatement("INSERT INTO rpg_chars (element, level, exp, line, job, sub, pot_phys, pot_mag, awake, hp, mana, energy, stamina, uuid, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")) {
                            bind(ins, ch);
                            ins.setLong(15, System.currentTimeMillis());
                            ins.executeUpdate();
                        }
                    }
                }
                try (PreparedStatement del = c.prepareStatement("DELETE FROM rpg_skills WHERE uuid = ?")) {
                    del.setString(1, ch.uuid.toString());
                    del.executeUpdate();
                }
                try (PreparedStatement ins = c.prepareStatement("INSERT INTO rpg_skills (uuid, skill_id, grade, lv, mastery, slot) VALUES (?,?,?,?,?,?)")) {
                    for (RpgChar.Learned l : skills) {
                        ins.setString(1, ch.uuid.toString());
                        ins.setString(2, l.id());
                        ins.setString(3, l.grade());
                        ins.setInt(4, l.lv());
                        ins.setDouble(5, l.mastery());
                        ins.setString(6, l.slot());
                        ins.addBatch();
                    }
                    ins.executeBatch();
                }
                c.commit();
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    private static void bind(PreparedStatement ps, RpgChar ch) throws SQLException {
        ps.setString(1, ch.element);
        ps.setInt(2, ch.level);
        ps.setLong(3, ch.exp);
        ps.setString(4, ch.line);
        ps.setString(5, ch.job);
        ps.setString(6, ch.sub);
        ps.setInt(7, ch.potPhys);
        ps.setInt(8, ch.potMag);
        ps.setBoolean(9, ch.awake);
        ps.setDouble(10, ch.hp);
        ps.setDouble(11, ch.mana);
        ps.setDouble(12, ch.energy);
        ps.setDouble(13, ch.stamina);
        ps.setString(14, ch.uuid.toString());
    }
}
