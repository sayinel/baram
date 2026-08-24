// §298 Vim Phase 1 — the always-installed extension (design §2/§7).
//
// Installed unconditionally with priority 10000 so its plugin (and its
// `attributes`/`editable` props) sort before every other extension — the
// tabindex first-writer-wins contract (§3b) depends on this ordering. The
// plugin starts DISABLED and inert; the settings lifecycle (S6) flips it
// through the setEnabled meta broadcast.

import { Extension } from "@tiptap/core";

import { createVimPlugin } from "./vim-plugin";

export const WysiwygVim = Extension.create({
  name: "wysiwygVim",
  priority: 10000,

  addProseMirrorPlugins() {
    return [createVimPlugin(this.editor)];
  },
});
