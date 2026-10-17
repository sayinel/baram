// §394 spec 0073 D6 · D7 · D10 · D11 · D17 — a code block whose language a plugin renderer is bound
// to. The same node and the same markdown (D6); this view draws the plugin's sanitized output in a
// shadow root, and shows the ordinary CodeMirror view it wraps while the block is selected or "Show
// source" is on (P16). Wrapping — not a second editor — keeps one road into the source for the
// caret, the keyboard and vim (`selectNode` / `setSelection` are the wrapped view's).
//
//   root  [data-plugin-block] data-vim-suspend   ← outside the shadow root; paint containment (CSS)
//   ├ .plugin-block-chrome                        ← host-drawn: the source badge, status, the toggle
//   ├ .plugin-block-error                         ← host-drawn, the renderer's text capped (D10)
//   ├ .plugin-block-body > .plugin-block-host     ← open shadow root: the plugin's markup and CSS
//   └ the wrapped CodeBlockNodeView's .code-block-wrapper, hidden in rendered mode
//
// The root never carries `.code-block-wrapper` (the tables stylesheet would lower its containment,
// D10); export tells a rendered block by `[data-plugin-block]` and leaves the wrapper inside it
// alone (Task 12).
//
// What the renderer is told (`codeBlockInfo`) is the note of THIS view's editor, read at each draw
// (plan 0125 P29) — and since a tab switch in the shared editor may keep this view for the next
// note's block, the content-loaded notice draws it again when that note differs.

import { openUrl } from "@tauri-apps/plugin-opener";

import type { Locale } from "../../../i18n";
import type { RendererBinding } from "../../../plugins/rendered/code-block-registry";
import type { CodeBlockInfo } from "../../../plugins/types";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView, EditorView as PMView } from "@tiptap/pm/view";

import { t } from "../../../i18n";
import { codeBlockInfo } from "../../../plugins/rendered/code-block-info";
import { codeBlockRendererFor } from "../../../plugins/rendered/code-block-registry";
import { dispatchRenderedAction } from "../../../plugins/rendered/code-blocks-api";
import {
  RENDERED_BLOCK_MAX_HEIGHT_PX,
  SOURCE_DEBOUNCE_MS,
} from "../../../plugins/rendered/limits";
import { openPluginNoteLink } from "../../../plugins/rendered/note-link";
import {
  onRendersInvalidated,
  requestRender,
} from "../../../plugins/rendered/render-queue";
import {
  createRenderedHost,
  drawRendered,
} from "../../../plugins/rendered/rendered-body";
import {
  handleRenderedClicks,
  hostOwnedTarget,
} from "../../../plugins/rendered/rendered-clicks";
import { watchVisibility } from "../../../plugins/rendered/visibility";
import { useSettingsStore } from "../../../stores/settings/store";
import { subscribeContentLoaded } from "../../../utils/editor/programmatic-update";
import { logger } from "../../../utils/logger";
import { CodeBlockNodeView } from "./code-block-node-view";
import { onFirstVisible } from "./lazy-visible";

/**
 * D17 · plan 0125 P28 — the event types the pointer model judges (with the `mouse` · `pointer` ·
 * `drag` · `touch` prefixes, `isPointerEvent`). Every other type is the island's inside the block.
 */
const POINTER_EVENT_TYPES: ReadonlySet<string> = new Set([
  "auxclick",
  "click",
  "contextmenu",
  "dblclick",
  "drop",
]);

export class RenderedCodeBlockView implements NodeView {
  dom: HTMLElement;
  private readonly binding: RendererBinding;
  private readonly body: HTMLElement;
  private readonly chrome: HTMLElement;
  private destroyed = false;
  private readonly disposers: Array<() => void> = [];
  /** The note (`noteOf`) the last draw was asked for — `null` until one (P29). */
  private drawnNote: null | string = null;
  /** The source of the last successful draw — `null` until one. */
  private drawnSource: null | string = null;
  /** The selection is in the block (D17): source editing is open. */
  private editing = false;
  /** The editor that holds this block — whose note the renderer is told (P29). */
  private readonly editor: Editor;
  private readonly errorLine: HTMLElement;
  private readonly getPos: () => number | undefined;
  private readonly inner: CodeBlockNodeView;
  private node: PMNode;
  private redrawTimer: null | ReturnType<typeof setTimeout> = null;
  /** Each draw's number; an answer for an older one is late and dropped (D7). */
  private requestSeq = 0;
  private readonly shadow: ShadowRoot;
  /** "Show source" is on — per attached view, never saved (D17). */
  private sourceShown = false;
  /** Invalidated or edited while not drawable; drawn when it is (D7). */
  private stale = false;
  private readonly status: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly view: PMView;
  private visible = false;

