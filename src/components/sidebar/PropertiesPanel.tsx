// §72 Properties Panel — YAML frontmatter GUI editor
import { useCallback, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../../stores/file/file";
import type {
  PropertyEntry,
  PropertyType,
} from "../../utils/markdown/yaml-properties";

import { CodeXml, FileText, Plus, Redo2, Undo2, X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { showPrompt } from "../../utils/ai-commands";
import { logger } from "../../utils/logger";
import {
  extractFrontmatter,
  withFrontmatterYaml,
} from "../../utils/markdown/frontmatter";
import {
  addYamlProperty,
  ARRAY_KEYS,
  ENUM_KEYS,
  ENUM_VALUES,
  isWritableYamlValue,
  parseYamlProperties,
  removeYamlProperty,
  setYamlPropertyItems,
  setYamlPropertyValue,
} from "../../utils/markdown/yaml-properties";
import { isSkillFrontmatter } from "../../utils/skill/skill-frontmatter";
import { isBodyTagName, tagName } from "../../utils/tags/tag-name";
import { getSkillSections } from "./skill-panel-registry";
// §72c Side-effect imports: sections self-register into the registry
import "./SkillDependencySection";
import "./SkillLintSection";
import "./SkillLivePreview";
import "./SkillOptimizeSection";

// ─── Types re-exported for backward compatibility ─────────────────────────────
// (types and parse/serialize functions now live in ../../utils/yaml-properties)

/**
 * §72 A value input's edit in progress. The input writes on every keystroke, and typing must
 * not change the value's type on the way (`-1` → `-` → `-1`), so each write is spelled against
 * the value as the edit found it (`setYamlPropertyValue`'s `original`), not as the previous
 * keystroke left it. The edit ends when the input loses focus, or when the front matter is no
 * longer what it left (`after`) — another file, an undo, an edit from elsewhere.
 */
interface InputEdit {
  after: string;
  /** The field was a `yaml` one when the edit began: emptying it does not make it a string. */
  asYaml: boolean;
  file: string;
  /** The value's spelling when the edit began. */
  raw: string;
}

/** §72 `yaml` text typed that is not valid YAML there: shown in the input, not written. */
interface YamlDraft {
  file: string;
  text: string;
  /** The front matter it was typed on; another one drops the draft. */
  yaml: string;
}

export function PropertiesPanel() {
  const { t } = useTranslation();
  const { rightPanelOpen, rightPanelMode } = useUIStore(
    useShallow((s) => ({
      rightPanelOpen: s.rightPanelOpen,
      rightPanelMode: s.rightPanelMode,
    })),
  );
  const { activeTabId, tabs } = useEditorStore(
    useShallow((s) => ({ activeTabId: s.activeTabId, tabs: s.tabs })),
  );
  const { openFiles, fileTree } = useFileStore(
    useShallow((s) => ({ openFiles: s.openFiles, fileTree: s.fileTree })),
  );

  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [lastAddedKey, setLastAddedKey] = useState<null | string>(null);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const [, forceRender] = useState(0);
  /** §72 Each value input's edit in progress, by key (`InputEdit`). */
  const inputEditsRef = useRef(new Map<string, InputEdit>());
  /** §72 `yaml` text typed that is not valid YAML yet, by key (`YamlDraft`). */
  const [yamlDrafts, setYamlDrafts] = useState<ReadonlyMap<string, YamlDraft>>(
    () => new Map(),
  );

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId],
  );
  const filePath = activeTab?.filePath ?? null;
  const content = filePath ? (openFiles.get(filePath) ?? null) : null;

  const { yaml, entries, parsed } = useMemo(() => {
    if (!content)
      return { yaml: null, entries: [] as PropertyEntry[], parsed: null };
    const p = extractFrontmatter(content);
    const y = p?.yaml ?? null;
    return {
      yaml: y,
      entries: y !== null ? parseYamlProperties(y) : ([] as PropertyEntry[]),
      parsed: p ?? null,
    };
  }, [content]);

  // ── write-back helpers ───────────────────────────────────────────────────

  /**
   * §72 Writes `newYaml` as the open file's frontmatter. Every other character of the file —
   * the `---` fences and their line breaks, the body — stays as it was (`withFrontmatterYaml`);
   * an edit that changes nothing (a write the editors refused) is not recorded.
   */
  function applyYamlDirectly(newYaml: string, skipUndo = false) {
    if (!filePath || !parsed || content === null || yaml === null) return;
    if (newYaml === yaml) return;
    if (!skipUndo) {
      undoStackRef.current.push(yaml);
      redoStackRef.current = [];
    }
    const newContent = withFrontmatterYaml(content, newYaml);
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
      applyYamlDirectly(sourceText);
    }
    setSourceMode((v) => !v);
  };

  // ── field handlers ───────────────────────────────────────────────────────

  /** Sets or clears (`null`) the `yaml` text kept for `key` while it is not valid YAML. */
  const setYamlDraft = (key: string, draft: null | YamlDraft) =>
    setYamlDrafts((drafts) => {
      if (draft === null && !drafts.has(key)) return drafts;
      const next = new Map(drafts);
      if (draft === null) next.delete(key);
      else next.set(key, draft);
      return next;
    });

  /** The `yaml` text an input shows instead of its value: a draft typed on this front matter. */
  const draftOf = (key: string): string | undefined => {
    const draft = yamlDrafts.get(key);
    return draft && draft.file === filePath && draft.yaml === yaml
      ? draft.text
      : undefined;
  };

  // Each edit rewrites only its own property's lines (`yaml-properties.ts`).
  const handleStringChange = useCallback(
    (key: string, val: string) => {
      const entry = entries.find((e) => e.key === key);
      if (yaml === null || filePath === null || !entry) return;
      const edits = inputEditsRef.current;
      let edit = edits.get(key);
      if (!edit || edit.file !== filePath || edit.after !== yaml) {
        edit = {
          after: yaml,
          asYaml: entry.type === "yaml",
          file: filePath,
          raw: entry.raw ?? "",
        };
        edits.set(key, edit);
      }
      let newYaml: string;
      if (edit.asYaml) {
        // YAML text (`{a: 1}`, `&a x`) is written as typed, and only once it is valid YAML.
        if (!isWritableYamlValue(yaml, key, val)) {
          setYamlDraft(key, { file: filePath, text: val, yaml });
          return;
        }
        setYamlDraft(key, null);
        newYaml = setYamlPropertyValue(yaml, key, val, { asYaml: true });
      } else {
        newYaml = setYamlPropertyValue(yaml, key, val, { original: edit.raw });
      }
      edit.after = newYaml;
      applyYamlDirectly(newYaml);
    },
    // deps change on every edit, suppress to avoid infinite re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, yaml, content, filePath, parsed],
  );

  // A choice is one whole edit: it keeps the type of the value it replaces.
  const handleEnumChange = (key: string, val: string) => {
    if (yaml !== null) applyYamlDirectly(setYamlPropertyValue(yaml, key, val));
  };

  const handleChipRemove = useCallback(
    (key: string, idx: number) => {
      const entry = entries.find((e) => e.key === key);
      if (yaml === null || !entry) return;
      const items = (entry.value as string[]).filter((_, i) => i !== idx);
      applyYamlDirectly(setYamlPropertyItems(yaml, key, items));
    },
    // deps change on every edit, suppress to avoid infinite re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, yaml, content, filePath, parsed],
  );

  const handleChipAdd = useCallback(
    (key: string) => {
      (async () => {
        const typed = (await showPrompt("Add item:"))?.trim();
        const entry = entries.find((e) => e.key === key);
        if (!typed || yaml === null || !entry) return;
        // §56m A tag chip takes a tag name, and only one a note's body can spell — the rule of
        // the tag bar, whose list writer this edit goes through.
        const item = key === "tags" ? tagName(typed) : typed;
        if (key === "tags" && !isBodyTagName(item)) return;
        applyYamlDirectly(
          setYamlPropertyItems(yaml, key, [...(entry.value as string[]), item]),
        );
      })();
    },
    // deps change on every edit, suppress to avoid infinite re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, yaml, content, filePath, parsed],
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
        const fileContent = await readFile(found.path);
        useFileStore.getState().setFileContent(found.path, fileContent);
        openTab({
          contextId: "",
          id: tabId,
          filePath: found.path,
          title: found.name,
          isDirty: false,
          isPinned: false,
        });
        setActiveTab(tabId);
      } catch (err) {
        logger.error("PropertiesPanel: failed to open file", err);
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
      if (yaml === null) return;
      setLastAddedKey(key);
      applyYamlDirectly(addYamlProperty(yaml, key, type));
    },
    // deps change on every edit, suppress to avoid infinite re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yaml, content, filePath, parsed],
  );

  const handleDeleteProperty = useCallback(
    (key: string) => {
      if (yaml !== null) applyYamlDirectly(removeYamlProperty(yaml, key));
    },
    // deps change on every edit, suppress to avoid infinite re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yaml, content, filePath, parsed],
  );

  // ── render ───────────────────────────────────────────────────────────────

  if (!rightPanelOpen || rightPanelMode !== "properties") return null;

  return (
    <div className="properties-panel">
      <div className="properties-header flex-header">
        <span>Properties</span>
        <div className="properties-header-actions">
          <button
            aria-label={t("menu.edit.undo")}
            className="properties-undo-btn"
            disabled={undoStackRef.current.length === 0}
            onClick={handleUndo}
            title={t("menu.edit.undo")}
          >
            <Undo2 className="icon-inline" size="1em" />
          </button>
          <button
            aria-label={t("menu.edit.redo")}
            className="properties-undo-btn"
            disabled={redoStackRef.current.length === 0}
            onClick={handleRedo}
            title={t("menu.edit.redo")}
          >
            <Redo2 className="icon-inline" size="1em" />
          </button>
          <button
            aria-label={t("properties.toggleSource")}
            className="properties-source-toggle"
            onClick={handleToggleSource}
            title={t("properties.toggleSource")}
          >
            <CodeXml className="icon-inline" size="1em" />
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
                    aria-label={t("properties.deleteKey", { key: entry.key })}
                    className="properties-key-delete"
                    onClick={() => handleDeleteProperty(entry.key)}
                    title={t("properties.deleteKey", { key: entry.key })}
                  >
                    <X className="icon-inline" size="1em" />
                  </button>
                </div>

                {(entry.type === "string" || entry.type === "yaml") && (
                  <input
                    aria-invalid={draftOf(entry.key) !== undefined || undefined}
                    autoFocus={entry.key === lastAddedKey}
                    className="properties-input"
                    onBlur={() => {
                      inputEditsRef.current.delete(entry.key);
                      setYamlDraft(entry.key, null);
                    }}
                    onChange={(e) =>
                      handleStringChange(entry.key, e.target.value)
                    }
                    onFocus={() => {
                      if (entry.key === lastAddedKey) setLastAddedKey(null);
                    }}
                    value={draftOf(entry.key) ?? (entry.value as string)}
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
                          className={`properties-chip ${isFileRef ? "file-ref" : ""}`}
                          key={idx}
                          onClick={
                            isFileRef ? () => handleOpenFile(chip) : undefined
                          }
                        >
                          {isFileRef && (
                            <FileText className="icon-inline" size="1em" />
                          )}
                          {chip}
                          <button
                            aria-label={t("properties.removeItem")}
                            className="properties-chip-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleChipRemove(entry.key, idx);
                            }}
                            title={t("properties.removeItem")}
                          >
                            <X className="icon-inline" size="1em" />
                          </button>
                        </span>
                      );
                    })}
                    <button
                      aria-label={t("properties.addItem")}
                      className="properties-chip-add"
                      onClick={() => handleChipAdd(entry.key)}
                      title={t("properties.addItem")}
                    >
                      <Plus className="icon-inline" size="1em" />
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

function AddPropertyButton({ onAdd }: { onAdd: (key: string) => void }) {
  const { t } = useTranslation();
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
        <Plus className="icon-inline" size="1em" />{" "}
        {t("properties.addProperty")}
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
