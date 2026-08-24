// §56c OneLineEditor — inline one-line editing for current year journal entry
import { useEffect, useState } from "react";

import { useTranslation } from "../../i18n/useTranslation";
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
  const { t } = useTranslation();
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
            : // Wrapped in a <p> because it shares the markdown render path above. Locale
              // strings are ours and carry no markup, so nothing here needs escaping.
              `<p>${t("journal.oneline.prompt")}</p>`,
        }}
        onClick={() => setEditing(true)}
        title={t("journal.oneline.editHint")}
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
      placeholder={t("journal.oneline.placeholder")}
      value={draft}
    />
  );
}
