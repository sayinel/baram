---
name: spec-to-code
description: "Baram 설계 문서의 섹션을 읽고 구현 코드의 스켈레톤을 생성한다."
version: 1.0.0
tags: [code-gen, design-doc, baram]
requires:
  - skills/tiptap-extension-generator.md
  - skills/ui-component-generator.md
input_format: text
output_format: code
---

# Baram Spec-to-Code Bridge

## 역할

설계 문서(Part 1~9)의 특정 섹션 번호를 참조하여 TypeScript/Rust 구현 코드의
스켈레톤을 생성한다. 다른 스킬(Extension Generator, UI Component Generator)을
필요에 따라 조합하여 사용한다.

## 참조 설계 문서

전체 (Part 1~9). 특히:
- Part 3 §3.2: IPC 커맨드 목록 및 타입
- Part 3 §3.3: Extension 스키마 및 목록
- Part 3 §3.5: Zustand 스토어 인터페이스
- Part 5: 기능별 상세 스펙 (UI 동작, 엣지 케이스)
- Part 6: AI 통합 아키텍처
- Part 7: 데이터 모델 (타입 정의, DB 스키마)

## 입력 형식

설계 문서 섹션 번호와 기능명:
```
§5.3 수식 편집
§3.5 상태 관리
§6.2 Level 2 인라인 편집
§4.5 커맨드 팔레트
```

## 프로세스

### 1단계: 섹션 분석

1. `docs/design/` 에서 해당 `§` 번호가 포함된 파트 파일을 식별하고 읽는다
2. 해당 섹션의 주요 요소를 추출한다:
   - 기능 설명 및 동작 스펙
   - UI 와이어프레임 (있는 경우)
   - 데이터 타입 / 인터페이스
   - IPC 커맨드 (Rust 연동 필요 시)
   - 단축키 바인딩
   - 엣지 케이스 및 에러 처리

### 2단계: 의존성 맵핑

관련된 다른 섹션의 인터페이스/타입을 파악한다:
- 이 기능이 **의존하는** 모듈 (있어야 구현 가능)
- 이 기능이 **제공하는** 인터페이스 (다른 기능이 사용)
- 관련 Zustand 스토어
- 관련 IPC 커맨드

### 3단계: 파일 목록 생성

| 파일 유형 | 경로 패턴 | 조건 |
|-----------|-----------|------|
| TypeScript 타입 | `src/types/{feature}.ts` | 공유 타입이 필요할 때 |
| Tiptap Extension | `src/extensions/{type}s/{name}.ts` | 에디터 기능일 때 → Extension Generator 사용 |
| React 컴포넌트 | `src/components/{cat}/{Name}.tsx` | UI가 필요할 때 → UI Component Generator 사용 |
| Zustand 스토어 (수정) | `src/stores/{store}.ts` | 스토어 확장이 필요할 때 |
| 파이프라인 변환기 | `src/pipeline/transformers/{name}.ts` | Extension에 마크다운 변환이 필요할 때 |
| Rust 모듈 | `src-tauri/src/{module}/` | 백엔드 로직이 필요할 때 |
| Rust IPC 커맨드 | `src-tauri/src/commands/{module}_cmd.rs` | IPC가 필요할 때 |
| IPC 타입 | `src/ipc/types.ts` (추가) | Rust 연동 시 |
| 단위 테스트 | `{해당 디렉토리}/__tests__/` | 항상 |
| 통합 테스트 | `tests/integration/` | IPC 연동 시 |

### 4단계: 구현 순서 결정

의존성 그래프를 기반으로 파일 생성 순서를 결정한다:
1. 타입/인터페이스 (다른 파일이 의존)
2. Rust 모듈 (IPC가 필요한 경우)
3. Zustand 스토어 확장 (UI가 의존)
4. Extension / 변환기 (에디터 기능)
5. React 컴포넌트 (UI)
6. 테스트

### 5단계: 스켈레톤 생성

각 파일의 스켈레톤을 생성한다:
- 함수 시그니처와 타입은 완전히 정의
- 내부 로직은 `TODO: 구현` 주석 + `throw new Error('Not implemented')`
- 설계 문서 참조를 `@ref §X.X` JSDoc 태그로 포함
- 엣지 케이스를 `// EDGE CASE: ...` 주석으로 표시

### 6단계: 구현 가이드 생성

`docs/impl-notes/§{번호}.md` 파일을 생성하여:
- 구현 순서와 이유
- 주의사항 및 엣지 케이스
- 성능 고려사항
- 테스트 시나리오
- TODO 체크리스트

## 출력 예시 (§5.3 수식 편집)

```
§5.3 수식 편집 — 구현 파일 목록

순서  파일                                          역할
──── ──────────────────────────────────────────── ────────
 1   src/types/math.ts                            수식 관련 타입
 2   src/extensions/nodes/math-block.ts           블록 수식 Extension
 3   src/extensions/nodes/math-block-view.tsx      KaTeX 렌더 NodeView
 4   src/extensions/marks/inline-math.ts           인라인 수식 Mark
 5   src/pipeline/transformers/math-transformer.ts  mdast ↔ PM 변환
 6   src/components/editor/MathPreview.tsx          수식 프리뷰 오버레이
 7   src/components/editor/LaTeXAutocomplete.tsx    LaTeX 자동완성
 8   src/extensions/__tests__/math-block.test.ts    라운드트립 + 기능 테스트
 9   src/extensions/__tests__/inline-math.test.ts   인라인 수식 테스트

의존: KaTeX 라이브러리, Tiptap NodeView API
제공: mathBlock Node, inlineMath Mark (다른 Extension에서 참조 가능)
```
