// §5.4 Raw ProseMirror NodeView for CodeMirror 6 code blocks
// Uses a plain ProseMirror NodeView (not React) to properly handle
// setSelection(), which is critical for CM ↔ PM focus coordination.

import type { ViewUpdate } from "@codemirror/view";
import type { Transaction } from "@tiptap/pm/state";
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
import { focusEditorView } from "../../../utils/editor/focus-editor-view";
import { logger } from "../../../utils/logger";
import { showNodeViewAIMenu } from "../../../utils/nodeview-ai-menu";
import {
  boundaryModeMeta,
  vimPluginKey,
  withVimExternalEdit,
} from "../../plugins/vim/vim-keys";
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
  armIslandPointerHandoff,
  ensurePointerDownRecorder,
  enterCodeBlockSelection,
  isRegisteredIslandContainer,
  recentPointerTarget,
  registerCodeBlockEditableSync,
  registerCodeBlockEntry,
  registerCodeBlockVimSync,
  takeIslandPointerHandoff,
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
  /** issue 477 — entry-mode intent, held until a mode publish CONFIRMS the
   *  island reached insert ("queued" is not "delivered": the controller's
   *  microtask drops on a generation change, and a readOnly window can
   *  refuse the entry — the memo survives both and retries on the next
   *  publish). Carries the entry's local head as its identity.
   *
   *  LIFECYCLE (전 지점 — 지역 주석은 이 표를 참조한다):
   *  - armed    : requestEntryInsert() — 진입 핸드오프의 insert 의도
   *               (이미 plain insert인 island에는 arm하지 않음)
   *  - confirmed: onModeChange publish "insert" → 소각 (배달 완료)
   *  - retried  : onModeChange 그 외 publish + 엔트리가 아직 current
   *               (선택이 메모된 head 위) → ensureInsert 재시도
   *  - burned   : ① 명시적 vim OFF ② escapeToPM 키보드 이탈
   *               ③ 포인터 이탈(island→island arm / island→본문)
   *               ④ focusout 확정(크롬 이탈 포함) ⑤ island 안 사용자
   *               keydown(인수인계 종료) ⑥ stale cold(선택이 블록을 떠남)
   *               ⑦ publish 시점에 not-current
   *
   *  pendingVimModeRestore(아래)와 반대 생존 정책: 그쪽은 설정 재생성을
   *  살아남는 게 목적(R7), 이쪽은 전이 하나를 넘기지 않는 게 목적이다. */
  private pendingEntryInsert: null | { head: number } = null;
  private pendingFocusRestore: null | { head: number } = null;
  private pendingSelection: null | {
    anchor: number;
    focusIntent: boolean;
    head: number;
  } = null;
  private pendingVimModeRestore: "insert" | "replace" | null = null;
  /** 포인터 이탈의 전이당 1회 처리 latch — focusout이 한 전이에 겹쳐
   *  발화해도(계측 실증) 정규화 이전의 첫 캡처만 전파된다. */
  private pointerExitHandled = false;
  // §298 §12-4: readOnly must be reconfigurable after creation — vim toggles
  // PM editable without triggering NodeView.update(), and broadcasts instead.
  private readOnlyCompartment = new Compartment();
  private settingsUnsub: (() => void) | null = null;
  private tiptapEditor: import("@tiptap/core").Editor;
  private unregisterEditableSync: (() => void) | null = null;
  private unregisterEntry: (() => void) | null = null;
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

    // §298 Phase 0b (PR 307 review) — a click must ENTER the island while
    // vim is in normal mode, and nothing else in the chain delivers that.
    // The barrier leaves contentDOM `contenteditable=false` with a negative
    // tabindex, and WebKit does not focus such an element on click; the
    // island meanwhile stays read-only until it is focused (suspension is
    // driven by focusin), so the focus the click needed was exactly what the
    // click was supposed to produce. Users had to press `i` first — vim's
    // insert mode makes the PM view editable, which unlocked the island by a
    // different route. Capture phase, because CodeMirror's own mousedown
    // handling is what we are standing in for.
    cmContainer.addEventListener(
      "mousedown",
      () => {
        if (!this.latestVimEnabled || !this.cmView) return;
        if (this.cmView.hasFocus) return;
        this.cmView.focus();
      },
      true,
    );

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

    // §298 — explicit vim entry channel (registry note): while vim is modal
    // PM's editorOwnsSelection gate usually fails, so selectionToDOM cannot
    // be relied on to descend into setSelection here — the vim plugin
    // drives it through this channel instead.
    ensurePointerDownRecorder(view);
    this.unregisterEntry = registerCodeBlockEntry(
      view,
      getPos,
      cmContainer,
      (anchor, head, opts) => {
        // issue 477 — the mode intent applies on EVERY outcome, including
        // the dedup early-return below: in editable PM (insert mode) the
        // dispatch's own selectionToDOM descent often delivers the exact
        // selection first, and skipping the mode there would silently drop
        // the insert entry (adversarial review BLOCKER).
        const wantInsert = opts?.vimMode === "insert";
        // Dedup: when the gate DID pass, PM's own descent already delivered
        // this exact selection inside the dispatch — and a second call is
        // not a no-op (CM re-dispatches a selectionSet update). Skip only
        // on an exact match with focus already held. Known limitation: an
        // equal-valued LATER re-entry is indistinguishable and also skips
        // CM-vim's selectionSet bookkeeping (review round 2, minor).
        const cm = this.cmView;
        if (
          cm?.hasFocus &&
          cm.state.selection.main.anchor === anchor &&
          cm.state.selection.main.head === head
        ) {
          if (wantInsert) this.requestEntryInsert(head);
          return true;
        }
        this.enterExplicitly(anchor, head);
        if (wantInsert) this.requestEntryInsert(head);
        // A live CM was focused synchronously; a cold one only memoed the
        // selection for its deferred init — report false so the caller
        // keeps its focus fallback alive until the island claims focus on
        // mount (pendingSelection consumption).
        return this.cmView !== null;
      },
    );

    // §298 Phase 0b: vim on/off broadcast — the memo is consumed by the
    // deferred initCM, exactly like the editable memo above.
    this.unregisterVimSync = registerCodeBlockVimSync(view, (enabled) => {
      this.latestVimEnabled = enabled;
      // An EXPLICIT off is a boundary: an unconfirmed restore memo from a
      // recreate must not resurrect insert on a later re-enable (R8).
      // Internal recreates never pass here. Entry memo: LIFECYCLE burn ①.
      if (!enabled) {
        this.pendingVimModeRestore = null;
        this.pendingEntryInsert = null;
      }
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
    if (this.unregisterEntry) {
      this.unregisterEntry();
      this.unregisterEntry = null;
    }
    this.teardownCM();
  }

  /** Prevent PM from reacting to CM DOM mutations */
  ignoreMutation(): boolean {
    return true;
  }

  /** Called when node is selected as a whole (NodeSelection) */
  selectNode() {
    // NodeSelection은 사용자 제스처(블록 자체 선택)의 결과다 — 명시
    // 의도로 취급한다. 이탈 전이는 TextSelection만 만들므로 이 경로가
    // 강탈에 동원되지 않는다 (적대 리뷰 확인 사항).
    this.ensureCM();
    if (this.cmView) {
      this.cmView.focus();
    }
  }

  /** 선택 반영 본체 — focus는 옵션 권한. cold 메모에도 의도를 함께
   *  저장해, 비동기 init의 소비가 하강 유래 선택으로 포커스를 훔치지
   *  않게 한다 (적대 리뷰 CRITICAL 2). */
  private applySelection(
    anchor: number,
    head: number,
    opts: { focus: boolean },
  ): void {
    this.ensureCM();
    if (!this.cmView) {
      // 단조 병합 (감사 BLOCKER): 같은 선택에 대한 비명시 재동기화(늦은
      // PM 하강 — vim의 50ms selection 재주장 등)가 정당한 명시 grant를
      // focus:false로 강등하면 안 된다. 같은 (anchor, head)면 grant는
      // 보존되고, 다른 선택이면 통째 교체(새 방문 = 새 권한 판정).
      const prev = this.pendingSelection;
      const sameSelection =
        prev !== null && prev.anchor === anchor && prev.head === head;
      this.pendingSelection = {
        anchor,
        focusIntent: opts.focus || (sameSelection && prev.focusIntent),
        head,
      };
      return;
    }
    if (opts.focus) this.cmView.focus();
    this.updating = true;
    // scrollIntoView — CM walks ancestor scrollables to the real caret
    // line. The PM-side follow cannot: this NodeView has no contentDOM, so
    // coordsAtPos maps every interior offset to the wrapper's TOP edge
    // (issue 472). 포커스 없는 동기화는 스크롤도 하지 않는다.
    this.cmView.dispatch({
      scrollIntoView: opts.focus,
      selection: { anchor, head },
    });
    this.updating = false;
  }

  /** 명시 진입 채널(레지스트리) 전용 — 포커스 권한 보유. */
  private enterExplicitly(anchor: number, head: number): void {
    this.applySelection(anchor, head, { focus: true });
  }

  /**
   * Called by ProseMirror when selection enters this node.
   * This is the KEY method that ReactNodeViewRenderer doesn't expose —
   * it allows us to properly focus CodeMirror and set its cursor position.
   */
  setSelection(anchor: number, head: number) {
    // FOCUS는 권한이다 (적대 리뷰 CRITICAL, issue 474 근인): PM의
    // selectionToDOM 하강은 dispatch·focus 핸들러의 20ms setTimeout·
    // observer 복구 등 여러 시점에 이 프로토콜 메서드를 호출하고,
    // editorOwnsSelection 게이트는 activeElement=BODY조차 통과시킨다 —
    // 여기서 무조건 focus하면 떠나던 island가 포커스를 강탈해 "포커스
    // 전쟁"(모드 워·StatusBar 동결)의 연료가 된다. vim이 켜진 동안 PM
    // 하강은 선택 동기화만 하고, 포커스는 명시 진입 채널(enterExplicitly)
    // 만 가진다. vim off는 네이티브 진입 경로이므로 유지.
    this.applySelection(anchor, head, {
      focus: !this.latestVimEnabled || this.cmView?.hasFocus === true,
    });
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

  /** The entry intent is CURRENT: the PM selection is a cursor sitting
   *  exactly on the memoed local head inside this block. */
  private entryInsertCurrent(): boolean {
    const memo = this.pendingEntryInsert;
    if (!memo) return false;
    if (!this.selectionInsideBlock()) return false;
    const pos = this.getPos();
    if (typeof pos !== "number") return false;
    const sel = this.view.state.selection;
    return sel.empty && sel.head - (pos + 1) === memo.head;
  }

  /** issue 478 — the PM mode the cursor carries out of this island:
   *  insert/replace map to insert (PM has no replace), anything else to
   *  normal. Null (no propagation) with vim off, or while the island's
   *  vim never published a mode (loading, install failure). */
  private exitPmMode(): "insert" | "normal" | null {
    if (!this.latestVimEnabled) return null;
    const mode = this.currentVimMode;
    if (mode === null) return null;
    return mode === "insert" || mode === "replace" ? "insert" : "normal";
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

    // issue 475 — leaving the island IS the end of any insert/visual/pending
    // ISLAND session. The keymap's edge-arrow escape is mode-blind (vim
    // passes insert-mode arrows through), so without the normalization the
    // island keeps insertMode=true and revives insert on the next entry.
    // Best-effort by contract: a failed normalization reports through the
    // controller's onError and the escape STILL proceeds — trapping focus
    // in the island is worse than a stale mode. No-op with vim off or
    // still loading (nothing to normalize).
    //
    // issue 478 — the mode follows the cursor OUT: the island's exit-time
    // mode (captured BEFORE the normalization erases it) rides the escape
    // transaction as PM's new mode. And leaving ends ALL island intents:
    // the entry/restore memos burn BEFORE exitToNormal, because its
    // "normal" publish fires while the PM selection still sits inside the
    // block — a leftover entry memo would pass the currency check there
    // and queue an off-focus insert revival (adversarial review).
    const escapeToPM = (dir: -1 | 1) => {
      const exitMode = this.exitPmMode();
      // 이탈 훅 구성(M1): 메타 스탬프는 same-transaction, 인접 island
      // 인계는 post-dispatch — escape 모듈은 vim을 모른 채 둘 다 주입받는다.
      const exit = exitMode
        ? {
            handoff: () =>
              enterCodeBlockSelection(
                this.view,
                exitMode === "insert" ? { vimMode: "insert" } : undefined,
              ),
            stamp: (tr: Transaction) => {
              tr.setMeta(vimPluginKey, boundaryModeMeta(exitMode));
            },
          }
        : undefined;
      // 이 이탈이 곧 유발할 focusout(포인터 이탈 감지)은 같은 전이다 —
      // latch로 잠가서 정규화 뒤의 "normal" 재캡처가 방금 전파한 모드를
      // 덮어쓰지 못하게 한다. 메모 소각은 LIFECYCLE burn ②.
      this.latchPointerExit();
      this.endIslandSession();
      maybeEscape(dir, exit);
    };

    // Custom keymaps for PM ↔ CM navigation
    const customKeys = buildCodeBlockKeymap({
      escape: escapeToPM,
      focusPM,
      getPos: this.getPos,
      // issue 478 — the empty-block conversion only fires from insert, and
      // the island dies with the block: no normalization needed, but the
      // outgoing mode still rides the SAME replacement transaction.
      stampExitMode: (tr) => {
        const mode = this.exitPmMode();
        if (mode) {
          tr.setMeta(vimPluginKey, boundaryModeMeta(mode));
        }
      },
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
        // Same wrapper as the keymap: the boundary fires only from idle
        // normal, where exitToNormal is a no-op — uniformity over cleverness.
        escape: (dir) => escapeToPM(dir),
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
      onError: (err) => {
        // INSTALL failure → deterministic plain editing (v3 contract 1).
        logger.error("[vim] island vim install failed:", err);
        this.cmView?.dispatch({
          effects: this.vimEditableCompartment.reconfigure([]),
        });
      },
      // Best-effort operation failures are report-only — the install
      // rollback above must never fire for a transient handleKey throw.
      onOperationError: (err) => {
        logger.error("[vim] island vim operation failed:", err);
      },
      onModeChange: (mode) => {
        this.currentVimMode = mode;
        // The restore memo clears only when the target mode is REACHED —
        // consumption-on-read lost it when a second settings recreate
        // arrived before the deferred handleKey ran (R7).
        if (mode !== null && mode === this.pendingVimModeRestore) {
          this.pendingVimModeRestore = null;
        }
        // issue 477 — publish 주도 배달 (LIFECYCLE confirmed/retried/burn ⑦):
        // insert 확인 시 소각, not-current면 소각, 그 외엔 재시도 — 이
        // publish는 큐를 떨어뜨린 새 세대이거나 걷힌 readOnly 거부일 수 있다.
        if (mode !== null && this.pendingEntryInsert) {
          if (!this.entryInsertCurrent()) {
            this.pendingEntryInsert = null;
          } else if (mode === "insert") {
            this.pendingEntryInsert = null;
          } else {
            this.vimController?.ensureInsert();
          }
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
    const onIslandFocus = (event: FocusEvent) => {
      islandVimFocus(island);
      // 포인터 인계(기기 보고: B insert → A 클릭이 A의 stale 모드로 열림):
      // 다른 island에서 온 이동이면 그쪽 모드를 이어받는다.
      const handoff = takeIslandPointerHandoff(this.view, this.cmContainer);
      if (handoff === "insert") {
        this.vimController?.ensureInsert();
        return;
      }
      if (handoff === "normal") {
        this.vimController?.exitToNormal();
        return;
      }
      // 인계가 없을 때: 출발지가 PM 표면(본문)이면 PM 모드가 커서를 따라
      // 들어온다 — 본문(insert)에서 클릭으로 island에 들어가는 방향이
      // 마지막 구멍이었다 (기기 보고: i로 클릭 이동 중 어느 순간 n).
      // 크롬/외부 출발(relatedTarget이 view 밖·null)은 세션 보존 —
      // vim의 창 포커스 복귀 관례 그대로.
      const from =
        event.relatedTarget instanceof Element ? event.relatedTarget : null;
      const fromPmSurface =
        from !== null &&
        this.view.dom.contains(from) &&
        !from.closest("[data-vim-suspend]");
      if (!fromPmSurface) return;
      const pm = vimPluginKey.getState(this.view.state) as
        undefined | { enabled: boolean; mode: string };
      if (!pm?.enabled) return;
      if (pm.mode === "insert") this.vimController?.ensureInsert();
      else this.vimController?.exitToNormal();
    };
    const onIslandBlur = (event: FocusEvent) => {
      // 동기 구간(focusout → 도착측 focusin 이전): 다른 island로의 포인터
      // 이동이면 지금 모드를 인계로 arm하고 이 세션을 끝낸다. 키보드
      // 이탈(escapeToPM)과 같은 의미론 — 이동 = 세션 종료 + 의도 소각.
      //
      // 전이당 정확히 1회: 프로그램적 focus 연쇄는 한 전이에 focusout을
      // 겹쳐 쏘고, 두 번째 실행은 정규화 뒤의 모드를 다시 캡처해 방금
      // 전파한 모드를 "normal"로 덮어쓴다 (계측 실증). 포커스 전이는
      // 동기이므로 microtask 해제가 정확히 한 전이를 묶는다.
      if (this.pointerExitHandled) return;
      // relatedTarget이 null/BODY로 오는 전이(macOS WebKit이 비폼 요소를
      // 클릭 포커스하지 않는 경우)는 직전 pointerdown 타깃으로 목적지를
      // 보완한다 (적대 리뷰 HIGH: BODY/null 전이가 분기에 안 들어옴).
      const rawRelated =
        event.relatedTarget instanceof Element ? event.relatedTarget : null;
      const related =
        rawRelated && rawRelated !== this.view.dom.ownerDocument.body
          ? rawRelated
          : recentPointerTarget(this.view);
      // 목적지 권한은 등록에서 나온다 (감사 MAJOR): 문서 HTML이 같은
      // class를 그려도 등록된 island 컨테이너만 목적지다 — 가짜는 null로
      // 떨어지고, sanitized island는 suspend 마커가 본문行 분기도 걸러
      // "크롬과 동일 = 세션 보존"으로 안전 수렴한다.
      const destCandidate = related?.closest(".code-block-editor") ?? null;
      const dest =
        destCandidate && isRegisteredIslandContainer(this.view, destCandidate)
          ? destCandidate
          : null;
      let pmBodyExit = false;
      if (dest && !island.dom.contains(dest) && !dest.contains(island.dom)) {
        const mode = this.exitPmMode();
        if (mode) {
          this.latchPointerExit();
          armIslandPointerHandoff(this.view, mode, dest);
          this.endIslandSession();
        }
      } else if (
        !dest &&
        related &&
        this.view.dom.contains(related) &&
        !related.closest("[data-vim-suspend]")
      ) {
        // island → PM 본문 포인터 이탈(기기 보고: island insert에서 본문
        // 클릭 후 바깥이 normal로 남음): 키보드 이탈과 같은 의미론 —
        // 정규화 전에 모드 캡처, 의도 소각, 세션 종료, boundary setMode로
        // PM에 전파. 크롬(view.dom 밖)과 다른 suspend 섬(math 등)은 제외.
        const mode = this.exitPmMode();
        if (mode) {
          pmBodyExit = true;
          this.latchPointerExit();
          this.endIslandSession();
          this.view.dispatch(
            this.view.state.tr.setMeta(vimPluginKey, boundaryModeMeta(mode)),
          );
        }
      }
      queueMicrotask(() => {
        // 세대 가드 (감사): detach/재부착·destroy 뒤에 도는 유령 blur가
        // 새 세대의 메모를 태우거나 포커스를 배달하면 안 된다 —
        // controller의 session 정체성 가드와 같은 패턴.
        if (this.cmView !== island) return;
        const active = island.dom.ownerDocument.activeElement;
        if (!island.dom.contains(active)) {
          islandVimBlur(island);
          // LIFECYCLE burn ④ — 방문이 끝나면 의도도 끝난다 (크롬 이탈 포함).
          this.pendingEntryInsert = null;
          // 포커스 배달 (기기 실측): WebKit은 클릭으로 tabindex div(PM
          // 루트)를 포커스하지 않아 전이가 BODY로 흘러 키보드가 죽는다.
          // 본문行 이탈로 판정된 전이에서 포커스가 view 밖에 남았으면
          // 명시 배달한다 — 하강의 포커스 강탈은 setSelection의 권한
          // 분리가 차단하므로 이 focus는 안전하다 (CRITICAL 1 해소 전제).
          if (pmBodyExit && !this.view.dom.contains(active)) {
            focusEditorView(this.view);
          }
        }
      });
    };
    // LIFECYCLE burn ⑤ — 사용자 키 = 인수인계 종료 (armed 메모가 이후
    // publish에서 배달되면 세션 납치: 거부된 배달 + v가 insert로 뒤집힘).
    // capture라 vim이 키를 처리해 publish하기 전에 소각이 앞선다.
    const onIslandKeydown = () => {
      this.pendingEntryInsert = null;
    };
    island.dom.addEventListener("focusin", onIslandFocus);
    island.dom.addEventListener("focusout", onIslandBlur);
    island.dom.addEventListener("keydown", onIslandKeydown, true);
    this.islandStatusDispose = () => {
      island.dom.removeEventListener("focusin", onIslandFocus);
      island.dom.removeEventListener("focusout", onIslandBlur);
      island.dom.removeEventListener("keydown", onIslandKeydown, true);
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
      if (this.userDepartedDuringInit()) {
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
      // The WHOLE selection must live inside this block — a selection
      // spanning from the block into the next paragraph passes a from-only
      // check and would still steal focus (R6).
      const stillHere = this.selectionInsideBlock();
      if (stillHere) {
        // The memo predates the async init — an edit landing meanwhile
        // would leave it in-range but STALE. `stillHere` just proved the
        // CURRENT PM selection lives inside this block, so derive the
        // local offsets from it instead of the memo, clamped like
        // pendingFocusRestore above (review round 2).
        const max = this.cmView.state.doc.length;
        const sel = this.view.state.selection;
        const base = (pos as number) + 1;
        // 하강 유래 메모(focusIntent=false)는 cold 소비에서도 포커스를
        // 훔치지 않는다 — 명시 진입만 지연 포커스를 배달한다 (CRITICAL 2).
        // 그리고 grant는 방문과 함께 죽는다 (감사 BLOCKER): 사용자가 init
        // 중 다른 곳으로 떠났으면 — pendingFocusRestore와 같은 술어 —
        // 선택만 반영하고 stale grant로 포커스를 훔치지 않는다.
        const wantFocus =
          this.pendingSelection.focusIntent && !this.userDepartedDuringInit();
        if (wantFocus) this.cmView.focus();
        this.updating = true;
        this.cmView.dispatch({
          // Same reason as the live entry path: the caret line — not the
          // wrapper top — must be what the viewport follows.
          scrollIntoView: wantFocus,
          selection: {
            anchor: Math.min(Math.max(sel.anchor - base, 0), max),
            head: Math.min(Math.max(sel.head - base, 0), max),
          },
        });
        this.updating = false;
      } else {
        // LIFECYCLE burn ⑥ — 메모의 엔트리가 선택과 함께 죽었다.
        this.pendingEntryInsert = null;
      }
      this.pendingSelection = null;
    }
  }

  /** 이탈의 공통 마무리: island의 모든 의도(entry/restore 메모)를 태우고
   *  vim 세션을 종료한다 — 키보드 이탈·포인터 이탈(island간/본문行) 세
   *  경로가 공유한다 (퀄리티 리뷰: 3중복 통합). */
  private endIslandSession(): void {
    this.pendingEntryInsert = null;
    this.pendingVimModeRestore = null;
    this.vimController?.exitToNormal();
  }

  /** 포인터 이탈 처리를 이 전이 동안 잠근다 (microtask에 해제 —
   *  포커스 전이는 동기라 정확히 한 전이를 묶는다). */
  private latchPointerExit(): void {
    this.pointerExitHandled = true;
    queueMicrotask(() => {
      this.pointerExitHandled = false;
    });
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

  /** issue 477 — arm the intent and attempt delivery. An island already in
   *  plain insert has nothing to deliver — arming there would let a later
   *  unrelated publish (the user's own Esc) yank them back into insert.
   *  Every other state arms the memo FIRST: the controller's acceptance is
   *  only "queued", and the publish-driven consumer owns confirmation. */
  private requestEntryInsert(head: number): void {
    if (this.currentVimMode === "insert") return;
    this.pendingEntryInsert = { head };
    this.vimController?.ensureInsert();
  }

  /** 사용자가 비동기 init 동안 이 NodeView 밖으로 떠났는가 — 포커스가
   *  body도 아니고 이 뷰 안도 아닌 상태. pendingFocusRestore(재생성)와
   *  pendingSelection의 grant 소비(cold 진입)가 같은 술어를 공유한다
   *  (감사: 두 번째 술어를 발명하지 않는다). */
  private userDepartedDuringInit(): boolean {
    const active = this.dom.ownerDocument.activeElement;
    return (
      active !== null &&
      active !== this.dom.ownerDocument.body &&
      !this.dom.contains(active)
    );
  }

  /** The WHOLE current PM selection lives inside this block (R6 shape —
   *  shared by the stale-cold-selection guard and the entry-insert memo). */
  private selectionInsideBlock(): boolean {
    const pos = this.getPos();
    if (typeof pos !== "number") return false;
    const { from, to } = this.view.state.selection;
    return from > pos && to < pos + this.node.nodeSize;
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
