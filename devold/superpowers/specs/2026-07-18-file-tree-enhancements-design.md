# 파일 트리 개선 설계서 (§4.3 확장)

- 날짜: 2026-07-18
- 상태: 확정 (사용자 승인 완료)
- 브랜치(예정): `feature/file-tree-enhancements` (PR 단계별 서브 브랜치)
- 관련 설계 문서: part4 §4.3 (사이드바/파일 트리), part5 §5.1 (파일 시스템), §67 (Git), §71 (스냅샷), §33 (rename+위키링크 동기화)
- 배경: 파일 트리는 단일 선택 + 4개 액션(새 파일/새 폴더/이름 변경/삭제) 수준에 머물러 있다. Obsidian/VSCode 수준의 다중 선택, 풍부한 컨텍스트 메뉴, 키보드 내비게이션, 안전한 삭제(휴지통)를 도입한다.

## 1. 문제 정의 (사용자 요구)

1. **다중 선택 부재**: 파일을 복수 선택할 수 없어 일괄 이동/삭제/복제가 불가능하다.
2. **컨텍스트 메뉴 빈약**: 우클릭 메뉴가 4개 액션뿐. 경로 복사, 위키링크 복사, 복제, Finder 열기, 내보내기 등 표준 기능이 없다.
3. **영구 삭제 위험**: 삭제가 `std::fs::remove_file`로 즉시 영구 삭제된다 (확인 다이얼로그만 존재). 일괄 삭제 도입 시 실수 비용이 커진다.
4. **키보드 내비게이션 부재**: 화살표 이동/펼침/접기가 없다 (F2, Cmd+Delete만 존재).
5. **트리 편의 기능 부족**: 정렬 옵션, 모두 접기, 활성 파일 자동 reveal, git 상태 표시가 없다.

## 2. 현재 구현 요약 (As-Is)

| 항목 | 현재 상태 | 위치 |
|---|---|---|
| 컴포넌트 | FileTree.tsx 476줄 + FileTreeNode.tsx 249줄 + 훅 4개(598줄) | `src/components/sidebar/` |
| 선택 | `selectedPath: string \| null` — 단일 선택만 | FileTree.tsx:58 |
| 컨텍스트 메뉴 | plain div, 4개 액션 (New File/New Folder/Rename/Delete) | FileTree.tsx:430–472 |
| DnD | 커스텀 구현(WKWebView 제약), 파일 이동 + 폴더 자동 펼침 + 에디터 링크 삽입 | hooks/use-file-tree-dnd.ts (248줄) |
| 삭제 | showConfirm → `delete_file`/`delete_dir` → **영구 삭제** | use-file-tree-crud.ts:39–65, src-tauri/src/fs/mod.rs:208 |
| 키보드 | F2(rename), Cmd+Delete(삭제), Enter/Escape(인라인 입력) — 화살표 없음 | FileTree.tsx:130–141 |
| 정렬 | 폴더 우선 + `localeCompare` 하드코딩 | src/stores/file/file.ts:136–139 |
| 검색/필터 | 검색 입력 + 태그 필터 뱃지 | use-file-tree-search.ts |
| git | per-file `GitChange[]` (path/staged/status)가 store에 이미 존재, 트리 표시 없음 | src/stores/system/git.ts |
| 내보내기 | 활성 에디터 전용 (`exportAsHTML(editor, …)` 등), Command Palette로 트리거 | src/utils/export/export.ts |
| 스냅샷 | VersionHistoryPanel(vault 단위), `loadFileHistory(vaultPath, filePath)` 존재하나 UI 미노출 | src/stores/editor/snapshot.ts |
| opener | `tauri-plugin-opener` v2 설치됨 — URL 열기만 사용, `revealItemInDir` 미사용 | src-tauri/Cargo.toml:18 |

## 3. 핵심 아키텍처 결정

