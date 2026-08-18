# Export 기능 개선 설계 (2026-07-02)

> 관련 설계 문서: §5.12 (Export), §53 (Notion), §55 (Pandoc), §5.5 (Mermaid)

## 1. 배경 / 동기

현재 Baram의 내보내기(Export) 기능에는 두 가지 개선점이 있다.

**메뉴 발견성/구조 문제**
- Export 진입점이 `CommandPalette`의 "Export..." 항목 1곳뿐(`CommandPalette.tsx:262`)이라, 커맨드 팔레트를 모르는 사용자는 기능을 찾기 어렵다.
- `ExportDialog` 모달 안에서 7개 포맷(HTML/PDF/Notion/Word/LaTeX/EPUB/RST)이 **평면 세로 카드로 나열**되어(`ExportDialog.tsx:211-240`) 카테고리 구분이 없고, 커스텀 export가 늘어나면 계속 길어진다.

**Mermaid 다이어그램이 문서 포맷에서 렌더되지 않음**
- HTML/PDF는 라이브 DOM의 렌더된 SVG를 캡처(`captureEditorHTML`)하므로 이미 정상 출력된다.
- 그러나 Pandoc 경로(docx/latex/epub/rst)는 `convertForPandoc()`(`pandoc-export.ts:48`)가 ` ```mermaid ` 코드블록을 **그대로 통과**시켜, Pandoc이 이를 다이어그램이 아닌 **모노스페이스 소스 텍스트**로 출력한다.
- Notion 경로도 mermaid 블록을 통과시키지만, 별도 정리가 없다.

## 2. 목표

1. **메뉴 개선**: 네이티브 **File 메뉴에 `Export...` 항목** 추가(발견성 확보) + `ExportDialog`의 포맷 선택을 평면 나열식 카드에서 **카테고리 그룹 드롭다운 메뉴**로 개선.
2. **Mermaid 렌더 출력**: Pandoc 전 포맷(Word/LaTeX/EPUB/RST)은 PNG 임베드, Notion은 네이티브 코드블록 유지로 다이어그램이 실제로 렌더되도록 한다.

## 3. 비목표 (YAGNI)

- **Export를 TabBar 등에 배치하지 않는다** — Export는 문서 전체 대상 동작이므로 진입점은 File 메뉴/다이얼로그로 둔다(Mermaid PNG 복사 같은 블록-단위 액션과 다름).
- 스마트 즉시 export / 포맷 포커스 다이얼로그 — 단일 다이얼로그(드롭다운 포맷 선택 + 옵션) 흐름을 유지하므로 도입하지 않는다.
- 커스텀 export(§55 `run_custom_export`) 메뉴 재설계 — 별도 과제.
- HTML/PDF 변환 경로 변경 — 이미 정상 동작.
- Notion을 ZIP 번들(.md + images/)로 바꾸는 것 — 네이티브 코드블록 렌더로 충분하므로 도입하지 않는다.

## 4. 설계 A — 메뉴

Export는 문서 전체를 대상으로 하는 동작이므로, 진입점은 **File 메뉴**에 두고, 실제 포맷 선택 UI는 **팝업(ExportDialog) 내부**에서 개선한다.

### 4.1 진입점 (이미 구현됨 — 검증만)
- 네이티브 File 메뉴의 `Export...` 항목은 **이미 존재하고 연결되어 있다**: `src-tauri/src/menu.rs:48`(id `export_doc`) → `src/hooks/use-menu-event-handler.ts:67`에서 `useUIStore.getState().openExportDialog("html")`로 매핑됨. **추가 작업 불필요**, 동작 검증만 한다.
- `CommandPalette`의 "Export..." 항목(`CommandPalette.tsx:262`)도 그대로 유지.

### 4.2 팝업(ExportDialog) 포맷 선택 개선 — 나열식 → 드롭다운 메뉴
현재 7개 포맷을 세로 카드로 나열하던 `export-format-list`(`ExportDialog.tsx:211-240`)를 **카테고리 그룹 드롭다운 메뉴**로 교체한다.

- 현재 선택 포맷을 표시하는 **트리거 버튼**(예: `Word (.docx) ▾`) → 클릭 시 드롭다운 팝업.
- 팝업은 카테고리로 그룹화하고, 각 항목에 확장자 배지·설명·pandoc 배지를 유지한다. pandoc 미설치 시 문서 그룹 항목은 disabled + 안내.

```
[ Word (.docx)                       ▾ ]   ← 트리거 버튼(현재 선택)
┌─────────────────────────────────────┐
│ 웹                                   │
│   .html  HTML     Standalone page    │
│   .pdf   PDF      Print-ready        │
│ ───────────────────────────────────  │
│ 마크다운                              │
│   .md    Notion   Notion-compatible  │
│ ───────────────────────────────────  │
│ 문서 (Pandoc)          pandoc 미설치시 │
│   .docx  Word     Editable    [pandoc]│
│   .tex   LaTeX    Typesetting [pandoc]│
│   .epub  EPUB     E-book      [pandoc]│
│   .rst   RST      Sphinx      [pandoc]│
└─────────────────────────────────────┘
```

- 포맷 선택 후, 기존과 동일하게 포맷별 옵션(PDF=용지/배율, Word=템플릿, Notion 힌트)이 다이얼로그 하단에 표시되고, `Export` 버튼으로 실행한다.

### 4.3 컴포넌트 변경
- **신규** `src/components/export/ExportFormatDropdown.tsx`: 카테고리 그룹 드롭다운(기존 `ContextMenu`/`buildMermaidBlockMenu` 팝업 패턴과 스타일 일관). `FORMAT_OPTIONS` 메타를 입력받아 렌더.
- **리팩터** `src/components/export/ExportDialog.tsx`: `export-format-list` 카드 블록을 `ExportFormatDropdown`으로 교체. 나머지(제목·옵션·footer) 유지.
- **CSS**: `styles/dialogs.css`(또는 해당 export 스타일)에 드롭다운 스타일 추가. 기존 `export-format-*` 카드 스타일은 제거/치환.

## 5. 설계 B — Mermaid 렌더 출력

### 5.1 Pandoc 경로 (docx / latex / epub / rst)

**프론트엔드** (`exportWithPandoc`, `export.ts`):
1. `editor.state.doc`를 순회하며 `mermaidBlock` 노드를 등장 순서대로 수집(`code` attr).
2. 각 code에 대해 `renderMermaidRasterSvg(code)` → `svgToPngBlob(svgHtml, 2)` → PNG bytes(base64) 생성. (PR #157 자산 재사용)
3. `prosemirrorToMarkdown` → `convertForPandoc` 결과에서 **N번째 ` ```mermaid ` 코드펜스**를 `![](baram-asset:mermaid-{N}.png)`로 치환. (doc 순서 == 마크다운 fence 등장 순서로 1:1 매핑)
4. `exportPandoc(md, path, format, ..., assets)` 호출 — `assets = [{ name: "mermaid-0.png", dataBase64 }, ...]`.

