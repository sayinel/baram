// §94 Inline title-input dialog (WKWebView has no window.prompt)
import { useEffect, useState } from "react";

import { useShallow } from "zustand/shallow";

import { useUIStore } from "../../stores/ui/ui";

export function ZettelTitleDialog() {
  const { dialog, close } = useUIStore(
    useShallow((s) => ({
      dialog: s.zettelTitleDialog,
      close: s.closeZettelTitleDialog,
    })),
  );
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (dialog.open) setTitle("");
  }, [dialog.open]);

  if (!dialog.open) return null;

  const submit = () => {
    dialog.onSubmit?.(title);
    close();
  };

  return (
    <div className="zettel-title-dialog-overlay" onClick={close}>
      <div className="zettel-title-dialog" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") close();
          }}
          placeholder="노트 제목"
          type="text"
          value={title}
        />
        <div className="zettel-title-dialog-actions">
          <button onClick={close}>Cancel</button>
          <button onClick={submit}>Create</button>
        </div>
      </div>
    </div>
  );
}
