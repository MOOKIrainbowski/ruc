// 약탈 서버 전용 규칙 (§2.4).
// 화폐/경험치/평판은 RucCore가 소유하므로 여기서는 참조만 합니다.

dependencies {
    compileOnly(project(":RucCore"))
}

// RucCore 는 shadowJar 가 기본 jar 자리를 대신합니다(classifier = "").
// 그래서 컴파일이 그 산출물에 암묵적으로 의존하는데, Gradle 은 순서가
// 보장되지 않는 이 상황을 오류로 막습니다. 명시적으로 선언해 순서를 보장합니다.
tasks.compileJava {
    dependsOn(":RucCore:shadowJar")
}

tasks.shadowJar {
    archiveClassifier.set("")
}
