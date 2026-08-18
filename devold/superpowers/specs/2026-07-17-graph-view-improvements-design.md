# Graph View 개선 설계서 (§30 정립)

- 날짜: 2026-07-17
- 상태: 확정 (리서치 검증 완료 — §9 참조)
- 브랜치(예정): `feature/graph-view-improvements`
- 관련 설계 문서: part12 §87 (cross-vault graph), part10 §61 (네임스페이스 색상), part3 §3.2 (`get_link_index` IPC)
- 배경: 코드가 참조하는 `§30 Graph View`는 지금까지 공식 설계 문서 섹션이 없었다. 본 문서가 §30의 canonical 스펙이 된다.

## 1. 문제 정의 (사용자 요구)

1. **노드 겹침**: 현재 fcose 레이아웃에 충돌 방지(collision) 설정이 전혀 없어 밀집 구간에서 노드가 서로 겹쳐 보인다. → 노드는 겹치면 안 된다.
2. **드래그 물리 부재**: Logseq는 노드 하나를 드래그하면 연결된 노드들이 따라오고, 놓으면 주변 노드까지 자연스럽게 재정렬된다. 현재 Baram은 수제 스프링(1-hop만, 감쇠 상수 하드코딩)으로 어색하게 흉내내고, 놓는 순간 fcose 전체 재실행으로 그래프가 튄다.
3. **기능 격차**: Obsidian/Logseq 대비 부족한 기능·UI를 정리하고, 최신 그래프 기능을 도입한다.

## 2. 현재 구현 요약 (As-Is)

| 항목 | 현재 상태 |
|---|---|
| 렌더링 | Cytoscape.js (canvas), 지연 로드 |
| 레이아웃 | **fcose 배치 실행** (`numIter: 500` 후 정지) — 연속 시뮬레이션 아님 |
| 겹침 방지 | **없음** (nodeRepulsion만 존재) |
| 드래그 | 수제 스프링(1-hop, `SPRING_K=0.06`), 놓으면 fcose 재실행(released 노드 pin) |
| 상호작용 | hover 이웃 하이라이트+dim, 클릭 열기, 활성 파일 추적+센터링, pan/zoom |
| 시각 인코딩 | degree 로그 스케일 크기, 네임스페이스/vault 색상, 태그=다이아몬드, ghost=점선, cross-vault=보라 점선 |
| 설정 | 14개 (Filters/Display/Forces) — **비영속** (재시작 시 초기화) |
| 스코프 | current vault / all vaults (§87). **local(파일 중심 N-hop) 없음** |
| 데이터 | `LinkGraph { nodes: string[], edges: [{from,to,crossVault?}] }` + `tag:` 가상 노드, ghost는 클라이언트 합성 |
| 테스트 | graph-utils 순수 함수만 (컴포넌트/레이아웃/드래그 미테스트) |
| 마운트 | 사이드바 패널 + 에디터 탭(GraphViewTab) 공용 컴포넌트 |
| 파일 | `GraphView.tsx` 약 900줄 (컨벤션 300줄 초과) |

## 3. Obsidian / Logseq 비교

> ✅ = 있음, ⚠️ = 부분적, ❌ = 없음

