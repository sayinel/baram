// Shared factory for atom-block NodeSelection entry-direction tracking Plugin.
// Used by mathBlock (§5.3) and mermaidBlock (§5.5) — the only difference is the node type name.
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";

export interface AtomBlockEntryState {
  direction: "above" | "below";
}

/**
 * Creates a ProseMirror Plugin that:
 * 1. Tracks the entry direction (above/below) when a given atom-block node becomes selected.
 * 2. Handles click events to set a NodeSelection on the atom block.
 *
 * @param nodeName - The Tiptap/ProseMirror node type name (e.g. "mathBlock", "mermaidBlock")
 * @param pluginKey - A unique PluginKey for this plugin instance
 */
export function createAtomBlockEntryPlugin(
  nodeName: string,
  pluginKey: PluginKey<AtomBlockEntryState>,
): Plugin<AtomBlockEntryState> {
  return new Plugin<AtomBlockEntryState>({
    key: pluginKey,
    state: {
      init(): AtomBlockEntryState {
        return { direction: "above" };
      },
      apply(tr, value, oldState): AtomBlockEntryState {
        const newSel = tr.selection;
        const oldSel = oldState.selection;
        if (
          newSel instanceof NodeSelection &&
          newSel.node.type.name === nodeName
        ) {
          if (
            !(oldSel instanceof NodeSelection) ||
            oldSel.from !== newSel.from
          ) {
            const enteredFromBelow = oldSel.from > newSel.from;
            return { direction: enteredFromBelow ? "below" : "above" };
          }
        }
        return value;
      },
    },
    props: {
      handleClickOn(view, _pos, node, nodePos, _event, direct): boolean {
        if (node.type.name === nodeName && direct) {
          const tr = view.state.tr.setSelection(
            NodeSelection.create(view.state.doc, nodePos),
          );
          view.dispatch(tr);
          return true;
        }
        return false;
      },
    },
  });
}
