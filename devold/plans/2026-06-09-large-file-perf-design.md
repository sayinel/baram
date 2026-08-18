# 대용량 파일 성능 리팩토링 설계 (§perf-large-file Phase C)

> 작성일: 2026-06-09
> 범위: 중위험(medium-risk) 구조 개선, 측정 게이팅(measurement-gated)
> 선행 분석: [`dev/impl-notes/large-file-performance.md`](../impl-notes/large-file-performance.md) (Phase A/B/C 로드맵)

## 1. 배경 & 목표

대용량 마크다운 파일(2만 줄 규모)을 열고 다룰 때의 체감 성능을 개선한다.
기존에 §perf-large-file 로드맵(Phase A/B/C)이 정의돼 있으며 **Phase B(Worker 파싱)는 완료, Phase A(플러그인 최적화)는 부분 완료, Phase C(뷰포트 렌더링)는 미완** 상태다.
본 설계는 **Phase C를 완성하고 Phase A를 마무리**하여 사용자가 보고한 증상을 해소하는 것을 목표한다.

신규 아키텍처를 만들지 않고 기존 로드맵 구조 위에 쌓는다.

## 2. 증상 (사용자 확인)

우선순위 1순위로 확인된 체감 느림:

1. **큰 파일을 열 때 프리즈** (수백 ms~수 초간 UI 멈춤)
2. **스크롤 / 탭 전환 시 끊김**

> 타이핑 레이턴시·저장 지연은 이번 효과 범위의 1순위가 **아니다**. Phase A(플러그인 최적화)는 부수 효과로만 다룬다.

## 3. 증거 기반 진단

| 증상 | 직접 원인 | 코드 위치 | 기존 상태 |
|------|----------|----------|----------|
| 오픈 프리즈 (JS) | `mdastBlocksToPmNodes` mdast→PM 변환이 메인 스레드 동기 | `src/hooks/use-tab-switching.ts:290` | Worker는 remark 파싱만 분리(B1 완료), 변환은 여전히 동기 |
| 오픈 프리즈 (DOM) | `view.updateState`가 2만+ DOM 노드를 한 번에 생성 | `src/hooks/use-tab-switching.ts:299` | 미해결 |
| 오픈 프리즈 (CodeMirror) | 코드블록마다 CodeMirror 인스턴스 즉시 생성 (CONTEXT.md 기준 ~296개) | `src/extensions/nodes/views/code-block-node-view.ts` (정적 import) | 미해결, 로드맵에 없던 신규 발견 |
| 스크롤 끊김 | 문서 전체가 DOM 상주, off-screen 블록도 레이아웃/페인트 | `src/styles/editor.css` | C1(content-visibility) 미적용 — 표 행에만 적용됨 (`editor.css:1326`) |
| 탭 전환 끊김 | 캐시 히트해도 `updateState`가 전체 DOM 재조정 | `src/hooks/use-tab-switching.ts:250` | EditorState 캐시 자체는 정상 동작 (`:245`) |

확정된 기존 자산:
- **Worker 파싱(B1)**: `src/pipeline/parse-worker.ts`, `parse-mdast.ts`, `parse-async.ts` — remark 파싱(md→mdast)만 Worker로 분리됨. mdast→PM 변환은 메인 스레드.
- **로딩 스켈레톤(B2)**: `src/App.tsx:587`
- **EditorState 캐시**: `src/hooks/use-tab-switching.ts:245` — 탭 전환 시 재파싱 없이 캐시된 상태 복원.
- **lazy import**: KaTeX(`import("katex")`), Mermaid(`import("mermaid")`)는 이미 동적 import. 단 *인스턴스 생성 시점*은 NodeView mount 시점.
- **CodeMirror 코어**: 정적 import — 번들 상주.
- **content-visibility**: 표 행(`.baram-vscroll`)에만 적용 (`editor.css:1325-1326`).
- **벤치마크 인프라**: `src/pipeline/__tests__/perf-benchmark.test.ts`(5 테스트), `src/utils/perf.ts`.

핵심 통찰: 세 증상(오픈/스크롤/탭)은 결국 **"문서 전체를 동기로 변환하고 전체를 DOM에 상주시킨다"**는 한 가지 뿌리로 수렴한다.

## 4. 범위 결정

- **범위**: 중위험 구조 개선 (예상 3~4주).
- **방식**: 측정 게이팅. 추측이 아닌 Phase 0 실측 데이터로 후속 단계 우선순위·기법을 확정한다.
- **고위험 항목 보류**: C2(청크/가상 문서)는 기본 보류하되, Phase 0 측정 결과 `T_settled < 1초`가 floor에 막히면 escalation 후보로만 둔다.

## 5. 성능 목표 (3-tier 재정의)

단일 "오픈 시간" 숫자 대신, 사용자 체감을 반영한 3개 지표로 분리한다.

| 지표 | 정의 | 1k줄 | 10k줄 | 20k줄 (CONTEXT.md) |
|------|------|------|-------|---------------------|
| **T_freeze** | 메인 스레드가 막혀 입력 불가한 시간 | <16ms | <50ms | **<100ms** |
| **T_interactive** | 스켈레톤 사라지고 첫 화면 사용 가능 | <100ms | <500ms | **<1초** |
| **T_settled** | 문서 전체가 완전 렌더 완료 | <200ms | <1초 | **Phase 0 후 결정** |

- **20k줄 `T_settled`**: Phase 0에서 DOM 노드 생성 floor를 실측한 뒤 결정.
  - floor가 여유 있으면 → `T_settled < 1초` 목표 (C2 포함 검토).
  - floor에 막히면 → `T_interactive < 1초` 유지 + `T_settled` 1~2초 허용.