  constructor(
    node: PMNode,
    view: PMView,
    getPos: () => number | undefined,
    tiptapEditor: Editor,
    binding: RendererBinding,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.editor = tiptapEditor;
    this.binding = binding;

    const root = document.createElement("div");
    root.setAttribute("data-plugin-block", "");
    // P17 — the common container of the chrome's button, the shadow host and the wrapped island.
    root.setAttribute("data-vim-suspend", "");
    root.dataset.lang = binding.lang;
    root.dataset.renderState = "pending";

    this.chrome = document.createElement("div");
    this.chrome.className = "plugin-block-chrome";
    this.chrome.contentEditable = "false";
    const badge = document.createElement("span");
    badge.className = "plugin-block-source";
    // §385's attribution text (`pluginSourceLabel`, already applied to `pluginName`).
    badge.textContent = tr("plugin.prompt.source", {
      name: binding.pluginName,
    });
    const spacer = document.createElement("span");
    spacer.className = "plugin-block-chrome-spacer";
    this.status = document.createElement("span");
    this.status.className = "plugin-block-status";
    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "btn-unstyled plugin-block-toggle";
    // D17 — "Show source" keeps the source open after the selection leaves; "Show rendered" ends
    // that. While the selection is in the block the toggle is hidden (`applyMode`), so a press
    // always changes what is shown.
    this.toggle.addEventListener("click", () => {
      this.sourceShown = !this.sourceShown;
      this.applyMode();
    });
    this.chrome.append(badge, spacer, this.status, this.toggle);

    this.errorLine = document.createElement("div");
    this.errorLine.className = "plugin-block-error";
    this.errorLine.hidden = true;

    this.body = document.createElement("div");
    this.body.className = "plugin-block-body";
    this.body.style.maxHeight = `${RENDERED_BLOCK_MAX_HEIGHT_PX}px`;
    const { host, shadow } = createRenderedHost();
    this.shadow = shadow;
    this.body.append(host);

    this.inner = new CodeBlockNodeView(node, view, getPos, tiptapEditor);

    root.append(this.chrome, this.errorLine, this.body, this.inner.dom);
    this.dom = root;
    this.applyMode();

    const onSelection = () => this.followSelection();
    tiptapEditor.on("selectionUpdate", onSelection);
    this.disposers.push(
      () => tiptapEditor.off("selectionUpdate", onSelection),
      handleRenderedClicks(shadow, {
        // A click lands on a block on screen, whose editor holds a nameable note; `null` (no
        // note to name) dispatches nothing, and a note link without a context is refused.
        action: (name) => {
          const info = this.info();
          if (info !== null) {
            void dispatchRenderedAction(binding, { action: name, ...info });
          }
        },
        link: (href) => {
          openUrl(href).catch((err: unknown) => {
            logger.error("[PluginBlock] opening a link failed:", err);
          });
        },
        note: (path) => {
          void openPluginNoteLink(
            this.info()?.context ?? null,
            path,
            badge.textContent ?? "",
          );
        },
      }),
      // P29 — a tab switch in the shared editor may keep this view for the next note's block; with
      // the same source nothing else would draw it again. A view still waiting for a note it can name
      // (`draw` met `null` and left it stale) draws now too; one never asked to draw has nothing to
      // redo.
      subscribeContentLoaded(() => {
        if (this.drawnNote === null && !this.stale) return;
        const info = this.info();
        if (info !== null && noteOf(info) !== this.drawnNote)
          this.drawWhenShown();
      }),
      onFirstVisible(root, () => this.draw()),
      watchVisibility(root, (visible) => {
        this.visible = visible;
        if (visible && this.stale && this.dom.dataset.mode === "rendered")
          this.draw();
      }),
      onRendersInvalidated((pluginId, langs) => {
        if (pluginId !== binding.pluginId) return;
        if (langs !== null && !langs.has(binding.lang)) return;
        this.drawWhenShown();
      }),
    );
  }