**Rust** (`run_pandoc`, `pandoc.rs`):
5. `assets`를 pandoc 입력 temp dir에 파일로 기록.
6. 마크다운 내 `baram-asset:NAME` 참조를 temp dir의 절대경로로 rewrite.
7. pandoc 실행 → 각 포맷이 PNG를 임베드(docx=인라인 이미지, latex=`\includegraphics`, epub=임베드, rst=이미지 참조).

**IPC 변경**:
- `export_pandoc` 커맨드에 `assets: Vec<PandocAsset>`(`{ name: String, data_base64: String }`) 인자 추가. 기본 빈 배열(하위호환).
- `src/ipc/export.ts`의 `exportPandoc` 시그니처에 `assets?` 추가.
- `src-tauri/ipc-registry.json` + `src/ipc/types.ts` 동기화.

**매칭 정확도 주의**: `mermaidBlock`의 `code` attr과 마크다운 fence value는 `%% baram-meta`(width/caption) 때문에 다를 수 있으므로, 매칭 키는 코드 내용이 아니라 **"문서 내 mermaid 코드펜스의 순번(N)"**으로 한다.

### 5.2 Notion 경로

- Notion은 코드블록의 `mermaid` 언어를 **네이티브로 렌더**하므로, ` ```mermaid ` 펜스를 그대로 유지하는 것이 최선(편집 가능, 이미지 파일 불필요, 단일 .md 유지).
- `convertForNotion`에 **`stripMermaidMeta` 적용**을 추가해 `%% baram-meta` 주석 라인을 제거 → 깔끔한 mermaid 코드블록만 남긴다.
- 결과: 단일 `.md` 파일. Notion import 시 다이어그램이 코드블록 프리뷰로 렌더된다.

### 5.3 에러 처리
- 개별 mermaid 렌더 실패: 해당 블록은 원본 ` ```mermaid ` 코드블록으로 남기고 나머지는 정상 진행(부분 성공). 실패 사유는 로깅.
- pandoc 미설치: 기존 로직 유지(포맷 disabled + 안내).

