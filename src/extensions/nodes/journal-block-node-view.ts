// §56f Journal Dynamic Block NodeView — mounts React into a plain PM NodeView
// Used for journal-list, journal-mood, journal-photos fenced code blocks.

import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView as PMView, NodeView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import {
  JournalDynamicBlock,
  type JournalBlockLanguage,
} from "../../components/journal/JournalDynamicBlock";

export class JournalBlockNodeView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  private view: PMView;
  private getPos: () => number | undefined;
  private root: Root;
  private showSource = false;

  constructor(node: PMNode, view: PMView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    const wrapper = document.createElement("div");
    wrapper.classList.add("journal-block-nodeview");
    this.dom = wrapper;

    this.root = createRoot(wrapper);
    this.render();
  }

  private render() {
    const lang = this.node.attrs.language as string as JournalBlockLanguage;
    const content = this.node.textContent;

    if (this.showSource) {
      // Render a plain textarea for source editing
      const ta = document.createElement("textarea");
      ta.className = "journal-block-source-edit";
      ta.value = content;
      ta.rows = content.split("\n").length + 1;
      ta.addEventListener("input", () => {
        const pos = this.getPos();
        if (typeof pos !== "number") return;
        const pmNode = this.view.state.doc.nodeAt(pos);
        if (!pmNode) return;
        const newText = ta.value;
        const { tr } = this.view.state;
        const start = pos + 1;
        const end = start + pmNode.content.size;
        if (newText) {
          tr.replaceWith(start, end, this.view.state.schema.text(newText));
        } else {
          tr.delete(start, end);
        }
        this.view.dispatch(tr);
      });
      ta.addEventListener("blur", () => {
        this.showSource = false;
        this.render();
      });

      // Unmount React and show native textarea
      this.root.unmount();
      this.root = createRoot(this.dom);
      this.dom.innerHTML = "";
      this.dom.appendChild(ta);
      requestAnimationFrame(() => ta.focus());
      return;
    }

    this.root.render(
      createElement(JournalDynamicBlock, {
        language: lang,
        content,
        onShowSource: () => {
          this.showSource = true;
          this.render();
        },
      }),
    );
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    if (
      (node.attrs.language as string) !== (this.node.attrs.language as string)
    )
      return false;
    this.node = node;
    if (!this.showSource) {
      this.render();
    }
    return true;
  }

  selectNode() {
    // Move PM focus to just after this node so arrow keys work
    const pos = this.getPos();
    if (typeof pos !== "number") return;
    const sel = TextSelection.near(
      this.view.state.doc.resolve(pos + this.node.nodeSize),
      1,
    );
    this.view.dispatch(this.view.state.tr.setSelection(sel));
    this.view.focus();
  }

  deselectNode() {}

  stopEvent(event: Event): boolean {
    // Allow button/textarea events through, block everything else
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.closest("textarea")) return true;
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    // Defer unmount to avoid React "unmount during render" warning
    setTimeout(() => {
      try {
        this.root.unmount();
      } catch {
        // ignore
      }
    }, 0);
  }
}
