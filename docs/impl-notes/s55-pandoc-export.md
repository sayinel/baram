# §55 Pandoc Extended Export — 구현 노트

## Requirements (설계서에서 추출)

### 핵심 기능
1. **Pandoc 연동 확장 포맷**: 시스템에 Pandoc이 설치되어 있으면 추가 포맷 지원
   - Word (.docx): `pandoc -o output.docx`, 레퍼런스 템플릿 지원 (`--reference-doc`)
   - LaTeX (.tex): `pandoc -o output.tex`, 수식 네이티브 변환
   - Epub (.epub): `pandoc -o output.epub`, 전자책 메타데이터 설정
   - reStructuredText (.rst): `pandoc -o output.rst`, Python 문서용

2. **Pandoc 경로 설정**: 설정에서 Pandoc 경로를 지정 (기본값: `"pandoc"`)

3. **커스텀 Export 항목**: 설정에서 셸 명령으로 커스텀 Export 추가
   ```json
   {
     "name": "Hugo Blog Post",
     "command": "pandoc ${file} -o ${output_dir}/${basename}.html --template=hugo.html",
     "extension": "html",
     "show_in_menu": true
   }
   ```
   - 변수: `${file}`, `${basename}`, `${output_dir}`, `${vault_dir}`

4. **Word 레퍼런스 템플릿**: 헤딩 스타일, 폰트, 머리글/바닥글이 템플릿을 따름

## Dependencies (의존하는 모듈)
- `src-tauri/src/export/mod.rs` — 기존 PDF export 모듈 (확장)
- `src-tauri/src/commands/export_cmd.rs` — 기존 export IPC 커맨드 (확장)
- `src/components/export/ExportDialog.tsx` — 기존 ExportDialog (탭 추가)
- `src/stores/settings-store.ts` — pandocPath, customExports 설정 추가
- `src/ipc/types.ts` — ExportFormat 타입 확장
- `src/utils/export.ts` — Pandoc export 유틸 함수 추가

## Technical Challenges
1. **Pandoc 감지**: Pandoc이 설치되어 있는지, 어떤 버전인지 런타임 감지 필요
2. **크로스 플랫폼 셸 실행**: macOS/Windows/Linux에서 안전하게 Pandoc 프로세스 실행
3. **임시 파일 관리**: Pandoc은 파일 입력을 받으므로 MD를 임시 파일로 저장 후 변환
4. **명령 인젝션 방지**: 커스텀 Export의 셸 명령에서 보안 이슈
5. **수식 변환**: KaTeX → LaTeX 네이티브 변환 시 Pandoc `--katex` 또는 raw LaTeX 전달
6. **Pandoc이 없을 때 UX**: 기능 비활성화 + 설치 안내

## Edge Cases
- Pandoc 미설치 시 해당 포맷 비활성화 (grayed out)
- Pandoc 버전 호환성 (최소 2.0+ 권장)
- 큰 파일 변환 시 타임아웃 처리
- Windows에서 경로 구분자 처리
- 커스텀 Export 명령의 변수 치환 실패 시 에러 처리
- frontmatter가 있는 파일의 Pandoc 처리 (YAML frontmatter 지원)
- Baram 확장 문법(wikilink, callout 등)이 Pandoc에서 인식되지 않는 문제
  → Notion Export처럼 변환 전 호환 형식으로 전처리 필요

## Files to Create/Modify

### Rust (생성)
- `src-tauri/src/export/pandoc.rs` — Pandoc 감지, 실행, 에러 처리

### Rust (수정)
- `src-tauri/src/export/mod.rs` — pandoc 모듈 등록
- `src-tauri/src/commands/export_cmd.rs` — `export_pandoc`, `detect_pandoc`, `run_custom_export` IPC
- `src-tauri/src/lib.rs` — 새 IPC 커맨드 등록

### TypeScript (생성)
- `src/utils/pandoc-export.ts` — Pandoc용 MD 전처리 + export 유틸

### TypeScript (수정)
- `src/ipc/types.ts` — PandocExportFormat, PandocOptions 타입 추가
- `src/ipc/invoke.ts` — exportPandoc, detectPandoc IPC 래퍼
- `src/stores/settings-store.ts` — pandocPath, wordTemplatePath, customExports 설정
- `src/components/export/ExportDialog.tsx` — Pandoc 포맷 탭 추가
- `src/utils/export.ts` — exportWithPandoc 함수 추가

### 테스트 (생성)
- `src/utils/__tests__/pandoc-export.test.ts` — MD 전처리 + 변수 치환 테스트
- Rust: `src-tauri/src/export/pandoc.rs` 내 `#[cfg(test)]` 모듈

## Implementation Order
1. Rust: Pandoc 감지 + 실행 모듈 (`export/pandoc.rs`)
2. Rust: IPC 커맨드 추가 (`export_cmd.rs`)
3. TS: IPC 타입 + invoke 래퍼
4. TS: Pandoc용 MD 전처리 유틸 (`pandoc-export.ts`)
5. TS: Settings store 확장 (pandocPath, customExports)
6. TS: ExportDialog UI 확장 (Pandoc 포맷 탭)
7. TS: export.ts에 exportWithPandoc 통합
8. 테스트 작성 + 전체 테스트 스위트 통과 확인
