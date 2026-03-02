// §56e Mood/Energy Bar — segmented control design
import { useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  MOOD_VALUES,
  type MoodValue,
  type EnergyValue,
} from "../../utils/journal-mood";
import { useFileStore } from "../../stores/file-store";
import { useEditorStore } from "../../stores/editor-store";

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

/** Check if the active file is a journal daily note */
function isJournalDailyNote(): boolean {
  const { isJournalScoped } = useFileStore.getState();
  if (!isJournalScoped) return false;

  const { tabs, activeTabId } = useEditorStore.getState();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab?.filePath) return false;

  return activeTab.filePath.includes("/daily/") && activeTab.filePath.endsWith(".md");
}

/** Find frontmatter node and its position in the PM document */
function findFrontmatter(editor: Editor): { node: PMNode; pos: number } | null {
  let result: { node: PMNode; pos: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "frontmatter" && !result) {
      result = { node, pos };
      return false;
    }
  });
  return result;
}

/** Parse a field value from YAML text */
function parseYamlField(yaml: string, field: string): string | undefined {
  const match = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : undefined;
}

/** Update a field in YAML text */
function updateYamlField(yaml: string, field: string, value: string | undefined): string {
  const fieldRegex = new RegExp(`^${field}:\\s*.*$`, "m");
  const hasField = fieldRegex.test(yaml);

  if (value === undefined) {
    return yaml.replace(fieldRegex, "").replace(/\n{2,}/g, "\n").trim();
  } else if (hasField) {
    return yaml.replace(fieldRegex, `${field}: ${value}`);
  } else {
    return yaml.trim() + `\n${field}: ${value}`;
  }
}

/** Update frontmatter in the ProseMirror document */
function updateFrontmatterField(editor: Editor, field: string, value: string | undefined): boolean {
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

export function MoodBar({ editor }: MoodBarProps) {
  const [mood, setMood] = useState<MoodValue | undefined>(undefined);
  const [energy, setEnergy] = useState<EnergyValue | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const activeTabId = useEditorStore((s) => s.activeTabId);

  // Read mood/energy from frontmatter when editor or tab changes
  useEffect(() => {
    if (!editor || !isJournalDailyNote()) {
      setVisible(false);
      return;
    }

    setVisible(true);
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
      updateFrontmatterField(editor, "energy", newEnergy !== undefined ? String(newEnergy) : undefined);
    },
    [editor, energy],
  );

  if (!visible) return null;

  return (
    <div className="mood-bar">
      <div className="mood-bar-section">
        <span className="mood-bar-section-label">기분</span>
        <div className="mood-segment-group">
          {MOOD_VALUES.map((v) => {
            const isSelected = mood === v;
            return (
              <button
                key={v}
                className={`mood-segment ${isSelected ? "mood-segment-selected" : ""}`}
                style={isSelected ? {
                  backgroundColor: MOOD_TINTS[v],
                  color: MOOD_TEXT_COLORS[v],
                } : undefined}
                onClick={() => handleMoodClick(v)}
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
                key={v}
                className={`mood-segment energy-segment ${isFilled ? "energy-segment-filled" : ""}`}
                style={isFilled ? { backgroundColor: ENERGY_FILLS[v - 1] } : undefined}
                onClick={() => handleEnergyClick(v)}
                title={`Energy ${v}`}
              >
                {v}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
