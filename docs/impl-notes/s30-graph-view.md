# §30 그래프 뷰 — 구현 노트

## Requirements (설계서에서 추출)

- Part 8 §8.1: "58. 그래프 뷰 ← M10" (원래 Phase 3이지만, M7에서 선행 구현)
- Part 8 §8.6: "그래프 뷰 (링크 인덱스만 필요 — M7에서 완료)" → 독립 작업 가능
- Part 2: "D3.js 기반 문서 간 연결 시각화. Phase 3 플러그인으로 구현"
- Part 5 §5.6: 백링크 인덱스 구조 — `graph: Map<FilePath, LinkInfo>`, outgoing/incoming links
- Obsidian 참조: 노드-엣지 네트워크, 줌/패닝, 노드 클릭 → 파일 열기, 현재 파일 하이라이트

## Dependencies (의존하는 모듈)

- **cytoscape.js v3.33.1** — 이미 mermaid 의존성으로 node_modules에 존재. 추가 설치 불필요
- **Rust LinkIndex** (`src-tauri/src/index/mod.rs`) — `get_link_graph()` → `LinkGraph { nodes, edges }`
- **IPC** `getLinkIndex()` → `Promise<LinkGraph>` — 이미 구현됨
- **useLinkStore** — `indexVersion` 으로 그래프 갱신 트리거
- **useUIStore** — `sidebarPanel` 에 "graph" 추가
- **ActivityBar** + **Sidebar** — 그래프 패널 탭 추가

## Technical Challenges

1. **대형 Vault 성능**: 1000+ 노드일 때 레이아웃 계산 비용 → cytoscape `cose` 레이아웃 사용 (O(n log n))
2. **실시간 갱신**: 파일 저장 시 인덱스 변경 → 그래프 증분 업데이트 (전체 재렌더링 방지)
3. **현재 파일 하이라이트**: 에디터 탭 전환 시 그래프에서 현재 노드 강조
4. **파일명 표시**: 전체 경로 대신 파일명만 표시, 긴 이름 truncate

## Edge Cases

- 빈 Vault (노드 0개): 빈 상태 메시지 표시
- 고립 노드 (링크 없음): 표시하되 회색/작게
- 자기 참조 (self-loop): edge 표시 가능하나 레이아웃에서 충돌 방지
- Vault 미열기 상태 (rootPath null): "폴더를 열어주세요" 안내

## Files to Create/Modify

| # | 파일 | 동작 | 설명 |
|---|------|------|------|
| 1 | `src/components/sidebar/GraphView.tsx` | CREATE | 그래프 뷰 컴포넌트 (cytoscape 렌더링) |
| 2 | `src/components/sidebar/graph-utils.ts` | CREATE | 그래프 데이터 변환 유틸 |
| 3 | `src/components/sidebar/__tests__/graph-view.test.ts` | CREATE | 유틸 테스트 |
| 4 | `src/stores/ui-store.ts` | MODIFY | SidebarPanel에 "graph" 추가 |
| 5 | `src/components/layout/ActivityBar.tsx` | MODIFY | 그래프 아이콘 탭 추가 |
| 6 | `src/components/layout/Sidebar.tsx` | MODIFY | GraphView 렌더링 추가 |
| 7 | `src/App.css` | MODIFY | 그래프 뷰 스타일 추가 |

## Implementation Order

1. 유틸 함수 (`graph-utils.ts`): LinkGraph → cytoscape elements 변환
2. 테스트 작성 (Red)
3. GraphView 컴포넌트 구현
4. UI 통합 (ui-store, ActivityBar, Sidebar)
5. CSS 스타일링
6. 전체 테스트 통과 확인 (Green)
