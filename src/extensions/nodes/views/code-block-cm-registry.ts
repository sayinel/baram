// §298 Phase 1 (§12-4) — per-PMView registry of live CodeMirror code blocks.
//
// Why this exists (design §4, "CM readOnly 동기화"): when vim toggles the PM
// view's editable prop, ProseMirror does NOT call NodeView.update() — only
// doc/attr changes do. So the vim PluginView broadcasts the new editable
// state here, and every live CodeBlockNodeView reconfigures its CM readOnly
// Compartment.
//
// Leaf-module pin (plan review R6): this file must import neither the vim
// module nor concrete NodeView classes — both sides import IT.
import type { EditorView as PMView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

type EditableSync = (editable: boolean) => void;

const registries = new WeakMap<PMView, Set<EditableSync>>();
/** Last broadcast value per view — replayed to late registrants so a lazy
 *  CM created after a mode flip does not miss it (vim review S5/S6-R5). */
const lastBroadcast = new WeakMap<PMView, boolean>();

/** Push the PM view's editable state to every live code block it hosts. */
export function broadcastCodeBlockEditable(
  view: PMView,
  editable: boolean,
): void {
  lastBroadcast.set(view, editable);
  const set = registries.get(view);
  if (!set) return;
  for (const sync of set) sync(editable);
}

/**
 * Register a code block's sync callback for its owning PM view.
 * Returns the unregister function — call it in NodeView.destroy().
 */
export function registerCodeBlockEditableSync(
  view: PMView,
  sync: EditableSync,
): () => void {
  let set = registries.get(view);
  if (!set) {
    set = new Set();
    registries.set(view, set);
  }
  set.add(sync);
  const cached = lastBroadcast.get(view);
  if (cached !== undefined) sync(cached);
  return () => {
    set.delete(sync);
  };
}

// §298 Phase 0b — vim on/off channel, same shape as the editable channel:
// the vim PluginView broadcasts the ENABLED flag, live code blocks flip
// their vim controller, and the last value replays to late registrants
// (a lazily created CM must not miss the current setting).

const vimRegistries = new WeakMap<PMView, Set<EditableSync>>();
const lastVimBroadcast = new WeakMap<PMView, boolean>();

/** issue 477 — entry-mode intent, owned by the registrant through its whole
 *  lifecycle (live vim session, vim still loading, cold CM): "insert" lands
 *  the island editing (continuity from a PM insert-mode arrow entry). */
export interface EntryOptions {
  vimMode?: "insert";
}

/** Returns whether focus was delivered SYNCHRONOUSLY. A cold island (CM not
 *  yet mounted) memos the selection for its deferred init and returns false —
 *  the caller must keep its own focus fallback so keys stay alive until the
 *  island claims focus on mount (adversarial review round 2, cold-island
 *  false success). */
type EntryHandoff = (
  anchor: number,
  head: number,
  opts?: EntryOptions,
) => boolean;

interface EntryRegistrant {
  /** 이 island의 실제 DOM 컨테이너 — 포인터 목적지 판정의 권한 원천.
   *  문서 HTML이 class="code-block-editor"를 그려도(sanitizer가 class를
   *  보존한다) 등록되지 않은 컨테이너는 목적지가 될 수 없다 (감사 MAJOR:
   *  콘텐츠 주도 focus/mode DoS 차단). */
  container: Element;
  enter: EntryHandoff;
  getPos: () => number | undefined;
}

/** register/unregister에서 관리되는 O(1) 컨테이너 인덱스. */
const islandContainers = new WeakMap<PMView, Set<Element>>();

/** 후보가 실제 등록된 island 컨테이너인가 — DOM 모양이 아니라 등록이
 *  권한이다 (entry 채널과 같은 원칙). */
export function isRegisteredIslandContainer(
  view: PMView,
  el: Element,
): boolean {
  return islandContainers.get(view)?.has(el) ?? false;
}

// §298 — explicit code-block ENTRY channel. prosemirror-view's
// selectionToDOM() is gated by editorOwnsSelection(view): on a NON-editable
// view (vim normal mode) the gate additionally requires a DOM selection
// whose anchor AND focus sit inside view.dom, plus an activeElement that
// contains view.dom. While vim is modal those preconditions frequently do
// not hold (ranged selections are wiped by the phantom-highlight defense,
// a source-mode roundtrip relocates the DOM selection entirely) — so PM's
// own descent into NodeView.setSelection (the one hook that focuses CM and
// carries the cursor in) cannot be relied on; entry only "worked" when a
// stale DOM range happened to be lying inside view.dom (device-measured).
// A cursor write that lands inside a code block invokes the handoff HERE
// instead, with the same node-LOCAL offsets PM's docView descent passes.

/** Push the vim ENABLED flag to every live code block of this PM view. */
export function broadcastCodeBlockVim(view: PMView, enabled: boolean): void {
  lastVimBroadcast.set(view, enabled);
  const set = vimRegistries.get(view);
  if (!set) return;
  for (const sync of set) sync(enabled);
}

/** Register a code block's vim sync; returns the unregister function. */
export function registerCodeBlockVimSync(
  view: PMView,
  sync: EditableSync,
): () => void {
  let set = vimRegistries.get(view);
  if (!set) {
    set = new Set();
    vimRegistries.set(view, set);
  }
  set.add(sync);
  const cached = lastVimBroadcast.get(view);
  if (cached !== undefined) sync(cached);
  return () => {
    set.delete(sync);
  };
}

const entryRegistries = new WeakMap<PMView, Set<EntryRegistrant>>();

// issue 478 후속(기기 보고) — island 간 POINTER 이동의 모드 인계. 떠나는
// island가 focusout(relatedTarget=다른 island)에서 자기 모드를 arm하고,
// 도착 island의 focusin이 소비한다: 포커스 전이는 동기(focusout → focusin)
// 라 순서가 보장된다. 일회성이며 소비 즉시 사라진다 — 크롬(사이드바)
// 왕복은 arm 자체가 없어 세션 보존 관례가 유지된다.
interface PointerHandoff {
  /** 인계의 정당한 목적지(.code-block-editor 컨테이너) — 멀티홉 포커스
   *  폭주에서 엉뚱한 island가 소비하는 오배송을 막는다 (적대 리뷰 V3). */
  dest: Element;
  mode: "insert" | "normal";
}

const pointerHandoffs = new WeakMap<PMView, PointerHandoff>();

/** 떠나는 island가 도착 island로 나를 모드를 예고한다. FIRST-WINS:
 *  같은 전이에서 focusout이 겹쳐 발화해도(프로그램적 focus 연쇄) 최초
 *  캡처 — 정규화 이전의 진짜 모드 — 가 이긴다. 소비되지 않은 arm은
 *  microtask에서 만료된다: 포커스 전이는 동기라 정상 소비는 그 전에
 *  끝나고, 남는 것은 도착지가 island가 아니었던 잔재뿐이다. */
export function armIslandPointerHandoff(
  view: PMView,
  mode: "insert" | "normal",
  dest: Element,
): void {
  if (pointerHandoffs.has(view)) return;
  const entry: PointerHandoff = { dest, mode };
  pointerHandoffs.set(view, entry);
  queueMicrotask(() => {
    if (pointerHandoffs.get(view) === entry) pointerHandoffs.delete(view);
  });
}

// ── 포인터 다운 기록 (BODY/null relatedTarget 보완) ─────────────────────
// macOS WebKit은 클릭으로 tabindex div·비폼 요소를 포커스하지 않아,
// focusout의 relatedTarget이 null/BODY로 오는 전이가 있다 (기기 실측).
// 마지막 pointerdown의 실제 타깃을 짧게 기억해 이탈 분기의 목적지 판정을
// 보완한다. 뷰당 리스너 1개(capture), O(1) 기록.

const lastPointerDown = new WeakMap<PMView, { target: Element; ts: number }>();
const pointerRecorderInstalled = new WeakSet<PMView>();

/** 뷰당 1회 pointerdown 기록기 설치 (등록자 수와 무관하게 단일). */
export function ensurePointerDownRecorder(view: PMView): void {
  if (pointerRecorderInstalled.has(view)) return;
  pointerRecorderInstalled.add(view);
  view.dom.addEventListener(
    "mousedown",
    (e) => {
      if (e.target instanceof Element) {
        lastPointerDown.set(view, { target: e.target, ts: Date.now() });
      }
    },
    true,
  );
}

/** 직전(500ms 내) pointerdown 타깃 — 이탈 focusout의 목적지 보완용. */
export function recentPointerTarget(view: PMView): Element | null {
  const rec = lastPointerDown.get(view);
  if (!rec) return null;
  if (Date.now() - rec.ts > 500) {
    // 만료 즉시 참조 해제 — 제거된(클릭했던) 서브트리를 다음 mousedown
    // 까지 붙들지 않는다 (감사 MINOR).
    lastPointerDown.delete(view);
    return null;
  }
  return rec.target;
}

/**
 * Invoke the entry handoff of the code block whose node starts at
 * `blockPos`. Returns whether the island took focus SYNCHRONOUSLY — false
 * (no registrant, or a cold island that only memoed the selection) leaves
 * the caller's fallback (plain PM focus) in charge.
 */
export function enterCodeBlockAt(
  view: PMView,
  blockPos: number,
  localAnchor: number,
  localHead: number,
  opts?: EntryOptions,
): boolean {
  const set = entryRegistries.get(view);
  if (!set) return false;
  for (const registrant of set) {
    if (registrant.getPos() === blockPos) {
      return registrant.enter(localAnchor, localHead, opts);
    }
  }
  return false;
}

/**
 * Shared caller-side shape check: hand the CURRENT selection over when it is
 * an empty text cursor inside a code block. Every programmatic landing path
 * (vim dispatchCursor, search submit, source-mode cursor restore) funnels
 * through this one predicate so the entry semantics cannot fork.
 */
export function enterCodeBlockSelection(
  view: PMView,
  opts?: EntryOptions,
): boolean {
  const sel = view.state.selection;
  if (!sel.empty || !(sel instanceof TextSelection)) return false;
  const $head = sel.$head;
  if ($head.parent.type.name !== "codeBlock") return false;
  return enterCodeBlockAt(
    view,
    $head.before(),
    $head.parentOffset,
    $head.parentOffset,
    opts,
  );
}

/** Register a code block's entry handoff; returns the unregister function. */
export function registerCodeBlockEntry(
  view: PMView,
  getPos: () => number | undefined,
  container: Element,
  enter: EntryHandoff,
): () => void {
  let set = entryRegistries.get(view);
  if (!set) {
    set = new Set();
    entryRegistries.set(view, set);
  }
  let containers = islandContainers.get(view);
  if (!containers) {
    containers = new Set();
    islandContainers.set(view, containers);
  }
  const registrant: EntryRegistrant = { container, enter, getPos };
  set.add(registrant);
  containers.add(container);
  return () => {
    set.delete(registrant);
    containers.delete(container);
  };
}

/** 도착 island가 인계 모드를 소비한다 — 없으면 null (세션 보존). */
export function takeIslandPointerHandoff(
  view: PMView,
  claimant: Element,
): "insert" | "normal" | null {
  const entry = pointerHandoffs.get(view);
  if (entry === undefined) return null;
  if (entry.dest !== claimant && !entry.dest.contains(claimant)) return null;
  pointerHandoffs.delete(view);
  return entry.mode;
}
