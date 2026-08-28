// §298 — vim island binding for CodeBlockNodeView (issue 372 split).
//
// NodeView의 vim 통합부를 collaborator로 분리한 것. 두 수명이 다르다는
// 것이 이 모듈의 계약이다 (적대 계획 리뷰 BLOCKER):
//
//   - NodeView 수명 (constructor → destroy): 레지스트리 구독(vim on/off
//     브로드캐스트, 명시적 entry 채널), cmContainer의 mousedown 진입,
//     그리고 설정 재생성을 살아남아야 하는 restore 메모.
//   - CM-instance 수명 (attachCM → detachCM, 재생성마다 반복): vim
//     controller, island status 리스너(focusin/focusout/keydown), 그리고
//     정확히 그 CM 인스턴스를 캡처하는 클로저들.
//
// detachCM은 restore 메모를 보존한다 — 재생성 복원(R7)이 그 메모로
// 산다. destroy만 레지스트리를 해제한다.
//
// 이 모듈은 NodeView 클래스도 vim-plugin.ts도 import하지 않는다 —
// 방향은 NodeView → binding → (controller, status, keys, registry)뿐.

import type { EditorView as PMView } from "@tiptap/pm/view";

import { EditorState as CMState, Prec } from "@codemirror/state";
import { Compartment } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";
import { redo, undo } from "@tiptap/pm/history";

import {
  createVimController,
  type VimController,
} from "../../../components/editor/vim-controller";
import { focusEditorView } from "../../../utils/editor/focus-editor-view";
import { logger } from "../../../utils/logger";
import { boundaryModeMeta, vimPluginKey } from "../../plugins/vim/vim-keys";
import {
  islandVimBlur,
  islandVimDispose,
  islandVimFocus,
  islandVimMode,
} from "../../plugins/vim/vim-status";
import {
  armIslandPointerHandoff,
  ensurePointerDownRecorder,
  enterCodeBlockSelection,
  isRegisteredIslandContainer,
  recentPointerTarget,
  registerCodeBlockEntry,
  registerCodeBlockVimSync,
  takeIslandPointerHandoff,
} from "./code-block-cm-registry";
import { type EscapeExitHooks } from "./code-block-escape";

/** NodeView가 binding에 빌려주는 표면 — binding은 NodeView의 나머지
 *  상태(updating, pendingSelection/FocusRestore, readOnly/언어 컴파트먼트,
 *  세대 카운터)를 절대 만지지 않는다 (소유권 표). */
export interface VimIslandHost {
  cmContainer: HTMLElement;
  /** 명시 진입 배달 — 포커스 권한을 가진 유일한 selection 경로 (live면
   *  CM 포커스+디스패치, cold면 focusIntent와 함께 메모 — 소비는 NodeView
   *  소유). */
  enterExplicitly(anchor: number, head: number): void;
  getPos(): number | undefined;
  /** R6 형태의 컨테인먼트 — stale-cold 가드와 entry 메모 currency가
   *  같은 판정을 쓰도록 NodeView가 단일 구현을 빌려준다. */
  selectionInsideBlock(): boolean;
  view: PMView;
}

export class CodeBlockVimIsland {
  /** buildCodeBlockExtensions가 필요로 하는 컴파트먼트 — CM 재생성을
   *  넘어 살아야 하므로 binding(NodeView 수명) 소유다. */
  readonly vimCompartment = new Compartment();
  readonly vimEditableCompartment = new Compartment();

  private attachedCm: CMView | null = null;
  private currentVimMode: null | string = null;
  private host: VimIslandHost;
  private latestVimEnabled: boolean | null = null;
  private listenersDispose: (() => void) | null = null;
  /** 이탈에 필요한 escape 콜백 — attachCM에서 그 CM의 것을 캡처. */
  private maybeEscape: ((dir: -1 | 1, exit?: EscapeExitHooks) => void) | null =
    null;
  private mousedownDispose: (() => void) | null = null;
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
  private pendingVimModeRestore: "insert" | "replace" | null = null;
  /** 포인터 이탈의 전이당 1회 처리 latch — focusout이 한 전이에 겹쳐
   *  발화해도(계측 실증) 정규화 이전의 첫 캡처만 전파된다. */
  private pointerExitHandled = false;
  private unregisterEntry: (() => void) | null = null;
  private unregisterVimSync: (() => void) | null = null;
  private vimController: null | VimController = null;

