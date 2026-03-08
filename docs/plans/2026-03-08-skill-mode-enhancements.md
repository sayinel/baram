# §72c Skill Mode Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 스킬 모드에 공유 상태 레이어 + 섹션 레지스트리를 도입하고, 변수 자동완성, 린트 표시, 라이브 프리뷰, 갤러리, 프롬프트 최적화 5개 기능을 추가한다.

**Architecture:** Zustand `skill-store`가 스킬 메타/린트/의존성 데이터를 중앙 관리. `skill-panel-registry`가 PropertiesPanel 섹션을 동적 등록. 각 기능은 독립 파일로 구현하여 레지스트리에 등록만 하면 동작.

**Tech Stack:** React 19, Zustand, Tiptap Suggestion API, 기존 LLM 스트리밍 인프라 (useLLMStream)

---

### Task 1: skill-store (공유 상태 스토어)

**Files:**
- Create: `src/stores/skill-store.ts`
- Create: `src/stores/__tests__/skill-store.test.ts`
- Modify: `src/hooks/use-skills-mode.ts` — 스토어 연동

**Step 1: 스토어 생성**

`src/stores/skill-store.ts`:
```typescript
import { create } from "zustand";
import type { SkillMeta, DependencyWarning } from "../utils/skill-dependency-analyzer";
import type { LintResult } from "../utils/prompt-linter";
import {
  parseSkillFrontmatter,
  analyzeSkillDependencies,
  buildDependencyGraph,
  getReverseDependencies,
  getImpactAnalysis,
} from "../utils/skill-dependency-analyzer";
import { isSkillFrontmatter } from "../hooks/use-skills-mode";
import type { FileEntry } from "./file-store";
import { useFileStore } from "./file-store";

interface SkillState {
  isSkill: boolean;
  currentSkill: SkillMeta | null;
  allSkills: SkillMeta[];
  lintResults: LintResult[];
  dependencyWarnings: DependencyWarning[];
  scanning: boolean;

  updateCurrentFile: (yaml: string, filePath: string) => void;
  scanWorkspace: () => Promise<void>;
  setLintResults: (results: LintResult[]) => void;
}
```

스토어 구현:
- `updateCurrentFile`: `isSkillFrontmatter(yaml)` 체크 → `parseSkillFrontmatter()` → set currentSkill
- `scanWorkspace`: `useFileStore.getState().fileTree`에서 .md 파일 수집 → IPC readFile → 스킬 파싱 → set allSkills + dependencyWarnings
- `setLintResults`: prompt-lint 플러그인에서 호출

**Step 2: 테스트 작성**

`src/stores/__tests__/skill-store.test.ts`:
- `updateCurrentFile` 스킬 감지 테스트
- `updateCurrentFile` 비스킬 파일 테스트
- `setLintResults` 업데이트 테스트

**Step 3: useSkillsMode 연동**

`src/hooks/use-skills-mode.ts` 수정:
- `useEffect` 내에서 `useSkillStore.getState().updateCurrentFile(yaml, filePath)` 호출
- 기존 `isSkillFrontmatter` 로직은 유지 (UI 전환용)

**Step 4: prompt-lint 연동**

`src/extensions/plugins/prompt-lint.ts` 수정:
- `buildLintState()` 함수 끝에서 `useSkillStore.getState().setLintResults(results)` 호출
- import 추가

**Step 5: 테스트 실행 및 커밋**

Run: `npx vitest run src/stores/__tests__/skill-store.test.ts`
Commit: `feat(§72c): add skill-store — shared state for skill mode features`

---

### Task 2: skill-panel-registry (섹션 레지스트리)

**Files:**
- Create: `src/components/sidebar/skill-panel-registry.ts`
- Create: `src/components/sidebar/__tests__/skill-panel-registry.test.ts`
- Modify: `src/components/sidebar/PropertiesPanel.tsx`
- Modify: `src/components/sidebar/SkillDependencySection.tsx`

**Step 1: 레지스트리 생성**

`src/components/sidebar/skill-panel-registry.ts`:
```typescript
import type { ComponentType } from "react";

export interface SkillPanelSection {
  id: string;
  title: string;
  order: number;
  component: ComponentType;
}

const sections: SkillPanelSection[] = [];

export function registerSkillSection(section: SkillPanelSection): void {
  const idx = sections.findIndex((s) => s.id === section.id);
  if (idx >= 0) sections[idx] = section;
  else sections.push(section);
}

export function getSkillSections(): SkillPanelSection[] {
  return [...sections].sort((a, b) => a.order - b.order);
}
```

