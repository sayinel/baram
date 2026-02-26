# §53 Notion 호환 — 구현 노트

## Requirements (설계서에서 추출)

### Notion → Baram (가져오기)
1. Notion "Export as Markdown & CSV" ZIP 파일을 받아 Baram에서 가져온다
2. ZIP 해제 → 폴더 구조 파싱
3. Notion 고유 구문 변환:
   - Notion 내부 링크 → Wikilink (`[[]]`)
   - Notion 수식 (KaTeX) → Baram 수식 (`$...$`) — 이미 `notion-katex-compat.ts` 존재
   - Notion 콜아웃 (`<aside>`) → Baram 콜아웃 (`> [!type]`)
   - Notion 토글 → HTML `<details>` — Baram 이미 지원
   - Notion 데이터베이스 → YAML Frontmatter + 마크다운 테이블
   - 이미지: 상대 경로 정리
   - 32-char hex ID 파일명 정리
4. 결과 미리보기 → 확인 후 폴더에 저장

### Baram → Notion (내보내기)
마크다운을 Notion 가져오기 호환 형식으로 변환하여 ZIP으로 묶는다 (Phase 3 범위, 이번 구현에서는 Import만).

## Dependencies
- `src/utils/notion-katex-compat.ts` — 이미 존재, 수식 변환
- `src/pipeline/md-to-pm.ts` — 변환 후 기존 파이프라인으로 렌더
- `@tauri-apps/plugin-dialog` — ZIP 파일 선택 다이얼로그
- `src/ipc/invoke.ts` — copyFile, createDir, writeFile 등 이미 존재
- Rust `zip` crate — ZIP 해제

## Notion Export Format 특성
- ZIP 파일 내부: 마크다운(.md) + CSV + 이미지 파일
- 파일명에 32-char hex ID 접미사: `My Page 3a4b5c6d7e8f...12.md`
- 내부 링크: `[Link Text](My%20Page%203a4b5c.md)` (URL 인코딩 + hex ID)
- 콜아웃: `<aside>\n💡 content\n</aside>` (emoji 기반)
- 이미지: 상대경로, `Untitled.png`, `Untitled 1.png` 등
- 데이터베이스: 별도 CSV 파일 + 각 행이 서브페이지 md 파일
- 수식: `$...$` (인라인), `$$...$$` (블록) — 표준 KaTeX이지만 bare Greek 등 사용

## Technical Challenges
1. Hex ID 추출: 파일명 끝 공백+32자 hex 패턴 매칭
2. 내부 링크 해석: URL 디코딩 + hex ID 제거 + wikilink 변환
3. 콜아웃 emoji → type 매핑: 💡→tip, ⚠️→warning, ❗→danger, 💭→note 등
4. 중첩 구조: 서브페이지가 하위 폴더에 존재
5. CSV 데이터베이스: 간단한 CSV 파싱 후 YAML+테이블로 변환

## Files to Create/Modify

| 파일 | 작업 | 설명 |
|------|------|------|
| `src/utils/notion-converter.ts` | 신규 | 핵심 변환 로직 |
| `src/utils/__tests__/notion-converter.test.ts` | 신규 | 변환 유닛 테스트 |
| `src-tauri/src/fs/mod.rs` | 수정 | `extract_zip` 함수 추가 |
| `src-tauri/src/commands/fs_cmd.rs` | 수정 | `extract_zip` IPC 커맨드 |
| `src-tauri/src/lib.rs` | 수정 | 커맨드 등록 |
| `src/ipc/invoke.ts` | 수정 | `extractZip` TS 래퍼 |
| `src/components/import/NotionImportDialog.tsx` | 신규 | 가져오기 다이얼로그 |
| `src/stores/ui-store.ts` | 수정 | notionImportDialogOpen 상태 |
| `src/App.tsx` | 수정 | 메뉴 이벤트 + 다이얼로그 마운트 |
| `src/App.css` | 수정 | 가져오기 다이얼로그 CSS |
| `src-tauri/src/lib.rs` | 수정 | File 메뉴에 Import 항목 추가 |

## Implementation Order
1. `notion-converter.ts` — 순수 함수, 테스트 먼저
2. Rust `extract_zip` — ZIP 해제 백엔드
3. `NotionImportDialog.tsx` — UI + 통합
4. 메뉴 연결 + 최종 검증