| 기능 | Obsidian | Logseq | Baram (현재) | Baram (목표) |
|---|---|---|---|---|
| 연속 물리 시뮬레이션 | ✅ (d3-force 물리 + PIXI/WebGL 렌더) | ✅ (Graphology + ForceAtlas2 + pixi-graph-fork) | ❌ (배치 fcose) | ✅ P0 |
| 드래그 시 이웃 추종 + 재정렬 | ✅ | ✅ (alphaTarget reheat) | ⚠️ (1-hop 수제 스프링) | ✅ P0 |
| 노드 겹침 방지 (collide) | ❌ (겹침 허용) | ❌ (겹침 허용) | ❌ | ✅ P0 — **양쪽보다 우위** |
| Forces 슬라이더 | ✅ (4종) | ❌ | ✅ (4종) | ✅ 유지 |
| 검색 필터 | ✅ | ✅ | ✅ | ✅ 유지 |
| 태그 노드/토글 | ✅ | ✅ | ✅ | ✅ 유지 |
| 고아 노드 토글 | ✅ | ✅ | ✅ | ✅ 유지 |
| 로컬 그래프 (파일 중심 N-hop) | ✅ (별도 뷰, depth 슬라이더) | ✅ (페이지 그래프) | ❌ | ✅ P1 |
| hover 이웃 하이라이트/dim | ✅ | ✅ | ✅ | ✅ 유지 |
| 그룹 색상 (쿼리 기반) | ✅ | ❌ | ⚠️ (네임스페이스/vault 자동 색) | ⏸ P2 보류 |
| 설정 영속화 | ✅ | ✅ | ❌ | ✅ P1 |
| 레이아웃 freeze/재가열 | ⚠️ (플러그인) | ❌ | ❌ | ✅ P1 |
| 시간 여행(time-lapse) 애니메이션 | ✅ | ❌ | ❌ | ⏸ P2 보류 |
| 노드 크기 = degree | ✅ | ✅ | ✅ | ✅ 유지 |
| cross-vault 시각화 | ❌ | ❌ | ✅ (§87) | ✅ 유지 — 차별점 |
| 새로고침 시 위치 보존 | ✅ | ✅ | ❌ (인덱스 갱신마다 재배치) | ✅ P0 |

### 3.1 근본 원인 발견 (탐색 중)

`GraphView.tsx`의 드래그 스프링(Effect 4)·hover(Effect 5)·줌 페이드 이펙트는 Cytoscape 이벤트를 바인딩하지만, Cytoscape 인스턴스는 **비동기(lazy import)로 생성**된다. `deps: []` 또는 설정값-only deps인 이 이펙트들은 인스턴스 생성 전에 실행되어 조기 반환하고, **첫 마운트에서 이벤트가 영영 바인딩되지 않는다** (설정 변경으로 이펙트가 재실행될 때만 살아남). 사용자가 "드래그 시 따라오는 기능이 없다"고 느낀 직접 원인. → 새 구조에서는 모든 cy-이벤트 이펙트가 `cyReady`에 의존한다.

## 4. 핵심 아키텍처 결정

### 결정: Cytoscape 렌더러 유지 + 레이아웃 엔진을 d3-force 연속 시뮬레이션으로 교체

**대안 비교**

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| A. fcose 유지 + nodeSeparation/후처리 | 변경 최소 | 연속 물리 불가 — 드래그 UX 목표 달성 불가 | ❌ |
| B. force-graph(vasturiano) 등 전면 교체 | 물리 내장 | 렌더링/스타일/필터/hover 등 검증된 코드 전부 재작성, 신규 대형 의존성 | ❌ |
| C. **cytoscape 렌더 + d3-force 시뮬레이션 (하이브리드)** | 기존 스타일·필터·hover·§87 코드 보존, d3-force는 초소형(~15KB), 드래그/충돌은 canonical 패턴 그대로 | 틱마다 위치 동기화 비용 | ✅ 채택 |

- cytoscape는 `SkillDependencySection.tsx`(Skills 의존성 그래프)에서도 사용하므로 어차피 제거 불가.
- `cytoscape-fcose` 의존성은 GraphView 전환 후 **제거** (SkillDependencySection은 fcose 미사용). 부수효과: backlog.md의 `cytoscape.use(fcose)` 이중 호출 경고 항목 자동 해소.
- 신규 의존성: `d3-force` (+ 타입 `@types/d3-force`).

### 시뮬레이션 설계 (`graph-simulation.ts`)