**Step 2: 테스트 작성**

- `registerSkillSection` 등록/중복 방지 테스트
- `getSkillSections` 정렬 순서 테스트

**Step 3: SkillDependencySection 레지스트리 등록**

`src/components/sidebar/SkillDependencySection.tsx` 파일 끝에 추가:
```typescript
import { registerSkillSection } from "./skill-panel-registry";
registerSkillSection({
  id: "dependencies",
  title: "Dependencies",
  order: 50,
  component: SkillDependencySection,
});
```

**Step 4: PropertiesPanel 레지스트리 루프로 교체**

`src/components/sidebar/PropertiesPanel.tsx`:
- 하드코딩된 `<SkillDependencySection>` import/렌더 제거
- `getSkillSections()` import
- 렌더 영역에 레지스트리 루프:
```tsx
{yaml !== null && isSkillFrontmatter(yaml) && (
  getSkillSections().map((s) => <s.component key={s.id} />)
)}
```

**Step 5: 테스트 실행 및 커밋**

Run: `npx vitest run src/components/sidebar/__tests__/skill-panel-registry.test.ts`
Run: `npx tsc --noEmit` (소스 파일 에러 없음 확인)
Commit: `feat(§72c): add skill-panel-registry — dynamic section registration`

---

### Task 3: SkillLintSection (린트 PropertiesPanel 표시)

**Files:**
- Create: `src/components/sidebar/SkillLintSection.tsx`

**Step 1: 컴포넌트 구현**

- `useSkillStore((s) => s.lintResults)` 구독
- 접을 수 있는 섹션 (기본 접힘)
- 헤더: "Lint" + 에러 수 빨간 배지 + 경고 수 노란 배지
- 펼치면: 항목별 규칙명 + 메시지, 클릭 시 에디터 커서 이동
- 커서 이동: `editor.commands.setTextSelection(pmFrom)` + `editor.commands.scrollIntoView()`
- 에디터 접근: `useEditorStore` 에서 에디터 인스턴스 없이, 커스텀 이벤트 `baram:goto-position` dispatch → App.tsx에서 처리

**Step 2: 레지스트리 등록**

```typescript
registerSkillSection({ id: "lint", title: "Lint", order: 10, component: SkillLintSection });
```

**Step 3: App.tsx에 `baram:goto-position` 이벤트 리스너 추가**

```typescript
useEffect(() => {
  const handler = (e: CustomEvent<{ from: number }>) => {
    if (!editor) return;
    editor.commands.setTextSelection(e.detail.from);
    editor.commands.scrollIntoView();
    editor.commands.focus();
  };
  window.addEventListener("baram:goto-position", handler as any);
  return () => window.removeEventListener("baram:goto-position", handler as any);
}, [editor]);
```

**Step 4: CSS 추가**

`src/App.css`:
- `.skill-lint-section`, `.skill-lint-badge`, `.skill-lint-item` 등
- 에러: 빨간 배지, 경고: 노란 배지

**Step 5: 빌드 검증 및 커밋**

Run: `npx tsc --noEmit`
Commit: `feat(§72c): add SkillLintSection — live lint results in properties panel`

---

### Task 4: 스킬 변수 자동완성

**Files:**
- Create: `src/extensions/plugins/skill-variable-suggest.ts`
- Create: `src/components/editor/SkillVariableList.tsx`

**Step 1: SkillVariableList 드롭다운 UI**

`src/components/editor/SkillVariableList.tsx`:
- 기존 `TagMenu.tsx` 패턴 참조 (forwardRef + useImperativeHandle)
- `SkillVariableItem` = `{ name: string, description: string }`
- 키보드 네비게이션: ArrowUp/Down/Enter/Escape
- 선택 시 `command({ name })` 콜백

**Step 2: Suggestion 플러그인**

