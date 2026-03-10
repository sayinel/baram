// §72 Properties Panel — YAML frontmatter GUI editor
import { useCallback, useRef, useState } from "react";

import type { FileEntry } from "../../stores/file-store";

import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useUIStore } from "../../stores/ui-store";
import { showPrompt } from "../../utils/ai-commands";
import { isSkillFrontmatter } from "../../utils/skill-frontmatter";
import { getSkillSections } from "./skill-panel-registry";
// §72c Side-effect imports: sections self-register into the registry
import "./SkillDependencySection";
import "./SkillLintSection";
import "./SkillLivePreview";
import "./SkillOptimizeSection";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PropertyEntry {
  key: string;
  type: PropertyType;
  value: string | string[];
}

export type PropertyType = "array" | "enum" | "string";

// Keys that are always treated as arrays
const ARRAY_KEYS = new Set(["requires", "tags"]);

// Keys that are treated as enums
const ENUM_KEYS = new Set(["status"]);
const ENUM_VALUES: Record<string, string[]> = {
  status: ["draft", "active", "deprecated"],
};

// ─── Parse / Serialize ────────────────────────────────────────────────────────

/**
 * Parse a YAML frontmatter string (without --- delimiters) into PropertyEntry[].
 * Exported for testing.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function parseYamlProperties(yaml: string): PropertyEntry[] {
  if (!yaml || !yaml.trim()) return [];

  const entries: PropertyEntry[] = [];
  const lines = yaml.split("\n");

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;

    const rawValue = line.slice(colonIdx + 1).trim();

    if (ENUM_KEYS.has(key)) {
      entries.push({ key, value: rawValue, type: "enum" });
      continue;
    }

    if (ARRAY_KEYS.has(key)) {
      // bracket syntax: [a, b] or []
      const bracketMatch = rawValue.match(/^\[(.*)\]$/);
      if (bracketMatch) {
        const inner = bracketMatch[1].trim();
        const items =
          inner === ""
            ? []
            : inner
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        entries.push({ key, value: items, type: "array" });
      } else {
        // single value without brackets — still treat as array
        const items = rawValue ? [rawValue] : [];
        entries.push({ key, value: items, type: "array" });
      }
      continue;
    }

    // default: string
    entries.push({ key, value: rawValue, type: "string" });
  }

  return entries;
}

export function PropertiesPanel() {
  const { rightPanelOpen, rightPanelMode } = useUIStore();
  const { activeTabId, tabs } = useEditorStore();
  const { openFiles, fileTree } = useFileStore();

  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [lastAddedKey, setLastAddedKey] = useState<null | string>(null);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const [, forceRender] = useState(0);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;
  const content = filePath ? (openFiles.get(filePath) ?? null) : null;

  const parsed = content ? extractFrontmatter(content) : null;
  const yaml = parsed?.yaml ?? null;
  const entries: PropertyEntry[] =
    yaml !== null ? parseYamlProperties(yaml) : [];

  // ── write-back helpers ───────────────────────────────────────────────────

  function applyEntries(updated: PropertyEntry[], skipUndo = false) {
    if (!filePath || !parsed) return;
    if (!skipUndo && yaml !== null) {
      undoStackRef.current.push(yaml);
      redoStackRef.current = [];
    }
    const newYaml = serializeYamlProperties(updated);
    const newContent = rebuildContent(newYaml, parsed.rest);
    useFileStore.getState().setFileContent(filePath, newContent);
    if (activeTabId) useEditorStore.getState().markDirty(activeTabId, true);
    useEditorStore.getState().requestContentRefresh();
    forceRender((n) => n + 1);
  }

  function applyYamlDirectly(newYaml: string, skipUndo = false) {
    if (!filePath || !parsed) return;
    if (!skipUndo && yaml !== null) {
      undoStackRef.current.push(yaml);
      redoStackRef.current = [];
    }
    const newContent = rebuildContent(newYaml, parsed.rest);
    useFileStore.getState().setFileContent(filePath, newContent);
    if (activeTabId) useEditorStore.getState().markDirty(activeTabId, true);
    useEditorStore.getState().requestContentRefresh();
    forceRender((n) => n + 1);
  }

  function applySourceText(text: string) {
    if (!filePath || !parsed) return;
    if (yaml !== null) {
      undoStackRef.current.push(yaml);
      redoStackRef.current = [];
    }
    const newContent = rebuildContent(text, parsed.rest);
    useFileStore.getState().setFileContent(filePath, newContent);
    if (activeTabId) useEditorStore.getState().markDirty(activeTabId, true);
    useEditorStore.getState().requestContentRefresh();
    forceRender((n) => n + 1);
  }

  function handleUndo() {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    if (yaml !== null) redoStackRef.current.push(yaml);
    applyYamlDirectly(prev, true);
  }

  function handleRedo() {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    if (yaml !== null) undoStackRef.current.push(yaml);
    applyYamlDirectly(next, true);
  }

  // ── source mode toggle ───────────────────────────────────────────────────

  const handleToggleSource = () => {
    if (!sourceMode) {
      setSourceText(yaml ?? "");
    } else {
      applySourceText(sourceText);
    }
    setSourceMode((v) => !v);
  };

  // ── field handlers ───────────────────────────────────────────────────────

  const handleStringChange = useCallback(
    (key: string, val: string) => {
      const updated = entries.map((e) =>
        e.key === key ? { ...e, value: val } : e,
      );
      applyEntries(updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, filePath, parsed],
  );

  const handleEnumChange = useCallback(
    (key: string, val: string) => {
      const updated = entries.map((e) =>
        e.key === key ? { ...e, value: val } : e,
      );
      applyEntries(updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, filePath, parsed],
  );

  const handleChipRemove = useCallback(
    (key: string, idx: number) => {
      const updated = entries.map((e) => {
        if (e.key !== key) return e;
        const arr = (e.value as string[]).filter((_, i) => i !== idx);
        return { ...e, value: arr };
      });
      applyEntries(updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, filePath, parsed],
  );

  const handleChipAdd = useCallback(
    (key: string) => {
      (async () => {
        const item = await showPrompt("Add item:");
        if (!item) return;
        const updated = entries.map((e) => {
          if (e.key !== key) return e;
          return { ...e, value: [...(e.value as string[]), item.trim()] };
        });
        applyEntries(updated);
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, filePath, parsed],
  );

  const handleOpenFile = useCallback(
    async (name: string) => {
      const found = findFileInTree(fileTree, name);
      if (!found) return;
      const { openTab, setActiveTab } = useEditorStore.getState();
      const tabId = `tab-${found.path}`;
      const { tabs: currentTabs } = useEditorStore.getState();
      const existing = currentTabs.find((t) => t.filePath === found.path);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }
      try {
        const { readFile } = await import("../../ipc/invoke");
        const fileContent = await readFile(found.path);
        useFileStore.getState().setFileContent(found.path, fileContent);
        openTab({
          id: tabId,
          filePath: found.path,
          title: found.name,
          isDirty: false,
          isPinned: false,
        });
        setActiveTab(tabId);
      } catch (err) {
        console.error("PropertiesPanel: failed to open file", err);
      }
    },
    [fileTree],
  );

  const handleAddProperty = useCallback(
    (key: string) => {
      const type: PropertyType = ENUM_KEYS.has(key)
        ? "enum"
        : ARRAY_KEYS.has(key)
          ? "array"
          : "string";
      const value: string | string[] = type === "array" ? [] : "";
      const updated = [...entries, { key, value, type }];
      setLastAddedKey(key);
      applyEntries(updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, filePath, parsed],
  );

  const handleDeleteProperty = useCallback(
    (key: string) => {
      const updated = entries.filter((e) => e.key !== key);
      applyEntries(updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, filePath, parsed],
  );

  // ── render ───────────────────────────────────────────────────────────────

  if (!rightPanelOpen || rightPanelMode !== "properties") return null;

  return (
    <div className="properties-panel">
      <div className="properties-header">
        <span>Properties</span>
        <div className="properties-header-actions">
          <button
            className="properties-undo-btn"
            disabled={undoStackRef.current.length === 0}
            onClick={handleUndo}
            title="Undo (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            className="properties-undo-btn"
            disabled={redoStackRef.current.length === 0}
            onClick={handleRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            ↪
          </button>
          <button
            className="properties-source-toggle"
            onClick={handleToggleSource}
            title="Toggle source YAML"
          >
            {"</>"}
          </button>
        </div>
      </div>

      {content === null && (
        <div className="properties-empty">파일이 열려 있지 않습니다.</div>
      )}

      {content !== null && yaml === null && (
        <div className="properties-empty">No frontmatter</div>
      )}

      {content !== null && yaml !== null && sourceMode && (
        <textarea
          className="properties-source"
          onChange={(e) => setSourceText(e.target.value)}
          spellCheck={false}
          value={sourceText}
        />
      )}

      {content !== null && yaml !== null && !sourceMode && (
        <>
          <div className="properties-entries">
            {entries.map((entry) => (
              <div className="properties-row" key={entry.key}>
                <div className="properties-key">
                  <span>{entry.key}</span>
                  <button
                    className="properties-key-delete"
                    onClick={() => handleDeleteProperty(entry.key)}
                    title={`Delete "${entry.key}"`}
                  >
                    ×
                  </button>
                </div>

                {entry.type === "string" && (
                  <input
                    autoFocus={entry.key === lastAddedKey}
                    className="properties-input"
                    onChange={(e) =>
                      handleStringChange(entry.key, e.target.value)
                    }
                    onFocus={() => {
                      if (entry.key === lastAddedKey) setLastAddedKey(null);
                    }}
                    value={entry.value as string}
                  />
                )}

                {entry.type === "enum" && (
                  <select
                    className="properties-select"
                    onChange={(e) =>
                      handleEnumChange(entry.key, e.target.value)
                    }
                    value={entry.value as string}
                  >
                    {(ENUM_VALUES[entry.key] ?? [entry.value as string]).map(
                      (opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ),
                    )}
                  </select>
                )}

                {entry.type === "array" && (
                  <div className="properties-chips">
                    {(entry.value as string[]).map((chip, idx) => {
                      const isFileRef = entry.key === "requires";
                      return (
                        <span
                          className={`properties-chip${isFileRef ? "file-ref" : ""}`}
                          key={idx}
                          onClick={
                            isFileRef ? () => handleOpenFile(chip) : undefined
                          }
                        >
                          {isFileRef && <span>📄</span>}
                          {chip}
                          <button
                            className="properties-chip-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleChipRemove(entry.key, idx);
                            }}
                            title="Remove"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    <button
                      className="properties-chip-add"
                      onClick={() => handleChipAdd(entry.key)}
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <AddPropertyButton onAdd={handleAddProperty} />

          {/* §72c Skill sections via registry */}
          {yaml !== null &&
            isSkillFrontmatter(yaml) &&
            getSkillSections().map((s) => <s.component key={s.id} />)}
        </>
      )}
    </div>
  );
}