  constructor(host: VimIslandHost) {
    this.host = host;
    ensurePointerDownRecorder(host.view);

    // §298 Phase 0b (PR 307 review) — a click must ENTER the island while
    // vim is in normal mode, and nothing else in the chain delivers that.
    // The barrier leaves contentDOM `contenteditable=false` with a negative
    // tabindex, and WebKit does not focus such an element on click. Capture
    // phase, because CodeMirror's own mousedown handling is what we are
    // standing in for.
    const onMousedown = () => {
      if (!this.latestVimEnabled || !this.attachedCm) return;
      if (this.attachedCm.hasFocus) return;
      this.attachedCm.focus();
    };
    host.cmContainer.addEventListener("mousedown", onMousedown, true);
    this.mousedownDispose = () => {
      host.cmContainer.removeEventListener("mousedown", onMousedown, true);
    };

    // §298 — explicit vim entry channel (registry note): while vim is modal
    // PM's editorOwnsSelection gate usually fails, so selectionToDOM cannot
    // be relied on to descend into setSelection — the vim plugin drives it
    // through this channel instead.
    this.unregisterEntry = registerCodeBlockEntry(
      host.view,
      host.getPos,
      host.cmContainer,
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
        const cm = this.attachedCm;
        if (
          cm?.hasFocus &&
          cm.state.selection.main.anchor === anchor &&
          cm.state.selection.main.head === head
        ) {
          if (wantInsert) this.requestEntryInsert(head);
          return true;
        }
        host.enterExplicitly(anchor, head);
        if (wantInsert) this.requestEntryInsert(head);
        // A live CM was focused synchronously; a cold one only memoed the
        // selection for its deferred init — report false so the caller
        // keeps its focus fallback alive until the island claims focus on
        // mount (pendingSelection consumption).
        return this.attachedCm !== null;
      },
    );

