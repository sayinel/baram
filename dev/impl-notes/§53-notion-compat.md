# §53 Export for Notion — 구현 노트

## 개요

Baram 마크다운을 Notion 호환 마크다운으로 변환하는 Export 기능.
Notion의 마크다운 가져오기가 이해하지 못하는 Baram 고유 문법을 자동 변환한다.

> 초기에 Notion Import 기능을 구현했으나, 사용자 피드백으로 방향 전환:
> "노션에서 Export한 md 파일은 별다른 변환없이도 이미 잘 읽을 수 있다.
> Import 대신 Baram→Notion Export가 필요하다."

## 변환 규칙 (12개)

| Baram 문법 | Notion 변환 | 함수 |
|---|---|---|
| `[[page]]` | `[page](page.md)` | `convertWikilinksForNotion` |
| `> [!type]` callout | `> emoji **Type**` | `convertCalloutsForNotion` |
| `$inline$` math | `$$inline$$` | `convertInlineMathForNotion` |
| `==text==` highlight | `**text**` bold | `convertHighlightForNotion` |
| `~text~` subscript | Unicode or `$_{text}$` | `convertSubscriptForNotion` |
| `^text^` superscript | Unicode or `$^{text}$` | `convertSuperscriptForNotion` |
| `[^id]` footnotes | `(id)` + Notes section | `convertFootnotesForNotion` |
| `((ref))`, `^blockId` | 제거 | `stripBlockRefsForNotion` |
| Definition lists | `**Term**\n: Definition` | `convertDefinitionListsForNotion` |
| `[TOC]` | 제거 | `stripTocForNotion` |
| `<details>` toggle | `**▶ Title**` + body | `convertToggleForNotion` |
| `<u>text</u>` underline | `*text*` italic | `convertUnderlineForNotion` |

## Subscript/Superscript 전략 (Strategy C: Hybrid)

- 숫자와 매핑 가능한 라틴 문자 → Unicode 변환 (₀₁₂₃…, ⁰¹²³…)
- 매핑 불가능한 문자 → LaTeX math fallback (`$_{text}$`, `$^{text}$`)
- `toUnicodeSubscript()` / `toUnicodeSuperscript()` 헬퍼 함수

## 수식 보호

`replaceOutsideCode()`는 코드 블록, 인라인 코드, **수식 블록** (`$$...$$`)을 보호 영역으로 인식하여
인라인 변환기가 LaTeX 내부의 `^`, `_` 등을 건드리지 않도록 한다.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `src/utils/notion-export.ts` | 12개 변환 함수 + Unicode 헬퍼 + `convertForNotion()` 오케스트레이터 |
| `src/utils/__tests__/notion-export.test.ts` | 76개 테스트 |
| `src/utils/export.ts` | `exportForNotion()` — PM doc → md → convertForNotion → save dialog |
| `src/components/export/ExportDialog.tsx` | Notion 탭 추가 |
| `src/stores/ui-store.ts` | `ExportFormat = "html" | "pdf" | "notion"` |
| `src-tauri/src/lib.rs` | "Export for Notion" 메뉴 항목 |

## 테스트

- Vitest: 912/912 pass (76 notion-export tests 포함)
- TypeScript: clean
- Cargo check: clean
