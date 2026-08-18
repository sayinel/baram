# Graph View Enhancement — P0/P1 구현 노트

## 구현 완료 (2026-02-22)

### 변경 파일

| # | 파일 | 액션 | 설명 |
|---|------|------|------|
| 1 | `src/stores/graph-settings-store.ts` | NEW | Filters/Display/Forces 설정 Zustand 스토어 |
| 2 | `src/components/sidebar/graph-utils.ts` | MODIFY | `matchesFilter()` + ghost 노드 생성 |
| 3 | `src/components/sidebar/GraphView.tsx` | MODIFY | fcose 레이아웃, 호버/드래그/필터/줌 라벨 fade |
| 4 | `src/components/sidebar/GraphSettingsPanel.tsx` | NEW | 인라인 설정 패널 (Filters/Display/Forces) |
| 5 | `src/App.css` | MODIFY | 설정 패널 CSS, 토글 스위치, ghost 노드 스타일 |
| 6 | `src/components/sidebar/__tests__/graph-view.test.ts` | MODIFY | matchesFilter + ghost 노드 테스트 추가 |
| 7 | `src/vite-env.d.ts` | MODIFY | cytoscape-fcose 모듈 타입 선언 |

### P0-1: Force-directed 물리

- `cytoscape-fcose` 등록 (모듈 레벨 `cytoscape.use(fcose)`)
- `buildLayoutOptions()` 헬퍼 — 설정 스토어 값을 fcose 파라미터로 변환
- 드래그 후 `free` 이벤트에서 `fixedNodeConstraint`로 드래그한 노드 고정 + 나머지 재배치
- Force 설정 변경 시 `randomize: false, animate: true, fit: false`로 부드러운 전환

### P0-2: 호버 하이라이트

- `mouseover`: 전체 `.faded` → 호버 노드/이웃 `.faded` 제거 + `.hover`/`.hover-neighbor`/`.hover-edge` 추가
- `mouseout`: 모든 hover/fade 클래스 제거
- CSS transition 150ms로 부드러운 전환

### P1-3: 설정 패널

- `GraphSettingsPanel` — absolute 오버레이, 톱니바퀴 버튼 토글
- 3섹션: Filters (search + toggle), Display (slider + toggle), Forces (slider)
- 접히는 disclosure 패턴, 로컬 ToggleRow/SliderRow 컴포넌트

### P1-4: 필터 시스템

- searchQuery: `matchesFilter()` 대소문자 무시 substring
- showOrphans: `node.degree() === 0` 기반
- existingFilesOnly: `isGhost` data 속성 기반
- 필터된 노드 `display: none` + 연결 엣지 자동 숨김

### Ghost 노드

- `toGraphElements()`에서 엣지 타겟/소스가 `graph.nodes`에 없으면 자동 생성
- `isGhost: true` data 속성 → Cytoscape `node[?isGhost]` 셀렉터로 dashed border 스타일
- 클릭 시 파일 열기 방지 (`handleNodeTap`에서 isGhost 체크)

### 줌 라벨 페이드

- `zoom` 이벤트에서 `textFadeThreshold` 미만이면 `.labels-hidden` 클래스 → `text-opacity: 0`

### 동적 스타일

- `buildGraphStyle(settings)` — linkThickness, showArrows에 따라 StylesheetStyle[] 동적 생성
- 설정 변경 시 `cy.style().fromJson(...).update()`

### useEffect 구조 (7 + 3 = 10개)

1. `[]` — Cytoscape 인스턴스 생성
2. `[rootPath, indexVersion]` — IPC fetch + 초기 레이아웃
3. `[forces 4개]` — Force 설정 변경 시 재레이아웃
4. `[forces 4개]` — `free` 이벤트 바인딩
5. `[]` — 호버 이벤트
6. `[activeFilePath, nodeCount]` — 활성 파일 하이라이트
7. `[searchQuery, showOrphans, existingFilesOnly, nodeCount]` — 필터 적용
8. `[linkThickness, showArrows]` — 동적 스타일 업데이트
9. `[settingsNodeSize]` — 노드 크기 업데이트
10. `[textFadeThreshold]` — 줌 라벨 페이드

### 테스트 결과

- 22 tests pass (5 displayName + 3 matchesFilter + 10 toGraphElements + 4 nodeSize)
- TypeScript: clean compilation