```
Forces:
  link:      forceLink(edges).id(d=>d.id).distance(linkDistance).strength(linkForce)
  charge:    forceManyBody().strength(-repelForce * REPEL_SCALE)   // REPEL_SCALE ≈ 40
  center:    forceX(0).strength(centerForce * 0.1) + forceY(0).strength(centerForce * 0.1)
             // forceCenter 대신 forceX/Y — 드래그 시 전체가 밀리는 현상 방지
  collide:   forceCollide(d => d.radius + COLLIDE_PADDING).iterations(2)   // 겹침 방지, PADDING ≈ 6
```

- **노드 반지름**: 렌더 크기와 일치 — `nodeSize(degree)/2 + COLLIDE_PADDING`.
- **틱 → 렌더 동기화**: `simulation.on("tick")`에서 `cy.batch()`로 전 노드 `position()` 갱신. 시뮬레이션발 이동과 사용자 드래그발 이동을 플래그로 구분.
- **냉각**: 기본 alphaDecay로 자연 정지(`alphaMin` 도달 시 stop). 유휴 시 CPU 0.
- **드래그 (canonical d3 패턴)**:
  - `grab`: 노드 `fx/fy` = 현재 위치, `simulation.alphaTarget(0.3).restart()` → 시뮬레이션 재가열, 전체 이웃이 살아 움직임
  - `drag`: `fx/fy`를 커서 위치로 갱신
  - `free`: `alphaTarget(0)`, `fx/fy = null` 해제 → 자연 재정착 (기존 수제 스프링 + fcose 재실행 코드 삭제)
- **Forces 슬라이더 변경**: 힘 파라미터 갱신 + `alpha(0.3).restart()` — 전체 재배치 없이 부드럽게 적응.
- **위치 보존**: 인덱스 갱신(indexVersion bump) 시 기존 노드의 `x/y`를 id 기준으로 승계 → 그래프가 튀지 않음. 신규 노드만 이웃 평균 근처에 시드.
- **초기 레이아웃**: d3-force 기본 phyllotaxis 시드 후 시뮬레이션. 대형 그래프(>1,500 노드)는 첫 N틱을 동기 실행 후 렌더 시작(애니메이션 생략)으로 초기 비용 제어.

## 5. 기능 스펙 (To-Be)

### §30.1 데이터 모델 (변경 없음)
- `LinkGraph` 계약, `tag:` 가상 노드, ghost 합성, §87 merge 로직 모두 유지. **백엔드(Rust) 무변경.**

### §30.2 레이아웃 엔진 — P0
- 위 시뮬레이션 설계 전체. fcose 및 수제 드래그 스프링 삭제.
- 겹침 방지는 기본 활성 (설정 항목 아님 — 항상 on).

### §30.3 인터랙션 — P0/P1
- P0: 드래그 재가열/추종/재정착 (위).
- P1: **로컬 그래프 모드** — 스코프에 `local` 추가 (기존 current/all + local). 활성 파일 중심 BFS depth 1~3 슬라이더. 활성 탭 변경 시 자동 추적(기존 Effect 6 확장). 클라이언트 필터로 구현 (display 토글, 데이터 재요청 없음). *결정: graphScope는 컴포넌트 state → 설정 스토어로 이동 (설정 패널에서 depth 슬라이더 조건부 노출 + 영속화 일원화).*
- P1: **freeze/재가열 컨트롤** — freeze = 시뮬레이션 정지(드래그해도 단독 이동만, 재가열 없음); 재배치 버튼 = unfreeze + alpha(0.8) 재시작.

### §30.4 설정 — P1
- `useGraphSettingsStore`에 zustand `persist` 적용 (localStorage, 독립 키 `baram-graph-settings`).
- 신규 설정: `localDepth` (1~3, 기본 1).
- 기존 Forces 슬라이더 4종의 의미는 유지하되 d3-force 파라미터로 매핑 재보정 (기본값 재튜닝).

### §30.5 성능
- 유휴 시 시뮬레이션 정지 (CPU 0). 탭/패널 언마운트 시 `simulation.stop()`.
- >1,500 노드: 초기 동기 틱 + 애니메이션 생략 경로.
- 기존 지연 로드/label fade 유지.

