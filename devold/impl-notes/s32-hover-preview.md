# §32 호버 미리보기 — 구현 노트

## Requirements (설계서에서 추출)
- Ctrl+hover (macOS: Cmd+hover)로 wikilink 위에 마우스를 올리면 대상 문서 미리보기 팝업 표시
- 팝업 크기: 최대 400×300px, 내부 스크롤 가능
- 팝업 안에서 링크 Cmd+클릭 시 해당 파일로 이동
- 팝업 체인 미지원 (성능상 1단계만)
- 최대 20줄 미리보기 (Part 8 §8.2 기준)

## Dependencies (의존하는 모듈)
- `src/extensions/nodes/wikilink.ts` — Wikilink Node Extension
- `src/extensions/nodes/wikilink-view.tsx` — NodeView (hover 이벤트 추가 지점)
- `src/utils/wikilink-nav.ts` — resolveWikilinkTarget()으로 파일 경로 해석
- `src/ipc/invoke.ts` — readFile() IPC
- `src/stores/file-store.ts` — openFiles 캐시 우선 활용

## Technical Approach
- WikilinkView에 onMouseEnter/onMouseLeave 이벤트 추가
- Cmd(Meta) 키가 눌린 상태에서만 미리보기 활성화
- 호버 딜레이 300ms → 타겟 해석 → 파일 읽기 (캐시 우선) → 팝업 표시
- 팝업은 React Portal로 렌더링 (body에 직접 마운트)
- 팝업 위치: wikilink 요소 기준 하단, 화면 밖이면 상단으로 flip

## Edge Cases
- 존재하지 않는 파일: 팝업 미표시 (silent fail)
- 빈 파일: "Empty document" 표시
- 매우 긴 파일: 처음 20줄만 표시 + "..." 표시
- 빠르게 다른 wikilink로 이동: 이전 타이머 취소
- 팝업 위에 마우스 올리면 팝업 유지 (hover chain)
- Cmd 키를 놓으면 팝업 즉시 닫힘

## Files to Create/Modify
1. **신규** `src/components/editor/HoverPreview.tsx` — 팝업 컴포넌트
2. **수정** `src/extensions/nodes/wikilink-view.tsx` — hover 이벤트 핸들러 추가
3. **수정** `src/App.css` — `.hover-preview` 스타일
4. **신규** `src/extensions/__tests__/hover-preview.test.ts` — 테스트

## Implementation Order
1. HoverPreview 컴포넌트 (팝업 UI + 위치 계산)
2. WikilinkView에 hover 이벤트 연결
3. CSS 스타일 추가
4. 테스트 작성 및 통과
