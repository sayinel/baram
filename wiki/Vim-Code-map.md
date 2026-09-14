# Vim Code map

vim 구현의 **파일 경로가 사는 유일한 페이지**다. 다른 페이지는 경로를 적지 않고 여기를 가리킨다.
링크는 `main` 을 가리키므로 파일이 옮겨지면 404 가 된다 — 그리고 리포의 `lint:wiki` 게이트가
그보다 먼저 빨간불을 낸다. **단 아래 다섯 절의 검사 강도가 서로 다르다** — 마지막 절의 도입부를 볼 것.

`§` 는 vim 설계서의 절 번호다. 설계서 자체는 내부 문서(리포 밖)지만, **같은 § 가 각 모듈의 헤더
주석에 붙어 있다** — 공개된 등가물은 그 헤더 주석이고, 어긋나면 **헤더가 옳다**.

## core — 순수 상태기계 (ProseMirror 무의존)

| 파일                                                                                                            | 무엇                                          |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| [state-machine.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/state-machine.ts) | 모달 상태기계 (설계 §14)                      |
| [types.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/types.ts)                 | core 어휘 — `KeyToken` · `CoreCommand` intent |
| [keys.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/keys.ts)                   | 키스트로크 정규화 (물리키 / raw 분리)         |
| [visual-state.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/visual-state.ts)   | VisualState 기록 (설계 §6)                    |
| [hangul.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/hangul.ts)               | 한글 find 타겟 매칭 — 초성 검색 (설계 §5)     |

## adapters — core 의 intent 를 PM 위에서 실행

