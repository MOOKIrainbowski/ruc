// 러크 RPG 마크 서버 (구 국가전 서버, 2026-11-15~). 계획서 docs/10-MC-RPG-PLAN.md
// 화폐(Gold) · 길드 · 우편 · 칭호 · 스코어보드는 RucCore 것을 그대로 씁니다.

dependencies {
    compileOnly(project(":RucCore"))

    testImplementation("io.papermc.paper:paper-api:1.21.11-R0.1-SNAPSHOT")   // 테스트에서 Gson 등
    testImplementation(platform("org.junit:junit-bom:5.11.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.compileJava {
    dependsOn(":RucCore:shadowJar")
}

tasks.shadowJar {
    archiveClassifier.set("")
}

tasks.test {
    useJUnitPlatform()
}
