# Vim Code map

vim 구현의 **파일 경로가 사는 유일한 페이지**다. 다른 페이지는 경로를 적지 않고 여기를 가리킨다.
링크는 `main` 을 가리키므로 파일이 옮겨지면 404 가 된다 — 그리고 리포의 `lint:wiki` 게이트가
그보다 먼저 빨간불을 낸다.

## core — 순수 상태기계 (ProseMirror 무의존)

| 파일                                                                                                            | 무엇                                          |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| [state-machine.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/state-machine.ts) | 모달 상태기계 (설계 §14)                      |
| [types.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/types.ts)                 | core 어휘 — `KeyToken` · `CoreCommand` intent |
| [keys.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/keys.ts)                   | 키스트로크 정규화 (물리키 / raw 분리)         |
| [visual-state.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/visual-state.ts)   | VisualState 기록 (설계 §6)                    |
| [hangul.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/core/hangul.ts)               | 한글 find 타겟 매칭 — 초성 검색 (설계 §5)     |

## adapters — core 의 intent 를 PM 위에서 실행

| 파일                                                                                                                            | 무엇                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [execute-command.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/execute-command.ts)         | `CoreCommand` 실행 진입점 (설계 §2)                    |
| [motions.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/motions.ts)                         | 모션                                                   |
| [operations.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/operations.ts)                   | 줄·문자 오퍼레이션 d/c/y (설계 §9)                     |
| [line-units.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/line-units.ts)                   | "줄이란 무엇인가" (설계 §9)                            |
| [cursor-line-columns.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/cursor-line-columns.ts) | 커서 줄의 컬럼 프리미티브                              |
| [cursor-selection.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/cursor-selection.ts)       | vim 커서 위치를 PM selection 으로 바꾸는 **유일한 곳** |
| [graphemes.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/graphemes.ts)                     | 커서 단위 — grapheme 경계 (설계 §6)                    |
| [search.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/search.ts)                           | `/` 검색 어댑터 (#372)                                 |
| [register.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/register.ts)                       | vim register (설계 §6)                                 |
| [paste.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/paste.ts)                             | paste — register · 예산 (설계 §6/§9)                   |
| [atom-insert.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/atom-insert.ts)                 | atom 위 insert 진입 프리플라이트                       |
| [insert-entry.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/insert-entry.ts)               | PM insert 모드 화살표로 코드블록 island 진입 (#477)    |
| [code-block-landing.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/code-block-landing.ts)   | 코드블록 진입 착지 정책                                |
| [esc-arbitration.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/esc-arbitration.ts)         | insert-Esc 중재 (설계 §4/§5)                           |
| [scroll.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/scroll.ts)                           | z 계열 스크롤 + 커서 팔로우                            |
| [suspension.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/adapters/suspension.ts)                   | 입력 섬 판정 + island 라벨 (설계 §4)                   |

## 루트 — 플러그인 본체와 배선

| 파일                                                                                                                         | 무엇                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [index.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/index.ts)                                   | 항상 설치되는 Extension — priority 10000 (설계 §2/§7)                 |
| [vim-plugin.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-plugin.ts)                         | PM Plugin 본체 (설계 §2/§3/§4/§5)                                     |
| [vim-plugin-state.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-plugin-state.ts)             | 플러그인 상태 — 무의존 leaf (PR #490 분리)                            |
| [vim-island-sync.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-island-sync.ts)               | PluginView 생애주기 (PR #490 분리)                                    |
| [vim-selection-commands.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-selection-commands.ts) | selection 커맨드 — `dispatchCursor` 의 집 (PR #490 분리)              |
| [vim-keys.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-keys.ts)                             | PluginKey · 모달 상태 질의 · 외부편집 태깅 `chainWithVimExternalEdit` |
| [vim-status.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-status.ts)                         | 상태 피드 arbitration (설계 §8)                                       |
| [vim-lifecycle.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-lifecycle.ts)                   | 설정 토글 배선 (설계 §7)                                              |
| [vim-activation.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-activation.ts)                 | 문서 활성화 경계 — 탭 전환 리셋                                       |
| [vim-search-line.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/vim-search-line.ts)               | StatusBar input ↔ core 배선 (IME 정공법)                              |
| [replace-editor-state.ts](https://github.com/sayinel/baram/blob/main/src/extensions/plugins/vim/replace-editor-state.ts)     | EditorState 전체 교체의 **유일한 관문**                               |

테스트는 각 모듈 옆 `__tests__/` 에 있다 (이 지도는 프로덕션 파일만 다룬다).
