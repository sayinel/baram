# Table Cell Merge Persistence in Markdown

**Date**: 2026-03-13
**Status**: Reviewed
**Section Reference**: §5.5 (Table), M10 (Table Advanced)

## Problem

현재 테이블 셀 병합(colspan/rowspan)은 ProseMirror 노드 속성으로만 존재하며, 마크다운 직렬화 시 병합 정보가 소실된다. GFM 파이프 테이블은 셀 병합을 지원하지 않기 때문에, 병합된 셀이 개별 셀로 확장되어 저장된다.

**증상**:
- Cmd+/ 소스 모드 토글 후 병합 해제
- 파일 저장 후 다시 열면 병합 해제
- MD → PM → MD 라운드트립에서 병합 정보 손실

## Solution: `<` + `^` Cell Merge Markers

Obsidian Sheets Extended 컨벤션을 채택하여, 파이프 테이블 내에서 마커 텍스트로 병합을 표현한다.

### Marker Rules

| 마커 | 의미 | 위치 조건 |
|------|------|----------|
| `<` | 이 셀은 왼쪽 셀에 병합 (colspan 확장) | 첫 번째 열이 아닐 때만 유효 |
| `^` | 이 셀은 위쪽 셀에 병합 (rowspan 확장) | 첫 번째 행이 아닐 때만 유효 |

**판별 조건**: 셀 텍스트를 trim한 값이 정확히 `<` 또는 `^`일 때만 마커로 인식.
`< 5`, `x < y`, `^2`, `<br>` 등은 일반 텍스트로 처리된다.

### Syntax Examples

**colspan=2**:
```markdown
| Merged | <  | Normal |
| ------ | -- | ------ |
| A      | B  | C      |
```
→ Row 0, Col 0: "Merged" (colspan=2). Col 2: "Normal" (colspan=1).

**rowspan=2**:
```markdown
| Tall   | Normal |
| ------ | ------ |
| ^      | Other  |
```
→ Row 0, Col 0: "Tall" (rowspan=2). Row 1, Col 1: "Other".

**2x2 merge (colspan=2, rowspan=2)**:
```markdown
| Big | <  | Normal |
| --- | -- | ------ |
| ^   | ^  | Other  |
```
→ (0,0)="Big" (colspan=2, rowspan=2). (0,1)=`<` colspan 확장. (1,0)과 (1,1)=`^` rowspan 확장.
(1,1)이 `<`가 아닌 `^`인 이유: rowspan 마커가 병합 블록 아래 전체 행을 채운다. 위 행의 `<`가 이미 colspan을 표현하므로, 아래 행은 `^`로 통일한다.

**3x3 merge (colspan=3, rowspan=3)**:
```markdown
| Wide | <  | <  | D |
| ---- | -- | -- | - |
| ^    | ^  | ^  | E |
| ^    | ^  | ^  | F |
```

### Separator Row

구분선 행은 항상 논리적 컬럼 수와 동일한 셀 수를 유지한다 (GFM과 동일).

## Serialization (PM → MD)

### Branching Strategy

```
pmToMdast(node):
  hasMerge = any cell has colspan > 1 OR rowspan > 1
  if (!hasMerge) → existing logic (unchanged)
  if (hasMerge)  → merge marker serialization path
```

병합 없는 테이블은 기존 코드 경로를 그대로 사용하여 하위 호환성을 보장한다.

### Grid Entry Extension

기존 grid decomposition 알고리즘 (Step 1~3)은 유지하되, grid entry에 main cell 좌표를 추가한다:

```typescript
grid[r][c] = { cell: PmNode, isMain: boolean, mainRow: number, mainCol: number }
```

`mainRow`/`mainCol` 필드는 병합 직렬화 경로에서만 사용된다. 병합 없는 테이블은 기존 grid 구조를 변경 없이 사용한다.

### Output Rules (Step 4)

```
for each grid[r][c]:
  if isMain:
    → serialize cell content via convertChildren (existing logic)
  else if mainRow === r:
    → emit { type: "tableCell", children: [{ type: "text", value: "<" }] }
  else:
    → emit { type: "tableCell", children: [{ type: "text", value: "^" }] }
```

