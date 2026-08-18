# 최근 오픈 폴더/파일 메뉴 노출 — 설계 문서

- **날짜**: 2026-07-09
- **브랜치**: `feature/recent-items-menu`
- **상태**: 설계 승인됨 (구현 플랜 작성 대기)
- **관련 설계 섹션**: §4.3 (Command/메뉴), §81 (워크스페이스), §89 (파일 열기), §90 (앱 시작)

## 1. 배경 및 문제

앱에는 이미 최근 오픈 데이터가 쌓이고 영속화되고 있으나, **홈 화면(HomeScreen, 빈 화면)에서만** 노출된다. 이미 vault/폴더가 열린 상태에서는 최근 항목에 빠르게 접근할 방법이 없다.

기존 자산 (재사용):

- `src/stores/settings/general-settings.ts` — `recentFiles`(최대 10), `recentFolders`(최대 5), `lastOpenedFile`, `lastOpenedFolder` 상태 + `addRecentFile`/`addRecentFolder` 액션.
- 영속화: Zustand `persist` (`baram:settings`, version 15) → `tauriStorage` → Rust `config.json`. `recentFolders`/`recentFiles`는 이미 `partialize`에 포함.
- 데이터 기록 지점: `openFolder`/`addFolder`(file.ts), `handleOpenFilePath`(use-file-operations.ts)가 오픈 시 `addRecent*` 호출.
- 소비 UI: `HomeScreen.tsx`가 recentFolders/recentFiles를 카드 리스트로 렌더링.
- 토스트: `useUIStore.getState().showToast(message)` (자동 소멸).
- Vault 판별: 오픈 시점에 `getVaultConfigByPath()`로 이미 vault 여부 감지. 인메모리 `useContextStore.vaultContexts()`.

## 2. 목표 / 범위

### 이번 단계 (Phase 1)

Vault Tab '+' 드롭다운(`ContextAddMenu`)에 **최근 폴더 / 최근 파일** 섹션을 추가하여, 열린 상태에서도 최근 항목을 열 수 있게 한다.

확정된 결정 사항:

1. **노출 대상**: Vault Tab '+' 메뉴 (`ContextAddMenu`). 프론트엔드만.
2. **통합 리스트**: 폴더와 vault를 하나의 "최근 폴더" 목록에 함께 표시하되 **vault 뱃지**로 구분.
3. **유효하지 않은 경로**: 클릭 시 오픈을 시도하고, 실패하면 **목록에서 자동 제거 + 토스트**. 렌더 시 fs 존재 체크 없음.
4. **Vault 뱃지 포함**: 닫힌 vault도 정확히 표시되도록 최근 폴더 항목에 선택적 `isVault` 플래그 저장.
5. **'최근 항목 지우기' 포함**: 최근 목록을 비우는 액션 제공.

### 명시적 비범위 (후속 단계)

- 네이티브 **File 메뉴 'Open Recent'** 서브메뉴 (Rust `Submenu::append/remove` 동적 메뉴 + `update_recent_menu` IPC + `use-menu-event-handler` 이벤트 케이스). 별도 단계로 분리.
- **recent vaults** 별도 슬라이스 — 통합 유지로 보류.
- HomeScreen 리팩토링 — 현 동작 유지.

## 3. 접근 방식

**선택: A — `ContextAddMenu` 확장 + 공유 오픈 훅.**

기존 recents 데이터/스토어를 그대로 재사용하고, 최근 항목 열기 로직(오픈 + 실패 시 자동 제거 + 토스트)을 재사용 가능한 훅으로 추출한다. 후속 File 메뉴 단계에서도 동일 훅을 재사용한다.

대안 및 기각 사유:

