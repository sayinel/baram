# §72c Skill Mode Enhancements — Design Document

## Overview

스킬 모드에 5개 신규 기능을 추가하고, 향후 확장을 쉽게 하기 위한 경량 플러그인 레이어를 도입한다.

**접근 방식**: 접근 A + 경량 플러그인 레이어 — 기존 코드 재사용 극대화, SkillContext 공유 상태 + PropertiesPanel 섹션 레지스트리로 확장성 확보.

---

## 기반: SkillContext (공유 상태 레이어)

### 목적
스킬 관련 데이터를 한 곳에서 파싱/캐싱하여 모든 하위 기능이 구독하게 함.

### 구현: Zustand 스토어 `skill-store.ts`

```typescript
interface SkillState {
  isSkill: boolean;
  currentSkill: SkillMeta | null;
  allSkills: SkillMeta[];           // 워크스페이스 내 전체 스킬 (캐싱)
  lintResults: LintResult[];
  dependencyWarnings: DependencyWarning[];

  updateCurrentFile: (yaml: string, filePath: string) => void;
  scanWorkspace: () => Promise<void>;
  setLintResults: (results: LintResult[]) => void;
}
```

### 데이터 흐름
- `useSkillsMode` → `skill-store.updateCurrentFile()` 호출
- `SkillDependencySection` 워크스페이스 스캔 → `skill-store.scanWorkspace()`로 이동
- `prompt-lint` 플러그인 린트 완료 → `skill-store.setLintResults()`
- 각 UI 컴포넌트는 `useSkillStore((s) => s.필요한것)` 구독

---

## 기반: PropertiesPanel 섹션 레지스트리

### 목적
새 섹션을 PropertiesPanel.tsx 수정 없이 등록 가능하게 함.

### 구현: `skill-panel-registry.ts`

```typescript
interface SkillPanelSection {
  id: string;
  title: string;
  order: number;
  component: React.ComponentType;
  visible?: (state: SkillState) => boolean;
}

function registerSkillSection(section: SkillPanelSection): void;
function getSkillSections(): SkillPanelSection[];
```

### PropertiesPanel 변경
하드코딩된 `<SkillDependencySection>`을 레지스트리 루프로 교체:
```tsx
{getSkillSections()
  .filter(s => !s.visible || s.visible(skillState))
  .sort((a, b) => a.order - b.order)
  .map(s => <s.component key={s.id} />)}
```

기존 SkillDependencySection은 `registerSkillSection({ id: "dependencies", order: 50 })`로 등록.

---

## 기능 1: 스킬 변수 자동완성

### 트리거
`{{` 2글자 입력 감지 → Tiptap Suggestion 플러그인 드롭다운.

### 후보 목록
- 기본 변수: `selection`, `document`, `input`, `clipboard`
- 체인 변수: `step1.output`, `step2.output` (frontmatter `steps` 값 기반)
- 커스텀 변수: frontmatter `variables: [x, y]`에서 추출

### 동작
항목 선택 시 `{{variable}}` 완성, `}}` 자동 닫기.

### 파일
- `src/extensions/plugins/skill-variable-suggest.ts` — Tiptap Suggestion 플러그인
- `src/components/editor/SkillVariableList.tsx` — 드롭다운 UI
- 데이터 소스: `useSkillStore`에서 currentSkill 메타 구독

---

## 기능 2: 실시간 린트 PropertiesPanel 표시

### 표시
PropertiesPanel 상단에 린트 요약 섹션 (레지스트리 order: 10).

### UI
- 에러 수 빨간 배지 + 경고 수 노란 배지
- 펼치기: 클릭 시 린트 항목 목록 (규칙명 + 메시지)
- 이동: 항목 클릭 → 에디터에서 해당 위치로 커서 이동 (prompt-lint의 pmFrom/pmTo)

### 파일
- `src/components/sidebar/SkillLintSection.tsx`
- 데이터 소스: `useSkillStore((s) => s.lintResults)`

---

## 기능 3: 라이브 프리뷰 분할 뷰

### 현재
Command Palette에서 수동으로 SkillPreviewPanel을 열어야 함.

### 변경
PropertiesPanel에 "Live Preview" 토글 섹션 등록 (order: 30).

### 동작
- 토글 ON 시 에디터 내용 변경마다 시스템/유저 블록 파싱 → 프리뷰 자동 갱신
- 디바운스: 500ms
- 토큰 수 + 시스템/유저 블록 하이라이트 (기존 SkillPreviewPanel 렌더 로직 재사용)

### 파일
- `src/components/sidebar/SkillLivePreview.tsx`
- 기존 `extractSkillPrompt()` 재사용

---

## 기능 4: 스킬 마켓플레이스/갤러리

### 진입점
사이드바 아이콘 + Command Palette "Skills Gallery".
UI 스토어 `sidebarPanel`에 `"skills-gallery"` 값 추가.

### 카드 레이아웃
스킬당 카드: name, description, tags 칩, requires 수, output_format 배지.

### 검색/필터
상단 검색바 (name/description 매칭) + tags 필터 드롭다운.

### 카드 액션
- 클릭 → 해당 스킬 파일 열기
- 더보기 → 의존성 그래프 보기

### 파일
- `src/components/sidebar/SkillGalleryPanel.tsx`
- 데이터 소스: `useSkillStore((s) => s.allSkills)`

---

## 기능 5: 프롬프트 최적화 제안

### UI
PropertiesPanel 섹션 (order: 40), "Optimize" 버튼.

### 동작
버튼 클릭 → 현재 스킬 파일 전체를 LLM에 전송 → 스트리밍 응답으로 제안 표시.

### 제안 항목
명확성 개선, 토큰 절약, 누락된 지시사항, 더 나은 변수 활용.

### 응답 표시
카드 형태로 제안별 표시, "적용" 버튼 (해당 부분을 에디터에 반영).

### 파일
- `src/utils/skill-optimize-prompt.ts` — 분석 시스템 프롬프트 빌더
- `src/components/sidebar/SkillOptimizeSection.tsx`

---

## 구현 순서

1. SkillContext (skill-store) + 섹션 레지스트리 — 기반 인프라
2. 기존 SkillDependencySection 레지스트리 마이그레이션
3. 기능 2: 린트 섹션 (가장 간단, 레지스트리 검증)
4. 기능 1: 변수 자동완성 (독립적, 에디터 경험 개선)
5. 기능 3: 라이브 프리뷰 (기존 코드 재사용)
6. 기능 4: 스킬 갤러리 (새 패널, 독립적)
7. 기능 5: 프롬프트 최적화 (LLM 의존, 마지막)