마커는 일반 텍스트 셀이므로 remark-stringify가 `| < |`, `| ^ |`로 정상 포맷한다.
html 노드 우회가 필요 없다.

### Alignment Handling

마커 셀의 alignment는 무시한다. 메인 셀의 alignment만 align 배열에 반영한다.
역직렬화 시, 메인 셀은 `table.align[mainCol]` (병합의 가장 왼쪽 열)에서 alignment를 가져온다. 마커 열의 alignment는 무시된다.

## Deserialization (MD → PM)

### Branching Strategy

```
mdastToPm(node):
  parse cells into 2D array
  hasMergeMarkers = any cell text is exactly "<" or "^"
  if (!hasMergeMarkers) → existing logic (unchanged)
  if (hasMergeMarkers)  → merge marker interpretation path
```

### 4-Pass Algorithm

**Pass 1 — Build 2D content array**:

```
content[r][c] = trimmed text of cell
rawCells[r][c] = original mdast cell node (preserves inline marks)
attrs[r][c] = { colspan: 1, rowspan: 1, consumed: false }
```

Note: GFM 구분선 행은 remark-parse의 mdast `table.children`에 포함되지 않는다
(remark-parse가 구분선을 `table.align` 배열로 변환). 따라서 2D 배열은 헤더 + 바디 행만 포함한다.

**Pass 2 — Resolve colspan (`<` markers, per-row left→right)**:

```
for each row r:
  for each col c (left to right):
    if content[r][c] === "<" AND c > 0:
      sourceCol = scan left from c-1, skip "<" cells, find first non-"<" non-"^"
      if sourceCol found AND content[r][sourceCol] !== "^":
        attrs[r][sourceCol].colspan++
        attrs[r][c].consumed = true
      // else: "<" targets a "^" cell → treat as plain text (malformed)
```

Note: Pass 2는 `^` 셀을 colspan source로 사용하지 않는다.
`<`의 좌측 스캔이 `^` 셀만 만나면, 해당 `<`는 마커가 아닌 일반 텍스트로 처리된다.

**Pass 3 — Resolve rowspan (`^` markers, per-row deduplication)**:

```
for each row r (top to bottom):
  rowspanApplied = Set()   // 이 행에서 이미 rowspan이 증가된 메인 셀 좌표
  for each col c (left to right):
    if content[r][c] === "^" AND r > 0 AND NOT attrs[r][c].consumed:
      // Step 1: 위쪽으로 스캔하여 소스 행 찾기
      sourceRow = scan up from r-1, skip "^" cells, find first non-"^" row
      sourceCol = c

      // Step 2: 소스가 colspan에 의해 consumed된 경우, 메인 셀 찾기
      if attrs[sourceRow][sourceCol].consumed:
        sourceCol = scan left in sourceRow, find first non-consumed cell

      // Step 3: 중복 방지 — 같은 행에서 같은 메인 셀에 대해 rowspan을 한 번만 증가
      mainKey = (sourceRow, sourceCol)
      if mainKey NOT in rowspanApplied:
        attrs[sourceRow][sourceCol].rowspan++
        rowspanApplied.add(mainKey)

      attrs[r][c].consumed = true
```

핵심: 2x2 병합에서 (1,0)과 (1,1)이 모두 `^`이고 같은 메인 셀 (0,0)을 가리킬 때,
`rowspanApplied` Set이 중복 증가를 방지하여 rowspan=2가 정확히 유지된다.

**Pass 4 — Build PM nodes**:

```
for each row r:
  cells = []
  for each col c:
    if NOT attrs[r][c].consumed:
      create PM cell with:
        - colspan: attrs[r][c].colspan
        - rowspan: attrs[r][c].rowspan
        - alignment: from table.align[c] (메인 셀의 가장 왼쪽 열)
        - content: convertChildren(rawCells[r][c])
      cells.push(cell)
  rows.push(tableRow(cells))
```

### Edge Cases

