// §5.4 Raw ProseMirror NodeView for CodeMirror 6 code blocks
// Uses a plain ProseMirror NodeView (not React) to properly handle
// setSelection(), which is critical for CM ↔ PM focus coordination.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView, EditorView as PMView } from "@tiptap/pm/view";

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState as CMState } from "@codemirror/state";
import {
  EditorView as CMView,
  drawSelection,
  keymap,
  lineNumbers,
  ViewUpdate,
} from "@codemirror/view";
import { redo, undo } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";

import { useSettingsStore } from "../../../stores/settings-store";
import { showNodeViewAIMenu } from "../../../utils/nodeview-ai-menu";
import { getHighlightStyle } from "../code-block-highlight";
import {
  getLanguageExtension,
  LANGUAGE_OPTIONS,
} from "../code-block-languages";

export class CodeBlockNodeView implements NodeView {
  dom: HTMLElement;
  private cmContainer: HTMLElement;
  private cmView: CMView | null = null;
  private destroyed = false;
  private getPos: () => number | undefined;
  private langSelect: HTMLSelectElement;
  private node: PMNode;
  private settingsUnsub: (() => void) | null = null;
  private tiptapEditor: import("@tiptap/core").Editor;
  private updating = false;
  private view: PMView;

  constructor(
    node: PMNode,
    view: PMView,
    getPos: () => number | undefined,
    tiptapEditor?: import("@tiptap/core").Editor,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.tiptapEditor = tiptapEditor as import("@tiptap/core").Editor;

    // Build DOM
    const wrapper = document.createElement("div");
    wrapper.classList.add("code-block-wrapper");
    const lang = (node.attrs.language as string) || "";
    wrapper.dataset.language = lang;
    wrapper.dataset.style = useSettingsStore.getState().codeBlockStyle;

    // Header with language selector
    const header = document.createElement("div");
    header.classList.add("code-block-header");
    header.contentEditable = "false";

    const select = document.createElement("select");
    select.classList.add("code-block-lang-select");
    select.contentEditable = "false";

    // Auto option
    const autoOpt = document.createElement("option");
    autoOpt.value = "";
    autoOpt.textContent = "auto";
    select.appendChild(autoOpt);

    // Language options
    for (const { value, label } of LANGUAGE_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    }
    select.value = lang;

    select.addEventListener("change", () => {
      const pos = this.getPos();
      if (typeof pos !== "number") return;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        language: select.value || null,
      });
      this.view.dispatch(tr);
    });

    header.appendChild(select);
    this.langSelect = select;

    // §11.2.3 AI button
    const aiBtn = document.createElement("button");
    aiBtn.classList.add("nodeview-ai-btn", "code-block-ai-btn");
    aiBtn.textContent = "AI";
    aiBtn.title = "AI Commands";
    aiBtn.contentEditable = "false";
    aiBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = this.node.textContent || "";
      if (!code.trim()) return;
      const lang = (this.node.attrs.language as string) || "";
      const blockText = lang ? `\`\`\`${lang}\n${code}\n\`\`\`` : code;
      const pos = this.getPos();
      if (typeof pos !== "number") return;
      showNodeViewAIMenu(aiBtn, "code", blockText, this.tiptapEditor, pos);
    });
    header.appendChild(aiBtn);

    // CodeMirror container
    const cmContainer = document.createElement("div");
    cmContainer.classList.add("code-block-editor");
    this.cmContainer = cmContainer;

    wrapper.appendChild(header);
    wrapper.appendChild(cmContainer);
    this.dom = wrapper;

    // Initialize CodeMirror (async for lazy language loading)
    this.initCM(lang);

    // Subscribe to settings changes for live updates
    this.settingsUnsub = useSettingsStore.subscribe((state, prev) => {
      if (
        state.tabSize !== prev.tabSize ||
        state.codeBlockLineNumbers !== prev.codeBlockLineNumbers ||
        state.autoPairBrackets !== prev.autoPairBrackets ||
        state.codeBlockStyle !== prev.codeBlockStyle ||
        state.theme !== prev.theme
      ) {
        wrapper.dataset.style = state.codeBlockStyle;
        // Recreate CodeMirror with new settings
        if (this.cmView) {
          this.cmView.destroy();
          this.cmView = null;
        }
        const currentLang = (this.node.attrs.language as string) || "";
        this.initCM(currentLang);
      }
    });
  }

  deselectNode() {
    // Nothing needed — CM handles its own blur
  }

  destroy() {
    this.destroyed = true;
    if (this.settingsUnsub) {
      this.settingsUnsub();
      this.settingsUnsub = null;
    }
    if (this.cmView) {
      this.cmView.destroy();
      this.cmView = null;
    }
  }

  /** Prevent PM from reacting to CM DOM mutations */
  ignoreMutation(): boolean {
    return true;
  }

  /** Called when node is selected as a whole (NodeSelection) */
  selectNode() {
    if (this.cmView) {
      this.cmView.focus();
    }
  }

  /**
   * Called by ProseMirror when selection enters this node.
   * This is the KEY method that ReactNodeViewRenderer doesn't expose —
   * it allows us to properly focus CodeMirror and set its cursor position.
   */
  setSelection(anchor: number, head: number) {
    if (!this.cmView) return;
    this.cmView.focus();
    this.updating = true;
    this.cmView.dispatch({ selection: { anchor, head } });
    this.updating = false;
  }

  /** Prevent ProseMirror from handling events inside the code block */
  stopEvent(): boolean {
    // Stop PM from processing any events — let CM and native select handle them
    return true;
  }

  /** Called by ProseMirror when the node is updated (e.g. undo/redo) */
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;

    const oldLang = (this.node.attrs.language as string) || "";
    this.node = node;

    // Update language selector and recreate CM if language changed
    const lang = (node.attrs.language as string) || "";
    if (oldLang !== lang) {
      this.langSelect.value = lang;
      this.dom.dataset.language = lang;
      if (this.cmView) {
        this.cmView.destroy();
        this.cmView = null;
      }
      this.initCM(lang);
      return true;
    }

    // Sync PM → CM
    if (this.cmView && !this.updating) {
      const cmContent = this.cmView.state.doc.toString();
      const pmContent = node.textContent;
      if (cmContent !== pmContent) {
        this.updating = true;
        this.cmView.dispatch({
          changes: {
            from: 0,
            to: this.cmView.state.doc.length,
            insert: pmContent,
          },
        });
        this.updating = false;
      }
    }

    return true;
  }

  /** Sync CM changes → PM document */
  private forwardUpdate(update: ViewUpdate) {
    const pos = this.getPos();
    if (typeof pos !== "number") return;
    const pmNode = this.view.state.doc.nodeAt(pos);
    if (!pmNode) return;

    const newText = update.state.doc.toString();
    this.updating = true;

    const start = pos + 1;
    const end = start + pmNode.content.size;
    const { tr } = this.view.state;

    if (newText) {
      tr.replaceWith(start, end, this.view.state.schema.text(newText));
    } else {
      tr.delete(start, end);
    }
    this.view.dispatch(tr);
    this.updating = false;
  }

  private async initCM(language: string) {
    const langExt = await getLanguageExtension(language);
    if (this.destroyed) return;

    const settings = useSettingsStore.getState();
    const { tabSize, codeBlockLineNumbers, autoPairBrackets } = settings;

    // Helper to exit CodeMirror → ProseMirror with proper direction bias.
    // dir: -1 = up/backward, 1 = down/forward
    const maybeEscape = (dir: -1 | 1) => {
      const pos = this.getPos();
      if (typeof pos !== "number") return;
      const targetPos = pos + (dir < 0 ? 0 : this.node.nodeSize);
      const selection = TextSelection.near(
        this.view.state.doc.resolve(targetPos),
        dir,
      );
      // Check if selection resolved back inside this code block
      const selInside =
        selection.from > pos && selection.from < pos + this.node.nodeSize;
      if (selInside) {
        // No valid position in escape direction — insert a new paragraph
        const insertPos = dir < 0 ? pos : pos + this.node.nodeSize;
        const paragraph = this.view.state.schema.nodes.paragraph.create();
        const tr = this.view.state.tr.insert(insertPos, paragraph);
        // After insert, positions shift — set selection into the new paragraph
        const newCursorPos = dir < 0 ? insertPos + 1 : insertPos + 1;
        tr.setSelection(TextSelection.near(tr.doc.resolve(newCursorPos), dir));
        this.view.dispatch(tr.scrollIntoView());
        this.view.focus();
        return;
      }
      const tr = this.view.state.tr.setSelection(selection).scrollIntoView();
      this.view.dispatch(tr);
      this.view.focus();
    };

    // Custom keymaps for PM ↔ CM navigation
    const customKeys = keymap.of([
      {
        key: "ArrowUp",
        run: (cmv) => {
          const { head } = cmv.state.selection.main;
          const line = cmv.state.doc.lineAt(head);
          if (line.number === 1) {
            maybeEscape(-1);
            return true;
          }
          return false;
        },
      },
      {
        key: "ArrowDown",
        run: (cmv) => {
          const { head } = cmv.state.selection.main;
          const line = cmv.state.doc.lineAt(head);
          if (line.number === cmv.state.doc.lines) {
            maybeEscape(1);
            return true;
          }
          return false;
        },
      },
      {
        key: "Escape",
        run: () => {
          maybeEscape(-1);
          return true;
        },
      },
      {
        key: "Backspace",
        run: (cmv) => {
          const { head } = cmv.state.selection.main;
          if (head === 0 && cmv.state.doc.length === 0) {
            // Empty code block → convert to paragraph
            const pos = this.getPos();
            if (typeof pos !== "number") return false;
            const pmNode = this.view.state.doc.nodeAt(pos);
            if (!pmNode) return false;
            const paragraph = this.view.state.schema.nodes.paragraph.create();
            const tr = this.view.state.tr.replaceWith(
              pos,
              pos + pmNode.nodeSize,
              paragraph,
            );
            tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
            this.view.dispatch(tr);
            this.view.focus();
            return true;
          }
          return false;
        },
      },
      {
        key: "Mod-z",
        run: () => {
          undo(this.view.state, this.view.dispatch);
          return true;
        },
      },
      {
        key: "Mod-Shift-z",
        run: () => {
          redo(this.view.state, this.view.dispatch);
          return true;
        },
      },
      {
        key: "Mod-y",
        run: () => {
          redo(this.view.state, this.view.dispatch);
          return true;
        },
      },
    ]);

    const extensions = [
      customKeys,
      keymap.of([
        ...defaultKeymap,
        ...(autoPairBrackets ? closeBracketsKeymap : []),
        indentWithTab,
      ]),
      ...(codeBlockLineNumbers ? [lineNumbers()] : []),
      drawSelection(),
      bracketMatching(),
      ...(autoPairBrackets ? [closeBrackets()] : []),
      syntaxHighlighting(getHighlightStyle()),
      CMView.lineWrapping,
      CMState.tabSize.of(tabSize),
      indentUnit.of(" ".repeat(tabSize)),
      CMState.readOnly.of(!this.view.editable),
      // Sync CodeMirror → ProseMirror
      CMView.updateListener.of((update: ViewUpdate) => {
        if (!update.docChanged || this.updating) return;
        this.forwardUpdate(update);
      }),
      ...(langExt ? [langExt] : []),
    ];

    const state = CMState.create({
      doc: this.node.textContent,
      extensions,
    });

    this.cmView = new CMView({
      state,
      parent: this.cmContainer,
    });

    // Auto-focus newly created (empty) code blocks and scroll into view
    if (!this.node.textContent) {
      requestAnimationFrame(() => {
        if (!this.destroyed && this.cmView) {
          this.cmView.focus();
          this.dom.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      });
    }
  }
}
