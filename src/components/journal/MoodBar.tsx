// §56e Mood/Energy Bar — segmented control design
// §56j Emotion Inference + §56m AI Tag Suggestions
import { useCallback, useEffect, useRef, useState } from "react";

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

import {
  parseFrontmatterTags,
  updateFrontmatterTags,
} from "../../extensions/nodes/frontmatter-view";
import { useLLMStream } from "../../hooks/use-llm-stream";
import { getVaultTags } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import {
  type EnergyValue,
  MOOD_VALUES,
  type MoodValue,
} from "../../utils/journal/journal-mood";
import {
  buildEmotionInferencePrompt,
  parseEmotionResponse,
} from "../../utils/journal/journal-reflection";
import {
  buildTagSuggestionPrompt,
  parseTagSuggestions,
} from "../../utils/journal/journal-tags";

interface MoodBarProps {
  editor: Editor | null;
}

// Segment labels (Korean)
const MOOD_SEGMENT_LABELS: Record<MoodValue, string> = {
  deep: "침울",
  calm: "차분",
  neutral: "평온",
  warm: "따뜻",
  bright: "밝은",
};

// Unified cool→warm palette for mood segment tints
const MOOD_TINTS: Record<MoodValue, string> = {
  deep: "rgba(100, 116, 139, 0.18)",
  calm: "rgba(148, 163, 184, 0.18)",
  neutral: "rgba(180, 190, 200, 0.18)",
  warm: "rgba(245, 158, 11, 0.15)",
  bright: "rgba(251, 191, 36, 0.15)",
};

// Mood text color when selected (darker version of tint)
const MOOD_TEXT_COLORS: Record<MoodValue, string> = {
  deep: "#475569",
  calm: "#64748B",
  neutral: "#78838E",
  warm: "#B45309",
  bright: "#A16207",
};

// Energy fill gradient (same tonal family, increasing intensity)
const ENERGY_FILLS = [
  "rgba(var(--mood-accent-rgb, 100, 116, 139), 0.12)",
  "rgba(var(--mood-accent-rgb, 100, 116, 139), 0.18)",
  "rgba(var(--mood-accent-rgb, 100, 116, 139), 0.24)",
  "rgba(var(--mood-accent-rgb, 100, 116, 139), 0.32)",
  "rgba(var(--mood-accent-rgb, 100, 116, 139), 0.42)",
];

/** Find frontmatter node and its position in the PM document */
function findFrontmatter(editor: Editor): null | { node: PMNode; pos: number } {
  let result: null | { node: PMNode; pos: number } = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "frontmatter" && !result) {
      result = { node, pos };
      return false;
    }
  });
  return result;
}

/** Check if the active file is a journal daily note */
function isJournalDailyNote(): boolean {
  const { isJournalScoped } = useFileStore.getState();
  if (!isJournalScoped) return false;

  const { tabs, activeTabId } = useEditorStore.getState();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab?.filePath) return false;

  return (
    activeTab.filePath.includes("/daily/") && activeTab.filePath.endsWith(".md")
  );
}

/** Parse a field value from YAML text */
function parseYamlField(yaml: string, field: string): string | undefined {
  const match = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : undefined;
}

/** Update frontmatter in the ProseMirror document */
function updateFrontmatterField(
  editor: Editor,
  field: string,
  value: string | undefined,
): boolean {
  const fm = findFrontmatter(editor);
  if (!fm) return false;

  const yaml = fm.node.textContent;
  const newYaml = updateYamlField(yaml, field, value);
  if (yaml === newYaml) return false;

  const tr = editor.state.tr;
  const from = fm.pos + 1; // content start (inside node)
  const to = fm.pos + 1 + fm.node.content.size; // content end

  if (fm.node.content.size > 0) {
    tr.replaceWith(from, to, editor.schema.text(newYaml));
  } else {
    tr.insertText(newYaml, from);
  }

  editor.view.dispatch(tr);
  return true;
}

