rootProject.name = "RucPlugins"

// 서버별 모듈이 늘어날 때마다 여기에 추가합니다.
include("RucCore")
include("RucHome")
include("RucRaid")

// 프록시(Velocity) 플러그인. 백엔드 모듈과 API 가 다릅니다.
include("RucGate")
