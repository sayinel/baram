// §5.4 Raw ProseMirror NodeView for CodeMirror 6 code blocks
// Uses a plain ProseMirror NodeView (not React) to properly handle
// setSelection(), which is critical for CM ↔ PM focus coordination.

import type { ViewUpdate } from "@codemirror/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView, EditorView as PMView } from "@tiptap/pm/view";

import { EditorState as CMState, Compartment, Prec } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";
import { redo, undo } from "@tiptap/pm/history";

import {
  createVimController,
  type VimController,
} from "../../../components/editor/vim-controller";
import { useSettingsStore } from "../../../stores/settings/store";
import { showNodeViewAIMenu } from "../../../utils/nodeview-ai-menu";
import { withVimExternalEdit } from "../../plugins/vim/vim-keys";
import {
  islandVimBlur,
  islandVimDispose,
  islandVimFocus,
  islandVimMode,
} from "../../plugins/vim/vim-status";
import {
  getLanguageExtension,
  LANGUAGE_OPTIONS,
} from "../code-block-languages";
import {
  registerCodeBlockEditableSync,
  registerCodeBlockVimSync,
} from "./code-block-cm-registry";
import { createCodeBlockEscape } from "./code-block-escape";
import { buildCodeBlockExtensions } from "./code-block-extensions";
import { buildCodeBlockKeymap } from "./code-block-keymap";
import { onFirstVisible } from "./lazy-visible";