1. **선택 상태는 신규 훅으로 분리** — `hooks/use-file-tree-selection.ts`. FileTree.tsx(476줄)에 추가하지 않고 분리해 300줄 컨벤션을 지킨다.
   - 상태: `selectedPaths: Set<string>`, `anchorPath: string | null`(Shift 범위 기준점), `focusedPath: string | null`(키보드 포커스).
   - 컴포넌트 로컬(훅) 유지 — 다른 컴포넌트가 선택 상태를 소비하지 않으므로 store 승격은 YAGNI.
2. **visible list(평탄화된 가시 노드 순서)를 단일 소스로 계산** — Shift 범위 선택과 키보드 ↑/↓가 공유. 펼쳐진 폴더 + 검색/태그 필터 통과 노드만 포함. `file-tree-visible.ts` 유틸(순수 함수)로 두고 단위 테스트.
3. **컨텍스트 메뉴는 신규 컴포넌트로 분리** — `file-tree-context-menu.tsx`. 에디터용 `toolbar/ContextMenu.tsx`는 `editor: Editor` 결합이라 재사용하지 않되, 시각 스타일(CSS 클래스)은 공유한다.
4. **휴지통은 기존 커맨드의 의미 변경** — `delete_file`/`delete_dir` 내부를 `trash` crate 호출로 교체. 시그니처 불변 → 모든 호출자(트리 외 포함)가 자동으로 안전해진다. 신규 커맨드 분리는 하지 않는다(영구 삭제 경로를 남기지 않기 위함).
5. **내보내기는 1차로 "열고 나서 export"** — export 엔진의 에디터 결합 리팩토링을 피하고, 액션 = 탭으로 열기 + `openExportDialog()`. by-path export는 백로그.
6. **git 뱃지는 파생 상태** — `gitStore.changes` → `Map<path, status>` 셀렉터. 트리는 렌더만 하고 폴링/새로고침 로직은 store 측(파일 저장·watcher 이벤트에 디바운스)에 둔다.

## 4. 상세 설계

### 4.1 선택 모델 (멀티 셀렉트)

- **일반 클릭**: 단일 선택(Set 초기화 후 1개) + 탭 열기(기존 동작 유지). anchor = 클릭 노드.
- **Cmd+클릭**: 해당 노드 토글. 탭은 열지 않는다. anchor = 마지막 토글 노드.
- **Shift+클릭**: anchor부터 클릭 노드까지 visible list 순서 기준 범위 선택(교체). 탭은 열지 않는다.
- 폴더+파일 혼합 선택 허용. 조상-자손이 동시 선택된 경우 일괄 작업 시 자손을 제외(중복 이동/삭제 방지) — `pruneNestedPaths()` 유틸.
- 탭 전환(외부 요인)으로 활성 파일이 바뀌면 단일 선택으로 리셋(기존 FileTree.tsx:96–128 구독 확장).
- **DnD**: 드래그 시작 노드가 선택에 포함되면 선택 전체가 이동 대상(고스트에 "N items"), 선택 밖이면 그 노드만. 드롭 시 `moveFileEntry`를 항목별 순차 호출, 실패 항목은 토스트로 보고하고 나머지는 계속.
- **일괄 삭제**: 확인 다이얼로그 1회 — "N개 항목을 휴지통으로 이동하시겠습니까?" (폴더 포함 시 명시).

### 4.2 휴지통 삭제

- Rust: `trash = "5"` crate 추가. `fs/mod.rs`의 delete 구현을 `trash::delete(path)`로 교체. 실패 시(권한/네트워크 드라이브 등) 에러를 그대로 반환 — 영구 삭제로 폴백하지 않는다(안전 우선).
- 프론트: 확인 다이얼로그 문구 "휴지통으로 이동" 계열로 변경. 다이얼로그는 유지.
- 테스트: Rust 단위 테스트는 tempdir 파일에 대해 trash 호출 결과(파일 부재)를 검증하되, CI 샌드박스에서 휴지통 미지원 환경이면 `#[ignore]` 처리하고 로컬 검증 절차를 PR에 기록.

