// §5.4 Raw ProseMirror NodeView for CodeMirror 6 code blocks
// Uses a plain ProseMirror NodeView (not React) to properly handle
// setSelection(), which is critical for CM ↔ PM focus coordination.

import type { ViewUpdate } from "@codemirror/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView, EditorView as PMView } from "@tiptap/pm/view";

import { EditorState as CMState, Compartment } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";

import { useSettingsStore } from "../../../stores/settings/store";
import { showNodeViewAIMenu } from "../../../utils/nodeview-ai-menu";
import { withVimExternalEdit } from "../../plugins/vim/vim-keys";
import {
  getLanguageExtension,
  LANGUAGE_OPTIONS,
} from "../code-block-languages";
import { registerCodeBlockEditableSync } from "./code-block-cm-registry";
import { createCodeBlockEscape } from "./code-block-escape";
import { buildCodeBlockExtensions } from "./code-block-extensions";
import { buildCodeBlockKeymap } from "./code-block-keymap";
import { CodeBlockVimIsland } from "./code-block-vim-island";
import { onFirstVisible } from "./lazy-visible";

export class CodeBlockNodeView implements NodeView {
  dom: HTMLElement;
  private cmContainer: HTMLElement;
  private cmInitialized = false;
  private cmView: CMView | null = null;
  private destroyed = false;
  private getPos: () => number | undefined;
  private initGeneration = 0;
  private langGeneration = 0;
  private langSelect: HTMLSelectElement;
  // §298 Phase 0b R6: language switches reconfigure IN PLACE — recreation
  // resets vim to normal mid-typing (a language undo while in insert).
  private languageCompartment = new Compartment();
  private latestEffectiveEditable: boolean | null = null;
  private lazyDispose: (() => void) | null = null;
  private node: PMNode;
  private pendingFocusRestore: null | { head: number } = null;
  private pendingSelection: null | {
    anchor: number;
    focusIntent: boolean;
    head: number;
  } = null;
  // §298 §12-4: readOnly must be reconfigurable after creation — vim toggles
  // PM editable without triggering NodeView.update(), and broadcasts instead.
  private readOnlyCompartment = new Compartment();
  private settingsUnsub: (() => void) | null = null;
  private tiptapEditor: import("@tiptap/core").Editor;
  private unregisterEditableSync: (() => void) | null = null;
  private updating = false;
  private view: PMView;
  /** issue 372 split — vim 통합부 전체(controller 배선, entry/exit
   *  핸드오프, 포인터 인계, focus-capability 판정, 메모 수명주기)는
   *  binding이 소유한다. NodeView 수명으로 생성, CM은 attach/detach. */
  private vimIsland: CodeBlockVimIsland;

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

    // issue 372 split — vim 통합부는 binding으로 (mousedown 진입, 진입
    // 채널, vim on/off 구독, pointerdown 기록기, 메모 수명주기 전부).
    this.vimIsland = new CodeBlockVimIsland({
      cmContainer,
      enterExplicitly: (anchor, head) => this.enterExplicitly(anchor, head),
      getPos: this.getPos,
      selectionInsideBlock: () => this.selectionInsideBlock(),
      view,
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
    this.teardownCM();
    this.vimIsland.destroy();
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
      focus: this.vimIsland.entryFocusAllowed(),
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
      // issue 475/478 — 이탈 의미론(세션 종료·모드 전파·인접 인계)은
      // binding이 소유한다; keymap과 boundary hook은 같은 위임을 쓴다.
      escape: (dir) => this.vimIsland.escapeToPM(dir),
      focusPM,
      getPos: this.getPos,
      stampExitMode: (tr) => this.vimIsland.stampExitMode(tr),
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
      vimCompartment: this.vimIsland.vimCompartment,
      vimEditableCompartment: this.vimIsland.vimEditableCompartment,
    });

    const state = CMState.create({
      doc: this.node.textContent,
      extensions,
    });

    this.cmView = new CMView({
      state,
      parent: this.cmContainer,
    });

    // issue 372 split — controller·status 리스너·memo replay는 binding의
    // CM-인스턴스 수명 (per-CM 클로저가 정확히 이 cm을 캡처한다).
    this.vimIsland.attachCM(this.cmView, maybeEscape);

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
        this.vimIsland.cancelRestoreMemo();
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
        this.vimIsland.onStaleColdEntry();
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
    // 모드 절반(R6/R7의 restore 메모)은 binding 소유다.
    this.vimIsland.snapshotModeForRecreate(focused);
  }

  /** ONE teardown path for every CM replacement — settings change, language
   *  change and NodeView.destroy. Dispose BEFORE destroy: the controller's
   *  deferred work checks its disposed flag before dispatching. */
  private teardownCM(): void {
    this.vimIsland.detachCM();
    if (this.cmView) {
      this.cmView.destroy();
      this.cmView = null;
    }
  }
}