    // §298 Phase 0b: vim on/off broadcast — the memo is consumed by the
    // deferred attach, exactly like the editable memo on the NodeView side.
    this.unregisterVimSync = registerCodeBlockVimSync(host.view, (enabled) => {
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
  }

  /** CM 인스턴스 수명 시작: controller 생성 + status 리스너 설치 + memo
   *  replay. per-CM 클로저는 전부 이 `cm`을 정확히 캡처한다 (getter가
   *  아니라 — 재생성 경합에서 다른 인스턴스를 찌르지 않도록). */
  attachCM(
    cm: CMView,
    maybeEscape: (dir: -1 | 1, exit?: EscapeExitHooks) => void,
  ): void {
    this.attachedCm = cm;
    this.maybeEscape = maybeEscape;

    // §298 Phase 0b — per-island vim controller (claimFocus false: a lazy
    // load must never steal focus from PM).
    this.vimController = createVimController(cm, this.vimCompartment, {
      // §3 boundary contract: edge j/k/arrows leave the block through the
      // SAME escape path as plain arrows; u/C-r go to PM — the island has
      // no CM history, PM owns the document's undo (design v3).
      boundaryHooks: {
        // Same wrapper as the keymap: the boundary fires only from idle
        // normal, where exitToNormal is a no-op — uniformity over cleverness.
        escape: (dir) => this.escapeToPM(dir),
        redo: () => {
          redo(this.host.view.state, this.host.view.dispatch);
        },
        undo: () => {
          undo(this.host.view.state, this.host.view.dispatch);
        },
      },
      claimFocus: false,
      editableCompartment: this.vimEditableCompartment,
      onError: (err) => {
        // INSTALL failure → deterministic plain editing (v3 contract 1).
        logger.error("[vim] island vim install failed:", err);
        cm.dispatch({
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
        // issue 477 — publish 주도 배달 (LIFECYCLE confirmed/retried/burn
        // ⑦): insert 확인 시 소각, not-current면 소각, 그 외엔 재시도 —
        // 이 publish는 큐를 떨어뜨린 새 세대이거나 걷힌 readOnly 거부일
        // 수 있다.
        if (mode !== null && this.pendingEntryInsert) {
          if (!this.entryInsertCurrent()) {
            this.pendingEntryInsert = null;
          } else if (mode === "insert") {
            this.pendingEntryInsert = null;
          } else {
            this.vimController?.ensureInsert();
          }
        }
        islandVimMode(cm, mode, this.host.view);
        // Cold-load race: the first mode arrives AFTER focus already sits
        // in the island — claim the indicator now, not on the next focus.
        if (mode !== null && cm.hasFocus) islandVimFocus(cm);
      },
      // Best-effort operation failures are report-only — the install
      // rollback above must never fire for a transient handleKey throw.
      onOperationError: (err) => {
        logger.error("[vim] island vim operation failed:", err);
      },
      restoreMode: () => this.pendingVimModeRestore,
    });

    // §3-4 nested StatusBar ownership — the island claims the indicator on
    // focus (snapshot replay) and releases it on blur/teardown. Ownership
    // listens on the CM ROOT: vim mounts its `:`/`/` panels outside
    // contentDOM, and moving focus into a panel is still the same island.
    const onIslandFocus = (event: FocusEvent) => {
      islandVimFocus(cm);
      // 포인터 인계(기기 보고: B insert → A 클릭이 A의 stale 모드로 열림):
      // 다른 island에서 온 이동이면 그쪽 모드를 이어받는다 (목적지 스코프
      // — 멀티홉 폭주의 오배송 차단).
      const handoff = takeIslandPointerHandoff(
        this.host.view,
        this.host.cmContainer,
      );
      if (handoff === "insert") {
        this.vimController?.ensureInsert();
        return;
      }
      if (handoff === "normal") {
        this.vimController?.exitToNormal();
        return;
      }
      // 인계가 없을 때: 출발지가 PM 표면(본문)이면 PM 모드가 커서를 따라
      // 들어온다 (기기 보고: i로 클릭 이동 중 어느 순간 n). 크롬/외부
      // 출발은 세션 보존 — vim의 창 포커스 복귀 관례.
      const from =
        event.relatedTarget instanceof Element ? event.relatedTarget : null;
      const fromPmSurface =
        from !== null &&
        this.host.view.dom.contains(from) &&
        !from.closest("[data-vim-suspend]");
      if (!fromPmSurface) return;
      const pm = vimPluginKey.getState(this.host.view.state) as
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
      // 클릭 포커스하지 않는 경우)는 직전 pointerdown 타깃으로 보완.
      const rawRelated =
        event.relatedTarget instanceof Element ? event.relatedTarget : null;
      const related =
        rawRelated && rawRelated !== this.host.view.dom.ownerDocument.body
          ? rawRelated
          : recentPointerTarget(this.host.view);
      // 목적지 권한은 등록에서 나온다 (감사 MAJOR): 문서 HTML이 같은
      // class를 그려도 등록된 island 컨테이너만 목적지다.
      const destCandidate = related?.closest(".code-block-editor") ?? null;
      const dest =
        destCandidate &&
        isRegisteredIslandContainer(this.host.view, destCandidate)
          ? destCandidate
          : null;
      let pmBodyExit = false;
      if (dest && !cm.dom.contains(dest) && !dest.contains(cm.dom)) {
        const mode = this.exitPmMode();
        if (mode) {
          this.latchPointerExit();
          armIslandPointerHandoff(this.host.view, mode, dest);
          this.endIslandSession();
        }
      } else if (
        !dest &&
        related &&
        this.host.view.dom.contains(related) &&
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
          this.host.view.dispatch(
            this.host.view.state.tr.setMeta(
              vimPluginKey,
              boundaryModeMeta(mode),
            ),
          );
        }
      }
      queueMicrotask(() => {
        // 세대 가드 (감사): detach/재부착·destroy 뒤에 도는 유령 blur가
        // 새 세대의 메모를 태우거나 포커스를 배달하면 안 된다.
        if (this.attachedCm !== cm) return;
        const active = cm.dom.ownerDocument.activeElement;
        if (!cm.dom.contains(active)) {
          islandVimBlur(cm);
          // LIFECYCLE burn ④ — 방문이 끝나면 의도도 끝난다 (크롬 이탈
          // 포함).
          this.pendingEntryInsert = null;
          // 포커스 배달: WebKit은 클릭으로 tabindex div(PM 루트)를
          // 포커스하지 않아 전이가 BODY로 흐른다 — 본문行 이탈이면 명시
          // 배달 (하강 강탈은 capability 분리가 차단하므로 안전).
          if (pmBodyExit && !this.host.view.dom.contains(active)) {
            focusEditorView(this.host.view);
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
    cm.dom.addEventListener("focusin", onIslandFocus);
    cm.dom.addEventListener("focusout", onIslandBlur);
    cm.dom.addEventListener("keydown", onIslandKeydown, true);
    this.listenersDispose = () => {
      cm.dom.removeEventListener("focusin", onIslandFocus);
      cm.dom.removeEventListener("focusout", onIslandBlur);
      cm.dom.removeEventListener("keydown", onIslandKeydown, true);
      islandVimDispose(cm);
    };

    if (this.latestVimEnabled) this.applyVim(true);
  }

  /** initCM의 focus-departure 취소(R5 C10 갈래)에서 restore 메모를 함께
   *  버린다 — 사용자가 재생성 중 다른 곳으로 떠났다. */
  cancelRestoreMemo(): void {
    this.pendingVimModeRestore = null;
  }

  destroy(): void {
    this.detachCM();
    this.mousedownDispose?.();
    this.mousedownDispose = null;
    this.unregisterEntry?.();
    this.unregisterEntry = null;
    this.unregisterVimSync?.();
    this.unregisterVimSync = null;
  }

  /** CM 인스턴스 수명 끝 (설정/언어 재생성, destroy). restore 메모는
   *  보존한다 — 재생성 복원(R7)의 재료다. Dispose BEFORE destroy: the
   *  controller's deferred work checks its disposed flag. */
  detachCM(): void {
    this.listenersDispose?.();
    this.listenersDispose = null;
    this.vimController?.dispose();
    this.vimController = null;
    this.attachedCm = null;
    this.maybeEscape = null;
  }

  // issue 475 — leaving the island IS the end of any insert/visual/pending
  // ISLAND session. The keymap's edge-arrow escape is mode-blind (vim
  // passes insert-mode arrows through), so without the normalization the
  // island keeps insertMode=true and revives insert on the next entry.
  // Best-effort by contract: a failed normalization reports through
  // onOperationError and the escape STILL proceeds — trapping focus in
  // the island is worse than a stale mode.
  //
  // issue 478 — the mode follows the cursor OUT: the island's exit-time
  // mode (captured BEFORE the normalization erases it) rides the escape
  // transaction as PM's new mode; the post-dispatch handoff carries the
  // insert intent to an adjacent island. Leaving ends ALL island intents
  // BEFORE exitToNormal — its "normal" publish fires while the PM
  // selection still sits inside the block, and a leftover entry memo
  // would pass the currency check there (adversarial review).
  escapeToPM(dir: -1 | 1): void {
    const exitMode = this.exitPmMode();
    const exit = exitMode
      ? {
          handoff: () =>
            enterCodeBlockSelection(
              this.host.view,
              exitMode === "insert" ? { vimMode: "insert" } : undefined,
            ),
          stamp: (tr: import("@tiptap/pm/state").Transaction) => {
            tr.setMeta(vimPluginKey, boundaryModeMeta(exitMode));
          },
        }
      : undefined;
    // 이 이탈이 곧 유발할 focusout(포인터 이탈 감지)은 같은 전이다 —
    // latch로 잠가서 정규화 뒤의 "normal" 재캡처가 방금 전파한 모드를
    // 덮어쓰지 못하게 한다. 메모 소각은 LIFECYCLE burn ②.
    this.latchPointerExit();
    this.endIslandSession();
    this.maybeEscape?.(dir, exit);
  }

  /** 진입 아닌 selection 동기화(PM 하강)가 포커스를 가져도 되는가 —
   *  vim off(네이티브 경로)거나 island가 이미 포커스를 쥔 경우만.
   *  NodeView.setSelection의 focus-capability 판정 입력 (판정 재료인
   *  latestVimEnabled·attachedCm가 binding 소유라 게터로 빌려준다). */
  entryFocusAllowed(): boolean {
    return !this.latestVimEnabled || this.attachedCm?.hasFocus === true;
  }

  /** LIFECYCLE burn ⑥ — stale-cold 소비(NodeView 소유)에서 메모의
   *  엔트리가 선택과 함께 죽었을 때. */
  onStaleColdEntry(): void {
    this.pendingEntryInsert = null;
  }

  /** 재생성 스냅샷의 모드 절반 (포커스 메모 절반은 NodeView 소유).
   *  Re-enter insert/replace after the rebuild — a recreation mid-typing
   *  must not flip keystrokes into normal-mode commands (R6). Visual dies
   *  with its old view. Preserve an UNCONFIRMED memo across back-to-back
   *  recreates (R7): the new controller re-seeded normal before its
   *  deferred restore could run. */
  snapshotModeForRecreate(focused: boolean): void {
    if (
      focused &&
      (this.currentVimMode === "insert" || this.currentVimMode === "replace")
    ) {
      this.pendingVimModeRestore = this.currentVimMode;
    } else if (!focused) {
      this.pendingVimModeRestore = null;
    }
  }

  /** issue 478 — the empty-block Backspace conversion is a boundary
   *  crossing too: the outgoing mode rides the SAME replacement
   *  transaction (the keymap stays vim-agnostic behind this hook). */
  stampExitMode(tr: import("@tiptap/pm/state").Transaction): void {
    const mode = this.exitPmMode();
    if (mode) tr.setMeta(vimPluginKey, boundaryModeMeta(mode));
  }

  /** §298 Phase 0b — vim enable/disable for THIS island (v3 contract 1).
   *  Enabling raises a SYNCHRONOUS editing-host barrier before the async
   *  module load: beforeinput fires ahead of keydown, so a suppressed-key
   *  gate alone would still let IME text through while vim loads. */
  private applyVim(enabled: boolean): void {
    const cm = this.attachedCm;
    if (!cm || !this.vimController) return;
    if (enabled) {
      // tabindex must land WITH the barrier: the controller only adds it
      // after the async module load, and a host-less, tabindex-less
      // contentDOM is unfocusable — an explicit PM entry (j/k into a cold
      // block, empty-block autofocus) would silently lose focus.
      cm.contentDOM.setAttribute("tabindex", "-1");
      // The editable facet does NOT gate key-bound API edits (installed
      // cm-view :8818) and the suspension broadcast releases the island's
      // readOnly on focus — so the loading barrier pins readOnly too.
      // Prec.highest: the readOnly facet takes its highest-precedence
      // value, and the broadcast compartment sits earlier in the config.
      // The controller's first mode flip replaces this compartment, so
      // the pin lifts exactly when vim takes over.
      cm.dispatch({
        effects: this.vimEditableCompartment.reconfigure([
          CMView.editable.of(false),
          Prec.highest(CMState.readOnly.of(true)),
        ]),
      });
    }
    this.vimController.apply(enabled);
  }

  /** 이탈의 공통 마무리: island의 모든 의도(entry/restore 메모)를 태우고
   *  vim 세션을 종료한다 — 키보드 이탈·포인터 이탈(island간/본문行) 세
   *  경로가 공유한다 (퀄리티 리뷰: 3중복 통합). */
  private endIslandSession(): void {
    this.pendingEntryInsert = null;
    this.pendingVimModeRestore = null;
    this.vimController?.exitToNormal();
  }

  /** The entry intent is CURRENT: the PM selection is a cursor sitting
   *  exactly on the memoed local head inside this block. */
  private entryInsertCurrent(): boolean {
    const memo = this.pendingEntryInsert;
    if (!memo) return false;
    if (!this.host.selectionInsideBlock()) return false;
    const pos = this.host.getPos();
    if (typeof pos !== "number") return false;
    const sel = this.host.view.state.selection;
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

  /** 포인터 이탈 처리를 이 전이 동안 잠근다 (microtask에 해제 —
   *  포커스 전이는 동기라 정확히 한 전이를 묶는다). */
  private latchPointerExit(): void {
    this.pointerExitHandled = true;
    queueMicrotask(() => {
      this.pointerExitHandled = false;
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
}
