# §31 링크 자동완성 — 구현 노트

## Requirements (설계서에서 추출)

### Part 5 §5.6
- `[[` 입력 시 Vault 내 파일 목록 퍼지 검색 팝업 표시
- 검색 순서: 파일명 정확 매칭 → 퍼지 매칭
- 파일 선택 시 `[[target]]` wikilink 노드 삽입
- 파일 선택 후 `#` 추가 입력 시 헤딩 2차 팝업 (M7 후반)
- `+ 새 파일 생성` 옵션 (M7 후반)

### Part 4 §4.6
- Tiptap Suggestion API 활용 (SlashCommands와 동일 메커니즘)

## Scope (M7 1차)
- `[[` 입력 시 파일 검색 팝업
- 퍼지 매칭 (file-search.ts 재사용)
- 파일 선택 → wikilink 노드 삽입
- NOT in scope: 헤딩 2차 팝업, 새 파일 생성, 별칭 매칭

## Dependencies
- §28 Wikilink Extension (완료) — insertWikilink command
- §4.6 SlashCommands — Suggestion API 패턴
- file-search.ts — fuzzyMatch, fuzzyScore, flattenFileTree
- file-store.ts — rootPath, fileTree

## Technical Approach
- Tiptap Extension (`wikilink-suggest`) using Suggestion API
- `char: "["` with custom `allow()` that checks for preceding `[`
- Items from file store (flattenFileTree → fuzzy filter by query)
- Command inserts wikilink node and deletes the `[[query` range
- UI component (`WikilinkMenu.tsx`) following SlashMenu.tsx pattern

## Files to Create
1. `src/extensions/plugins/wikilink-suggest.ts` — Tiptap Extension
2. `src/components/command/WikilinkMenu.tsx` — popup UI

## Files to Modify
1. `src/extensions/index.ts` — register extension
2. `src/App.css` — styles for wikilink menu
3. `src/extensions/registry.json` — update status

## Implementation Order
1. WikilinkMenu.tsx (UI component)
2. wikilink-suggest.ts (Suggestion plugin)
3. Register in extensions/index.ts
4. CSS styles
5. Tests + verification
