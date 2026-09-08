# CI/CD 계약 (이슈 207 / PR 208)

> CLAUDE.md에서 이전된 상황별 문서 — **워크플로(.github/)·릴리스 작업을 만질 때 읽을 것.**

- **push CI는 main만** 돈다 — feature 브랜치는 PR CI가 검증 (이중 실행 제거). main push는 test·rust까지 전체 스위트 실행
- **ci-pass 게이트**: rust skip이 허용되는 유일한 경우는 "rust 관련 경로를 안 건드린 PR". 그 외 모든 skip/실패는 빨간불
- **macos 잡은 릴리스 macOS 레그의 유일한 리허설이다** — 다른 모든 잡이 ubuntu라, v0.7.1 전까지 러너 라벨·Darwin 전용 Rust·링크된 SDK가 릴리스 당일에야 처음 실행됐다(v0.7.0이 밝은 타이틀바로 나간 이유). `rust`와 **같은 경로 필터**를 쓰므로 정당한 skip도 하나뿐이고, ci-pass가 그걸 강제한다. **PR 전용으로 만들지 말 것** — SDK 규칙은 러너 이미지에 달려 있어 이 리포에 아무 변경이 없어도 회귀할 수 있고, main push에서 `changes`가 rust=true를 무조건 내므로 머지마다 이미지가 재확인된다
- **SDK 단정은 `.github/actions/verify-macos-sdk` 하나뿐** — release.yml과 ci.yml이 같은 composite action을 쓴다. 복사본을 만들지 말 것: 갈라지는 쪽은 릴리스 날까지 아무도 안 돌리는 쪽이다. 유니버설 바이너리의 **모든 아키텍처 슬라이스**를 검사하며(첫 슬라이스만 보면 한쪽이 다른 툴체인에서 온 빌드를 통과시킨다), 라벨이 아니라 Mach-O 로드 커맨드를 근거로 삼는다
- **macos 잡의 `cargo test`는 ubuntu 것의 중복이 아니다** — macOS는 기본 파일시스템이 대소문자를 구분하지 않는다. `Notes`와 `notes`를 구별하는 테스트는 ubuntu에서 통과하고 여기서는 무의미해지는데, 그 차이는 양쪽에서 돌려야만 보인다
- **`npm run build`는 lint 잡과 rust 잡 양쪽에 있다 — 중복이 아니다.** rust가 정당하게 skip되는 PR(프런트 소스만, 의존성만)이 곧 프로덕션 빌드 게이트가 사라지는 PR이라, lint 쪽이 그 경우의 유일한 `vite build`다. `npm run lint`가 이미 tsc를 돌리므로 lint 쪽이 더하는 것은 번들링 자체다. 어느 한쪽을 "이미 빌드하니까"로 지우지 말 것
- **릴리스 태그 규칙**: `v*` 태그는 package.json 버전과 일치하고 **main에 포함된 커밋**이어야 함 — verify-tag 잡이 불일치 시 즉시 실패
- **reusable workflow 함정**: called workflow 안에서 `github.event_name`은 호출자의 이벤트 — 절대 `'workflow_call'`이 아님. 릴리스 여부는 `inputs.release`로 판별
- **액션은 커밋 SHA 핀** (+`# vN` 주석, dependabot이 갱신). dtolnay/rust-toolchain만 예외: master 히스토리 SHA + `toolchain:` 입력 (ref명이 툴체인을 선택, release 브랜치 SHA는 GC됨)
- **release Linux 러너는 ubuntu-22.04 고정** — 오래된 glibc에서 빌드해야 배포 호환이 넓어짐. "현대화" 금지
- **gitleaks는 curl 설치** — dependabot 사각지대라 버전+체크섬을 손으로 함께 갱신