### 4.3 컨텍스트 메뉴

단일 파일 대상:

```
새 탭에서 열기
─────────────
복제
이동...
이름 변경          F2
삭제               ⌘⌫   (danger)
─────────────
경로 복사
상대 경로 복사
위키링크로 복사
─────────────
Finder에서 보기
내보내기...
버전 히스토리
```

- 폴더 대상: 상단에 기존 "새 파일 / 새 폴더" 유지, "새 탭에서 열기·내보내기·버전 히스토리" 제외.
- 빈 영역: 기존대로 "새 파일 / 새 폴더"만.
- **다중 선택 대상**(우클릭한 노드가 선택에 포함될 때): `복제 / 이동... / 삭제 / 경로 복사(N줄)` 축소 세트. 복제는 파일만 지원하므로 선택에 폴더가 포함되면 복제 항목을 비활성화한다. 우클릭 노드가 선택 밖이면 단일 선택으로 전환 후 단일 메뉴.
- 액션 구현:
  - **복제**: `copyFile(src, src의 "name copy.ext")` — 충돌 시 "name copy 2.ext" 순번. 폴더 복제는 재귀 복사가 IPC에 없으므로 **파일만 지원**, 폴더 대상에선 비노출.
  - **이동...**: 경량 폴더 선택 모달(vault 내 폴더 트리, 검색 입력 포함) → `moveFileEntry` 재사용. 다중 선택 시 전체 이동.
  - **경로 복사 / 상대 경로 복사**: 절대 경로 / vault 루트 기준 상대 경로를 클립보드로.
  - **위키링크로 복사**: `[[파일명(확장자 제외)]]` — 기존 위키링크 resolver의 파일명 규칙을 따르고, 동명 파일 존재 시 vault-상대 경로 포함 형태로 복사.
  - **Finder에서 보기**: `revealItemInDir(path)` (`@tauri-apps/plugin-opener`) + capability에 `opener:allow-reveal-item-in-dir` 추가. 메뉴 라벨은 플랫폼별 분기(macOS "Finder에서 보기", 그 외 "파일 탐색기에서 보기").
  - **내보내기...**: 파일을 탭으로 연 뒤 `openExportDialog("pdf")`.
  - **버전 히스토리**: snapshot store에 `fileFilter: string | null` 추가 → 우측 패널 VersionHistoryPanel을 열고 해당 파일로 필터(`loadFileHistory` 활용). 필터 해제 UI(뱃지 + x) 포함.

### 4.4 키보드 내비게이션

- `focusedPath` 기반 roving focus. 트리 컨테이너가 포커스를 갖고 keydown 처리(검색 입력·인라인 rename 입력에 포커스가 있으면 무시).
- **↑/↓**: visible list에서 포커스 이동 + 단일 선택도 함께 이동(VSCode 방식). 탭은 열지 않는다.
- **→**: 폴더면 펼침(이미 펼쳐졌으면 첫 자식으로), 파일이면 무시.
- **←**: 폴더가 펼쳐져 있으면 접기, 아니면 부모 폴더로 포커스.
- **Enter**: 파일 열기(탭), 폴더 토글.
- **Shift+↑/↓**: anchor 기준 범위 선택 확장/축소.
- 접근성: `role="tree"` / `role="treeitem"`, `aria-expanded`, `aria-selected`, `aria-level`. 포커스 노드는 `scrollIntoView({ block: "nearest" })`.
- type-ahead는 도입하지 않는다 (기존 검색 입력과 중복, YAGNI).

### 4.5 트리 편의