// ─── Frontmatter helpers ──────────────────────────────────────────────────────

/**
 * Serialize PropertyEntry[] back to a YAML string (without --- delimiters).
 * Exported for testing.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function serializeYamlProperties(entries: PropertyEntry[]): string {
  return entries
    .map((entry) => {
      if (entry.type === "array") {
        const arr = entry.value as string[];
        const bracketList = arr.join(", ");
        return `${entry.key}: [${bracketList}]`;
      }
      return `${entry.key}: ${entry.value as string}`;
    })
    .join("\n");
}

function AddPropertyButton({ onAdd }: { onAdd: (key: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");

  const commit = () => {
    const trimmed = newKey.trim();
    if (trimmed) onAdd(trimmed);
    setAdding(false);
    setNewKey("");
  };

  if (!adding) {
    return (
      <button className="properties-add-btn" onClick={() => setAdding(true)}>
        + 속성 추가
      </button>
    );
  }

  return (
    <input
      autoFocus
      className="properties-input"
      onBlur={commit}
      onChange={(e) => setNewKey(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setAdding(false);
          setNewKey("");
        }
      }}
      placeholder="key 이름 입력 후 Enter"
      value={newKey}
    />
  );
}

// ─── File tree search ─────────────────────────────────────────────────────────

function extractFrontmatter(
  content: string,
): null | { rest: string; yaml: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return { yaml: match[1], rest: content.slice(match[0].length) };
}

// ─── AddPropertyButton ────────────────────────────────────────────────────────

function findFileInTree(tree: FileEntry[], name: string): FileEntry | null {
  for (const entry of tree) {
    if (!entry.isDir && (entry.name === name || entry.name === `${name}.md`)) {
      return entry;
    }
    if (entry.isDir && entry.children) {
      const found = findFileInTree(entry.children, name);
      if (found) return found;
    }
  }
  return null;
}

// ─── PropertiesPanel ──────────────────────────────────────────────────────────

function rebuildContent(yaml: string, rest: string): string {
  return `---\n${yaml}\n---${rest}`;
}