- **스크롤**: 60fps (프레임 드롭 없음).
- **탭 전환**: <100ms.

### 불변 조건 (회귀 금지)
- `npm test` (vitest) 2356 pass / 5 skip 유지.
- `cargo test` 163 pass 유지.
- 라운드트립 보존(MD→PM→MD) — 최우선 품질 기준.

## 6. 실행 플랜

테스트 픽스처: **`CONTEXT.md`** (21,308줄 / ~1MB / 헤딩 1,843 / 코드블록 ~296 / 표 행 4,368) — §8.4의 "2만 줄" 최악 케이스.

### Phase 0 — 측정 베이스라인 (게이트, 반나절)
`perf-benchmark.test.ts`를 확장하여 다음을 계측:
- 오픈을 **parse(Worker) / convert(mdast→PM) / updateState(DOM 생성) / CodeMirror-init** 4구간으로 분해.
- 픽스처: `CONTEXT.md` + 합성 1k/10k줄.
- 스크롤 FPS, 탭 전환 시간.

**산출물**: 구간별 점유율 수치표. → Phase 1·2 우선순위 및 Phase 2 기법, 20k `T_settled` 목표 확정의 근거.

### Phase 1 — 렌더링 비용 제거 (저위험·최고 ROI)
- **1a. C1 content-visibility 전면 적용**: 최상위 블록(문단/헤딩/리스트/코드블록 등)에 `content-visibility: auto` + `contain-intrinsic-size`. CSS만, ProseMirror 코드 변경 0. → 스크롤 끊김 직접 해결 + 오픈/탭 DOM 레이아웃·페인트 비용 절감.
- **1b. 무거운 NodeView 지연 인스턴스화**: CodeMirror·Mermaid를 **뷰포트 진입 시(IntersectionObserver)에만** 인스턴스화. CONTEXT.md의 CodeMirror 296개 동시 생성 → 화면에 보이는 ~수 개만. (KaTeX/Mermaid는 이미 동적 import이므로 *생성 시점*만 지연.)

> 주의: `content-visibility`는 off-screen 블록의 레이아웃/페인트만 스킵한다. ProseMirror가 DOM 노드를 "생성"하는 비용은 남는다 — 이 floor가 Phase 0의 핵심 측정 대상이며 20k `T_settled` 목표를 좌우한다.

### Phase 2 — 변환 비동기화 (Phase 0 데이터로 기법 확정)
오픈 프리즈의 JS 변환 구간 처리. **측정 결과에 따라 선택**:
- JS 변환이 지배적 → **(a) 청크+yield**(`mdastBlocksToPmNodes`를 청크 단위로 끊어 scheduler/requestIdleCallback로 양보) 또는 **(b) Worker fromJSON**(mdast→PM JSON까지 Worker, 메인은 `Node.fromJSON`) 중 데이터로 결정.
- DOM/CodeMirror가 지배적이고 Phase 1으로 목표 달성 → Phase 2 **축소/생략**.

### Phase 3 — 탭 전환 / updateState 다듬기
- 캐시 히트 경로(`use-tab-switching.ts:250`)의 전체 `updateState` 비용 점검.
- scroll/selection 복원 안정화.

### Phase 4 — Phase A 마무리 (후순위, 타이핑 부수효과)
- A2: `prompt-highlight`/`prompt-lint` Skills 파일 가드 (일반 MD에서 비용 0).
- A3: `find-replace` 증분 업데이트.
- A1: `list-atom-fix`/`block-id-decoration` DecorationSet.map 패턴 완결성 점검.

## 7. 측정 게이팅 결정 지점

| 결정 | 근거가 되는 측정 | 시점 |
|------|-----------------|------|
| Phase 2 필요 여부 | Phase 1 적용 후 오픈 T_freeze/T_interactive 재측정 | Phase 1 완료 후 |
| Phase 2 기법 (청크+yield vs Worker fromJSON) | convert 구간 점유율 | Phase 0 후 |
| 20k `T_settled < 1초` 채택 여부 (C2 escalation) | updateState(DOM 생성) floor 실측 | Phase 0 후 |

## 8. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| lazy NodeView가 스크롤/검색 시 깜빡임·점프 유발 | `contain-intrinsic-size`로 자리 예약, 인스턴스화 후 높이 보정 측정 |
| content-visibility가 브라우저(WKWebView) 미지원/버그 | 표 행에 이미 적용된 패턴 재사용, graceful degradation 확인 |
| 청크 변환 시 selection/플러그인이 부분 문서에 반응 | 진행적 삽입 대신 전체 doc 구성 후 단일 updateState 유지하며 yield만 삽입하는 방식 우선 검토 |
| 라운드트립 회귀 | 각 Phase 후 전체 테스트 + 라운드트립 스위트 강제 통과 게이트 |

## 9. 검증 전략

- 각 Phase는 OMC `executor`로 구현 → `verifier`로 **벤치마크 증거** 확인 후 다음 단계 진행.
- 매 Phase 종료 시: `npm test` + `cargo test` + Phase 0 벤치마크 재실행으로 목표 지표 대비 수치 기록.
- 증거 없는 완료 선언 금지 — 수치표를 산출물로 남긴다.

## 10. 참조

- 선행 분석/로드맵: `dev/impl-notes/large-file-performance.md`
- 성능 목표 원본: CLAUDE.md §8.4 / `dev/design/part8-roadmap.md`
- 벤치마크: `src/pipeline/__tests__/perf-benchmark.test.ts`, `src/utils/perf.ts`
- 핵심 코드: `src/hooks/use-tab-switching.ts`, `src/pipeline/md-to-pm.ts`, `src/pipeline/parse-async.ts`, `src/extensions/nodes/views/code-block-node-view.ts`, `src/styles/editor.css`
