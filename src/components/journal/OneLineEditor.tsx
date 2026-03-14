// §56c OneLineEditor — inline one-line editing for current year journal entry
import { useEffect, useState } from "react";

import { renderSimpleMarkdown } from "../../utils/journal/journal-memories";
import { resolveImageSrcs } from "./utils";

export interface MemoryEntry {
  diaryContent: string;
  fullContent: string;
  isCurrentYear: boolean;
  oneLine: string;
  path: string;
  year: number;
}

interface OneLineEditorProps {
  entry: MemoryEntry;
  onSave: (text: string) => void;
}

export function OneLineEditor({ entry, onSave }: OneLineEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.oneLine);

  useEffect(() => {
    setDraft(entry.oneLine);
  }, [entry.oneLine]);

  if (!editing) {
    const fileDir = entry.path.substring(0, entry.path.lastIndexOf("/"));
    return (
      <div
        className="memories-oneline memories-oneline-editable memories-md-render"
        dangerouslySetInnerHTML={{
          __html: entry.oneLine
            ? resolveImageSrcs(renderSimpleMarkdown(entry.oneLine), fileDir)
            : "<p>(클릭하여 한 줄 요약 입력)</p>",
        }}
        onClick={() => setEditing(true)}
        title="클릭하여 편집"
      />
    );
  }

  return (
    <input
      autoFocus
      className="memories-oneline-input"
      onBlur={() => {
        setEditing(false);
        if (draft !== entry.oneLine) onSave(draft);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          setEditing(false);
          if (draft !== entry.oneLine) onSave(draft);
        } else if (e.key === "Escape") {
          setEditing(false);
          setDraft(entry.oneLine);
        }
      }}
      placeholder="한 줄 요약 입력..."
      value={draft}
    />
  );
}
