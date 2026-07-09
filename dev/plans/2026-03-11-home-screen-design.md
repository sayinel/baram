# Home Screen + Close Folder Design

## 배경

Welcome 모달을 끄면 빈 에디터에 placeholder가 보여 파일이 없는데도 작성 가능한 것처럼 보이는 UX 문제.
앱 시작 화면을 상태 기반으로 재설계하고, 폴더 닫기 기능을 추가한다.

## 화면 상태 모델

| 상태 | 조건 | 표시 |
|------|------|------|
| **홈 화면** | `rootPath === null && !activeTabId` | 최근 폴더/파일 + 액션 버튼 |
| **빈 워크스페이스** | `rootPath !== null && !activeTabId` | "파일을 열거나 생성하세요" 안내 |
| **에디터** | `activeTabId !== null` | 현재 파일 편집 |

- 기존 `welcomeOpen` 플래그 제거 — 홈 화면은 `rootPath`와 `activeTabId`로 자동 결정
- 기존 Welcome 모달 → HomeScreen 컴포넌트로 대체
- Settings의 "Show Welcome" 옵션 제거

## HomeScreen 컴포넌트

`rootPath === null`일 때 에디터 영역에 인라인 표시:

- Baram 로고/타이틀
- 액션 버튼: Open Folder, Open File, New File
- Recent Folders (최대 5개, 상대 시간 표시)
- Recent Files (최대 10개, 상대 시간 표시)
- Keyboard Shortcuts (Cmd+Shift+O, Cmd+N 등)

## 빈 워크스페이스 상태

`rootPath !== null && !activeTabId`일 때:

- 중앙 안내 메시지: "사이드바에서 파일을 선택하거나 Cmd+N으로 새 파일을 생성하세요"

## 폴더 닫기

- 커맨드: `workspace:close-folder`
- 단축키: Command Palette에서 접근
- 동작:
  1. 열린 탭 모두 닫기 (dirty 파일은 저장 확인)
  2. `rootPath = null`, `fileTree = []` 초기화
  3. 자동으로 홈 화면 표시

## onLaunch 구현

현재 Settings UI만 존재하고 미구현. 앱 시작 시:

| 설정값 | 동작 |
|--------|------|
| `restoreLastFolder` | 마지막 rootPath를 settings에 저장 → 시작 시 자동 openFolder() |
| `restoreLastFile` | 마지막 폴더 + 마지막 열린 파일 복원 |
| `newFile` | Untitled 파일 자동 생성 |

`lastOpenedFolder`와 `lastOpenedFile`을 settings-store에 추가하여 persist.

## Recent 목록

settings-store에 persist:

```typescript
recentFolders: { path: string; lastOpened: number }[]  // 최대 5개
recentFiles: { path: string; lastOpened: number }[]    // 최대 10개
```

openFolder() 시 recentFolders 업데이트, 파일 열기 시 recentFiles 업데이트.

## 제거 대상

- `WelcomeScreen.tsx` → `HomeScreen.tsx`로 대체
- `welcomeOpen` (ui-store) → 삭제
- `showWelcome` (settings-store) → 삭제
- `dismissWelcome()` → 삭제
- Settings General 탭의 "Show Welcome" 토글 → 삭제
- `onFinishHydration` welcomeOpen 동기화 코드 → 삭제

## 영향 파일

- `src/components/onboarding/WelcomeScreen.tsx` → 삭제, `src/components/onboarding/HomeScreen.tsx` 생성
- `src/App.tsx` — 렌더링 분기 변경, onLaunch useEffect 추가
- `src/stores/ui-store.ts` — welcomeOpen/dismissWelcome 제거
- `src/stores/settings-store.ts` — showWelcome 제거, recentFolders/recentFiles/lastOpenedFolder/lastOpenedFile 추가
- `src/stores/file-store.ts` — closeFolder() 추가
- `src/stores/editor-store.ts` — closeAllTabs() 추가
- `src/components/settings/SettingsModal.tsx` — "Show Welcome" 토글 제거
- `src/components/command/CommandPalette.tsx` — workspace:close-folder 커맨드 추가
- `src/i18n/en.json`, `src/i18n/ko.json` — 신규 i18n 키 추가
- `src/App.css` — HomeScreen, EmptyWorkspace 스타일
