# CI/CD 계약 (이슈 207 / PR 208)

> CLAUDE.md에서 이전된 상황별 문서 — **워크플로(.github/)·릴리스 작업을 만질 때 읽을 것.**

- **push CI는 main만** 돈다 — feature 브랜치는 PR CI가 검증 (이중 실행 제거). main push는 test·rust까지 전체 스위트 실행
- **ci-pass 게이트**: rust skip이 허용되는 유일한 경우는 "rust 관련 경로를 안 건드린 PR". 그 외 모든 skip/실패는 빨간불
- **릴리스 태그 규칙**: `v*` 태그는 package.json 버전과 일치하고 **main에 포함된 커밋**이어야 함 — verify-tag 잡이 불일치 시 즉시 실패
- **reusable workflow 함정**: called workflow 안에서 `github.event_name`은 호출자의 이벤트 — 절대 `'workflow_call'`이 아님. 릴리스 여부는 `inputs.release`로 판별
- **액션은 커밋 SHA 핀** (+`# vN` 주석, dependabot이 갱신). dtolnay/rust-toolchain만 예외: master 히스토리 SHA + `toolchain:` 입력 (ref명이 툴체인을 선택, release 브랜치 SHA는 GC됨)
- **release Linux 러너는 ubuntu-22.04 고정** — 오래된 glibc에서 빌드해야 배포 호환이 넓어짐. "현대화" 금지
- **gitleaks는 curl 설치** — dependabot 사각지대라 버전+체크섬을 손으로 함께 갱신
