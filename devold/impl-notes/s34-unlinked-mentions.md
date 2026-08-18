# §34 언링크드 멘션 — 구현 노트

## Requirements (설계서에서 추출)
- 파일명(stem)이 다른 문서 본문에 `[[]]` 없이 등장하면 자동 감지
- 백링크 패널 하단에 "언링크드 멘션 (N)" 섹션으로 표시
- 각 항목: 소스 파일명 + 컨텍스트(해당 줄) + "링크로 변환" 버튼
- "링크로 변환" 클릭 → 해당 텍스트를 `[[target]]`로 래핑 후 저장
- 현재 파일 자체는 결과에서 제외

## Dependencies
- §29 Backlink Panel: Backlinks.tsx, link-store.ts (UI 컨테이너)
- Rust index (mod.rs): 파일 스캔 인프라 재사용 (collect_md_files)
- IPC: readFile, writeFile, update_file_index (기존)

## User Flow (전체 체인)
1. Backlinks.tsx mount → `getUnlinkedMentions(filePath, rootPath)` IPC 호출
2. Rust: collect .md files → 각 파일에서 current file stem을 검색 → `[[]]` 내부 매치 제외
3. Rust → Frontend: `Vec<UnlinkedMention>` (sourcePath, line, context, matchText)
4. Frontend: 그룹핑 후 Backlinks 패널 하단에 렌더링
5. "링크로 변환" 클릭 → readFile → 해당 줄에서 matchText를 `[[target]]`로 교체 → writeFile → update_file_index → 리페치

## Contract Points (반드시 테스트)
- Rust serde `rename_all = "camelCase"` ↔ TS `UnlinkedMention` 필드명 일치
- Rust `find_unlinked_mentions`: `[[]]` 내부 텍스트는 매치하지 않아야 함
- Rust `find_unlinked_mentions`: 현재 파일 자체는 결과에서 제외
- Rust `find_unlinked_mentions`: 대소문자 무시, 단어 경계 고려
- Frontend "링크로 변환": 정확한 줄/텍스트 교체, 다른 줄 변경 없음

## Edge Cases
- 파일명이 짧은 단어 (예: "a.md") → 너무 많은 false positive → 단어 경계 매치
- 파일명에 특수문자 (예: "c++.md") → regex escape 필요
- 같은 줄에 linked mention + unlinked mention → linked 제외, unlinked만 표시
- 빈 vault → 빈 결과

## Files to Create/Modify
1. **수정** `src-tauri/src/index/mod.rs` — `UnlinkedMentionResult` + `find_unlinked_mentions()`
2. **수정** `src-tauri/src/commands/index_cmd.rs` — `get_unlinked_mentions` IPC
3. **수정** `src-tauri/src/lib.rs` — 커맨드 등록
4. **수정** `src/ipc/types.ts` — `UnlinkedMention` 타입
5. **수정** `src/ipc/invoke.ts` — `getUnlinkedMentions()` 래퍼
6. **수정** `src/stores/link-store.ts` — unlinked mentions 상태
7. **수정** `src/components/sidebar/Backlinks.tsx` — 언링크드 멘션 섹션 UI + "링크로 변환"
8. **수정** `src/App.css` — 스타일
9. **신규** `src/__tests__/integration/unlinked-mentions.test.ts` — 통합 테스트

## Implementation Order
1. Rust: `UnlinkedMentionResult` 타입 + `find_unlinked_mentions` 로직 + 단위 테스트
2. Rust: IPC 커맨드 + lib.rs 등록
3. TS: 타입 + IPC 래퍼
4. TS: link-store 확장
5. TS: Backlinks.tsx UI + "링크로 변환"
6. CSS 스타일
7. 통합 테스트