`src/extensions/plugins/skill-variable-suggest.ts`:
- Tiptap `Extension.create()` + `Suggestion` 플러그인
- `char: "{{"`로 트리거 (2문자)
- `items({ query })`:
  - 기본 변수: `selection`, `document`, `input`, `clipboard`
  - `useSkillStore.getState().currentSkill`에서 frontmatter `variables` 추출
  - frontmatter `steps` 값 기반 `step1.output` ~ `stepN.output` 생성
  - `query`로 필터
- `command({ editor, range, props })`: `editor.chain().deleteRange(range).insertContent("{{" + props.name + "}}").run()`
- `render()`: `ReactRenderer` + `tippy` 팝업 (기존 tag-suggest.ts 패턴)

**Step 3: Extension 등록**

`src/extensions/index.ts`에 `SkillVariableSuggest` 추가. `isSkillFrontmatter` 체크로 스킬 파일에서만 활성화.

**Step 4: CSS 추가**

`.skill-var-list`, `.skill-var-item`, `.skill-var-item--selected`, `.skill-var-desc`

**Step 5: 빌드 검증 및 커밋**

Run: `npx tsc --noEmit`
Commit: `feat(§72c): add skill variable autocomplete — {{}} suggestion dropdown`

---

### Task 5: SkillLivePreview (라이브 프리뷰)

**Files:**
- Create: `src/components/sidebar/SkillLivePreview.tsx`

**Step 1: 컴포넌트 구현**

- 기존 `SkillPreviewPanel.tsx`의 파싱/렌더 로직 재사용 (`extractSkillPrompt`, `estimateTokenCount`)
- `useEditorStore` + `useFileStore`에서 현재 파일 콘텐츠 구독
- `contentRefreshKey` 구독으로 PropertiesPanel 변경도 반영
- 디바운스 500ms (`setTimeout` + cleanup)
- 토글 상태 로컬 `useState`
- 접힌 상태: "Preview" 헤더 + 토큰 수 배지
- 펼친 상태: 시스템/유저 블록 프리뷰 + `{{변수}}` 하이라이트
- 최대 높이 300px, 오버플로 스크롤

**Step 2: 레지스트리 등록**

```typescript
registerSkillSection({ id: "live-preview", title: "Preview", order: 30, component: SkillLivePreview });
```

**Step 3: CSS 추가**

`.skill-live-preview`, `.skill-preview-toggle`, `.skill-preview-block`, `.skill-preview-label`

**Step 4: 빌드 검증 및 커밋**

Run: `npx tsc --noEmit`
Commit: `feat(§72c): add SkillLivePreview — auto-updating preview in properties panel`

---

### Task 6: SkillGalleryPanel (스킬 갤러리)

**Files:**
- Create: `src/components/sidebar/SkillGalleryPanel.tsx`
- Modify: `src/stores/ui-store.ts` — SidebarPanel 타입에 `"skills-gallery"` 추가
- Modify: `src/components/sidebar/Sidebar.tsx` (또는 해당 사이드바 라우팅 파일) — 갤러리 패널 렌더

**Step 1: UI 스토어 업데이트**

`src/stores/ui-store.ts`:
- `SidebarPanel` 타입에 `"skills-gallery"` 추가

**Step 2: 갤러리 컴포넌트**

`src/components/sidebar/SkillGalleryPanel.tsx`:
- `useSkillStore((s) => s.allSkills)` 구독
- 상단: 검색 input + 태그 필터 드롭다운
- 카드 그리드 (`display: grid; grid-template-columns: 1fr;` 사이드바 폭 고려 1열)
- 카드: name (bold), description (truncate 2줄), tags 칩 (최대 3개), requires 수 배지, output_format 배지
- 카드 클릭 → 해당 스킬 파일 열기 (`useEditorStore.openTab()` + `useFileStore.setFileContent()`)
- 빈 상태: "No skills found" + "Scan" 버튼
- 마운트 시 `useSkillStore.getState().scanWorkspace()` 호출 (이미 스캔됐으면 캐시 사용)

**Step 3: 사이드바 라우팅**

사이드바 렌더 분기에 `sidebarPanel === "skills-gallery"` → `<SkillGalleryPanel />` 추가.
사이드바 아이콘 버튼 추가 (기존 패턴 따르기).

**Step 4: Command Palette 등록**

기존 Command Palette 항목에 "Skills Gallery" 추가 → `setSidebarPanel("skills-gallery")`.

**Step 5: CSS 추가**