  deselectNode(): void {
    this.inner.deselectNode();
    this.followSelection();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.redrawTimer !== null) clearTimeout(this.redrawTimer);
    for (const dispose of this.disposers.splice(0)) dispose();
    this.inner.destroy();
  }

  /** Nothing in this view is ProseMirror content: the shadow tree is not observed, and the chrome
   *  and the wrapped CodeMirror are this view's own (the wrapped view answers the same). */
  ignoreMutation(): boolean {
    return true;
  }

  /** D17 — a selected block opens source editing, as a selected mermaid block does. */
  selectNode(): void {
    this.editing = true;
    this.applyMode();
    this.inner.selectNode();
  }

  /** D17 — a caret arriving (arrow keys, vim) opens source editing in the wrapped CodeMirror. */
  setSelection(anchor: number, head: number): void {
    this.editing = true;
    this.applyMode();
    this.inner.setSelection(anchor, head);
  }

  /**
   * D17 · plan 0125 P28 — in source mode the wrapped CodeMirror owns its events, as before (its
   * `stopEvent` answers `true` to every event). In rendered mode the event's kind decides:
   *  - a POINTER event follows the pointer model: a press on the chrome, a link or a `data-action`
   *    element is the host's (`hostOwnedTarget`, which reads the composed path into the shadow
   *    tree), and any other press is ProseMirror's — a click then reaches the generation plugin's
   *    `handleClickOn`, which selects the node and so opens source editing
   *    (`code-block-render-generation.ts`);
   *  - EVERY OTHER event — keys, text input, composition, focus, clipboard — is the island's when
   *    its composed path runs through this view's shadow root, chrome or error line: a key on a
   *    focusable element of the output (a `<button>` without `data-action`, a `tabindex` element)
   *    or on the toggle must not run ProseMirror's keymap on the document's selection.
   * A key pressed while the caret is in the document targets `view.dom` itself, and ProseMirror
   * asks `stopEvent` only of the views between an event's target and `view.dom`
   * (`eventBelongsToView`) — arrow keys and vim motions into the block do not come here.
   */
  stopEvent(event: Event): boolean {
    if (this.dom.dataset.mode === "source") return this.inner.stopEvent();
    if (!isPointerEvent(event)) {
      const path = event.composedPath();
      return (
        path.includes(this.shadow) ||
        path.includes(this.chrome) ||
        path.includes(this.errorLine)
      );
    }
    if (event.target instanceof Node && this.chrome.contains(event.target)) {
      return true;
    }
    return hostOwnedTarget(event, this.shadow) !== null;
  }

  /**
   * D6 — the binding is fixed at creation: a different binding for the language (another plugin,
   * none, a different language) rebuilds the view. A source change redraws after the debounce.
   */
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const lang = (node.attrs.language as null | string) ?? "";
    if (codeBlockRendererFor(lang) !== this.binding) return false;
    const changed = node.textContent !== this.node.textContent;
    this.node = node;
    if (!this.inner.update(node)) return false;
    if (changed) {
      if (this.redrawTimer !== null) clearTimeout(this.redrawTimer);
      this.redrawTimer = setTimeout(() => {
        this.redrawTimer = null;
        this.drawWhenShown();
      }, SOURCE_DEBOUNCE_MS);
    }
    return true;
  }

  /**
   * Show the rendered output or the wrapped source, and redraw on the way back when it is due.
   *
   * The toggle names what a press would show, read from the mode on screen. It is hidden while the
   * selection is in the block (`editing`): source editing is open then whatever the toggle says,
   * and a press could not keep the block rendered — ProseMirror calls `setSelection` again on later
   * updates while the selection stays in the block (`selectionToDOM`), and hiding the wrapped
   * CodeMirror would hide the element that holds the keyboard focus. Leaving source editing is
   * moving the selection out of the block (D17).
   */
  private applyMode(): void {
    const source = this.sourceShown || this.editing;
    this.dom.dataset.mode = source ? "source" : "rendered";
    this.body.hidden = source;
    this.inner.dom.hidden = !source;
    this.toggle.hidden = this.editing;
    this.toggle.textContent = tr(
      source ? "plugin.block.showRendered" : "plugin.block.showSource",
    );
    if (
      !source &&
      this.dom.dataset.renderState === "done" &&
      (this.stale || this.node.textContent !== this.drawnSource)
    ) {
      this.draw();
    }
  }

  /**
   * Ask for the current source and draw what comes back, unless a newer draw started or the view is
   * gone. While this view's editor holds no note it can name (`codeBlockInfo` → `null`, P29) the
   * block stays stale and draws when it is next shown.
   */
  private draw(): void {
    if (this.destroyed) return;
    const info = this.info();
    if (info === null) {
      this.stale = true;
      return;
    }
    this.stale = false;
    this.drawnNote = noteOf(info);
    const seq = ++this.requestSeq;
    const source = this.node.textContent;
    this.status.textContent = tr("plugin.block.loading");
    void requestRender(this.binding, source, info).then((outcome) => {
      if (this.destroyed || seq !== this.requestSeq) return;
      this.status.textContent = "";
      // D7 — an answer for a source the block no longer holds is late even when no newer draw has
      // started: an edit waits out `SOURCE_DEBOUNCE_MS` before it asks again (`update`), and that
      // redraw follows.
      if (source !== this.node.textContent) return;
      switch (outcome.kind) {
        case "drawn":
          drawRendered(this.shadow, outcome.content);
          this.drawnSource = source;
          this.showError(null);
          break;
        case "failed":
          this.showError(outcome.message);
          break;
        case "stale":
          // The plugin's epoch moved under this render: an invalidate notice follows, or the
          // registry's change rebuilds this view — in an editor surface (`editor-surfaces.ts`).
          // The journal capture editor is not one: there this view keeps its binding until the
          // block's node changes, and draws again only when it is next asked to.
          return;
      }
      this.dom.dataset.renderState = "done";
    });
  }

  /** Draw now if the block is on screen and rendered; otherwise draw when it is (D7). */
  private drawWhenShown(): void {
    if (this.visible && this.dom.dataset.mode === "rendered") this.draw();
    else this.stale = true;
  }

  /** D17 — leave source editing when the selection leaves the block. The toggle stays as it is. */
  private followSelection(): void {
    if (this.destroyed || !this.editing) return;
    const pos = this.getPos();
    const { from, to } = this.view.state.selection;
    if (
      typeof pos === "number" &&
      from >= pos &&
      to <= pos + this.node.nodeSize
    ) {
      return;
    }
    this.editing = false;
    this.applyMode();
  }

  /** What the renderer is told about this block now — the note of this view's editor (P29). */
  private info(): CodeBlockInfo | null {
    return codeBlockInfo(this.editor, this.binding.lang, this.binding.tier);
  }

  /** §6 — the error line; a failure after a success keeps the last result, faded. */
  private showError(message: null | string): void {
    this.errorLine.hidden = message === null;
    this.errorLine.textContent =
      message === null ? "" : tr("plugin.block.error", { detail: message });
    this.dom.classList.toggle(
      "plugin-block-stale",
      message !== null && this.drawnSource !== null,
    );
  }
}

/** P28 — `POINTER_EVENT_TYPES`, or a type in the mouse, pointer, drag or touch family. */
function isPointerEvent(event: Event): boolean {
  return (
    POINTER_EVENT_TYPES.has(event.type) ||
    /^(?:drag|mouse|pointer|touch)/u.test(event.type)
  );
}

/** One string per note, for comparing what was drawn with what the editor holds now (P29). */
function noteOf(info: CodeBlockInfo): string {
  return `${info.context ?? ""}\u0000${info.path ?? ""}`;
}

/** The chrome's text in the app's language when it is drawn (the view is not rebuilt on a locale change). */
function tr(key: string, params?: Record<string, string>): string {
  return t(key, useSettingsStore.getState().locale as Locale, params);
}
