# 마인크래프트 서버

Paper 1.21.11 + Velocity 프록시. 자바 에디션 전용 (Q2 결정).

## 처음 시작할 때

```powershell
# 1. Paper/Velocity 다운로드 + 플러그인 빌드 + 배치
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# 2. EULA 동의 (운영자 본인이 직접)
powershell -ExecutionPolicy Bypass -File scripts\accept-eula.ps1

# 3. 홈 서버 실행
powershell -ExecutionPolicy Bypass -File scripts\start-home.ps1
```

`setup.ps1`은 빌드 번호를 하드코딩하지 않고 PaperMC API에서 최신 STABLE을 조회합니다. 다시 실행하면 최신 빌드로 갱신되고, 이미 받은 파일은 건너뜁니다. 체크섬도 검증합니다.

## 구조

```
minecraft/
├── proxy/              Velocity — 플레이어가 접속하는 유일한 창구 (25565)
├── servers/
│   ├── home/           홈 25566 · 어드벤처 · 평화 난이도
│   ├── raid/           약탈 25567
│   ├── war/            국가전 25568
│   └── peace/          평화 25569
├── plugins/RucCore/    공용 플러그인 소스 (Gradle)
└── scripts/            setup / accept-eula / start-home
```

## ⚠️ 보안 — 반드시 지킬 것

| 항목 | 값 | 이유 |
|---|---|---|
| Velocity `online-mode` | **true** | false면 UUID 위조가 가능해져 **디스코드 인증(D10)이 통째로 무력화**됩니다 |
| 백엔드 `online-mode` | false | 정상입니다. 프록시가 이미 인증하고 서명된 정보를 넘깁니다 |
| 방화벽 | **25565만 개방** | 25566~25569가 외부에 열리면 누구나 아무 UUID로 직접 접속할 수 있습니다. 이게 프록시 구조의 유일한 치명적 함정입니다 |
| `forwarding.secret` | git 제외됨 | 프록시↔백엔드 신뢰의 근거입니다 |

백엔드 서버를 처음 켜면 Velocity 포워딩을 켜야 합니다. 각 서버의 `config/paper-global.yml`:

```yaml
proxies:
  velocity:
    enabled: true
    online-mode: true
    secret: '<proxy/forwarding.secret 파일과 동일한 값>'
```

## RucCore 플러그인

4개 서버가 전부 올리는 공용 플러그인입니다. 화폐·경험치·평판처럼 서버를 넘나드는 것은 전부 여기가 소유합니다.

### 현재 구현된 것 (v0.1.0)

| 기능 | 명세 | 상태 |
|---|---|---|
| Ruc 화폐 (4서버 공용) | §3.1 | ✅ |
| 자체 경험치 (바닐라와 분리) | §3.4 | ✅ |
| 레벨 곡선 (고레벨일수록 가파름) | §3.4 | ✅ |
| 우측 스코어보드 7줄 | §3.6 / D9 | ✅ |
| 핑 등급 표시 | §3.6 | ✅ |
| 좌표 표시 억제 | §2.2 | ✅ |
| `/tpa` `/tpahere` `/tpaccept` `/tpdeny` `/tpcancel` | §3.3 | ✅ |
| 한국어/영어 (`/언어`) | §6.3 | ✅ |
| 평판 7티어 표시 | §3.7 | ✅ (점수 변동 로직은 Phase 7) |
| 디스코드 인증 게이트 | D10 | ⬜ 다음 작업 |

### 빌드

```powershell
cd plugins\RucCore
java -classpath "gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain build
```

결과물: `build/libs/RucCore-0.1.0.jar` (약 7MB — JDBC 드라이버 포함)

### 데이터베이스

기본값은 **H2**(임베디드, 설치 불필요)입니다. MySQL 호환 모드로 띄워서, 운영 전환 시 쿼리를 고칠 필요가 없습니다.

VPS로 옮길 때는 각 서버의 `plugins/RucCore/config.yml`에서:

```yaml
database:
  type: mysql
  mysql:
    host: ...
```

**4개 서버가 반드시 같은 DB를 봐야 합니다.** 그래야 "Ruc는 모든 서버 공용"(§3.1)과 드래곤 알의 네트워크 전역 버프(D3)가 성립합니다.

### 설정

`plugins/RucCore/config.yml`은 서버마다 `server-id`와 `server-display-name`만 다르고 나머지는 동일합니다.

경험치 곡선은 `xp.base`와 `xp.exponent`로 조절합니다. 필요 경험치 = `base × 레벨^exponent`이므로, exponent를 올리면 고레벨 구간이 급격히 가팔라집니다.

## 다음 작업

1. **디스코드 인증 게이트 (D10)** — 미인증 플레이어를 홈 인증 구역에 격리
2. MOOKI `/인증` 명령 (Phase 6에서 앞당겨짐)
3. 홈 광장 맵 (Q6 — 라이선스 확인 필요)
4. NPC 서버 선택기 · 정보 보드 (D1)
