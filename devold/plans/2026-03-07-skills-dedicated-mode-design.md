# §72 Skills 전용 모드 — 설계 문서

**날짜**: 2026-03-07
**상태**: 승인됨
**범위**: 핵심 4개 기능

## 배경

M8에서 Skills 편집 기능(구문 하이라이팅 §41, 프롬프트 린트 §46, 자동 생성 §45, 인라인 테스트 §47)이 개별적으로 구현되었다. §72는 이들을 하나의 응집된 "Skills 전용 모드"로 통합하고, 부족한 UI 요소를 추가한다.

## 구현 범위

| # | 기능 | 설명 |
|---|------|------|
| 1 | Skills Workspace 자동 전환 | `type: skill` 파일 열면 레이아웃 자동 변경 |
| 2 | YAML Properties Panel | Frontmatter GUI 편집 (칩, 드롭다운, 파일 참조) |
| 3 | LLM 관점 미리보기 | 토큰 카운트 + LLM 입력 형태 프리뷰 |
| 4 | 참조 링크 네비게이션 | 파일 경로 Cmd+클릭 이동 |

## 접근 방식

**Workspace Preset 기반** — 기존 ui-store의 사이드바 상태 관리를 활용한다.

- `type: skill` 감지 시 자동으로 Skills 프리셋 활성화 (좌: 파일트리, 우: Properties Panel)
- 파일 전환 시 non-skill 파일이면 이전 레이아웃 복원
- Properties Panel은 우 사이드바의 새 탭으로 추가
- 기존 UI 인프라 재사용, 사용자가 수동 전환도 가능

## 컴포넌트 설계

### 1. Skills Mode 감지 & 자동 전환

- `useSkillsMode()` 훅: 현재 파일의 frontmatter에서 `type: skill` 감지
- `ui-store.ts`에 `skillsModeActive` 상태 추가
- 활성화 시: 우 사이드바 → Properties 탭 자동 선택
- 비활성화 시: 이전 우 사이드바 상태 복원

### 2. Properties Panel

우 사이드바 새 탭 (Backlinks, Graph, AI Chat 옆에 "Properties" 추가).

**타입별 UI:**

| 타입 | UI | 예시 |
|------|-----|------|
| string | 인라인 텍스트 입력 | name, description |
| string[] | 칩 UI + [+] 추가 | tags, requires |
| enum (status) | 드롭다운 | draft/active/deprecated |
| file ref | 파일 참조 칩 (클릭 이동) | requires 배열 내 파일명 |

**추가 기능:**
- `</>` 버튼: YAML 소스 직접 편집 모드 전환
- 필수 필드 검증: name, description 비어있으면 인라인 경고
- 변경 시 에디터 frontmatter 노드와 양방향 동기화
- `+ 속성 추가` 버튼: 키 이름 입력 → 타입 선택

### 3. LLM 미리보기

- 커맨드 팔레트: "Skills: Preview as LLM Input"
- 하단 패널 (split view)로 표시
- frontmatter + 본문 + 참조 파일 조합 → LLM 전달 형태 렌더링
- 토큰 카운트 표시 (근사치: 영문 ~4chars/token, 한글 ~2chars/token)
- `{{변수}}` 플레이스홀더 하이라이트

### 4. 참조 링크 네비게이션

- 기존 prompt-highlight.ts의 파일 경로 감지 확장
- Decoration에 클릭 핸들러 추가
- Cmd+클릭 시 openTab() 호출로 해당 파일 이동
- 존재하지 않는 파일은 dim 스타일 + 툴팁 "File not found"

## 데이터 흐름

```
파일 열기 → frontmatter 파싱 → isSkillFile?
  ├─ Yes → skillsModeActive = true
  │        ├─ 우 사이드바 → Properties 탭
  │        ├─ prompt-highlight 활성화 (기존)
  │        ├─ prompt-lint 활성화 (기존)
  │        └─ 참조 링크 클릭 핸들러 등록
  └─ No  → skillsModeActive = false
           └─ 이전 사이드바 상태 복원
```

## 파일 구조

```
src/
├── components/sidebar/PropertiesPanel.tsx    ← NEW
├── components/ai/SkillPreviewPanel.tsx       ← NEW
├── hooks/use-skills-mode.ts                  ← NEW
├── stores/ui-store.ts                        ← 수정
├── extensions/plugins/prompt-highlight.ts    ← 수정
└── utils/token-counter.ts                    ← NEW
```

## 테스트 전략

- `use-skills-mode`: frontmatter 감지 로직 단위 테스트
- `PropertiesPanel`: YAML 파싱 ↔ GUI ↔ frontmatter 업데이트 통합 테스트
- `token-counter`: 토큰 카운트 정확도 테스트
- 참조 링크: 경로 감지 + 파일 존재 확인 테스트
