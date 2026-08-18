# §28 양방향 링크 (Wikilink) — 구현 노트

## Requirements (설계서에서 추출)

### 핵심 기능
- `[[filename]]` — 파일 링크
- `[[filename|display]]` — 표시 텍스트 지정
- `[[filename#heading]]` — 헤딩 링크
- `[[filename^block-id]]` — 블록 링크 (§30에서 본격 구현, §28에서는 파싱만)
- 렌더링: 포커스 외 → 스타일 링크(파란색), 포커스 내 → `[[` `]]` 구문 보임
- Cmd+click → 파일 열기 (없는 파일 → 생성 다이얼로그)
- 일반 클릭 → 편집 모드 (커서 진입)

### §28 범위 (이번 구현)
- Tiptap inline Node Extension (atom)
- 파이프라인: `[[...]]` ↔ ProseMirror Node 양방향 변환
- `[[` InputRule (자동 변환)
- 기본 렌더링 (NodeView)
- Cmd+click 파일 네비게이션
- 라운드트립 보존

### §28 범위 외 (후속 구현)
- §29: 백링크 패널 + SQLite 인덱스
- §30: 블록 참조 `(())` + 블록 임베드 `{{embed}}`
- §31: 링크 자동완성 팝업
- §32: 호버 미리보기
- §33: 파일 이름 변경 시 링크 자동 갱신
- §34: 언링크드 멘션

## Dependencies (의존하는 모듈/Extension)

- Tiptap `Node.create()` + `ReactNodeViewRenderer`
- Pipeline: md-to-pm.ts, pm-to-md.ts (inline node 추가)
- file-store (파일 열기)
- editor-store (탭 열기)

## Technical Challenges

### 1. 파싱 전략
remark-parse는 `[[]]`를 표준 마크다운으로 인식하지 않음 → text node로 파싱됨.
**해결**: `convertInlineChildren`에서 text node를 분할하여 `[[...]]` 패턴을 wikilink PM node로 변환.

Regex: `/\[\[([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]/g`
- Group 1: target (filename)
- Group 2: heading (optional, after #)
- Group 3: blockId (optional, after ^)
- Group 4: display (optional, after |)

### 2. Node vs Mark
설계서 registry에는 Mark으로 되어있지만, PM schema는 `atom: true` inline Node임.
**결정**: inline Node로 구현. 이유:
- 자체 내용을 가진 원자적 요소 (다른 텍스트를 감싸지 않음)
- 복잡한 attrs (target, display, heading, blockId)
- inlineMath와 유사한 패턴

### 3. 라운드트립
PM → mdast 시, wikilink Node를 `[[target]]` 또는 `[[target|display]]` 텍스트로 직렬화.
remark-stringify가 이를 이스케이프하지 않도록 `html` mdast 타입 사용 (raw output).

### 4. 커서 동작
`atom: true`이므로 커서가 노드 내부에 진입 불가. 편집은 NodeView에서 처리.
향후 SyntaxReveal 패턴으로 포커스 시 `[[` `]]` 노출 가능.

## Edge Cases

- 빈 wikilink: `[[]]` → 무시하거나 빈 target으로 생성
- 중첩 대괄호: `[[page [with] brackets]]` → 첫 `]]`에서 닫힘
- 파이프 없는 display: `[[page#heading]]` → display는 "heading", target은 "page"
- 존재하지 않는 파일 → 빨간 점선 밑줄 스타일
- 라운드트립: `[[a|b]]` → PM → `[[a|b]]` 정확히 보존
- 코드 블록 내 `[[]]` → wikilink로 변환하지 않음 (remark가 code block 내용을 text로 안 줌)

## Files to Create/Modify

### 생성
1. `src/extensions/nodes/wikilink.ts` — Tiptap Node Extension
2. `src/extensions/nodes/wikilink-view.tsx` — React NodeView
3. `src/pipeline/transformers/wikilink-transformer.ts` — PM ↔ mdast
4. `src/extensions/__tests__/wikilink.test.ts` — 라운드트립 + 기능 테스트

### 수정
5. `src/pipeline/md-to-pm.ts` — text node에서 `[[]]` 파싱 추가
6. `src/pipeline/pm-to-md.ts` — wikilink node 직렬화 추가
7. `src/pipeline/transformers/index.ts` — wikilink transformer 등록
8. `src/extensions/index.ts` — Wikilink extension 추가
9. `src/extensions/registry.json` — status → "completed"
10. `src/App.css` — wikilink 스타일 추가

## Implementation Order

1. **타입/스키마**: Wikilink Node Extension 정의 (attrs: target, display, heading, blockId)
2. **파이프라인**: wikilink-transformer.ts + md-to-pm/pm-to-md 수정
3. **라운드트립 테스트**: `[[page]]`, `[[page|display]]`, `[[page#heading]]` 등
4. **NodeView**: React 렌더링 컴포넌트
5. **InputRule**: `[[` 입력 시 wikilink 생성
6. **네비게이션**: Cmd+click 시 파일 열기
7. **스타일**: CSS 추가
8. **등록**: registry.json, extensions/index.ts 업데이트