- **B (App.tsx 핸들러 prop-drilling)**: ContextTabBar→ContextAddMenu로 2~3단계 prop 전달 필요, 재사용성 낮음. A의 훅이 재사용 불가할 경우의 **폴백**으로만 유지.
- **C (공유 `<RecentList>` 프레젠테이션 컴포넌트)**: HomeScreen(큰 카드)과 '+' 메뉴(컴팩트 드롭다운)의 표현이 달라 프레젠테이션 공유가 부적합. **로직만 공유(A)** 로 대체.

## 4. 상세 설계

### 4.1 스토어 — `src/stores/settings/general-settings.ts`

**타입 변경 (추가 전용, 마이그레이션 불필요):**

- `recentFolders` 항목 타입에 선택적 `isVault?: boolean` 추가.
  - `{ path: string; lastOpened: number; isVault?: boolean }`
  - 기존 영속 데이터의 항목은 `isVault` 부재 → `undefined` → "vault 아님"으로 취급(폴백 별도). optional 필드이므로 `version` 상향/마이그레이션 함수 불필요.

**액션 변경/추가:**

- `addRecentFolder(path: string, isVault?: boolean)` — 시그니처에 `isVault` 추가. 기존 dedup/prepend/`.slice(0,5)`/`lastOpenedFolder` 로직 유지, 항목에 `isVault` 저장. **재추가 시 `isVault` 미전달**이면 dedup으로 제거되는 기존 동일 경로 항목의 `isVault` 값을 승계(정보 손실 방지), 기존 항목도 없으면 `undefined`.
- `removeRecentFolder(path: string)` — 경로 일치 항목 제거 (**신규**).
- `removeRecentFile(path: string)` — 경로 일치 항목 제거 (**신규**).
- `clearRecent()` — `recentFolders`와 `recentFiles`를 모두 `[]`로 초기화 (**신규**). `lastOpened*`는 유지(시작 복원과 무관하게 목록만 비움).

**호출부 갱신 (`isVault` 전달):**

- `src/stores/file/file.ts` — `openFolder`, `addFolder`가 이미 `getVaultConfigByPath` 결과로 vault 여부를 알고 있으므로 `addRecentFolder(path, isVault)` 형태로 전달.
- `src/hooks/use-file-operations.ts` — `addRecentFolder` 호출부는 vault 여부를 모르면 인자 생략(기존 동작 유지). 정확도는 file.ts 경로에서 확보.

### 4.2 공유 훅 — `src/hooks/use-recent-open.ts` (신규)

```
useRecentOpen(): {
  openRecentFolder(path: string): Promise<void>;
  openRecentFile(path: string): Promise<void>;
}
```

- `openRecentFolder(path)`: 기존 폴더 오픈 흐름(`openFolder`/`addFolder`) 호출. 실패 시 `removeRecentFolder(path)` + `showToast(t("recent.notFound", locale))`.
- `openRecentFile(path)`: 기존 파일 오픈 흐름 재사용. 실패 시 `removeRecentFile(path)` + 토스트.
- **구현 주의(플랜에서 확정)**: 파일 오픈의 에디터 탭 생성 로직은 `use-file-operations`의 `handleOpenFilePath`에 있다. 이를 훅에서 깔끔히 재사용 가능한지(컴포넌트 refs/state 의존 여부) 플랜 단계에서 확인한다.
  - 재사용 가능 → 훅에서 직접 호출.
  - 의존성이 얽혀 재사용 곤란 → **접근 B(prop-drill)** 로 폴백하되, 실패 시 자동 제거+토스트 로직은 App.tsx 핸들러 내부에 추가.

### 4.3 UI — `src/components/layout/ContextAddMenu.tsx` 확장

기존 커스텀 드롭다운 구조를 확장한다. recents가 하나라도 있을 때만 구분선/섹션을 렌더링:

```
Open Folder…
Open File…
──────────────
Initialize as Vault…
──────────────            ← recents 존재 시에만
최근 폴더                    ← 섹션 라벨 (muted, 비클릭)
  🗄️ VaultName             ← isVault=true → vault 아이콘
  📁 FolderName             ← 일반 폴더 아이콘 (title=전체 경로)
최근 파일                    ← 섹션 라벨 (muted, 비클릭)
  📄 file.md                ← 최대 5개 표시 (스토어는 10 유지)
──────────────
  최근 항목 지우기            ← clearRecent (muted 액션)
```

