# §72 Skills 전용 모드 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `type: skill` 파일을 열면 자동으로 Skills 전용 UI 모드가 활성화되어, Properties Panel(YAML GUI), LLM 미리보기, 참조 링크 네비게이션이 통합된 편집 환경을 제공한다.

**Architecture:** 기존 Workspace Preset 시스템 위에 "skills" 프리셋을 추가하고, `useSkillsMode()` 훅이 활성 파일의 frontmatter를 감시하여 자동 전환한다. Properties Panel은 우측 사이드바의 새 모드(`rightPanelMode: "properties"`)로 추가된다. 각 panel 컴포넌트는 기존 패턴(self-gate on rightPanelMode)을 따른다.

**Tech Stack:** React 19, Zustand, Tiptap/ProseMirror, TypeScript

---

### Task 1: ui-store에 "properties" 모드 추가

**Files:**
- Modify: `src/stores/ui-store.ts`
- Modify: `src/stores/workspace-store.ts`
- Modify: `src/stores/__tests__/workspace-store.test.ts`

**Step 1: ui-store 타입 확장**

`src/stores/ui-store.ts`에서 `rightPanelMode` 유니온에 `"properties"` 추가:

```typescript
// line 14: 기존
rightPanelMode: "chat" | "help" | "memories" | "photo-gallery" | "none";
// 변경 →
rightPanelMode: "chat" | "help" | "memories" | "photo-gallery" | "properties" | "none";

// line 39: setRightPanelMode 시그니처도 동일하게 변경
setRightPanelMode: (mode: "chat" | "help" | "memories" | "photo-gallery" | "properties" | "none") => void;
```

**Step 2: workspace-store 타입 확장**

`src/stores/workspace-store.ts`에서 `WorkspaceLayout.rightPanelMode`에도 `"properties"` 추가:

```typescript
// line 19
rightPanelMode: "chat" | "help" | "memories" | "photo-gallery" | "properties" | "none";
```

**Step 3: "skills" 빌트인 프리셋 추가**

`src/stores/workspace-store.ts`의 `BUILTIN_PRESETS` 배열에 추가:

```typescript
{
  id: "skills",
  name: "Skills 편집",
  description: "LLM Skills 파일 편집에 최적화된 레이아웃입니다.",
  builtIn: true,
  layout: {
    sidebarOpen: true,
    sidebarPanel: "files",
    rightPanelOpen: true,
    rightPanelMode: "properties",
  },
},
```

**Step 4: 기존 workspace 테스트 업데이트**

`src/stores/__tests__/workspace-store.test.ts`에서 프리셋 수 검증이 있다면 업데이트. 새 "skills" 프리셋에 대한 기본 테스트 추가:

```typescript
it("skills preset activates properties panel", () => {
  useWorkspaceStore.getState().applyPreset("skills");
  const ui = useUIStore.getState();
  expect(ui.rightPanelOpen).toBe(true);
  expect(ui.rightPanelMode).toBe("properties");
  expect(ui.sidebarOpen).toBe(true);
});
```

**Step 5: Commit**

```bash
git add src/stores/ui-store.ts src/stores/workspace-store.ts src/stores/__tests__/workspace-store.test.ts
git commit -m "feat(§72): add 'properties' rightPanelMode and 'skills' workspace preset"
```

---

### Task 2: useSkillsMode 훅 — 자동 감지 & 전환

**Files:**
- Create: `src/hooks/use-skills-mode.ts`
- Create: `src/hooks/__tests__/use-skills-mode.test.ts`

**Step 1: 훅 유틸 함수 테스트 작성**

`src/hooks/__tests__/use-skills-mode.test.ts`:

```typescript
import { isSkillFrontmatter } from "../use-skills-mode";

describe("isSkillFrontmatter", () => {
  it("detects type: skill", () => {
    expect(isSkillFrontmatter("name: test\ntype: skill\n")).toBe(true);
  });
  it("case insensitive", () => {
    expect(isSkillFrontmatter("type: Skill")).toBe(true);
  });
  it("returns false for non-skill", () => {
    expect(isSkillFrontmatter("type: note")).toBe(false);
    expect(isSkillFrontmatter("")).toBe(false);
  });
  it("ignores type in value context", () => {
    expect(isSkillFrontmatter("description: type: skill in body")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/use-skills-mode.test.ts
```

