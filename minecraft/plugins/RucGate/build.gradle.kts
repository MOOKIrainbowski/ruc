// 프록시(Velocity) 플러그인. 국가전 서버 입장 자격을 프록시 단에서 판정합니다.
//
// 백엔드 모듈(RucCore/RucHome/...)과 달리 Bukkit 이 아니라 Velocity API 를 씁니다.
// 상위 build.gradle.kts 가 paper-api 를 이 모듈에는 넣지 않도록 빼 두었습니다.

dependencies {
    // 프록시 jar 과 같은 버전. 4.x 는 Java 25(class 69)를 요구해서 JDK 21 에서
    // 실행되지 않습니다 — 프록시를 3.5.1 로 고정한 것과 같은 이유입니다.
    compileOnly("com.velocitypowered:velocity-api:3.5.1")

    // velocity-plugin.json 을 @Plugin 애너테이션에서 생성해 줍니다.
    // 이게 없으면 프록시가 플러그인을 아예 인식하지 못합니다.
    annotationProcessor("com.velocitypowered:velocity-api:3.5.1")

    // 백엔드와 같은 DB 를 직접 봅니다. 버전도 RucCore 와 맞춥니다.
    implementation("com.zaxxer:HikariCP:5.1.0")
    implementation("com.h2database:h2:2.3.232")
    implementation("com.mysql:mysql-connector-j:9.1.0")
}

tasks.shadowJar {
    archiveClassifier.set("")

    // RucCore 와 같은 판단입니다: HikariCP 만 relocate 하고 JDBC 드라이버는
    // 건드리지 않습니다. 드라이버는 리플렉션과 META-INF/services 에 의존해서
    // relocate 하면 런타임에 조용히 깨집니다.
    relocate("com.zaxxer.hikari", "kr.rucserver.gate.lib.hikari")
}