export class CodeBlockNodeView implements NodeView {
  dom: HTMLElement;
  private cmContainer: HTMLElement;
  private cmInitialized = false;
  private cmView: CMView | null = null;
  private currentVimMode: null | string = null;
  private destroyed = false;
  private getPos: () => number | undefined;
  private initGeneration = 0;
  private islandStatusDispose: (() => void) | null = null;
  private langGeneration = 0;
  private langSelect: HTMLSelectElement;
  // §298 Phase 0b R6: language switches reconfigure IN PLACE — recreation
  // resets vim to normal mid-typing (a language undo while in insert).
  private languageCompartment = new Compartment();
  private latestEffectiveEditable: boolean | null = null;
  private latestVimEnabled: boolean | null = null;
  private lazyDispose: (() => void) | null = null;
  private node: PMNode;
  private pendingFocusRestore: null | { head: number } = null;
  private pendingSelection: null | { anchor: number; head: number } = null;
  private pendingVimModeRestore: "insert" | "replace" | null = null;
  // §298 §12-4: readOnly must be reconfigurable after creation — vim toggles
  // PM editable without triggering NodeView.update(), and broadcasts instead.
  private readOnlyCompartment = new Compartment();
  private settingsUnsub: (() => void) | null = null;
  private tiptapEditor: import("@tiptap/core").Editor;
  private unregisterEditableSync: (() => void) | null = null;
  private unregisterVimSync: (() => void) | null = null;
  private updating = false;
  private view: PMView;
  // §298 Phase 0b — per-island vim. Compartments outlive CM recreations;
  // the controller is created per CM instance inside initCM.
  private vimCompartment = new Compartment();
  private vimController: null | VimController = null;
  private vimEditableCompartment = new Compartment();

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
    // §298 §12-3: wrapper marker covers the CM island AND the header
    // language select / AI button (design §4 — no contentDOM here, so no
    // [data-node-view-content] can shadow it).
    wrapper.setAttribute("data-vim-suspend", "");
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
    autoOpt.defaultSelected = true;
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
      this.view.dispatch(withVimExternalEdit(tr));
    });

    header.appendChild(select);
    this.langSelect = select;

    // §11.2.3 AI button
    const aiBtn = document.createElement("button");
    aiBtn.classList.add("nodeview-ai-btn", "code-block-ai-btn");
    aiBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>';
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

    // §perf-large-file: defer CodeMirror creation until the block is near the
    // viewport. Show the raw code as a lightweight placeholder until then.
    const placeholder = document.createElement("pre");
    placeholder.classList.add("code-block-placeholder");
    placeholder.textContent = node.textContent;
    cmContainer.appendChild(placeholder);
    this.lazyDispose = onFirstVisible(wrapper, () => this.ensureCM());

    // §298 §12-4: registry membership for editable broadcasts. Registration
    // replays the cached EFFECTIVE state (suspension-aware — raw
    // view.editable stays false through a vim suspension), the callback
    // remembers it, and the deferred initCM consumes the memo so a lazy CM
    // can never observe a stale value (vim review S5/S6-R5).
    this.unregisterEditableSync = registerCodeBlockEditableSync(
      view,
      (editable) => {
        this.latestEffectiveEditable = editable;
        if (!this.cmView) return;
        this.cmView.dispatch({
          effects: this.readOnlyCompartment.reconfigure(
            CMState.readOnly.of(!editable),
          ),
        });
      },
    );

    // §298 Phase 0b: vim on/off broadcast — the memo is consumed by the
    // deferred initCM, exactly like the editable memo above.
    this.unregisterVimSync = registerCodeBlockVimSync(view, (enabled) => {
      this.latestVimEnabled = enabled;
      // An EXPLICIT off is a boundary: an unconfirmed restore memo from a
      // recreate must not resurrect insert on a later re-enable (R8).
      // Internal recreates never pass here, so the back-to-back
      // preservation contract stays intact.
      if (!enabled) this.pendingVimModeRestore = null;
      this.applyVim(enabled);
    });

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
        // Only recreate CodeMirror if already initialized; otherwise the
        // deferred initCM will read current settings when it eventually runs.
        if (this.cmInitialized) {
          this.snapshotFocusForRecreate();
          this.teardownCM();
          const currentLang = (this.node.attrs.language as string) || "";
          void this.initCM(currentLang);
        }
      }
    });
  }

  deselectNode() {
    // Nothing needed — CM handles its own blur
  }

  destroy() {
    this.destroyed = true;
    if (this.unregisterEditableSync) {
      this.unregisterEditableSync();
      this.unregisterEditableSync = null;
    }
    if (this.lazyDispose) {
      this.lazyDispose();
      this.lazyDispose = null;
    }
    if (this.settingsUnsub) {
      this.settingsUnsub();
      this.settingsUnsub = null;
    }
    if (this.unregisterVimSync) {
      this.unregisterVimSync();
      this.unregisterVimSync = null;
    }
    this.teardownCM();
  }

  /** Prevent PM from reacting to CM DOM mutations */
  ignoreMutation(): boolean {
    return true;
  }

  /** Called when node is selected as a whole (NodeSelection) */
  selectNode() {
    this.ensureCM();
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
    this.ensureCM();
    if (!this.cmView) {
      this.pendingSelection = { anchor, head };
      return;
    }
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

    // Update language selector and wrapper dataset regardless of CM state
    const lang = (node.attrs.language as string) || "";
    if (oldLang !== lang) {
      this.langSelect.value = lang;
      this.dom.dataset.language = lang;
    }

    // §perf-large-file: CM not yet created — update placeholder and bail.
    // A global find/replace or undo must NOT wake all off-screen blocks.
    if (!this.cmInitialized) {
      const ph = this.dom.querySelector(
        ".code-block-placeholder",
      ) as HTMLElement | null;
      if (ph) ph.textContent = node.textContent;
      return true;
    }

    // Language changed → reconfigure IN PLACE: focus, cursor, vim mode and
    // CM history all survive. A cold block needs nothing — the deferred
    // initCM reads fresh attrs. NO early return: the same PM update can
    // also carry a content change (an undo event grouping both, an
    // external setContent) and skipping the sync below would fork the CM
    // buffer from the document (R7).
    if (oldLang !== lang && this.cmView) {
      void this.reconfigureLanguage(lang);
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

  /** §298 Phase 0b — vim enable/disable for THIS island (v3 contract 1).
   *  Enabling raises a SYNCHRONOUS editing-host barrier before the async
   *  module load: beforeinput fires ahead of keydown, so a suppressed-key
   *  gate alone would still let IME text through while vim loads. */
  private applyVim(enabled: boolean): void {
    if (!this.cmView || !this.vimController) return;
    if (enabled) {
      // tabindex must land WITH the barrier: the controller only adds it
      // after the async module load, and a host-less, tabindex-less
      // contentDOM is unfocusable — an explicit PM entry (j/k into a cold
      // block, empty-block autofocus) would silently lose focus.
      this.cmView.contentDOM.setAttribute("tabindex", "-1");
      // The editable facet does NOT gate key-bound API edits (installed
      // cm-view :8818) and the suspension broadcast releases the island's
      // readOnly on focus — so the loading barrier pins readOnly too.
      // Prec.highest: the readOnly facet takes its highest-precedence
      // value, and the broadcast compartment sits earlier in the config.
      // The controller's first mode flip replaces this compartment, so
      // the pin lifts exactly when vim takes over.
      this.cmView.dispatch({
        effects: this.vimEditableCompartment.reconfigure([
          CMView.editable.of(false),
          Prec.highest(CMState.readOnly.of(true)),
        ]),
      });
    }
    this.vimController.apply(enabled);
  }

  /** Create CodeMirror if not already created (idempotent). */
  private ensureCM() {
    if (this.cmInitialized || this.destroyed) return;
    this.cmInitialized = true;
    if (this.lazyDispose) {
      this.lazyDispose();
      this.lazyDispose = null;
    }
    this.cmContainer.replaceChildren();
    const lang = (this.node.attrs.language as string) || "";
    void this.initCM(lang);
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
    const gen = ++this.initGeneration;
    // The language attr can change WHILE the extension loads (update()
    // cannot reconfigure a CM that does not exist yet) — re-read until the
    // resolved extension matches the current attr (R7).
    let lang = language;
    let langExt = await getLanguageExtension(lang);
    if (this.destroyed || gen !== this.initGeneration) return;
    for (;;) {
      const fresh = (this.node.attrs.language as string) || "";
      if (fresh === lang) break;
      lang = fresh;
      langExt = await getLanguageExtension(lang);
      if (this.destroyed || gen !== this.initGeneration) return;
    }

    const settings = useSettingsStore.getState();
    const { tabSize, codeBlockLineNumbers, autoPairBrackets } = settings;

    // PM's view.focus() skips dom.focus() on a non-editable view
    // (installed prosemirror-view :5711, if (this.editable) guard) — and
    // vim modal IS non-editable, so an escape would move the selection
    // while focus stayed in the island, keys still feeding CodeMirror.
    // The vim-modal attributes supply tabindex="0"; focus the DOM directly.
    const { focusPM, maybeEscape } = createCodeBlockEscape(
      this.view,
      this.getPos,
      () => this.node,
    );

    // Custom keymaps for PM ↔ CM navigation
    const customKeys = buildCodeBlockKeymap({
      escape: maybeEscape,
      focusPM,
      getPos: this.getPos,
      view: this.view,
    });

    const extensions = buildCodeBlockExtensions({
      autoPairBrackets,
      keymapExtension: customKeys,
      langExt,
      languageCompartment: this.languageCompartment,
      lineNumbers: codeBlockLineNumbers,
      onDocChanged: (update) => {
        if (this.updating) return;
        this.forwardUpdate(update);
      },
      readOnly: !(this.latestEffectiveEditable ?? this.view.editable),
      readOnlyCompartment: this.readOnlyCompartment,
      tabSize,
      vimCompartment: this.vimCompartment,
      vimEditableCompartment: this.vimEditableCompartment,
    });

    const state = CMState.create({
      doc: this.node.textContent,
      extensions,
    });

    this.cmView = new CMView({
      state,
      parent: this.cmContainer,
    });

    // §298 Phase 0b — per-island vim controller (claimFocus false: a lazy
    // load must never steal focus from PM). Consume the broadcast memo.
    this.vimController = createVimController(this.cmView, this.vimCompartment, {
      // §3 boundary contract: edge j/k/arrows leave the block through the
      // SAME escape path as plain arrows; u/C-r go to PM — the island has
      // no CM history, PM owns the document's undo (design v3).
      boundaryHooks: {
        escape: (dir) => maybeEscape(dir),
        redo: () => {
          redo(this.view.state, this.view.dispatch);
        },
        undo: () => {
          undo(this.view.state, this.view.dispatch);
        },
      },
      claimFocus: false,
      restoreMode: () => this.pendingVimModeRestore,
      editableCompartment: this.vimEditableCompartment,
      onError: () => {
        // failed → deterministic plain editing (v3 contract 1).
        this.cmView?.dispatch({
          effects: this.vimEditableCompartment.reconfigure([]),
        });
      },
      onModeChange: (mode) => {
        this.currentVimMode = mode;
        // The restore memo clears only when the target mode is REACHED —
        // consumption-on-read lost it when a second settings recreate
        // arrived before the deferred handleKey ran (R7).
        if (mode !== null && mode === this.pendingVimModeRestore) {
          this.pendingVimModeRestore = null;
        }
        islandVimMode(island, mode, this.view);
        // Cold-load race: the first mode arrives AFTER focus already sits
        // in the island — claim the indicator now, not on the next focus.
        if (mode !== null && island.hasFocus) islandVimFocus(island);
      },
    });
    // §3-4 nested StatusBar ownership — the island claims the indicator on
    // focus (snapshot replay) and releases it on blur/teardown.
    const island = this.cmView;
    // Ownership listens on the CM ROOT: vim mounts its `:`/`/` panels
    // outside contentDOM, and moving focus into a panel is still the same
    // island. focusout defers one microtask and releases only when focus
    // truly left the whole root.
    const onIslandFocus = () => islandVimFocus(island);
    const onIslandBlur = () => {
      queueMicrotask(() => {
        const active = island.dom.ownerDocument.activeElement;
        if (!island.dom.contains(active)) islandVimBlur(island);
      });
    };
    island.dom.addEventListener("focusin", onIslandFocus);
    island.dom.addEventListener("focusout", onIslandBlur);
    this.islandStatusDispose = () => {
      island.dom.removeEventListener("focusin", onIslandFocus);
      island.dom.removeEventListener("focusout", onIslandBlur);
      islandVimDispose(island);
    };
    if (this.latestVimEnabled) this.applyVim(true);

    // Auto-focus newly created (empty) code blocks and scroll into view
    if (!this.node.textContent) {
      requestAnimationFrame(() => {
        if (!this.destroyed && this.cmView) {
          this.cmView.focus();
          this.dom.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      });
    }

    // A CM replacement (language/settings change) blurred the old view —
    // installed CM destroy calls contentDOM.blur() — so a focused island
    // must reclaim focus on its replacement (R5 C10).
    if (this.pendingFocusRestore && this.cmView) {
      // …but never steal focus from wherever the user went DURING the
      // async recreation — restore only while focus is orphaned (body)
      // or still somewhere inside this NodeView.
      const active = this.dom.ownerDocument.activeElement;
      if (
        active &&
        active !== this.dom.ownerDocument.body &&
        !this.dom.contains(active)
      ) {
        this.pendingFocusRestore = null;
        this.pendingVimModeRestore = null;
      }
    }
    if (this.pendingFocusRestore && this.cmView) {
      const head = Math.min(
        this.pendingFocusRestore.head,
        this.cmView.state.doc.length,
      );
      this.cmView.focus();
      this.updating = true;
      this.cmView.dispatch({ selection: { anchor: head } });
      this.updating = false;
      this.pendingFocusRestore = null;
    }

    if (this.pendingSelection && this.cmView) {
      // Only when the PM selection STILL belongs to this block — a stale
      // memo from a visit the user already left must not steal focus back
      // (R5 C7).
      const pos = this.getPos();
      const { from, to } = this.view.state.selection;
      // The WHOLE selection must live inside this block — a selection
      // spanning from the block into the next paragraph passes a from-only
      // check and would still steal focus (R6).
      const stillHere =
        typeof pos === "number" && from > pos && to < pos + this.node.nodeSize;
      if (stillHere) {
        this.cmView.focus();
        this.updating = true;
        this.cmView.dispatch({ selection: this.pendingSelection });
        this.updating = false;
      }
      this.pendingSelection = null;
    }
  }

  private async reconfigureLanguage(language: string): Promise<void> {
    const gen = ++this.langGeneration;
    const target = this.cmView;
    const ext = await getLanguageExtension(language);
    if (this.destroyed || gen !== this.langGeneration) return;
    // Only the CM this reconfigure started for — a settings recreate may
    // have replaced the instance while the extension loaded (R7).
    if (!target || this.cmView !== target) return;
    target.dispatch({
      effects: this.languageCompartment.reconfigure(ext ?? []),
    });
  }

  /** Focus ownership survives a CM replacement: remember it (with the
   *  cursor) so the recreated view can reclaim what destroy() blurs. */
  private snapshotFocusForRecreate(): void {
    // MID-RECREATE there is nothing to judge: the previous CM is gone and
    // its replacement not built — both memos from the first snapshot are
    // still the truth, so leave them alone (R7 back-to-back recreates).
    if (!this.cmView) return;
    // Containment, not cmView.hasFocus — the getter also requires
    // document.hasFocus(), which drops out under context menus (Safari)
    // and headless runs. Focus anywhere in the island (panels too) counts.
    const active = this.dom.ownerDocument.activeElement;
    const focused = this.cmView.dom.contains(active);
    this.pendingFocusRestore = focused
      ? { head: this.cmView.state.selection.main.head }
      : null;
    // Re-enter insert/replace after the rebuild — a recreation mid-typing
    // (theme shortcut while inside a block) must not silently flip the
    // user's keystrokes into normal-mode commands (R6). Visual dies with
    // its old view and restores as normal.
    // Preserve an UNCONFIRMED memo across back-to-back recreates: the new
    // controller re-seeded normal before its deferred restore could run,
    // so the live mode alone would erase the user's insert (R7).
    if (
      focused &&
      (this.currentVimMode === "insert" || this.currentVimMode === "replace")
    ) {
      this.pendingVimModeRestore = this.currentVimMode;
    } else if (!focused) {
      this.pendingVimModeRestore = null;
    }
  }

  /** ONE teardown path for every CM replacement — settings change, language
   *  change and NodeView.destroy. Dispose BEFORE destroy: the controller's
   *  deferred work checks its disposed flag before dispatching. */
  private teardownCM(): void {
    if (this.islandStatusDispose) {
      this.islandStatusDispose();
      this.islandStatusDispose = null;
    }
    if (this.vimController) {
      this.vimController.dispose();
      this.vimController = null;
    }
    if (this.cmView) {
      this.cmView.destroy();
      this.cmView = null;
    }
  }
}