### 파일 분리 (컨벤션 준수, 선행 리팩토링)
GraphView.tsx(~900줄) → 행위 무변경 분리:
- `graph-style.ts` — `buildGraphStyle` (스타일시트)
- `graph-simulation.ts` — 시뮬레이션 래퍼 (신규)
- `use-graph-data.ts` — 데이터 fetch/merge/scope 훅
- `GraphView.tsx` — 조립 + 상호작용 (300줄 이하 목표)

## 6. 테스트 전략

- **d3-force는 DOM 불필요** — Node/vitest에서 헤드리스 실행 가능:
  - N틱 후 겹침 없음 검증 (모든 쌍 거리 ≥ r1+r2 − tolerance)
  - fx/fy 고정 중 위치 불변 + 이웃 이동 검증 (드래그 시나리오)
  - 설정→힘 파라미터 매핑 단위 테스트
  - 위치 승계 merge 유틸 테스트
- BFS local-graph 필터 순수 함수 테스트.
- 기존 graph-utils 테스트 전부 유지 (데이터 변환 계약 무변경이므로 통과해야 함).

## 7. 범위 제외 (P2 보류 — 리서치 기반 우선순위)

후속 이터레이션 후보 (사용자 선호도·구현 난이도 리서치 순위):

1. **검색 하이라이트 모드** — 현재는 검색어가 노드를 필터(숨김)하지만, Logseq처럼 매칭 노드는 밝히고 나머지는 dim만 하는 highlight-over-filter를 사용자들이 탐색 용도로 강하게 선호. 소규모 변경으로 큰 가치.
2. **우클릭 노드 컨텍스트 메뉴** — 새 탭에서 열기 / pin·unpin / 그래프에서 제외 / 링크 복사. 전 앱 공통 사용자 요청 1순위.
3. **로컬 그래프 incoming/outgoing/neighbor-links 토글** — Obsidian 로컬 그래프의 나머지 절반.
4. **그룹 색상(쿼리 기반)** — Obsidian 대표 기능. 필터/그룹 UI 패널 필요.
5. **엣지 방향 흐름 파티클** — 화살표 대신 흐르는 점으로 방향 표시 (canvas 커스텀 드로잉 필요).
6. **time-lapse 애니메이션** — 생성일 순 노드 등장 재생. 파일 생성일 메타데이터 필요.
7. **커뮤니티 자동 색상 / co-citation 패널 / 미니맵** — 대형 vault 대상, 알고리즘·UI 비용 큼.
- journal-workspace-spec §3.4의 monthly clustering / word-count 크기 / mood 색상 — 미구현 상태 유지 (로드맵 항목).
- SkillDependencySection의 cytoscape 사용 — 무변경.

## 8. 커밋 계획 (Conventional Commits, § 참조)

1. `refactor(§30): split GraphView into style/simulation/data modules` — 행위 무변경
2. `feat(§30.2): replace fcose batch layout with continuous d3-force simulation` — collide + 드래그 재가열 + 위치 보존, fcose 제거
3. `feat(§30.3): add local graph scope with depth slider`
4. `feat(§30.4): persist graph settings; add freeze/reheat controls`
5. `test(§30): simulation + local-graph unit tests` (각 phase에 동반 가능)
6. `docs(§30): update design references` (해당 시)

## 9. 리서치 검증 노트 (2026-07-17, 구현 후 도착)