/** Update a field in YAML text */
function updateYamlField(
  yaml: string,
  field: string,
  value: string | undefined,
): string {
  const fieldRegex = new RegExp(`^${field}:\\s*.*$`, "m");
  const hasField = fieldRegex.test(yaml);

  if (value === undefined) {
    return yaml
      .replace(fieldRegex, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
  } else if (hasField) {
    return yaml.replace(fieldRegex, `${field}: ${value}`);
  } else {
    return yaml.trim() + `\n${field}: ${value}`;
  }
}

/** Mood labels in Korean for AI suggestion display */
const MOOD_LABEL_KO: Record<MoodValue, string> = {
  deep: "침울",
  calm: "차분",
  neutral: "평온",
  warm: "따뜻",
  bright: "밝은",
};

export function MoodBar({ editor }: MoodBarProps) {
  const [mood, setMood] = useState<MoodValue | undefined>(undefined);
  const [energy, setEnergy] = useState<EnergyValue | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const activeTabId = useEditorStore((s) => s.activeTabId);

  // §56j Emotion Inference state
  const journalAIReflectionEnabled = useSettingsStore(
    (s) => s.journalAIReflectionEnabled,
  );
  const [suggestedMood, setSuggestedMood] = useState<MoodValue | null>(null);
  const [emotionDismissed, setEmotionDismissed] = useState(false);
  const emotionInferredRef = useRef<Map<string, boolean>>(new Map());
  const emotionLLM = useLLMStream();

  // §56m AI Tag Suggestions state
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [tagsDismissed, setTagsDismissed] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const tagLLM = useLLMStream();

  // Read mood/energy from frontmatter when editor or tab changes
  useEffect(() => {
    if (!editor || !isJournalDailyNote()) {
      setVisible(false);
      return;
    }

    setVisible(true);

    // Reset AI suggestion states on tab change
    setSuggestedMood(null);
    setEmotionDismissed(false);
    setSuggestedTags([]);
    setTagsDismissed(false);

    const fm = findFrontmatter(editor);
    if (!fm) return;

    const yaml = fm.node.textContent;
    const moodVal = parseYamlField(yaml, "mood");
    const energyVal = parseYamlField(yaml, "energy");

    if (moodVal && MOOD_VALUES.includes(moodVal as MoodValue)) {
      setMood(moodVal as MoodValue);
    } else {
      setMood(undefined);
    }

    const eNum = energyVal ? parseInt(energyVal, 10) : NaN;
    if (!isNaN(eNum) && eNum >= 1 && eNum <= 5) {
      setEnergy(eNum as EnergyValue);
    } else {
      setEnergy(undefined);
    }
  }, [editor, activeTabId]);

  // §56j Emotion Inference — auto-infer mood when mood is unset
  useEffect(() => {
    if (
      !editor ||
      !visible ||
      mood !== undefined ||
      !journalAIReflectionEnabled ||
      emotionDismissed
    )
      return;

    const filePath = useEditorStore
      .getState()
      .tabs.find(
        (t) => t.id === useEditorStore.getState().activeTabId,
      )?.filePath;
    if (!filePath || emotionInferredRef.current.get(filePath)) return;

    // Check content length > 50 chars (excluding frontmatter)
    const doc = editor.state.doc;
    let textLen = 0;
    doc.descendants((node) => {
      if (node.type.name !== "frontmatter" && node.isTextblock) {
        textLen += node.textContent.length;
      }
    });
    if (textLen < 50) return;

    // Mark as inferred for this file (session-scoped)
    emotionInferredRef.current.set(filePath, true);

    // Get body text for inference
    let bodyText = "";
    doc.descendants((node) => {
      if (node.type.name !== "frontmatter" && node.isTextblock) {
        bodyText += node.textContent + "\n";
      }
    });

    const { systemPrompt, userPrompt } = buildEmotionInferencePrompt(bodyText);
    emotionLLM.send(userPrompt, systemPrompt, { task: "chat", maxTokens: 50 });
    // emotionLLM object identity changes each render; adding it would cause
    // infinite re-triggering. filePath is read from store inside the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editor,
    visible,
    mood,
    journalAIReflectionEnabled,
    emotionDismissed,
    activeTabId,
  ]);

  // Parse emotion LLM response when streaming completes
  useEffect(() => {
    if (!emotionLLM.isStreaming && emotionLLM.text && !suggestedMood) {
      const parsed = parseEmotionResponse(emotionLLM.text);
      if (parsed) {
        setSuggestedMood(parsed);
      }
    }
  }, [emotionLLM.isStreaming, emotionLLM.text, suggestedMood]);

  // §56m AI Tag Suggestions handler
  const handleTagSuggest = useCallback(async () => {
    if (!editor || tagsLoading) return;
    setTagsLoading(true);
    setTagsDismissed(false);
    setSuggestedTags([]);

    // Get body text
    let bodyText = "";
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "frontmatter" && node.isTextblock) {
        bodyText += node.textContent + "\n";
      }
    });

    // Get existing tags from frontmatter
    const fm = findFrontmatter(editor);
    const existingTags = fm ? parseFrontmatterTags(fm.node.textContent) : [];

    // Get vault tags
    let vaultTagNames: string[] = [];
    try {
      const rootPath = useFileStore.getState().rootPath;
      if (rootPath) {
        const vaultEntries = await getVaultTags(rootPath);
        vaultTagNames = vaultEntries
          .sort((a, b) => b.count - a.count)
          .map((e) => e.tag);
      }
    } catch {
      // Vault tags are optional
    }

    const { systemPrompt, userPrompt } = buildTagSuggestionPrompt(
      bodyText,
      existingTags,
      vaultTagNames,
    );
    tagLLM.send(userPrompt, systemPrompt, { task: "chat", maxTokens: 200 });
  }, [editor, tagsLoading, tagLLM]);

  // Parse tag LLM response when streaming completes
  useEffect(() => {
    if (!tagLLM.isStreaming && tagLLM.text && tagsLoading) {
      const fm = findFrontmatter(editor!);
      const existingTags = fm ? parseFrontmatterTags(fm.node.textContent) : [];
      const tags = parseTagSuggestions(tagLLM.text, existingTags);
      setSuggestedTags(tags);
      setTagsLoading(false);
    }
  }, [tagLLM.isStreaming, tagLLM.text, tagsLoading, editor]);

  // Accept a suggested tag → add to frontmatter
  const handleAcceptTag = useCallback(
    (tag: string) => {
      if (!editor) return;
      const fm = findFrontmatter(editor);
      if (!fm) return;

      const currentTags = parseFrontmatterTags(fm.node.textContent);
      if (currentTags.includes(tag)) return;

      const newYaml = updateFrontmatterTags(fm.node.textContent, [
        ...currentTags,
        tag,
      ]);
      const tr = editor.state.tr;
      const from = fm.pos + 1;
      const to = fm.pos + 1 + fm.node.content.size;
      if (fm.node.content.size > 0) {
        tr.replaceWith(from, to, editor.schema.text(newYaml));
      } else {
        tr.insertText(newYaml, from);
      }
      editor.view.dispatch(tr);

      // Remove from suggestions
      setSuggestedTags((prev) => prev.filter((t) => t !== tag));
    },
    [editor],
  );

  const handleMoodClick = useCallback(
    (value: MoodValue) => {
      if (!editor) return;
      const newMood = mood === value ? undefined : value;
      setMood(newMood);
      updateFrontmatterField(editor, "mood", newMood);
    },
    [editor, mood],
  );

  const handleEnergyClick = useCallback(
    (value: EnergyValue) => {
      if (!editor) return;
      const newEnergy = energy === value ? undefined : value;
      setEnergy(newEnergy);
      updateFrontmatterField(
        editor,
        "energy",
        newEnergy !== undefined ? String(newEnergy) : undefined,
      );
    },
    [editor, energy],
  );

  if (!visible) return null;

  const showEmotionHint =
    suggestedMood && mood === undefined && !emotionDismissed;
  const showTagChips = suggestedTags.length > 0 && !tagsDismissed;

  return (
    <div className="mood-bar-wrapper">
      <div className="mood-bar">
        <div className="mood-bar-section">
          <span className="mood-bar-section-label">기분</span>
          <div className="mood-segment-group">
            {MOOD_VALUES.map((v) => {
              const isSelected = mood === v;
              return (
                <button
                  className={`mood-segment ${isSelected ? "mood-segment-selected" : ""}`}
                  key={v}
                  onClick={() => handleMoodClick(v)}
                  style={
                    isSelected
                      ? {
                          backgroundColor: MOOD_TINTS[v],
                          color: MOOD_TEXT_COLORS[v],
                        }
                      : undefined
                  }
                  title={MOOD_SEGMENT_LABELS[v]}
                >
                  {MOOD_SEGMENT_LABELS[v]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mood-bar-section">
          <span className="mood-bar-section-label">에너지</span>
          <div className="mood-segment-group">
            {([1, 2, 3, 4, 5] as EnergyValue[]).map((v) => {
              const isFilled = energy !== undefined && v <= energy;
              return (
                <button
                  className={`mood-segment energy-segment ${isFilled ? "energy-segment-filled" : ""}`}
                  key={v}
                  onClick={() => handleEnergyClick(v)}
                  style={
                    isFilled
                      ? { backgroundColor: ENERGY_FILLS[v - 1] }
                      : undefined
                  }
                  title={`Energy ${v}`}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>
        {/* §56m Tag Suggest Button */}
        {journalAIReflectionEnabled && (
          <button
            className="mood-bar-tag-suggest-btn"
            disabled={tagsLoading || tagLLM.isStreaming}
            onClick={handleTagSuggest}
            title="AI 태그 추천"
          >
            {tagsLoading || tagLLM.isStreaming ? "…" : "🏷️"}
          </button>
        )}
      </div>

      {/* §56j AI Emotion Hint */}
      {showEmotionHint && (
        <div className="mood-bar-ai-hint">
          <span className="mood-bar-ai-hint-text">
            AI 제안: {MOOD_LABEL_KO[suggestedMood]}
          </span>
          <button
            className="mood-bar-ai-hint-btn mood-bar-ai-hint-accept"
            onClick={() => {
              handleMoodClick(suggestedMood);
              setSuggestedMood(null);
            }}
            title="수락"
          >
            ✓
          </button>
          <button
            className="mood-bar-ai-hint-btn mood-bar-ai-hint-dismiss"
            onClick={() => setEmotionDismissed(true)}
            title="무시"
          >
            ✕
          </button>
        </div>
      )}

      {/* §56m AI Tag Chips */}
      {showTagChips && (
        <div className="mood-bar-ai-tags">
          <span className="mood-bar-ai-tags-label">AI 태그:</span>
          {suggestedTags.map((tag) => (
            <button
              className="ai-tag-chip"
              key={tag}
              onClick={() => handleAcceptTag(tag)}
              title={`"${tag}" 추가`}
            >
              #{tag}
            </button>
          ))}
          <button
            className="mood-bar-ai-hint-btn mood-bar-ai-hint-dismiss"
            onClick={() => setTagsDismissed(true)}
            title="닫기"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