- **표시 개수**: 최근 폴더는 스토어 상한(≤5) 전부, 최근 파일은 드롭다운 컴팩트 유지를 위해 상위 **5개**만 표시(스토어는 10 유지).
- **Vault 뱃지 로직**: 항목의 `isVault === true` → vault 아이콘. `isVault` 부재(레거시) → `useContextStore.vaultContexts()`에 경로 매칭되면 vault로 폴백, 아니면 일반 폴더. **렌더 시 fs 체크 없음.**
- **항목 클릭**: `useRecentOpen().openRecentFolder/openRecentFile` 호출 후 메뉴 닫기.
- **인라인 타임스탬프 없음**: 컴팩트 유지. 전체 경로는 hover `title`.
- 아이콘은 프로젝트에서 사용 중인 아이콘 세트(lucide 등, 기존 `ContextAddMenu`가 쓰는 것)와 일치시킨다.

### 4.4 i18n & 스타일

- **신규 i18n 키** (ko/en): `recent.folders`("최근 폴더"/"Recent Folders"), `recent.files`("최근 파일"/"Recent Files"), `recent.clear`("최근 항목 지우기"/"Clear Recent"), `recent.notFound`("경로를 찾을 수 없어 목록에서 제거했습니다"/"Path not found — removed from recents").
- **스타일**: 기존 `ContextAddMenu` 드롭다운 CSS 재사용. 섹션 라벨은 `base.css`의 muted 텍스트 유틸리티 사용. 필요한 최소 규칙만 해당 CSS 모듈에 추가.

## 5. 에러 처리

- 오픈 실패(경로 없음/권한 등) → 토스트 안내 + 목록에서 자동 제거. 정상 오픈 경로에는 영향 없음.
- `clearRecent()`는 즉시 반영(확인 다이얼로그 없음 — 되돌림은 재오픈으로 자연 복구). 필요 시 후속에서 확인 추가 가능.

## 6. 테스트 (Vitest)

- **스토어 단위 테스트** (`general-settings`):
  - `addRecentFolder`가 `isVault` 저장/dedup/상한(5) 유지.
  - `removeRecentFolder`/`removeRecentFile`가 경로 일치 항목만 제거.
  - `clearRecent`가 두 목록을 비우고 `lastOpened*`는 보존.
- **훅/컴포넌트 테스트** (`ContextAddMenu` + `useRecentOpen`):
  - recents 존재 시 섹션/항목 렌더링, vault 뱃지 표시(`isVault` 및 폴백).
  - 항목 클릭 → 오픈 핸들러 호출.
  - IPC/오픈 reject 목킹 → 자동 제거 + `showToast` 호출 검증.

## 7. 영향 파일 요약

| 파일 | 변경 |
| --- | --- |
| `src/stores/settings/general-settings.ts` | `isVault` 필드, `addRecentFolder` 시그니처, `removeRecentFolder`/`removeRecentFile`/`clearRecent` 추가 |
| `src/stores/file/file.ts` | `addRecentFolder(path, isVault)` 전달 |
| `src/hooks/use-recent-open.ts` | 신규 공유 훅 |
| `src/components/layout/ContextAddMenu.tsx` | 최근 섹션/뱃지/클리어 UI |
| i18n 리소스 파일 | `recent.*` 키 추가 |
| 관련 CSS 모듈 | 섹션 라벨 최소 스타일 |
| `__tests__` | 스토어/컴포넌트 테스트 추가 |

## 8. 미해결/검토 요청 사항

- **`handleOpenFilePath` 재사용 가능 여부**: 플랜 단계에서 의존성 확인 후 훅 직접 재사용 vs prop-drill 폴백 확정.
- (없음 — 그 외 결정 완료)
