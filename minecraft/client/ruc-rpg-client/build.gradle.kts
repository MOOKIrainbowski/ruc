// 러크 RPG 클라이언트 모드 (사용자 결정 K1, 2026-11-15): 웹 키 그대로 · HUD · 미니맵 · 지도 · 퀘스트 강조를 모드가 그림.
plugins {
    id("fabric-loom") version "1.14.10"
}

version = property("mod_version") as String
group = "kr.rucserver"

repositories { mavenCentral() }

dependencies {
    minecraft("com.mojang:minecraft:${property("minecraft_version")}")
    mappings(loom.officialMojangMappings())
    modImplementation("net.fabricmc:fabric-loader:${property("loader_version")}")
    modImplementation("net.fabricmc.fabric-api:fabric-api:${property("fabric_api_version")}")
}

// 개발 시험 클라이언트: 시험 서버(127.0.0.1:25599)에 RpgBot1 로 바로 접속 + 자동 시험(SelfTest)
loom {
    runs {
        named("client") {
            programArgs("--username", "RpgBot1", "--quickPlayMultiplayer", "127.0.0.1:25599")
            vmArgs("-Druc.selftest=1", "-Druc.selftest.cmds=" + (findProperty("selftestCmds") ?: "rpgadmin goto field"))
        }
    }
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(21))
}

tasks.processResources {
    inputs.property("version", project.version)
    filesMatching("fabric.mod.json") { expand("version" to project.version) }
}
