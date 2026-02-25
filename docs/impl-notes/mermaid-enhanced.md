# §50 Mermaid 다이어그램 고도화 — 구현 노트

## Requirements (설계서에서 추출)

1. **컨텍스트 메뉴** (§5.5 다이어그램 컨텍스트 메뉴):
   - SVG로 복사
   - PNG로 복사
   - Mermaid 소스 복사
   - 새 창에서 편집 (전체 화면 편집 모드)
   - 다이어그램 삭제

2. **에러 시 마지막 성공 렌더링 유지** → 이미 구현됨 (svgHtml 상태 유지 + faded class)

3. **다이어그램 타입 템플릿** — 7종 Phase 2 템플릿 제공:
   - flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, pie

## Dependencies

- `src/components/toolbar/ContextMenu.tsx` — 기존 컨텍스트 메뉴 (math/table 패턴 참조)
- `src/utils/katex-to-png.ts` — SVG→PNG 변환 패턴 참조
- `src/extensions/nodes/mermaid-block-view.tsx` — NodeView (템플릿 피커 추가)
- `src/extensions/nodes/mermaid-block.ts` — Extension 정의

## Technical Challenges

- **PNG 복사**: Mermaid SVG → Canvas → PNG blob → clipboard. SVG에 foreignObject 없으므로 직접 Image로 로드 가능
- **컨텍스트 메뉴에서 atom node 감지**: mathBlock과 동일 패턴 — DOM에서 `data-type="mermaidBlock"` 탐색
- **전체 화면 편집**: 모달 오버레이로 구현, split view (코드 | 프리뷰)

## Edge Cases

- SVG가 아직 렌더링되지 않은 상태에서 복사 시도 → disable 또는 source만 복사
- 빈 다이어그램 → 템플릿 피커만 표시
- 에러 상태에서 복사 → 마지막 성공 SVG 복사 (있으면)

## Files to Create/Modify

### 신규
| 파일 | 설명 |
|------|------|
| `src/utils/mermaid-utils.ts` | Copy SVG/PNG/Source + 템플릿 데이터 + 타입 감지 |
| `src/extensions/__tests__/mermaid-enhanced.test.ts` | 유틸 함수 테스트 |

### 수정
| 파일 | 변경 |
|------|------|
| `src/components/toolbar/ContextMenu.tsx` | Mermaid block 감지 + 전용 메뉴 빌드 |
| `src/extensions/nodes/mermaid-block-view.tsx` | 편집 모드 헤더에 템플릿 피커 드롭다운 |
| `src/App.css` | 템플릿 피커 + 전체 화면 모달 스타일 |

## Implementation Order

1. `mermaid-utils.ts` — 유틸 함수 (templates, copy, detect)
2. `mermaid-enhanced.test.ts` — 테스트
3. `ContextMenu.tsx` — 컨텍스트 메뉴 통합
4. `mermaid-block-view.tsx` — 템플릿 피커 + 전체 화면 편집
5. `App.css` — 스타일