`.skill-gallery`, `.skill-gallery-search`, `.skill-gallery-card`, `.skill-gallery-tags`, `.skill-gallery-badge`, `.skill-gallery-empty`

**Step 6: 빌드 검증 및 커밋**

Run: `npx tsc --noEmit`
Commit: `feat(§72c): add SkillGalleryPanel — browse and search workspace skills`

---

### Task 7: SkillOptimizeSection (프롬프트 최적화 제안)

**Files:**
- Create: `src/utils/skill-optimize-prompt.ts`
- Create: `src/utils/__tests__/skill-optimize-prompt.test.ts`
- Create: `src/components/sidebar/SkillOptimizeSection.tsx`

**Step 1: 프롬프트 빌더**

`src/utils/skill-optimize-prompt.ts`:
```typescript
export function buildOptimizePrompt(skillContent: string): string {
  return `You are a prompt engineering expert. Analyze this skill file and suggest improvements.

Skill file:
---
${skillContent}
---

Provide 3-5 actionable suggestions as JSON array:
[
  {
    "category": "clarity" | "efficiency" | "missing" | "variables",
    "title": "short title",
    "description": "what to improve and why",
    "before": "current problematic text (or null)",
    "after": "suggested replacement (or null)"
  }
]

Focus on: unclear instructions, token waste, missing constraints, better variable usage.
Return ONLY the JSON array.`;
}

export interface OptimizeSuggestion {
  category: "clarity" | "efficiency" | "missing" | "variables";
  title: string;
  description: string;
  before: string | null;
  after: string | null;
}

export function parseOptimizeResponse(raw: string): OptimizeSuggestion[];
```

**Step 2: 프롬프트 빌더 테스트**

- `buildOptimizePrompt` 스킬 콘텐츠 포함 확인
- `parseOptimizeResponse` 유효 JSON 파싱
- `parseOptimizeResponse` 잘못된 입력 시 빈 배열

**Step 3: UI 컴포넌트**

`src/components/sidebar/SkillOptimizeSection.tsx`:
- "Optimize" 버튼 → LLM 호출 (`useLLMStream` 또는 직접 IPC)
- 스트리밍 완료 후 `parseOptimizeResponse()`로 제안 파싱
- 제안별 카드: category 아이콘 + title + description
- before/after가 있으면 diff 형태로 표시
- "적용" 버튼: `before` 텍스트를 `after`로 에디터에서 치환 (`baram:replace-text` 커스텀 이벤트)
- 로딩 상태: 스피너 + "Analyzing..."

**Step 4: 레지스트리 등록**

```typescript
registerSkillSection({ id: "optimize", title: "Optimize", order: 40, component: SkillOptimizeSection });
```

**Step 5: CSS 추가**

`.skill-optimize-btn`, `.skill-optimize-card`, `.skill-optimize-category`, `.skill-optimize-diff`, `.skill-optimize-apply`

**Step 6: 테스트 실행, 빌드 검증, 커밋**

Run: `npx vitest run src/utils/__tests__/skill-optimize-prompt.test.ts`
Run: `npx tsc --noEmit`
Commit: `feat(§72c): add SkillOptimizeSection — LLM-powered prompt optimization suggestions`

---

### Task 8: 통합 검증

**Step 1: 전체 테스트 실행**

Run: `npx vitest run` — 전체 테스트 스위트
Run: `npx tsc --noEmit` — 타입 검증

**Step 2: 기능별 수동 검증 체크리스트**

- [ ] 스킬 파일 열기 → PropertiesPanel 자동 전환
- [ ] 린트 섹션: 경고 배지 표시, 클릭 시 에디터 이동
- [ ] 변수 자동완성: `{{` 입력 시 드롭다운, 선택 시 `{{var}}` 삽입
- [ ] 라이브 프리뷰: 편집 시 자동 갱신, 토큰 수 업데이트
- [ ] 갤러리: 사이드바 아이콘, 검색/필터, 카드 클릭 시 파일 열기
- [ ] 최적화: "Optimize" 버튼 → LLM 제안 표시, "적용" 시 에디터 반영
- [ ] 비스킬 파일에서 스킬 섹션 미표시

**Step 3: 최종 커밋**

Commit: `docs(§72c): mark skill mode enhancements as complete`