| Case | Behavior |
|------|----------|
| `<` in first column (c=0) | 왼쪽에 셀이 없으므로 일반 텍스트로 처리 |
| `^` in first row (r=0) | 위에 셀이 없으므로 일반 텍스트로 처리 |
| Header row (r=0)에서 `<` | 정상 동작 — 헤더 셀끼리 병합 가능 |
| `^` in body row 1 targeting header row 0 | 유효 — header+body 걸친 rowspan 생성. 메인 셀은 `tableHeader` 노드 타입 사용 |
| 연속 `<` 마커 (e.g., `\| A \| < \| < \|`) | colspan=3으로 누적 |
| 연속 `^` 마커 (e.g., 3행에 걸친 `^`) | rowspan=3으로 누적 |
| `<`가 `^` 셀을 가리키는 경우 | `<`의 좌측 스캔이 `^`만 만나면 일반 텍스트로 처리 (malformed marker) |
| 셀 내용이 정확히 `<` 또는 `^`인 리터럴 텍스트 | 알려진 제한사항. 사용자가 리터럴 `<`/`^`만 셀에 입력하면 마커로 오인식됨. 빈도가 극히 낮으며, 필요시 `\<`/`\^` 이스케이프 또는 공백 추가로 회피 가능 |

## Backward Compatibility

| 시나리오 | 동작 |
|---------|------|
| 기존 GFM 테이블 (병합 없음) | 직렬화/역직렬화 모두 기존 코드 경로 — 변경 없음 |
| 외부 마크다운에 `<` 또는 `^`가 일반 텍스트로 포함 | 셀 내용이 정확히 `<`/`^`만일 때만 마커 인식 |
| 병합 테이블을 비지원 렌더러에서 열기 | `<`와 `^`가 셀 텍스트로 표시될 뿐, 테이블 구조는 유지 |

## Roundtrip Guarantees

```
Case 1: No merge
  MD → PM(cs=1, rs=1) → MD
  ✓ Existing path, unchanged

Case 2: Merge created in editor
  PM(cs=2) → MD("| Content | < |") → PM(cs=2) → MD("| Content | < |")
  ✓ Markers preserved, lossless

Case 3: External markdown with markers
  MD("| A | < | ^ |") → PM(merge applied) → MD("| A | < | ^ |")
  ✓ Re-serialized with same markers

Case 4: Merge then split in editor
  PM(cs=2) → user splits → PM(cs=1, cs=1)
  → MD("| Content | |") — plain GFM, markers gone
  ✓ Correct behavior
```

## Test Plan

### PM → MD Marker Serialization
- colspan=2 cell → `"| Content | < |"` output
- colspan=3 cell → `"| Content | < | < |"` output
- rowspan=2 cell → next row has `"| ^ |"`
- 2x2 merge → correct `<` and `^` positions
- No merge → identical to existing output (no markers)

### MD → PM Marker Deserialization
- `"| A | < | C |"` → A cell colspan=2, C cell colspan=1
- `"| A |\n| ^ |"` → A cell rowspan=2
- 2x2 merge markdown → PM node with colspan=2, rowspan=2
- `<` in first column → treated as plain text
- `^` in first row → treated as plain text

### Roundtrip
- `"| A | < |\n|---|-|\n| ^ | ^ |"` → PM → MD → matches original
- Merge table + alignment markers roundtrip
- Merge cell with inline marks (**bold**, `code`, etc.) roundtrip
- Main cell with inline marks + adjacent `<` marker → marks preserved, colspan applied correctly

### Existing Tests
- All current `table-advanced.test.ts` tests must pass unchanged

## Affected Files

| File | Change |
|------|--------|
| `src/pipeline/transformers/table-transformer.ts` | pmToMdast: add marker serialization path. mdastToPm: add marker interpretation path |
| `src/extensions/__tests__/table-advanced.test.ts` | Add marker serialization/deserialization/roundtrip tests |

### Files NOT Changed

- `src/extensions/nodes/table.ts` — Extension definition unchanged
- `src/pipeline/md-to-pm.ts` — Table routes through transformer Map
- `src/pipeline/pm-to-md.ts` — Same, transformer handles it
- `src/components/toolbar/TableToolbar.tsx` — UI uses existing mergeCells/splitCell commands
- `src/components/toolbar/ContextMenu.tsx` — Same