Expected: FAIL — module not found

**Step 3: 훅 구현**

`src/hooks/use-skills-mode.ts`:

```typescript
// §72 Skills 전용 모드 — 활성 파일이 skill 파일인지 감지하고 UI 자동 전환
import { useEffect, useRef } from "react";
import { useEditorStore } from "../stores/editor-store";
import { useFileStore } from "../stores/file-store";
import { useUIStore } from "../stores/ui-store";

/** Check if frontmatter YAML contains type: skill (exported for testing) */
export function isSkillFrontmatter(yaml: string): boolean {
  // Match "type: skill" at the start of a line (not inside a value)
  return /^type\s*:\s*skill\s*$/im.test(yaml);
}

/**
 * Detect active file's frontmatter and auto-switch to Skills mode.
 * When a skill file is opened: right panel → "properties" mode.
 * When navigating away: restore previous panel mode.
 */
export function useSkillsMode() {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const fileContents = useFileStore((s) => s.fileContents);
  const prevModeRef = useRef<{ mode: string; open: boolean } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;
  const content = filePath ? fileContents.get(filePath) ?? "" : "";

  // Extract frontmatter from raw content
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const yaml = fmMatch ? fmMatch[1] : "";
  const isSkill = isSkillFrontmatter(yaml);

  useEffect(() => {
    const ui = useUIStore.getState();

    if (isSkill) {
      // Save previous state before switching (only once per activation)
      if (!prevModeRef.current) {
        prevModeRef.current = {
          mode: ui.rightPanelMode,
          open: ui.rightPanelOpen,
        };
      }
      // Activate properties panel
      ui.setRightPanelMode("properties");
      if (!ui.rightPanelOpen) ui.toggleRightPanel();
    } else if (prevModeRef.current) {
      // Restore previous state
      ui.setRightPanelMode(prevModeRef.current.mode as any);
      if (ui.rightPanelOpen !== prevModeRef.current.open) {
        ui.toggleRightPanel();
      }
      prevModeRef.current = null;
    }
  }, [isSkill]);

  return { isSkill, yaml };
}
```

**Step 4: Run tests**

```bash
npx vitest run src/hooks/__tests__/use-skills-mode.test.ts
```

Expected: PASS

**Step 5: App.tsx에서 훅 호출**

`src/App.tsx`에서 에디터 로직 부분 (다른 훅들이 호출되는 곳 근처)에 추가:

```typescript
import { useSkillsMode } from "./hooks/use-skills-mode";

// App 컴포넌트 내부, 다른 useEffect 근처
const { isSkill } = useSkillsMode();
```

**Step 6: Commit**

```bash
git add src/hooks/use-skills-mode.ts src/hooks/__tests__/use-skills-mode.test.ts src/App.tsx
git commit -m "feat(§72): add useSkillsMode hook — auto-detect skill files and switch UI"
```

---

### Task 3: PropertiesPanel 컴포넌트 — YAML GUI 편집

**Files:**
- Create: `src/components/sidebar/PropertiesPanel.tsx`
- Create: `src/components/sidebar/__tests__/properties-panel.test.ts`
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/App.css`

**Step 1: YAML 파싱/직렬화 유틸 테스트 작성**

`src/components/sidebar/__tests__/properties-panel.test.ts`:

```typescript
import { parseYamlProperties, serializeYamlProperties } from "../PropertiesPanel";
import type { PropertyEntry } from "../PropertiesPanel";

