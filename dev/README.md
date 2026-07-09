# dev/ — 내부 개발 문서

이 폴더는 **Baram 개발 과정에서만 사용하는 내부 문서**를 모아둔다.
사용자/배포용 문서는 저장소 루트의 `docs/`에 있다.

> ⚠️ **이 폴더는 public 릴리스에서 제외된다.**
> 공개 저장소에는 `docs/`(사용자 문서)만 포함하며, `dev/`는 배포 시점에
> `dev/`를 제외한 깨끗한 미러(예: `git filter-repo --path dev/ --invert-paths`)로 배포한다.
> `backlog.md`에는 미패치 보안 이슈가 파일:라인 위치까지 기록되어 있으므로,
> 저장소 가시성을 그대로 private→public으로 전환하지 말 것 (git 히스토리에 남는다).

## 구성

| 경로                        | 내용                                             |
| ------------------------- | ---------------------------------------------- |
| `design/`                 | 설계 문서 (Part 1~14, 각종 spec)                     |
| `plans/`                  | 구현 계획                                          |
| `impl-notes/`             | 구현 노트 (`/implement` 시 생성)                      |
| `superpowers/`            | Brainstorm 스펙/플랜 (`specs/`, `plans/`)          |
| `features/`               | 기능 카탈로그 (코드 기반)                                |
| `backlog.md`              | 기술부채 & 보안 백로그                                  |
| `next-steps.md`           | 로드맵                                            |
| `progress.json`           | 진행 상황 추적 (`/spec-check`, `/implement` 등이 갱신)  |
| `claude-automation-guide.md` | Claude Code 자동화 패키지 가이드                     |

## 사용자용 문서 (`docs/`, public)

- `docs/user-guide.md`, `docs/keyboard-shortcuts.md`, `docs/faq.md`
  — 앱 Help 패널에 `?raw`로 빌드 임베드됨 (경로 이동 금지)
- `docs/plugin-development.md` — 플러그인 개발자용 공개 가이드
