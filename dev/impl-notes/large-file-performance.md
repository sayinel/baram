# 대용량 파일 성능 최적화 (§perf-large-file)

## 문제

~2만 라인 규모 파일 오픈 시:
1. 파일을 빠르게 읽지 못함 (UI 프리징)
2. 오픈 후 타이핑 시 버벅거림 (렌더링 지연)

## 병목 분석

### 1. 파일 오픈 — 메인 스레드 차단 (Critical)

`markdownToProsemirror()`가 완전히 동기적으로 메인 스레드에서 실행:
- `remark-parse` (전체 파싱) → `mdast` 변환 → ProseMirror Doc 생성
- 2만 라인이면 수초간 UI 멈춤

**관련 코드**: `src/pipeline/md-to-pm.ts` — `markdownToProsemirror()` (line 59–66)

### 2. 초기 렌더링 — DOM 전체 생성 (High)

ProseMirror가 문서 전체의 DOM을 한 번에 생성. 가상화/뷰포트 기반 렌더링 없음.
- 2만 라인 = 2만+ DOM 노드 즉시 생성

### 3. 타이핑 — 매 키 입력마다 전체 문서 순회 (High)

| 플러그인 | 문제 | 파일 |
|---------|------|------|
| `list-atom-fix` | `decorations(state)`에서 매 렌더마다 전체 순회, 캐시 없음 | `src/extensions/plugins/list-atom-fix.ts` |
| `block-id-decoration` | 동일 — 매 렌더마다 전체 순회 | `src/extensions/plugins/block-id-decoration.ts` |
| `prompt-highlight` | 모든 파일에서 `docChanged` 시 전체 순회 (Skills 파일만 필요) | `src/extensions/plugins/prompt-highlight.ts` |
| `prompt-lint` | 동일 | `src/extensions/plugins/prompt-lint.ts` |
| `find-replace` | Find 열려있으면 매 입력마다 전체 텍스트 추출 + regex | `src/extensions/plugins/find-replace.ts` |

## 해결 로드맵

### Phase A: 플러그인 최적화 (노력 小, 효과 大) ← 1단계

**A1. `list-atom-fix` + `block-id-decoration` — DecorationSet.map() 패턴 적용**
- `props.decorations(state)` → `apply(tr, old)` 패턴으로 변경
- `docChanged` 아닌 경우 `old.map(tr.mapping)`으로 위치만 재계산
- 전체 재스캔은 `docChanged` 시에만 수행

**A2. `prompt-highlight` + `prompt-lint` — Skills 파일 가드**
- Skills 파일(`.skill.md`)이 아닌 경우 early return
- 일반 마크다운에서는 비용 0

**A3. `find-replace` — 증분 업데이트**
- 변경된 영역만 부분 업데이트 (incremental search)

### Phase B: 파싱 비동기화 (노력 中, 효과 大) ← 2단계

**B1. Web Worker로 remark 파싱 분리**
- `remarkParse → mdast` 까지를 Worker에서 수행
- 결과 JSON을 메인 스레드로 전달
- `Node.fromJSON(schema, json)`으로 PM Doc 생성

**B2. 로딩 중 스켈레톤 UI**

### Phase C: 뷰포트 기반 렌더링 (노력 大, 효과 大) ← 3단계

**C1. `content-visibility: auto` CSS**
- 최상위 블록 노드에 `content-visibility: auto; contain-intrinsic-size` 적용
- 브라우저가 뷰포트 밖 블록의 레이아웃/페인트를 건너뜀
- ProseMirror 코드 변경 없이 NodeView wrapper에 CSS만 추가

**C2. ProseMirror 문서 분할 (Chunked Document)** — 필요시
- 문서를 N개 섹션으로 분할, 뷰포트 근처만 실제 PM 노드
- 10만 라인급 대응

## 성능 목표 (CLAUDE.md §8.4)

| 지표 | 현재 (추정) | 목표 |
|------|------------|------|
| 1,000줄 파일 열기 | ~200ms | < 200ms |
| 10,000줄 파일 열기 | ~3–5초 | < 1초 |
| 20,000줄 파일 열기 | ~10초+ | < 2초 |
| 타이핑 레이턴시 (20K줄) | ~50–100ms | < 16ms (60fps) |