- **Logseq 스택 정정**: pixi-graph-fork(PIXI.js + Graphology) + **ForceAtlas2** (d3-force 아님). FA2는 수렴 없이 계속 도는 알고리즘이라 드래그 반응이 "공짜"지만, **놓아도 그래프가 영원히 움직이는 것이 Logseq 포럼의 대표 불만**.
- **Baram의 d3-force fx/fy + alphaTarget(0.3) 패턴이 Logseq보다 우월**: 드래그 중 이웃 반응 + 놓으면 안정 정착 둘 다 확보. 리서치 결론 = "구현이 정확함(correct)".
- forceCollide로 겹침 방지하는 앱은 Obsidian/Logseq 어느 쪽에도 없음 — Baram 차별점 확인.
- 권장 튜닝 범위 (사용자 체감 피드백 시 참고): manyBody strength −300~−400 (현 기본 −320 ✓), collide radius+4~6 (현 +6 ✓) / strength 0.7~0.8 / iterations 2 (현 2 ✓), velocityDecay 0.4 (d3 기본 ✓), theta 0.8 (현 d3 기본 0.9 — 밀집 그래프에서 품질↑ 필요 시 조정).
- 성능 임계: canvas는 ~5,000노드까지 적정 (Baram 타깃 vault 50~2,000노드 커버). 그 이상은 WebGL(sigma.js) 전환이 업그레이드 경로.

## 10. 이터레이션 2 — 검색 하이라이트 + 노드 컨텍스트 메뉴/핀/제외 (P2 #1+#2)