describe("parseYamlProperties", () => {
  it("parses string fields", () => {
    const result = parseYamlProperties("name: test-skill\ndescription: A skill");
    expect(result).toContainEqual({ key: "name", value: "test-skill", type: "string" });
    expect(result).toContainEqual({ key: "description", value: "A skill", type: "string" });
  });

  it("parses array fields", () => {
    const result = parseYamlProperties("tags: [code-gen, tiptap]");
    expect(result).toContainEqual({ key: "tags", value: ["code-gen", "tiptap"], type: "array" });
  });

  it("parses status as enum", () => {
    const result = parseYamlProperties("status: draft");
    expect(result).toContainEqual({ key: "status", value: "draft", type: "enum" });
  });

  it("roundtrips through serialize", () => {
    const yaml = "name: test\ndescription: desc\ntags: [a, b]\nstatus: draft";
    const props = parseYamlProperties(yaml);
    const out = serializeYamlProperties(props);
    expect(out).toBe(yaml);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/sidebar/__tests__/properties-panel.test.ts
```

**Step 3: PropertiesPanel 구현**

`src/components/sidebar/PropertiesPanel.tsx`:

```typescript
// §72 Properties Panel — YAML frontmatter GUI editor for Skills files
import { useState, useCallback, useMemo } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";

export interface PropertyEntry {
  key: string;
  value: string | string[];
  type: "string" | "array" | "enum";
}

const STATUS_OPTIONS = ["draft", "active", "deprecated"];
const ENUM_KEYS = new Set(["status"]);
const ARRAY_KEYS = new Set(["tags", "requires"]);

/** Parse YAML frontmatter into property entries */
export function parseYamlProperties(yaml: string): PropertyEntry[] {
  if (!yaml.trim()) return [];
  const entries: PropertyEntry[] = [];

  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let rawValue = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    if (ENUM_KEYS.has(key)) {
      entries.push({ key, value: rawValue, type: "enum" });
    } else if (ARRAY_KEYS.has(key) || rawValue.startsWith("[")) {
      // Parse [item1, item2] format
      const inner = rawValue.replace(/^\[/, "").replace(/\]$/, "").trim();
      const items = inner ? inner.split(",").map((s) => s.trim()) : [];
      entries.push({ key, value: items, type: "array" });
    } else {
      entries.push({ key, value: rawValue, type: "string" });
    }
  }
  return entries;
}

/** Serialize property entries back to YAML string */
export function serializeYamlProperties(entries: PropertyEntry[]): string {
  return entries
    .map((e) => {
      if (e.type === "array") {
        const arr = e.value as string[];
        return `${e.key}: [${arr.join(", ")}]`;
      }
      return `${e.key}: ${e.value}`;
    })
    .join("\n");
}

export function PropertiesPanel() {
  const { rightPanelOpen, rightPanelMode } = useUIStore();
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const fileContents = useFileStore((s) => s.fileContents);
  const [sourceMode, setSourceMode] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;
  const content = filePath ? fileContents.get(filePath) ?? "" : "";

  // Extract frontmatter YAML
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const yaml = fmMatch ? fmMatch[1] : "";

  const entries = useMemo(() => parseYamlProperties(yaml), [yaml]);

  // Update frontmatter in file content
  const updateFrontmatter = useCallback(
    (newYaml: string) => {
      if (!filePath) return;
      const currentContent = useFileStore.getState().fileContents.get(filePath) ?? "";
      const updated = currentContent.replace(
        /^---\r?\n[\s\S]*?\r?\n---/,
        `---\n${newYaml}\n---`,
      );
      useFileStore.getState().setFileContent(filePath, updated);

      // Mark tab as dirty
      const tabId = useEditorStore.getState().activeTabId;
      if (tabId) useEditorStore.getState().markDirty(tabId);
    },
    [filePath],
  );

  const updateEntry = useCallback(
    (index: number, newValue: string | string[]) => {
      const newEntries = [...entries];
      newEntries[index] = { ...newEntries[index], value: newValue };
      updateFrontmatter(serializeYamlProperties(newEntries));
    },
    [entries, updateFrontmatter],
  );

  const addEntry = useCallback(
    (key: string) => {
      const type = ARRAY_KEYS.has(key) ? "array" : ENUM_KEYS.has(key) ? "enum" : "string";
      const newEntries = [...entries, { key, value: type === "array" ? [] : "", type } as PropertyEntry];
      updateFrontmatter(serializeYamlProperties(newEntries));
    },
    [entries, updateFrontmatter],
  );

  if (!rightPanelOpen || rightPanelMode !== "properties") return null;

  if (!filePath || !yaml) {
    return (
      <div className="properties-panel">
        <div className="properties-header">Properties</div>
        <div className="properties-empty">No frontmatter in this file</div>
      </div>
    );
  }

  return (
    <div className="properties-panel">
      <div className="properties-header">
        Properties
        <button
          className="properties-source-toggle"
          onClick={() => setSourceMode((v) => !v)}
          title={sourceMode ? "GUI mode" : "YAML source"}
        >
          {"</>"}
        </button>
      </div>
      {sourceMode ? (
        <textarea
          className="properties-source"
          value={yaml}
          onChange={(e) => updateFrontmatter(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div className="properties-entries">
          {entries.map((entry, i) => (
            <PropertyRow
              key={entry.key}
              entry={entry}
              onChange={(val) => updateEntry(i, val)}
              onOpenFile={handleOpenFile}
            />
          ))}
          <AddPropertyButton existingKeys={entries.map((e) => e.key)} onAdd={addEntry} />
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function PropertyRow({
  entry,
  onChange,
  onOpenFile,
}: {
  entry: PropertyEntry;
  onChange: (val: string | string[]) => void;
  onOpenFile?: (path: string) => void;
}) {
  if (entry.type === "enum") {
    return (
      <div className="properties-row">
        <label className="properties-key">{entry.key}</label>
        <select
          className="properties-select"
          value={entry.value as string}
          onChange={(e) => onChange(e.target.value)}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (entry.type === "array") {
    const items = entry.value as string[];
    const isFileRef = entry.key === "requires";
    return (
      <div className="properties-row">
        <label className="properties-key">{entry.key}</label>
        <div className="properties-chips">
          {items.map((item, i) => (
            <span
              key={i}
              className={`properties-chip${isFileRef ? " file-ref" : ""}`}
              onClick={isFileRef && onOpenFile ? () => onOpenFile(item) : undefined}
            >
              {isFileRef && "📄 "}{item}
              <button
                className="properties-chip-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(items.filter((_, j) => j !== i));
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            className="properties-chip-add"
            onClick={() => {
              const val = prompt(`Add ${entry.key} item:`);
              if (val) onChange([...items, val.trim()]);
            }}
          >
            +
          </button>
        </div>
      </div>
    );
  }

  // String
  return (
    <div className="properties-row">
      <label className="properties-key">{entry.key}</label>
      <input
        className="properties-input"
        type="text"
        value={entry.value as string}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function AddPropertyButton({
  existingKeys,
  onAdd,
}: {
  existingKeys: string[];
  onAdd: (key: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");

  if (!adding) {
    return (
      <button className="properties-add-btn" onClick={() => setAdding(true)}>
        + 속성 추가
      </button>
    );
  }

  return (
    <div className="properties-row properties-add-row">
      <input
        className="properties-input"
        autoFocus
        placeholder="key name"
        value={newKey}
        onChange={(e) => setNewKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && newKey.trim() && !existingKeys.includes(newKey.trim())) {
            onAdd(newKey.trim());
            setNewKey("");
            setAdding(false);
          }
          if (e.key === "Escape") {
            setNewKey("");
            setAdding(false);
          }
        }}
      />
    </div>
  );
}

/** Helper to handle opening a file reference (used by requires chips) */
function handleOpenFile(fileName: string) {
  // Resolve to a path and open in editor
  const { rootPath } = useFileStore.getState();
  if (!rootPath) return;

  // Try to find the file in the file tree
  const { fileTree } = useFileStore.getState();
  const target = findFileInTree(fileTree, fileName);
  if (!target) return;

  const { tabs } = useEditorStore.getState();
  const existing = tabs.find((t) => t.filePath === target.path);
  if (existing) {
    useEditorStore.getState().setActiveTab(existing.id);
    return;
  }

  import("../../ipc/invoke").then(({ readFile }) => {
    readFile(target.path).then((content) => {
      useFileStore.getState().setFileContent(target.path, content);
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        filePath: target.path,
        title: target.name,
        isDirty: false,
        isPinned: false,
      });
    });
  });
}

/** Recursively search file tree for a file matching stem */
function findFileInTree(
  entries: Array<{ name: string; path: string; children?: any[] }>,
  stem: string,
): { name: string; path: string } | null {
  for (const entry of entries) {
    const entryName = entry.name.replace(/\.md$/, "");
    if (entryName === stem || entry.name === stem) {
      return entry;
    }
    if (entry.children) {
      const found = findFileInTree(entry.children, stem);
      if (found) return found;
    }
  }
  return null;
}
```

**Step 4: AppLayout에 PropertiesPanel 추가**

`src/components/layout/AppLayout.tsx`에서:

```typescript
// Lazy import 추가 (기존 lazy imports 옆)
const PropertiesPanel = lazy(() =>
  import("../sidebar/PropertiesPanel").then((m) => ({
    default: m.PropertiesPanel,
  })),
);

// Right Panel Suspense 내부에 추가 (line ~112)
<Suspense fallback={null}>
  <AIChatPanel />
  <HelpPanel />
  <MemoriesPanel />
  <PhotoGalleryPanel />
  <PropertiesPanel />       {/* ← 추가 */}
</Suspense>
```

**Step 5: CSS 스타일**

`src/App.css`에 Properties Panel 스타일 추가:

```css
/* §72 Properties Panel */
.properties-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 8px 12px;
  font-size: 0.85rem;
}
.properties-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 4px 0 8px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 8px;
}
.properties-source-toggle {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.75rem;
  cursor: pointer;
  color: var(--color-text-secondary);
}
.properties-source-toggle:hover {
  background: var(--color-bg-hover);
}
.properties-empty {
  color: var(--color-text-secondary);
  font-style: italic;
  padding: 16px 0;
}
.properties-source {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 8px;
  resize: none;
  color: var(--color-text);
}
.properties-entries {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.properties-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.properties-key {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-weight: 500;
}
.properties-input {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 0.82rem;
  color: var(--color-text);
}
.properties-input:focus {
  outline: none;
  border-color: var(--color-accent);
}
.properties-select {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 0.82rem;
  color: var(--color-text);
}
.properties-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.properties-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  border-radius: 10px;
  font-size: 0.78rem;
  color: var(--color-text);
}
.properties-chip.file-ref {
  cursor: pointer;
}
.properties-chip.file-ref:hover {
  background: color-mix(in srgb, var(--color-accent) 25%, transparent);
}
.properties-chip-remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  padding: 0 2px;
  line-height: 1;
}
.properties-chip-remove:hover {
  color: var(--color-danger);
}
.properties-chip-add {
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 10px;
  padding: 2px 8px;
  font-size: 0.78rem;
  cursor: pointer;
  color: var(--color-text-secondary);
}
.properties-chip-add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.properties-add-btn {
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--color-text-secondary);
  margin-top: 4px;
}
.properties-add-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.properties-add-row {
  flex-direction: row;
  gap: 4px;
}
```

**Step 6: Run tests**

```bash
npx vitest run src/components/sidebar/__tests__/properties-panel.test.ts
```

**Step 7: Commit**

```bash
git add src/components/sidebar/PropertiesPanel.tsx src/components/sidebar/__tests__/properties-panel.test.ts src/components/layout/AppLayout.tsx src/App.css
git commit -m "feat(§72): add PropertiesPanel — YAML frontmatter GUI editor in right sidebar"
```

---

### Task 4: token-counter 유틸리티

**Files:**
- Create: `src/utils/token-counter.ts`
- Create: `src/utils/__tests__/token-counter.test.ts`

**Step 1: 테스트 작성**

`src/utils/__tests__/token-counter.test.ts`:

```typescript
import { estimateTokenCount } from "../token-counter";

describe("estimateTokenCount", () => {
  it("estimates English text (~4 chars per token)", () => {
    const text = "Hello world this is a test";
    const count = estimateTokenCount(text);
    // ~26 chars / 4 ≈ 6-7 tokens
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(10);
  });

  it("estimates Korean text (~2 chars per token)", () => {
    const text = "안녕하세요 테스트입니다";
    const count = estimateTokenCount(text);
    // Korean chars cost more tokens
    expect(count).toBeGreaterThan(5);
  });

  it("returns 0 for empty", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("handles mixed content", () => {
    const text = "<system>\nYou are a 도우미\n</system>";
    const count = estimateTokenCount(text);
    expect(count).toBeGreaterThan(5);
  });
});
```

**Step 2: Run test — FAIL**

```bash
npx vitest run src/utils/__tests__/token-counter.test.ts
```

**Step 3: 구현**

`src/utils/token-counter.ts`:

```typescript
// §72 Token counter — approximate token estimation for LLM preview
// Uses character-based heuristic: ~4 chars/token for English, ~2 chars/token for CJK

const CJK_RANGE = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g;

export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  // Count CJK characters (each ≈ 0.5 tokens → multiply by 0.5... but actually ~1-2 tokens each)
  const cjkChars = (text.match(CJK_RANGE) || []).length;
  const nonCjkLength = text.length - cjkChars;

  // English: ~4 chars per token, CJK: ~1.5 chars per token
  const englishTokens = Math.ceil(nonCjkLength / 4);
  const cjkTokens = Math.ceil(cjkChars / 1.5);

  return englishTokens + cjkTokens;
}

export function formatTokenCount(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}
```

**Step 4: Run test — PASS**

```bash
npx vitest run src/utils/__tests__/token-counter.test.ts
```

**Step 5: Commit**

```bash
git add src/utils/token-counter.ts src/utils/__tests__/token-counter.test.ts
git commit -m "feat(§72): add token-counter utility for LLM preview"
```

---

### Task 5: SkillPreviewPanel — LLM 관점 미리보기

**Files:**
- Create: `src/components/ai/SkillPreviewPanel.tsx`
- Modify: `src/App.tsx` (커맨드 팔레트 항목 + 상태)
- Modify: `src/App.css`

**Step 1: SkillPreviewPanel 구현**

`src/components/ai/SkillPreviewPanel.tsx`:

```typescript
// §72 LLM 관점 미리보기 — 스킬 파일을 LLM이 받는 형태로 프리뷰
import { useMemo } from "react";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { extractSkillPrompt } from "../../utils/skill-test-runner";
import { estimateTokenCount, formatTokenCount } from "../../utils/token-counter";

interface SkillPreviewPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function SkillPreviewPanel({ visible, onClose }: SkillPreviewPanelProps) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const fileContents = useFileStore((s) => s.fileContents);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;
  const content = filePath ? fileContents.get(filePath) ?? "" : "";

  const preview = useMemo(() => {
    if (!content) return null;
    const { system, user, variables } = extractSkillPrompt(content);

    // Build the full prompt as LLM would receive it
    const parts: string[] = [];
    if (system) parts.push(`[SYSTEM]\n${system}`);
    if (user) parts.push(`[USER]\n${user}`);

    const fullText = parts.join("\n\n---\n\n");
    const tokenCount = estimateTokenCount(fullText);

    return { system, user, variables, fullText, tokenCount };
  }, [content]);

  if (!visible || !preview) return null;

  return (
    <div className="skill-preview-panel">
      <div className="skill-preview-header">
        <span>LLM Preview</span>
        <span className="skill-preview-tokens">
          ~{formatTokenCount(preview.tokenCount)} tokens
        </span>
        <button className="skill-preview-close" onClick={onClose}>×</button>
      </div>
      <div className="skill-preview-body">
        {preview.variables.length > 0 && (
          <div className="skill-preview-variables">
            Variables: {preview.variables.map((v) => (
              <span key={v} className="skill-preview-var">{`{{${v}}}`}</span>
            ))}
          </div>
        )}
        <pre className="skill-preview-content">{preview.fullText}</pre>
      </div>
    </div>
  );
}
```

**Step 2: App.tsx에 통합**

`src/App.tsx`에서:

1. 상태 추가: `const [skillPreviewOpen, setSkillPreviewOpen] = useState(false);`
2. 커맨드 팔레트에 항목 추가 (buildCommandItems 내):
```typescript
{
  id: "skills-preview",
  label: "Skills: Preview as LLM Input",
  shortcut: "",
  action: () => setSkillPreviewOpen((v) => !v),
}
```
3. 에디터 영역 하단에 SkillPreviewPanel 렌더링:
```typescript
<SkillPreviewPanel
  visible={skillPreviewOpen && isSkill}
  onClose={() => setSkillPreviewOpen(false)}
/>
```

**Step 3: CSS 스타일**

`src/App.css`에 추가:

```css
/* §72 Skill Preview Panel */
.skill-preview-panel {
  border-top: 1px solid var(--color-border);
  max-height: 40%;
  overflow-y: auto;
  background: var(--color-bg-secondary);
  display: flex;
  flex-direction: column;
}
.skill-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}
.skill-preview-tokens {
  font-weight: 400;
  color: var(--color-accent);
  font-size: 0.78rem;
}
.skill-preview-close {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  color: var(--color-text-secondary);
}
.skill-preview-body {
  padding: 8px 12px;
  font-size: 0.82rem;
}
.skill-preview-variables {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}
.skill-preview-var {
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent-ai) 15%, transparent);
  color: var(--accent-ai);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}
.skill-preview-content {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  color: var(--color-text);
  margin: 0;
}
```

**Step 4: Commit**

```bash
git add src/components/ai/SkillPreviewPanel.tsx src/App.tsx src/App.css
git commit -m "feat(§72): add SkillPreviewPanel — LLM perspective preview with token count"
```

---

### Task 6: 참조 링크 네비게이션 — Cmd+클릭 파일 이동

**Files:**
- Modify: `src/extensions/plugins/prompt-highlight.ts`
- Create: `src/extensions/plugins/__tests__/prompt-highlight-nav.test.ts`

**Step 1: 네비게이션 유틸 테스트**

`src/extensions/plugins/__tests__/prompt-highlight-nav.test.ts`:

```typescript
import { extractFilePaths } from "../prompt-highlight";

describe("extractFilePaths", () => {
  it("extracts relative paths", () => {
    const text = "See ./agents/executor.md for details";
    expect(extractFilePaths(text)).toContainEqual({
      path: "./agents/executor.md",
      start: 4,
      end: 25,
    });
  });

  it("extracts absolute-like paths", () => {
    const text = "ref: /skills/base.md";
    expect(extractFilePaths(text)).toContainEqual({
      path: "/skills/base.md",
      start: 5,
      end: 20,
    });
  });

  it("extracts bare file references", () => {
    const text = "requires: agents/executor.md";
    expect(extractFilePaths(text)).toContainEqual({
      path: "agents/executor.md",
      start: 10,
      end: 28,
    });
  });

  it("returns empty for no paths", () => {
    expect(extractFilePaths("Hello world")).toEqual([]);
  });
});
```

**Step 2: Run test — FAIL**

```bash
npx vitest run src/extensions/plugins/__tests__/prompt-highlight-nav.test.ts
```

**Step 3: prompt-highlight.ts 확장**

기존 파일 경로 regex 를 개선하고, `extractFilePaths` 함수를 export. 데코레이션에 `data-filepath` 속성 추가:

```typescript
// 새로 export 할 유틸 함수
export interface FilePathMatch {
  path: string;
  start: number;
  end: number;
}

export function extractFilePaths(text: string): FilePathMatch[] {
  // Match: ./path, /path, or word/path with file extension
  const regex = /(?:\.\/|\/|(?<=\s|^))(?:[a-zA-Z0-9_\-]+\/)*[a-zA-Z0-9_\-]+\.[a-zA-Z]+/g;
  const matches: FilePathMatch[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      path: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}
```

데코레이션에 `nodeName: "span"` + `data-filepath` 속성을 추가하여 클릭 이벤트에서 감지할 수 있게 한다:

```typescript
// File paths: enhanced with data attribute for click navigation
const pathRegex = /(?:\.\/|\/)[a-zA-Z0-9_\-./]+\.[a-zA-Z]+/g;
while ((match = pathRegex.exec(text)) !== null) {
  decorations.push(
    Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
      class: "prompt-filepath",
      "data-filepath": match[0],
      nodeName: "span",
    }),
  );
}
```

ProseMirror Plugin에 `handleClick` prop 추가:

```typescript
props: {
  decorations(state) {
    return promptHighlightKey.getState(state) as DecorationSet;
  },
  handleClick(view, pos, event) {
    // Cmd+Click (Mac) or Ctrl+Click (Win/Linux) on file path
    if (!(event.metaKey || event.ctrlKey)) return false;
    const target = event.target as HTMLElement;
    const filepath = target.closest("[data-filepath]")?.getAttribute("data-filepath");
    if (!filepath) return false;

    // Dispatch custom event for React to handle
    window.dispatchEvent(
      new CustomEvent("baram:open-filepath", { detail: { path: filepath } }),
    );
    return true;
  },
},
```

**Step 4: App.tsx에서 이벤트 수신**

`src/App.tsx`에 이벤트 리스너 추가 (기존 useEffect 근처):

```typescript
// §72 참조 링크 네비게이션
useEffect(() => {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.path) {
      handleOpenFilePath(detail.path);
    }
  };
  window.addEventListener("baram:open-filepath", handler);
  return () => window.removeEventListener("baram:open-filepath", handler);
}, [handleOpenFilePath]);
```

`handleOpenFilePath`는 이미 존재하거나, 파일 경로를 받아서 해당 파일을 여는 기존 로직을 활용한다. 존재하지 않으면 rootPath 기준으로 resolve.

**Step 5: prompt-filepath CSS에 cursor 추가**

`src/App.css`에서 기존 `.prompt-filepath` 스타일에 추가:

```css
.prompt-filepath {
  /* 기존 스타일 유지 */
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
}
.prompt-filepath:hover {
  text-decoration-style: solid;
}
```

**Step 6: Run tests**

```bash
npx vitest run src/extensions/plugins/__tests__/prompt-highlight-nav.test.ts
```

**Step 7: Commit**

```bash
git add src/extensions/plugins/prompt-highlight.ts src/extensions/plugins/__tests__/prompt-highlight-nav.test.ts src/App.tsx src/App.css
git commit -m "feat(§72): add Cmd+click file path navigation in Skills files"
```

---

### Task 7: 통합 테스트 & 빌드 검증

**Files:**
- All modified files

**Step 1: TypeScript 컴파일 체크**

```bash
npx tsc --noEmit
```

Expected: clean (0 errors)

**Step 2: 전체 Vitest 실행**

```bash
npx vitest run
```

Expected: 모든 기존 테스트 + 새 테스트 PASS

**Step 3: Cargo test (Rust — 변경 없지만 확인)**

```bash
cd src-tauri && cargo test && cd ..
```

Expected: 모든 테스트 PASS

**Step 4: 최종 커밋 & remaining-features 업데이트**

`dev/impl-notes/remaining-features.md`에서 §72를 완료 표시:

```markdown
| ~~72~~ | ~~Skills 전용 모드~~ | ~~UI 최적화된 LLM Skills 전용 인터페이스~~ ✅ 완료 (2026-03-07) |
```

```bash
git add dev/impl-notes/remaining-features.md
git commit -m "docs: mark §72 Skills dedicated mode as complete"
```
