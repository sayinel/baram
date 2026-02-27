# §57 @Mention System — 구현 노트 (✅ 완료)

## Requirements (설계서에서 추출)

- Part 7 §7.2: `mention` ProseMirror 노드 — `{ type: "date"|"page", inline: true, atom: true, attrs: { type, value } }`
- Part 8 §8: M9 생산성 도구 — "@멘션 시스템 (날짜/페이지), 인라인 칩"
- 날짜 멘션과 페이지 멘션 지원
- 인라인 칩(chip) UI로 렌더링
- `@` 트리거 자동완성 팝업

## Design Decisions

### Markdown 직렬화 포맷
`@[[value]]` — wikilink 구문 앞에 `@` 접두사. 일반 wikilink `[[value]]`와 구분됨.
- `@[[My Note]]` → 페이지 멘션
- `@[[2026-02-27]]` → 날짜 멘션 (YYYY-MM-DD 패턴 자동 감지)

### @today InputRule 통합
기존 wikilink.ts의 @today/@yesterday/@tomorrow InputRules를 제거하고,
멘션 suggestion 시스템으로 통합. `@` 입력 시 자동완성에서 Quick Dates 항목 표시.

### 기존 wikilink과의 관계
- `[[page]]` — 기존 wikilink (링크 텍스트 스타일)
- `@[[page]]` — 멘션 (인라인 칩 스타일)
- 두 가지 공존, 각각 다른 용도/시각적 표현

## Dependencies

- Tiptap Suggestion API (`@tiptap/suggestion`) — 이미 wikilink-suggest에서 사용 중
- `useFileStore` — 페이지 목록
- `journal.ts` — `resolveDateAlias`, `isDateString` 유틸
- `ReactNodeViewRenderer` — chip NodeView
- Pipeline: `md-to-pm.ts`, `pm-to-md.ts` — 변환 등록

## Technical Challenges

1. **@today InputRule 충돌**: `@` 입력 시 suggestion과 InputRule 동시 동작 방지 → InputRule 제거
2. **Markdown 파싱**: remark-parse는 `@[[...]]`를 텍스트로 처리 → `splitTextWithMentions()` 필요
3. **날짜/페이지 타입 판별**: value가 `YYYY-MM-DD` 패턴이면 date, 아니면 page
4. **기존 저널 기능 유지**: date mention 클릭 → 저널 열기/생성 (기존 wikilink-date와 동일 동작)

## Edge Cases

- `@` 뒤에 아무것도 입력하지 않고 Escape → 팝업 닫힘, `@` 텍스트 유지
- `@[[]]` 빈 멘션 → 무시/처리 안함
- `@[[My Note]]` 뒤에 텍스트 이어붙임 → atom 노드이므로 분리됨
- 존재하지 않는 페이지 멘션 → "Create page" 옵션 제공
- 멘션 내용에 `|` `#` 등 특수문자 → `@[[value]]`에서는 지원하지 않음 (단순 value만)

## Files to Create

| 파일 | 역할 |
|------|------|
| `src/extensions/nodes/mention.ts` | Tiptap Node Extension (inline atom) |
| `src/extensions/nodes/mention-view.tsx` | React NodeView (chip UI) |
| `src/extensions/plugins/mention-suggest.ts` | @ triggered suggestion plugin |
| `src/components/command/MentionMenu.tsx` | Suggestion 팝업 UI |
| `src/pipeline/transformers/mention-transformer.ts` | mdast ↔ PM 변환기 |
| `src/extensions/__tests__/mention.test.ts` | 라운드트립 + 구조 테스트 |

## Files to Modify

| 파일 | 변경 |
|------|------|
| `src/extensions/nodes/wikilink.ts` | @today/@yesterday/@tomorrow/@date InputRules 제거 |
| `src/extensions/index.ts` | Mention + MentionSuggest 등록 |
| `src/pipeline/md-to-pm.ts` | mention 파싱 (`splitTextWithMentions`) |
| `src/pipeline/pm-to-md.ts` | mention 직렬화 |
| `src/pipeline/transformers/index.ts` | mention transformer 등록 |
| `src/extensions/registry.json` | mention 항목 추가 |
| `src/App.tsx` | mention 클릭 네비게이션 핸들러 |

## Implementation Order

1. ✅ mention-transformer.ts — 변환기 (파싱/직렬화 로직)
2. ✅ mention.ts — Node Extension (attrs, parseHTML, renderHTML)
3. ✅ mention-view.tsx — NodeView (chip UI)
4. ✅ md-to-pm.ts — mention 파싱 추가 (`splitTextWithMentions`)
5. ✅ pm-to-md.ts — mention 직렬화 추가 + remark handler
6. ✅ mention-suggest.ts — @ suggestion plugin (Suggestion API)
7. ✅ MentionMenu.tsx — 팝업 UI (카테고리별: Dates/Pages)
8. ✅ wikilink.ts — @today/@yesterday/@tomorrow/@date InputRules 제거
9. ✅ index.ts — Mention + MentionSuggest Extension 등록
10. ✅ App.tsx — mentionNavigateRef → handleWikilinkNavigate 위임
11. ✅ registry.json — mention 항목 추가
12. ✅ mention.test.ts — 24 tests (utility, roundtrip, PM structure)
13. ✅ App.css — mention chip + menu 스타일

## Verification

- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — 996/996 pass (24 new mention tests)
- Roundtrip: `@[[My Note]]` → PM mention → `@[[My Note]]` 정확히 보존
- Mention + wikilink 공존: `@[[Page]] and [[Link]]` 정상 파싱
