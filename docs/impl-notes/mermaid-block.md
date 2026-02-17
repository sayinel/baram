# §5.5 Mermaid 다이어그램 — 구현 노트

## Requirements (설계서에서 추출)
- ```` ```mermaid ```` 코드 블록으로 트리거
- 포커스 아웃: Mermaid.js SVG 렌더링
- 포커스 인: 소스 코드 편집 (textarea)
- 렌더링 오류 시 에러 메시지 인라인 표시
- Phase 2에서 7종 다이어그램: flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, pie
- ProseMirror 스키마: `mermaidBlock { content: "text*", group: "block", code: true, attrs: { code } }`

## Dependencies
- `mermaid` npm 패키지 (v11.x)
- MathBlock 패턴 참조 (atom:true, selected/unselected dual mode)
- Pipeline transformer (code mdast node with lang="mermaid" ↔ mermaidBlock PM node)

## Technical Challenges
1. **Transformer routing**: mdast `code` with `lang: "mermaid"` must route to mermaidBlock, not codeBlock
   - Solution: intercept in `md-to-pm.ts` before standard transformer lookup
2. **Mermaid.js async rendering**: `mermaid.render()` is async
3. **SVG sanitization**: Mermaid output must be safely rendered
4. **Bundle size**: Mermaid.js is ~300KB — use dynamic import

## Edge Cases
- Empty mermaid source → placeholder text
- Invalid syntax → error message with last-success SVG faded
- Very large diagrams → overflow handling
- Dark mode → Mermaid theme switching

## Files to Create/Modify
1. CREATE `src/extensions/nodes/mermaid-block.ts` — Extension
2. CREATE `src/extensions/nodes/mermaid-block-view.tsx` — NodeView
3. CREATE `src/pipeline/transformers/mermaid-block-transformer.ts` — Transformer
4. MODIFY `src/pipeline/transformers/index.ts` — Register transformer
5. MODIFY `src/pipeline/md-to-pm.ts` — Route mermaid code blocks
6. MODIFY `src/extensions/nodes/index.ts` — Export
7. MODIFY `src/extensions/index.ts` — Register in createBaramExtensions
8. MODIFY `src/App.css` — Styles
9. MODIFY `src/extensions/registry.json` — Update status
10. CREATE test file for roundtrip

## Implementation Order
1. Transformer (mermaid-block-transformer.ts)
2. Pipeline routing (md-to-pm.ts intercept)
3. Extension (mermaid-block.ts) — atom:true pattern
4. NodeView (mermaid-block-view.tsx) — dual mode
5. CSS styles
6. Registration (index files, registry.json)
7. Tests
