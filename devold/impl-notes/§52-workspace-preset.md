# §52 Workspace 프리셋 — 구현 노트

## Requirements (설계서에서 추출)

### §4.3 — 3종 기본 프리셋
| 프리셋 | 좌 사이드바 | 에디터 | 우 사이드바 | 추가 |
|--------|-----------|--------|-----------|------|
| **글쓰기** (Writing) | 숨김 | 전체 화면 | 숨김 | Focus Mode ON |
| **Skills 편집** (Skills) | 파일 트리 | 에디터 | AI 채팅 | Skills Extension ON |
| **리서치** (Research) | 파일 트리 | 에디터 | AI 채팅 | AI Extension ON |

### §4.6 — 단축키
| 기능 | macOS | Windows/Linux |
|------|-------|---------------|
| Workspace: 글쓰기 | ⌥⌘1 | Ctrl+Alt+1 |
| Workspace: Skills | ⌥⌘2 | Ctrl+Alt+2 |
| Workspace: 리서치 | ⌥⌘3 | Ctrl+Alt+3 |

### 추가 요구사항
- 커맨드 팔레트에서 "workspace" 검색으로 전환
- 사용자 커스텀 프리셋 저장 가능

## Dependencies (의존하는 모듈)
- `ui-store.ts` — sidebarOpen, sidebarPanel, rightPanelOpen, rightPanelMode
- `settings-store.ts` — tauriStorage persistence 패턴 참조
- `CommandPalette.tsx` — 커맨드 등록
- `SettingsModal.tsx` — 탭 추가
- `App.tsx` — 키보드 단축키

## Technical Challenges
1. "Focus Mode"는 현재 미구현 — Writing 프리셋에서는 양쪽 사이드바 숨김으로 대체
2. Right panel에 "backlinks" 모드는 현재 없음 — "chat" 모드로 대체
3. 커스텀 프리셋 저장 시 현재 UI 상태를 스냅샷

## Edge Cases
- 프리셋 적용 시 이미 같은 상태면 무시 (불필요한 리렌더링 방지)
- 커스텀 프리셋 이름 중복 방지
- 빌트인 프리셋은 삭제/수정 불가
- 빌트인 프리셋 3개 + 커스텀 프리셋 N개 지원

## Files to Create/Modify

### 생성
| 파일 | 목적 |
|------|------|
| `src/stores/workspace-store.ts` | Zustand 스토어 (프리셋 CRUD + apply) |
| `src/stores/__tests__/workspace-store.test.ts` | 스토어 단위 테스트 |
| `src/components/settings/WorkspaceTab.tsx` | 설정 모달 Workspace 탭 |

### 수정
| 파일 | 변경 |
|------|------|
| `src/components/settings/SettingsModal.tsx` | Workspace 탭 추가 |
| `src/components/command/CommandPalette.tsx` | workspace 커맨드 추가 |
| `src/App.tsx` | Cmd+Alt+1/2/3 단축키 |
| `src/App.css` | WorkspaceTab 스타일 |
| `docs/keyboard-shortcuts.md` | 단축키 문서 |

## Implementation Order
1. workspace-store.ts + 테스트 (스토어 + 빌트인 프리셋 정의)
2. WorkspaceTab.tsx (설정 UI)
3. SettingsModal.tsx 수정 (탭 추가)
4. CommandPalette.tsx (커맨드 추가)
5. App.tsx (단축키)
6. App.css (스타일)
7. keyboard-shortcuts.md (문서)
8. progress.json (진행 상황)
