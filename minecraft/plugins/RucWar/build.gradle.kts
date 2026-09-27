// 국가전 서버 전용 규칙 (§2.6).
// 길드·화폐·경험치는 RucCore 가 소유하므로 여기서는 참조만 합니다.

dependencies {
    compileOnly(project(":RucCore"))
}

// RucCore 는 shadowJar 가 기본 jar 자리를 대신합니다(classifier = "").
// 컴파일이 그 산출물에 암묵적으로 의존하는데 Gradle 은 순서가 보장되지 않는
// 상황을 오류로 막으므로, 명시적으로 선언합니다.
tasks.compileJava {
    dependsOn(":RucCore:shadowJar")
}

tasks.shadowJar {
    archiveClassifier.set("")
}
