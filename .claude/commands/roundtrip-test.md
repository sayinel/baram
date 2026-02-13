# /roundtrip-test — 라운드트립 정합성 검증

마크다운 → ProseMirror → 마크다운 변환의 무손실 보존을 검증한다.
Baram의 최우선 품질 기준.

## 사용법

```
/roundtrip-test              # 전체 Extension 테스트
/roundtrip-test heading      # 특정 Extension만
/roundtrip-test --level 2    # Level 2 복합 문서 테스트
/roundtrip-test --level 3    # Level 3 Fuzzy 테스트
```

## 인자

- `$ARGUMENTS`: (선택) Extension 이름 또는 테스트 레벨

---

## Level 1: 개별 요소 라운드트립 (기본)

각 Extension의 마크다운 구문이 변환 후 원본과 정확히 일치하는지 검증.

### 테스트 소스
1. **CommonMark 스펙**: 651개 테스트 케이스 — 표준 마크다운 호환성
2. **GFM 확장**: 테이블, 태스크리스트, 취소선 등
3. **Baram 확장 구문**: 수식, 위키링크, 콜아웃, 블록 참조 등

### 검증 규칙
```
입력 마크다운 → parse() → ProseMirror Doc → serialize() → 출력 마크다운
assert(출력 === 입력)  // 바이트 단위 일치
```

### 허용되는 정규화
- 줄 끝 문자: CRLF → LF 통일
- 파일 끝 빈 줄: 1개로 통일
- 연속 빈 줄: 2개로 통일

### 허용되지 않는 변형
- 공백 추가/삭제
- 들여쓰기 변경
- 구문 변경 (예: `*bold*` → `**bold**`)
- 속성 순서 변경 (YAML frontmatter)
- 이스케이프 추가/삭제

---

## Level 2: 복합 문서 라운드트립

여러 요소가 혼합된 실제 문서 5종으로 테스트.

### 테스트 문서

**1. README 스타일**
```markdown
# Project Title

## Features

- **Fast** rendering with KaTeX
- `inline code` support
- [Link](https://example.com)

### Installation

> Note: Requires Node.js 18+

1. Clone the repository
2. Run `npm install`
3. Start with `npm run dev`
```

**2. 학술 논문 스타일**
```markdown
---
title: "Research Paper"
author: "Author Name"
---

# Abstract

The equation $E = mc^2$ is fundamental. The full derivation:

$$
\frac{-b \pm \sqrt{b^2-4ac}}{2a}
$$

## Methodology

See [[related-work]] for details.
```

**3. Skills 파일 스타일**
```markdown
---
name: skill-name
description: "Skill description"
version: 1.0.0
tags: [code-gen, baram]
---

# Skill Title

## Instructions

<system>
You are a helpful assistant.
</system>

Use {{variable}} for dynamic content.
```

**4. 일기/노트 스타일**
```markdown
# 2026-02-13 Daily Note

## Tasks

- [x] Complete design document
- [ ] Start implementation
- [/] Review PR #42

## Notes

> [!tip] Remember
> Check [[meeting-notes]] before the standup.

#project-baram #development
```

**5. 기술 문서 스타일**
```markdown
# API Reference

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files` | List files |
| POST | `/api/files` | Create file |

### Code Example

\`\`\`typescript
const response = await fetch('/api/files')
const files = await response.json()
\`\`\`

\`\`\`mermaid
graph TD
    A[Client] --> B[API]
    B --> C[Database]
\`\`\`
```

---

## Level 3: Fuzzy 라운드트립

랜덤하게 생성된 마크다운으로 예상치 못한 엣지 케이스 탐지.

### 전략
1. 각 Extension의 유효한 마크다운 패턴을 랜덤 조합
2. 중첩 구조를 랜덤 깊이로 생성 (리스트 안 인용 안 코드 등)
3. 유니코드 (한글, 이모지, CJK 문자) 포함
4. 1,000개 랜덤 문서 생성 후 라운드트립 검증

---

## 결과 보고

```
=== Baram Roundtrip Test Report ===

Level 1: CommonMark   651/651  ✅
Level 1: GFM          120/120  ✅
Level 1: Baram Ext     42/45   ❌ (3 failures)

  FAIL: mathBlock — aligned 환경에서 줄 끝 공백 손실
  FAIL: table — 3열 이상 정렬 마커 변형
  FAIL: callout — 중첩 콜아웃 내 인라인 수식

Level 2: Complex Docs   5/5   ✅
Level 3: Fuzzy         997/1000 ❌ (3 failures)

Overall: 99.6% (1815/1821)
Target:  99.0% (Phase 1)
Status:  ✅ PASS
```

`docs/progress.json`의 roundtrip 필드를 업데이트한다.