| 파일                                                                                                                            | 무엇                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [execute-command.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/execute-command.ts)         | `CoreCommand` 실행 진입점 (설계 §2)                                                         |
| [motions.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/motions.ts)                         | 모션 해석 — EditorState + 위치 + motion → 목표 위치 (dispatch 는 plugin, 설계 §2)           |
| [operations.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/operations.ts)                   | 줄·문자 오퍼레이션 d/c/y (설계 §9)                                                          |
| [line-units.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/line-units.ts)                   | "줄이란 무엇인가" (설계 §9)                                                                 |
| [cursor-line-columns.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/cursor-line-columns.ts) | 커서 줄의 컬럼 프리미티브                                                                   |
| [cursor-selection.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/cursor-selection.ts)       | normal 모드 커서 위치를 PM selection 으로 바꾸는 **유일한 곳** (visual·편집 후 착지는 따로) |
| [graphemes.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/graphemes.ts)                     | 커서 단위 — grapheme 경계 (설계 §6)                                                         |
| [search.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/search.ts)                           | `/` 검색 어댑터 (#372)                                                                      |
| [register.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/register.ts)                       | vim register (설계 §6)                                                                      |
| [paste.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/paste.ts)                             | paste — register · 예산 (설계 §6/§9)                                                        |
| [atom-insert.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/atom-insert.ts)                 | atom 위 insert 진입 프리플라이트                                                            |
| [insert-entry.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/insert-entry.ts)               | PM insert 모드 화살표로 코드블록 island 진입 (#477)                                         |
| [code-block-landing.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/code-block-landing.ts)   | 코드블록 진입 착지 정책                                                                     |
| [esc-arbitration.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/esc-arbitration.ts)         | insert-Esc 중재 (설계 §4/§5c)                                                               |
| [scroll.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/scroll.ts)                           | z 계열 스크롤 + 커서 팔로우                                                                 |
| [suspension.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/suspension.ts)                   | 입력 섬 판정 + island 라벨 (설계 §4)                                                        |

## 루트와 렌더 — 플러그인 본체 · 배선 · 커서 CSS

| 파일                                                                                                                         | 무엇                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [index.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/index.ts)                                   | 항상 설치되는 Extension — priority 10000 (설계 §2/§7)                            |
| [vim-plugin.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-plugin.ts)                         | PM Plugin 본체 (설계 §2/§3/§4/§5)                                                |
| [vim-plugin-state.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-plugin-state.ts)             | 플러그인 상태 — 무의존 leaf (PR #491 분리)                                       |
| [vim-island-sync.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-island-sync.ts)               | PluginView 생애주기 (PR #491 분리)                                               |
| [vim-selection-commands.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-selection-commands.ts) | selection 커맨드 — `dispatchCursor` 의 집 (PR #491 분리)                         |
| [vim-keys.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-keys.ts)                             | PluginKey · 모달 상태 질의 · 외부편집 태깅 `chainWithVimExternalEdit`            |
| [vim-status.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-status.ts)                         | 상태 피드 arbitration (설계 §8)                                                  |
| [vim-lifecycle.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-lifecycle.ts)                   | 설정 토글 배선 (설계 §7)                                                         |
| [vim-activation.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-activation.ts)                 | 문서 활성화 경계 — 탭 전환 리셋                                                  |
| [vim-search-line.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-search-line.ts)               | StatusBar input ↔ core 배선 (IME 정공법)                                         |
| [replace-editor-state.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/replace-editor-state.ts)     | EditorState 전체 교체의 관문 — 전 호출부가 여기를 지난다(관례이고 게이트는 없다) |
| [vim.css](https://github.com/sayinel/baram/blob/main/src/styles/vim.css)                                                     | WYSIWYG 블록 커서 렌더 (설계 §10) — normal 모드 데코레이션 · 비활성 창 hollow    |

## CM 표면 — source mode · 코드블록 island

WYSIWYG 이 자체 엔진인 반면 이쪽은 `@replit/codemirror-vim` 어댑터다 ([Overview](Vim-Overview) 참조).
위의 세 절과 같이 **게이트가 전수로 지킨다** — 이름이 vim 인 파일이 `src/` 어디에 생겨도 잡힌다(`src/spike/` 프로브는 제외).

| 파일                                                                                                                       | 무엇                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [vim-mode.ts](https://github.com/sayinel/baram/blob/main/src/components/editor/vim-mode.ts)                                | 어댑터 설치 — 동적 import · 모듈 캐시                         |
| [vim-controller.ts](https://github.com/sayinel/baram/blob/main/src/components/editor/vim-controller.ts)                    | CM 쪽 모드 배선과 상태 보고                                   |
| [vim-ime-guard.ts](https://github.com/sayinel/baram/blob/main/src/components/editor/vim-ime-guard.ts)                      | CM 표면의 IME 가드 (`beforeinput` 취소)                       |
| [vim-code-block-boundary.ts](https://github.com/sayinel/baram/blob/main/src/components/editor/vim-code-block-boundary.ts)  | 코드블록 경계 — Esc 계단 · 경계 j/k                           |
| [code-block-vim-island.ts](https://github.com/sayinel/baram/blob/main/src/extensions/nodes/views/code-block-vim-island.ts) | 섬 배선 — 동기 editing-host 장벽 · PM↔CM 핸드오프 · 상태 피드 |
| [vim-island-markers.ts](https://github.com/sayinel/baram/blob/main/src/utils/vim-island-markers.ts)                        | 마커 상수 leaf — sanitizer 와 공용 (설계 §4)                  |
| [VimSearchInput.tsx](https://github.com/sayinel/baram/blob/main/src/components/layout/VimSearchInput.tsx)                  | 검색 input — IME 목적지                                       |

## vim 디렉터리 밖 — vim 이 의존하는 공용 파일

**위의 네 절과 성격이 다르다.** 위는 게이트가 **전수**로 지켜서 파일이 늘면 지도가 빨간불을
내지만, 이 절은 **사람이 고른 목록**이고 게이트는 링크가 살아 있는지만 본다. 전수를 걸 수 없는
이유는 이 파일들이 사는 디렉터리가 vim 소유가 아니기 때문이다.

즉 **여기 없다고 해서 vim 과 무관하다는 뜻이 아니다.** 어떤 페이지가 이름 붙여 설명하는 동작의
집이 여기 없으면, 그건 빠진 것이다 — 행을 더할 것.

| 파일                                                                                                                           | 무엇                                                            |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| [use-source-mode.ts](https://github.com/sayinel/baram/blob/main/src/hooks/use-source-mode.ts)                                  | source mode 복귀 — churn 방어 4번이 사는 곳 (양 브랜치)         |
| [focus-editor-view.ts](https://github.com/sayinel/baram/blob/main/src/utils/editor/focus-editor-view.ts)                       | editable 게이트 폴백 — non-editable 뷰에서 `focus()` 가 no-op   |
| [code-block-cm-registry.ts](https://github.com/sayinel/baram/blob/main/src/extensions/nodes/views/code-block-cm-registry.ts)   | leaf 채널 — editable 브로드캐스트 · vim on/off · entry 핸드오프 |
| [use-atom-block-behavior.ts](https://github.com/sayinel/baram/blob/main/src/extensions/nodes/views/use-atom-block-behavior.ts) | 모든 atom 블록 뷰의 공유 경계 동작                              |
| [StatusBar.tsx](https://github.com/sayinel/baram/blob/main/src/components/layout/StatusBar.tsx)                                | 모드 · 명령 · island 라벨 렌더                                  |

테스트는 각 모듈 옆 `__tests__/` 에 있다 — vim 테스트는 위 디렉터리들 각각의 `__tests__/` 에
흩어져 있다(`extensions/plugins/vim/` · `components/editor/` · `extensions/` · `nodes/views/` ·
`hooks/` · `stores/`). 이 지도는 프로덕션 파일만 다룬다.
