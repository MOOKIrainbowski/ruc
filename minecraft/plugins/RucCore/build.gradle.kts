// 공통 설정은 상위 build.gradle.kts 의 subprojects 블록에 있습니다.

dependencies {
    // DB 커넥션 풀
    implementation("com.zaxxer:HikariCP:5.1.0")

    // 로컬 개발용 임베디드 DB. 운영(VPS)에서는 MySQL로 전환 — config.yml에서 선택.
    // 설치 없이 둘 다 쓸 수 있게 번들합니다.
    implementation("com.h2database:h2:2.3.232")
    implementation("com.mysql:mysql-connector-j:9.1.0")
}

tasks.shadowJar {
    archiveClassifier.set("")

    // HikariCP만 relocate 합니다.
    // JDBC 드라이버(H2/MySQL)는 일부러 건드리지 않습니다 — 내부적으로
    // 리플렉션과 META-INF/services 에 의존해서, relocate 하면 런타임에
    // 조용히 깨지는 경우가 많습니다. 버킷은 플러그인마다 클래스로더가
    // 분리되므로 드라이버를 그대로 둬도 다른 플러그인과 충돌하지 않습니다.
    relocate("com.zaxxer.hikari", "kr.rucserver.core.lib.hikari")

    // minimize()도 쓰지 않습니다. 드라이버 클래스는 정적 분석으로
    // 참조를 추적할 수 없어서 필요한 클래스가 잘려나갈 수 있습니다.
}