- **정렬**: 트리 헤더에 정렬 드롭다운 — `이름 ↑ / 이름 ↓ / 수정일 ↑ / 수정일 ↓`. 폴더 우선은 항상 고정. 수정일 정렬을 위해 Rust `list_dir`의 `FileEntry`에 `mtime: Option<u64>` 추가(기존 호출자에 비파괴 — serde 기본값). 설정은 vault 설정(§86 계층)에 `fileTree.sortOrder`로 영속화.
- **모두 접기**: 헤더 아이콘 버튼 → `expandedDirs` 초기화.
- **자동 reveal**: 탭 전환 시 활성 파일의 조상 폴더를 펼치고 `scrollIntoView`. 검색/태그 필터 활성 중엔 필터를 건드리지 않고 스크롤만 시도(노드가 필터에 걸려 안 보이면 무동작).
- **git 뱃지**: 파일 노드 우측에 상태 도트 — M(modified, 노랑 계열 토큰) / U(untracked/added, 초록 계열 토큰). 폴더는 하위에 변경 존재 시 중립 도트. `gitStore.changes` → `Map` 셀렉터(useShallow), 저장·watcher 이벤트 시 디바운스(≥1s) refresh. git 저장소가 아니면 셀렉터가 빈 Map을 반환하고 렌더 비용 0. 색상은 기존 CSS 토큰(`--color-*`)만 사용.

## 5. 구현 단계 (순차 PR)

| PR | 내용 | 크기 |
|---|---|---|
| 1 | 선택 모델 개편(use-file-tree-selection + visible list 유틸) + 멀티 셀렉트 + DnD 다중 이동 + 휴지통 삭제(Rust trash) + 일괄 삭제 | 大 |
| 2 | 컨텍스트 메뉴 분리·확장(12 액션) + 이동 모달 + 스냅샷 파일 필터 + opener capability | 大 |
| 3 | 키보드 내비게이션 + 접근성 role/aria | 中 |
| 4 | 정렬 옵션(list_dir mtime 포함) + 모두 접기 + 자동 reveal | 中 |
| 5 | git 상태 뱃지 | 小 |

각 PR은 독립 배포 가능. 모두 FileTree 주변 동일 파일을 수정하므로 병렬 진행하지 않는다.

## 6. 테스트 전략

- **단위(vitest)**: visible list 계산(펼침/필터 조합), 범위 선택·토글·pruneNestedPaths, 복제 순번 네이밍, 위키링크 라벨 생성, git Map 셀렉터.
- **컴포넌트(vitest + testing-library)**: 컨텍스트 메뉴 조건부 항목(파일/폴더/다중/빈 영역), 액션 디스패치, 키보드 keydown 시나리오.
- **Rust(cargo test)**: trash 삭제(tempdir, CI 미지원 시 `#[ignore]`), `list_dir` mtime 직렬화.
- **수동 GUI**: 휴지통 복구 확인, DnD 다중 드래그 고스트, Finder 열기, reveal 스크롤.
- 에디터 파이프라인을 건드리지 않으므로 라운드트립 영향 없음.

## 7. 리스크 및 완화

| 리스크 | 완화 |
|---|---|
| trash crate가 특정 환경(리눅스 배포판)에서 실패 | 에러 그대로 표면화(폴백 없음), 에러 토스트에 경로 표기 |
| 다중 DnD 중 일부 이동 실패 시 부분 상태 | 항목별 순차 처리 + 실패 목록 토스트, refresh로 트리 재동기화 |
| visible list와 렌더 트리의 순서 불일치 | 단일 유틸을 렌더·선택·키보드 모두가 사용, 단위 테스트로 고정 |
| `list_dir` FileEntry 변경이 기존 소비자 파손 | `Option<u64>` + serde 기본값, TS 타입은 optional 필드 |
| git refresh 과다 호출(대형 vault) | 디바운스 ≥1s + git 저장소 아닐 때 완전 비활성 |

## 8. 백로그 (이번 범위 제외)

- by-path export (엔진의 에디터 결합 해제)
- 폴더 복제(재귀 복사 IPC)
- 즐겨찾기/핀 섹션
- type-ahead 점프
- 삭제 확인 다이얼로그 생략 옵션(설정)