## 6. 테스트 전략

- **단위**
  - `convertForNotion`: `%% baram-meta` 제거 + ` ```mermaid ` fence 보존.
  - mermaid 마커 치환 함수: N번째 fence를 `baram-asset:mermaid-N.png`로 정확히 치환, 코드/텍스트 영역 오검출 없음.
  - Rust: `assets` temp dir 기록 + `baram-asset:` 절대경로 rewrite.
- **통합**
  - mermaid 포함 doc → pandoc 마크다운에 이미지 참조가 생성되고 `assets` 배열이 순서대로 구성되는지.
  - 기존 라운드트립/export 테스트 회귀 없음.
- **수동/QA**
  - 실제 `.docx`를 열어 다이어그램 이미지가 임베드됐는지, LaTeX/EPUB/RST도 확인.
  - Notion import로 mermaid 코드블록이 렌더되는지 확인.
  - `verifier` 에이전트로 증거 기반 확인.

## 7. 영향 파일 (예상)

메뉴 (프론트엔드) — File 메뉴 진입점은 이미 존재하므로 다이얼로그만 개선
- `src/components/export/ExportFormatDropdown.tsx` — 신규 카테고리 그룹 드롭다운
- `src/components/export/ExportDialog.tsx` — 나열식 카드 → 드롭다운 교체
- `src/styles/dialogs.css`(또는 export 스타일) — 드롭다운 스타일
- 검증만: `src-tauri/src/menu.rs:48`(`export_doc`), `src/hooks/use-menu-event-handler.ts:67` (변경 없음)

Mermaid 렌더 출력 (프론트엔드)
- `src/utils/export/export.ts` — mermaid 수집/치환 + assets 전달
- `src/utils/export/mermaid-export-assets.ts` — 신규 헬퍼(수집·래스터·치환)
- `src/utils/export/notion-export.ts` — mermaid `%% baram-meta` strip
- `src/ipc/export.ts`, `src/ipc/types.ts` — `assets` 인자

Mermaid 렌더 출력 (Rust)
- `src-tauri/src/export/pandoc.rs` — assets 기록 + `baram-asset:` 경로 rewrite
- `src-tauri/src/commands/export_cmd.rs` — `export_pandoc` 시그니처
- `src-tauri/ipc-registry.json` — 동기화

## 8. 진행 방식

- 브랜치: `feature/export-improvements`
- 순서: 스펙 승인 → 구현 계획(writing-plans) → 구현(OMC `executor`/`deep-executor` 위임) → 테스트/verifier 검증 → PR.
- 커밋: Conventional Commits + `§5.12`/`§55` 섹션 참조.
