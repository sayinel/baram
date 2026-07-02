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

1. **메뉴 개선 (A안)**: 발견 가능한 `Export ▾` 드롭다운 진입점 + 카테고리 그룹 + 스마트 진입(옵션 없는 포맷 원클릭) + 포맷 포커스 다이얼로그.
2. **Mermaid 렌더 출력**: Pandoc 전 포맷(Word/LaTeX/EPUB/RST)은 PNG 임베드, Notion은 네이티브 코드블록 유지로 다이어그램이 실제로 렌더되도록 한다.

## 3. 비목표 (YAGNI)

- 커스텀 export(§55 `run_custom_export`) 메뉴 재설계 — 별도 과제.
- HTML/PDF 변환 경로 변경 — 이미 정상 동작.
- Notion을 ZIP 번들(.md + images/)로 바꾸는 것 — 네이티브 코드블록 렌더로 충분하므로 도입하지 않는다.

## 4. 설계 A — 메뉴

### 4.1 진입점
- **주 진입점**: `TabBar` 우측 끝에 `Export ▾` 아이콘 버튼 추가 (항상 보이는 상단 chrome).
- **유지**: `CommandPalette`의 "Export..." 항목은 그대로 둔다(`Cmd+P` 워크플로우 보존).
- **선택(옵션)**: 네이티브 Tauri File 메뉴(`src-tauri/src/menu.rs`, `menu-event`)에 Export 서브메뉴 추가 — 저비용이면 포함, 아니면 후속.

### 4.2 드롭다운 구조
기존 메뉴 패턴(`ContextMenu`, `buildMermaidBlockMenu`)을 재사용해 항목 배열로 구성한다.

```
Export ▾
  웹
    HTML
    PDF            ▸ (옵션: 용지/배율)
  ──────────────
  마크다운
    Notion
  ──────────────
  문서 (Pandoc)                 ← pandoc 미설치 시 그룹 disabled + 힌트
    Word (.docx)   ▸ (옵션: 템플릿)
    LaTeX
    EPUB
    RST
```

### 4.3 스마트 진입
- **옵션 없는 포맷**(HTML, Notion, LaTeX, EPUB, RST): 곧바로 네이티브 save dialog → export 실행.
- **옵션 있는 포맷**(PDF=용지/배율, Word=템플릿): 해당 포맷 옵션만 담은 **포커스 다이얼로그**를 연다.
- 기존 전체 `ExportDialog`(모든 포맷 카드 + 옵션)는 fallback으로 유지한다(커맨드 팔레트 진입 시).

### 4.4 컴포넌트 변경
- **신규** `src/components/export/ExportMenu.tsx`: 드롭다운 메뉴. 포맷 메타(`FORMAT_OPTIONS`)를 `ExportDialog`에서 공유 모듈로 추출해 재사용.
- **리팩터** `src/components/export/ExportDialog.tsx`: 특정 포맷만 표시하는 "포커스 모드" 지원(선택 포맷 prop). 기존 전체 모드 유지.
- 포맷 메타(`FORMAT_OPTIONS`, `PANDOC_FORMATS`, `isPandocFormat`)를 `src/components/export/export-formats.ts`(신규)로 추출 → 메뉴/다이얼로그 공유.

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

프론트엔드
- `src/components/layout/TabBar.tsx` — `Export ▾` 버튼 배치
- `src/components/export/ExportMenu.tsx` — 신규 드롭다운
- `src/components/export/export-formats.ts` — 신규 공유 포맷 메타
- `src/components/export/ExportDialog.tsx` — 포커스 모드
- `src/components/command/CommandPalette.tsx` — (유지, 필요 시 진입 정리)
- `src/utils/export/export.ts` — mermaid 수집/치환 + assets 전달
- `src/utils/export/mermaid-export-assets.ts` — 신규 헬퍼(수집·래스터·치환)
- `src/utils/export/notion-export.ts` — mermaid meta strip
- `src/ipc/export.ts`, `src/ipc/types.ts` — `assets` 인자

Rust
- `src-tauri/src/export/pandoc.rs` — assets 기록 + 경로 rewrite
- `src-tauri/src/commands/export_cmd.rs` — `export_pandoc` 시그니처
- `src-tauri/ipc-registry.json` — 동기화

## 8. 진행 방식

- 브랜치: `feature/export-improvements`
- 순서: 스펙 승인 → 구현 계획(writing-plans) → 구현(OMC `executor`/`deep-executor` 위임) → 테스트/verifier 검증 → PR.
- 커밋: Conventional Commits + `§5.12`/`§55` 섹션 참조.
