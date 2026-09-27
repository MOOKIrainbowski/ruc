// 모든 러크 플러그인이 공유하는 빌드 설정.
// 각 모듈은 자기 의존성과 shadowJar relocate 만 신경 쓰면 됩니다.

plugins {
    java
    id("com.gradleup.shadow") version "9.0.2" apply false
}

subprojects {
    apply(plugin = "java")
    apply(plugin = "com.gradleup.shadow")

    group = "kr.rucserver"
    version = "0.1.0"

    repositories {
        mavenCentral()
        maven("https://repo.papermc.io/repository/maven-public/")
    }

    // RucGate 는 Bukkit 이 아니라 Velocity 플러그인이라 paper-api 를 넣지 않습니다.
    // 넣어 두면 프록시에는 없는 Bukkit 클래스를 실수로 쓰고도 컴파일이 통과합니다.
    if (project.name != "RucGate") {
        dependencies {
            // Paper 1.21.11 — §6.2 "안정 우선" 결정 (1.21 계열 최신 STABLE)
            "compileOnly"("io.papermc.paper:paper-api:1.21.11-R0.1-SNAPSHOT")
        }
    }

    extensions.configure<JavaPluginExtension> {
        toolchain.languageVersion.set(JavaLanguageVersion.of(21))
    }

    tasks.withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
        options.release.set(21)
    }

    tasks.withType<ProcessResources>().configureEach {
        // plugin.yml 의 ${version} 을 빌드 시 실제 버전으로 치환
        filesMatching("plugin.yml") {
            expand("version" to project.version)
        }
    }

    tasks.named("build") {
        dependsOn("shadowJar")
    }
}
