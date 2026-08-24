// §298 vim §12-⑩ — reactive chrome capability (design v7.3~v7.5).
//
// Reading `editor.isEditable` during render is a trap twice over:
// ReactNodeView skips re-render while the node reference is unchanged
// (stale UI), and isEditable couples real write capability with vim's
// modal view.editable. This hook subscribes to both change axes —
// transactions (modal flips ride plugin state) and the app-owned
// editability signal (§12-⑪ bans every other options.editable path) —
// and answers "may chrome mutate the document right now?".
//
// This gates EXPOSURE only. Mutation callbacks must also re-check
// canUseEditorChrome at event time: a stale-rendered button can outlive
// this hook's value.

import { useCallback, useSyncExternalStore } from "react";

import type { Editor } from "@tiptap/core";

import { canUseEditorChrome } from "../extensions/plugins/vim/vim-keys";
import { subscribeEditorEditable } from "../utils/editor/editor-editable";

export function useEditorChrome(editor: Editor): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      editor.on("transaction", onChange);
      const unsubscribe = subscribeEditorEditable(onChange);
      return () => {
        editor.off("transaction", onChange);
        unsubscribe();
      };
    },
    [editor],
  );
  return useSyncExternalStore(subscribe, () => canUseEditorChrome(editor));
}
