// §100/§101 Zettel hub — sidebar panel for the Zettel space.
// Actions bar now; Inbox queue + MOCs + Recent sections land in Task 4.
import { FileText, Map as MapIcon, Zap } from "lucide-react";

import { getAction } from "../../keybindings/keybinding-actions";
import { useUIStore } from "../../stores/ui/ui";
import "../../styles/zettelkasten.css";

export function ZettelHubPanel() {
  return (
    <div className="zettel-hub">
      <div className="zettel-hub-actions">
        <button
          aria-label="New Zettel"
          className="zettel-hub-action"
          onClick={() => getAction("zettelkasten.newNote")?.()}
          title="New Zettel (⇧⌘V)"
        >
          <FileText size={14} strokeWidth={1.5} />
          New
        </button>
        <button
          aria-label="Quick Capture"
          className="zettel-hub-action"
          onClick={() => useUIStore.getState().openQuickCapture()}
          title="Quick Capture (⇧⌘N)"
        >
          <Zap size={14} strokeWidth={1.5} />
          Capture
        </button>
        <button
          aria-label="New MOC"
          className="zettel-hub-action"
          onClick={() => getAction("zettelkasten.newMoc")?.()}
          title="New MOC (⇧⌘C)"
        >
          <MapIcon size={14} strokeWidth={1.5} />
          MOC
        </button>
      </div>
    </div>
  );
}
