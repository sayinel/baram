# CI/CD 계약 (이슈 207 / PR 208)

> CLAUDE.md에서 이전된 상황별 문서 — **워크플로(.github/)·릴리스 작업을 만질 때 읽을 것.**

- **push CI는 main만** 돈다 — feature 브랜치는 PR CI가 검증 (이중 실행 제거). main push는 test·rust까지 전체 스위트 실행
- **ci-pass 게이트**: rust skip이 허용되는 유일한 경우는 "rust 관련 경로를 안 건드린 PR". 그 외 모든 skip/실패는 빨간불
- **macOS 검증은 둘로 나뉘어 있고, 나눈 기준은 "무엇이 답을 바꿀 수 있는가"다** — 다른 모든 잡이 ubuntu라 v0.7.1 전까지 macOS 레그가 릴리스 당일에야 처음 실행됐다(v0.7.0이 밝은 타이틀바로 나간 이유). 되돌리지 말 것:
  - **ci.yml `macos` 잡** = Clippy + cargo test, `rust`와 **같은 경로 필터**. 셋 다 diff에 의존하므로 PR마다 도는 게 맞다 — 러너 라벨이 살아 있는가, `cfg(target_os = "macos")` 코드가 컴파일되는가, 대소문자 구분 없는 FS에서 테스트가 여전히 유효한가. 정당한 skip은 rust와 같은 하나뿐이고 ci-pass가 강제한다
  - **macos-sdk.yml** = `tauri build` + SDK 단정, **일 1회 cron**(+ `workflow_dispatch`, + 러너·단정·번들 설정·툴체인을 건드리는 PR). **`rust` 경로 필터로 되돌리지 말 것** — SDK는 러너 **이미지**의 속성이라 rust diff가 바꿀 수 없다. 그렇게 걸어 뒀을 때 실측 비용이 rust PR당 `tauri build` 12분이었고(잡 전체 26분 50초 vs 나머지 최장 6분 14초), 그러면서 rust 머지가 없는 주에는 오히려 눈이 멀었다. 위험이 시간 기반이면 트리거도 시간 기반이어야 한다
  - 이건 최후 방어선이 **아니다** — release.yml이 공증 직전에 같은 액션을 돌리므로 나쁜 SDK는 어차피 못 나간다. cron의 몫은 그 릴리스 실패가 놀라움이 되지 않게 하는 것
  - ‼️ cron 워크플로는 리포가 60일 조용하면 자동 비활성화되고, 실패해도 cron을 마지막으로 만진 사람에게 메일이 갈 뿐 아무것도 빨갛게 만들지 않는다
- **SDK 단정은 `.github/actions/verify-macos-sdk` 하나뿐** — release.yml과 macos-sdk.yml이 같은 composite action을 쓴다. 복사본을 만들지 말 것: 갈라지는 쪽은 릴리스 날까지 아무도 안 돌리는 쪽이다. 유니버설 바이너리의 **모든 아키텍처 슬라이스**를 검사하며(첫 슬라이스만 보면 한쪽이 다른 툴체인에서 온 빌드를 통과시킨다), 라벨이 아니라 Mach-O 로드 커맨드를 근거로 삼는다
- **macos 잡의 `cargo test`는 ubuntu 것의 중복이 아니다** — macOS는 기본 파일시스템이 대소문자를 구분하지 않는다. `Notes`와 `notes`를 구별하는 테스트는 ubuntu에서 통과하고 여기서는 무의미해지는데, 그 차이는 양쪽에서 돌려야만 보인다
- **`npm run build`는 lint 잡과 rust 잡 양쪽에 있다 — 중복이 아니다.** rust가 정당하게 skip되는 PR(프런트 소스만, 의존성만)이 곧 프로덕션 빌드 게이트가 사라지는 PR이라, lint 쪽이 그 경우의 유일한 `vite build`다. `npm run lint`가 이미 tsc를 돌리므로 lint 쪽이 더하는 것은 번들링 자체다. 어느 한쪽을 "이미 빌드하니까"로 지우지 말 것
- **릴리스 태그 규칙**: `v*` 태그는 package.json 버전과 일치하고 **main에 포함된 커밋**이어야 함 — verify-tag 잡이 불일치 시 즉시 실패
- **reusable workflow 함정**: called workflow 안에서 `github.event_name`은 호출자의 이벤트 — 절대 `'workflow_call'`이 아님. 릴리스 여부는 `inputs.release`로 판별
- **액션은 커밋 SHA 핀** (+`# vN` 주석, dependabot이 갱신). dtolnay/rust-toolchain만 예외: master 히스토리 SHA + `toolchain:` 입력 (ref명이 툴체인을 선택, release 브랜치 SHA는 GC됨)
- **release Linux 러너는 ubuntu-22.04 고정** — 오래된 glibc에서 빌드해야 배포 호환이 넓어짐. "현대화" 금지
- **gitleaks는 curl 설치** — dependabot 사각지대라 버전+체크섬을 손으로 함께 갱신
