import java.io.BufferedWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * 공용 H2 DB 를 SQL 덤프로 뜹니다. backup.ps1 이 부릅니다.
 *
 * <pre>
 * java -cp servers/home/plugins/RucCore.jar scripts/DbDump.java &lt;JDBC URL&gt; &lt;출력 .sql&gt;
 * </pre>
 *
 * <h2>왜 따로 만들었나</h2>
 * 서버가 DB 파일을 잡고 있으면 AUTO_SERVER 원격 연결이 되는데, 원격에서는 파일을
 * 쓰는 명령({@code BACKUP TO}, {@code SCRIPT TO})이 전부 "Feature not supported"
 * 입니다. 그래서 {@code SCRIPT} 를 <b>질의</b>로 돌려 결과 행을 받아 이쪽에서
 * 파일로 씁니다. 한 트랜잭션 안의 스냅샷이라 일관된 사본입니다.
 *
 * <h2>복원</h2>
 * <pre>
 * java -cp RucCore.jar org.h2.tools.RunScript -url &lt;같은 URL&gt; -user sa -script ruc-h2.sql
 * </pre>
 * 복원은 <b>서버를 전부 끈 상태에서, 빈 DB 에</b> 하세요.
 */
public class DbDump {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: DbDump <jdbc-url> <out.sql>");
            System.exit(2);
        }
        Class.forName("org.h2.Driver");
        Path out = Path.of(args[1]);
        long rows = 0;
        try (Connection conn = DriverManager.getConnection(args[0], "sa", "");
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SCRIPT");
             BufferedWriter w = Files.newBufferedWriter(out, StandardCharsets.UTF_8)) {
            while (rs.next()) {
                w.write(rs.getString(1));
                w.newLine();
                rows++;
            }
        }
        System.out.println("DUMP OK lines=" + rows + " bytes=" + Files.size(out));
    }
}