이터레이션 1 머지(PR #242) 후 사용자 승인으로 착수. 브랜치 `feature/graph-view-highlight-context-menu`.

### §30.3a 검색 하이라이트 (filter → highlight 전환)

- **행동 변경**: `searchQuery`는 더 이상 노드를 숨기지 않는다. 매칭 노드 = `.search-match`(강조 테두리·완전 불투명), 비매칭 노드 = `.search-dim`(hover fade 수준). 엣지는 양 끝이 모두 매칭일 때만 정상, 아니면 dim.
- **근거**: 리서치 — 탐색 용도로 highlight-over-filter를 사용자가 강하게 선호 (Logseq 방식). 부가 효과: 타이핑 중 visible set이 안 변해 시뮬레이션 재배치가 발생하지 않음 (기존에는 글자 입력마다 그래프가 움찔거림).
- **구현**: `graph-highlight.ts`의 `applySearchHighlight(cy, query)` — 클래스만 조작하는 순수 로직이라 headless cytoscape로 단위 테스트. `use-graph-filter`의 가시성 체인·sync key에서 search 제거.
- namespaceFilter/orphans/tags/existingFilesOnly는 필터로 유지 (별개 개념).

### §30.3b 노드 우클릭 컨텍스트 메뉴

- cytoscape `cxttap` 이벤트 → 기존 공용 `MenuList`(§4.8, 뷰포트 클램핑/외부클릭/Escape 내장) 재사용.
- 노드 타입별 항목:
  - 파일 노드: Open / Pin↔Unpin / Copy wikilink (`[[name]]`) / ─ / Exclude from graph
  - ghost 노드: Copy wikilink / Exclude from graph (열기 불가)
  - 태그 노드: Copy tag (`#name`) / Exclude from graph
- 클립보드는 `navigator.clipboard.writeText`.

### §30.3c 노드 핀 (Obsidian식 고정)

- 시뮬레이션 API 확장: `pin(id)` / `unpin(id)` / `isPinned(id)`. 핀 = `fx/fy` 영구 고정, `setGraph` 스왑에도 유지.
- **드래그 상호작용**: 핀 노드를 드래그하면 놓은 자리에 다시 고정 (`endDrag`가 핀 노드는 fx/fy 유지). 일반 노드는 기존대로 물리 복귀.
- 시각 표시: `node.pinned` — 앰버 실선 테두리 (`--graph-pinned-color`, fallback #f59e0b).
- 범위: 세션 한정 (위치 영속화는 P3 — 좌표 저장 필요).

### §30.4a 그래프 제외 목록

- 설정 스토어에 `excludedPaths: string[]` (+ `excludeNode`, `clearExcluded`) — 영속 (TRANSIENT 아님).
- `use-graph-filter` 가시성 체인 최우선 조건으로 제외 적용.
- 설정 패널 Filters 섹션: 제외 개수 + "Clear" 버튼 (0개면 숨김).

## 11. 이터레이션 3 — 로컬 그래프 incoming/outgoing/neighbor-links 토글 (P2 #3)

이터레이션 2 머지(PR #243) 후 사용자 지시로 착수. 브랜치 `feature/graph-view-local-link-toggles`. Obsidian 로컬 그래프의 나머지 절반.

### §30.3d 방향 토글 (incoming / outgoing)

- 설정: `localIncoming` / `localOutgoing` (기본 true, 영속). 둘 다 true = 현행 무방향 BFS.
- **의미론**: BFS 탐색이 엣지 방향을 따름 — outgoing만 켜면 "이 노트가 (전이적으로) 링크하는 것들", incoming만 켜면 "이 노트를 (전이적으로) 링크하는 것들". 둘 다 끄면 중심 노드만 표시 (Obsidian 동일 — 막지 않음).
- 구현: `localSubgraphDepths(edges, centerId, depth, {incoming, outgoing})` → `Map<id, hopDepth>` 신규. 기존 `localSubgraph`는 이 함수의 Set 래퍼로 재구현 (기존 테스트/계약 유지).

### §30.3e neighbor-links 토글

- 설정: `localNeighborLinks` (기본 true, 영속). false면 **같은 BFS 깊이의 두 노드를 잇는 엣지 숨김** (이웃끼리의 링크). 연속 깊이(d→d+1) 엣지는 항상 유지 — 트리 골격이 끊기지 않음. depth 1에서 Obsidian의 "이웃 간 링크 숨김"과 정확히 일치하고 depth 2+로 자연 일반화.
- 구현: 로컬 스코프에서 엣지 가시성 마지막 단계에 `depth(source) === depth(target)` 필터.

### UI

- 설정 패널 Filters 섹션, `graphScope === "local"`일 때 Local depth 아래에 ToggleRow 3개: "Incoming links" / "Outgoing links" / "Neighbor links".

### 사용자 피드백 디버깅 (2026-07-17, systematic-debugging)

증상: (1) neighbor-links 재활성화 시 원상복구 안 됨, (2) 태그끼리/태그-노드 겹침.

조사: 토글/BFS/엣지 숨김 로직은 headless 재현 전 시나리오에서 정확함이 증명됨 (격리 루프, 실제 훅+스토어, StrictMode, 반복 토글, 스코프 왕복, 대형 허브 물리 1000틱, 앱 초기 로드 에너지 경로 — 전부 통과). 근본 원인은 로직이 아니라 **상태 동기화 채널**:

- **D1 — count 기반 필터 재실행**: 인덱스 갱신(auto-save)마다 `useGraphData`가 cy 요소를 전부 교체(모든 display bypass 소실)하는데, 노드/엣지 개수가 같으면 `setNodeCount` same-value로 React가 bail → 필터 미재실행 → 숨김 상태가 통째로 리셋. → **`graphEpoch`** (populate마다 증가) 도입, 필터가 epoch에 의존.
- **D2 — count 기반 sync key**: 같은 개수로 엣지 구성만 바뀌면 (링크 수정/rename) 심 재동기화 생략 → 스테일 스프링 + 미등록 신규 요소가 안 움직여 겹침 (태그가 가장 자주 해당). → sync key를 **엣지 identity 기반**으로.
- **수축 부족**: 스프링 복원 시 alpha 0.3 재가열이 charge+collide 저항을 못 이겨 퍼진 레이아웃이 안 돌아옴. → 구조 변경 재동기화는 **alpha 0.6**.
- 테스트 인프라: React 19 + RTL renderHook/act의 순서 의존 flush 문제로 훅 직접 테스트가 불안정 → **`applyGraphFilter` 순수 함수로 추출** (React-free, headless cytoscape 단위 테스트 5종), 훅은 얇은 래퍼.
