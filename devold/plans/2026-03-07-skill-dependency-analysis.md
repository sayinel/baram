# §72b Skill Dependency Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Skills 파일의 `requires` 필드를 기반으로 의존성을 정적/AI 분석하여 호환성 경고, 순환 참조 감지, 의존성 그래프 시각화, 체인 테스트를 제공한다.

**Architecture:** `skill-dependency-analyzer.ts` 유틸이 스킬 파일들을 스캔하여 의존성 그래프를 구축하고, 정적 분석(P0) + AI 분석(P1) + 체인 테스트(P2)를 수행한다. UI는 PropertiesPanel 하단에 의존성 섹션으로 통합된다.

**Tech Stack:** React 19, Zustand, Cytoscape.js (기존 설치됨), LLM API (기존 인프라)

---

## Scope

### P0 — 정적 분석
- 파일 존재 여부 확인 (requires 엔트리)
- 순환 참조 감지 (DFS)
- 의존성 미니 그래프 시각화 (Cytoscape 재사용)
- 누락 필드 경고 (output_format 등)

### P1 — AI 분석
- 인터페이스 호환성 (output_format vs 기대 입력)
- 자동 수정 제안

### P2 — 고급
- 역방향 의존성 (이 스킬을 requires하는 다른 스킬 목록)
- 영향 분석 (수정 시 영향받는 스킬)
- 스킬 체인 테스트 실행

---

### Task 1: skill-dependency-analyzer 유틸 (P0 정적 분석)

**Files:**
- Create: `src/utils/skill-dependency-analyzer.ts`
- Create: `src/utils/__tests__/skill-dependency-analyzer.test.ts`

### Task 2: prompt-lint 규칙 확장

**Files:**
- Modify: `src/utils/prompt-linter.ts`
- Modify: `src/utils/__tests__/prompt-linter.test.ts` (if exists)

### Task 3: SkillDependencySection UI (PropertiesPanel 통합)

**Files:**
- Create: `src/components/sidebar/SkillDependencySection.tsx`
- Modify: `src/components/sidebar/PropertiesPanel.tsx`
- Modify: `src/App.css`

### Task 4: AI 호환성 분석 (P1)

**Files:**
- Create: `src/utils/skill-compatibility-prompt.ts`
- Modify: `src/components/sidebar/SkillDependencySection.tsx`

### Task 5: 역방향 의존성 + 영향 분석 (P2)

**Files:**
- Modify: `src/utils/skill-dependency-analyzer.ts`
- Modify: `src/components/sidebar/SkillDependencySection.tsx`

### Task 6: 스킬 체인 테스트 (P2)

**Files:**
- Create: `src/utils/skill-chain-runner.ts`
- Modify: `src/components/sidebar/SkillDependencySection.tsx`

### Task 7: 통합 테스트 & 빌드 검증
