// §298 Phase 0a S2 — vim controller lifecycle tests.
//
// Codex S2 gate: a guard-level disposer test is not evidence that the caller
// actually calls it. These tests pin the CALLER contract with fakes: attach
// on enable, dispose on toggle-off, stale-load dropping across on/off/on,
// and unmount-before-resolve silence.

import type { VimControllerDeps } from "../vim-controller";
import type { VimModeName } from "../vim-ime-guard";
import type { EditorView } from "@codemirror/view";

import { Compartment } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { createVimController } from "../vim-controller";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (e: unknown) => void;
  resolve: (v: T) => void;
}

type LoadModule = NonNullable<VimControllerDeps["loadModule"]>;

type VimModule = Awaited<ReturnType<LoadModule>>;

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
function makeFakes() {
  const view = {
    contentDOM: document.createElement("div"),
    dispatch: vi.fn(),
    // 3v focus fallback uses view.focus() (selection resync + prevent-scroll).
    focus: vi.fn(),
  };
  const compartment = new Compartment();
  const guardDispose = vi.fn();
  const attachGuard = vi.fn(
    (_view: unknown, _cm: unknown, _onModeChange?: unknown) => guardDispose,
  );
  const cm = { fake: true };
  const mod = { getCM: vi.fn(() => cm), vim: vi.fn(() => []) };
  return { attachGuard, cm, compartment, guardDispose, mod, view };
}

const asView = (v: { contentDOM: HTMLElement }) => v as unknown as EditorView;
const asModule = (m: unknown) => m as VimModule;

describe("createVimController", () => {
  it("enable: loads the module, reconfigures, and attaches the guard once", async () => {
    const f = makeFakes();
    const loadModule = vi.fn(() => Promise.resolve(asModule(f.mod)));
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule,
    });
    controller.apply(true);
    await flush();
    expect(f.view.dispatch).toHaveBeenCalledTimes(1);
    expect(f.attachGuard).toHaveBeenCalledTimes(1);
    expect(f.attachGuard.mock.calls[0][1]).toBe(f.cm);
  });

  it("toggle off after enable: disposes the guard, empties the slot, reports null mode", async () => {
    const f = makeFakes();
    const onModeChange = vi.fn();
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule: () => Promise.resolve(asModule(f.mod)),
      onModeChange,
    });
    controller.apply(true);
    await flush();
    controller.apply(false);
    expect(f.guardDispose).toHaveBeenCalledTimes(1);
    expect(f.view.dispatch).toHaveBeenCalledTimes(2);
    expect(onModeChange).toHaveBeenCalledWith(null);
  });

  it("on/off/on: the stale first load is dropped; the guard attaches exactly once", async () => {
    const f = makeFakes();
    const d1 = deferred<VimModule>();
    const d2 = deferred<VimModule>();
    const loadModule = vi
      .fn<LoadModule>()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule,
    });
    controller.apply(true);
    controller.apply(false);
    controller.apply(true);
    d1.resolve(asModule(f.mod)); // stale — belongs to the first enable
    await flush();
    expect(f.attachGuard).not.toHaveBeenCalled();
    d2.resolve(asModule(f.mod));
    await flush();
    expect(f.attachGuard).toHaveBeenCalledTimes(1);
  });

  it("dispose before resolve: late module arrival does nothing", async () => {
    const f = makeFakes();
    const d = deferred<VimModule>();
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule: () => d.promise,
    });
    controller.apply(true);
    controller.dispose();
    d.resolve(asModule(f.mod));
    await flush();
    expect(f.view.dispatch).not.toHaveBeenCalled();
    expect(f.attachGuard).not.toHaveBeenCalled();
  });

  it("unmount after attach: dispose detaches the guard AND resets the mode to null", async () => {
    const f = makeFakes();
    const onModeChange = vi.fn();
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule: () => Promise.resolve(asModule(f.mod)),
      onModeChange,
    });
    controller.apply(true);
    await flush();
    controller.dispose();
    expect(f.guardDispose).toHaveBeenCalledTimes(1);
    // The StatusBar store feed must be cleared on unmount — a lingering mode
    // would only be masked by the source-mode render gate (Codex final gate).
    expect(onModeChange).toHaveBeenLastCalledWith(null);
  });

  it("load failure reports onError; after dispose it stays silent", async () => {
    const f = makeFakes();
    const onError = vi.fn();
    const d1 = deferred<VimModule>();
    const d2 = deferred<VimModule>();
    const loadModule = vi
      .fn<LoadModule>()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule,
      onError,
    });
    controller.apply(true);
    d1.reject(new Error("chunk failed"));
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);

    controller.apply(true);
    controller.dispose();
    d2.reject(new Error("late failure"));
    await flush();
    expect(onError).toHaveBeenCalledTimes(1); // unchanged
  });

  it("getCM null (plugin creation failed): rolls back to plain editing", async () => {
    // CodeMirror DEACTIVATES a throwing ViewPlugin instead of propagating,
    // so getCM null IS the init-failure path. A pre-raised editing-host
    // barrier (code block islands) must not survive it — the slot empties,
    // the host returns, and the failure is reported.
    const f = makeFakes();
    const mod = { getCM: vi.fn(() => null), vim: vi.fn(() => []) };
    const onError = vi.fn();
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule: () => Promise.resolve(asModule(mod)),
      onError,
    });
    controller.apply(true);
    await flush();
    expect(f.attachGuard).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    // vim slot installed, then emptied again on the failure rollback
    expect(f.view.dispatch).toHaveBeenCalledTimes(2);
    expect(f.view.contentDOM.getAttribute("tabindex")).toBeNull();
  });

  it("a throwing attach rolls the half-enabled plugin back to plain", async () => {
    // compartment + tabindex are already installed when the guard attaches;
    // reporting alone would leave vim active WITHOUT its IME guard.
    const f = makeFakes();
    const mod = { getCM: vi.fn(() => ({})), vim: vi.fn(() => []) };
    const onError = vi.fn();
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: vi.fn(() => {
        throw new Error("guard exploded");
      }),
      loadModule: () => Promise.resolve(asModule(mod)),
      onError,
    });
    controller.apply(true);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(f.view.dispatch).toHaveBeenCalledTimes(2); // install + rollback
    expect(f.view.contentDOM.getAttribute("tabindex")).toBeNull();
  });

  it("a stale host-restore never reopens a re-raised barrier", async () => {
    // enable → disable → enable while the module load is still pending:
    // disable queues a host restore; the queued flip must not fire into
    // the second enable's barrier window.
    const f = makeFakes();
    const editableCompartment = new Compartment();
    let resolveLoad: ((m: unknown) => void) | null = null;
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      editableCompartment,
      loadModule: () =>
        new Promise((r) => {
          resolveLoad = r as (m: unknown) => void;
        }),
    });
    controller.apply(true);
    controller.apply(false); // queues pendingEditable=true (host restore)
    controller.apply(true); // re-enable — load still unresolved
    const dispatches = f.view.dispatch.mock.calls.length;
    await flush(); // the queued restore microtask runs here
    expect(f.view.dispatch.mock.calls.length).toBe(dispatches); // no restore
    expect(resolveLoad).not.toBeNull();
  });

  it("3v mechanism: removes the editing host per mode and restores it on off", async () => {
    // Real-surface smoke finding: WebKit uses the composition path
    // (insertCompositionText — non-cancelable) in the production editor, so
    // beforeinput canceling alone cannot work. 3v removes the editing host in
    // normal/visual (no host = no composition, ever) and keeps contentDOM
    // focusable via tabindex (measured, probe step 3v).
    const f = makeFakes();
    const editableCompartment = new Compartment();
    let modeCb: ((m: null | VimModeName) => void) | undefined;
    const attachGuard = vi.fn((_view: unknown, _cm: unknown, cb?: unknown) => {
      modeCb = cb as (m: null | VimModeName) => void;
      return f.guardDispose;
    });
    const onModeChange = vi.fn();
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard,
      editableCompartment,
      loadModule: () => Promise.resolve(asModule(f.mod)),
      onModeChange,
    });
    controller.apply(true);
    await flush();
    // Focusable before any editable flip so focus never drops.
    expect(f.view.contentDOM.getAttribute("tabindex")).toBe("-1");

    const base = f.view.dispatch.mock.calls.length;
    modeCb!("normal"); // → editing host removed (one editable dispatch)
    // The flip is deferred by one microtask so it can never land inside
    // CodeMirror's update cycle (see setEditingHost) — the mode callback
    // itself must stay synchronous for the StatusBar feed.
    expect(onModeChange).toHaveBeenLastCalledWith("normal");
    expect(f.view.dispatch.mock.calls.length).toBe(base);
    await flush();
    expect(f.view.dispatch.mock.calls.length).toBe(base + 1);
    // Focus fallback: activeElement is body in jsdom, so the host removal
    // must re-focus via view.focus() (Codex 3v review note pinned here).
    expect(f.view.focus).toHaveBeenCalled();

    modeCb!("insert"); // → editing host restored
    await flush();
    expect(f.view.dispatch.mock.calls.length).toBe(base + 2);
    expect(onModeChange).toHaveBeenLastCalledWith("insert");

    controller.apply(false); // → restore host + clear vim slot + tabindex off
    expect(f.view.contentDOM.getAttribute("tabindex")).toBeNull();
    expect(onModeChange).toHaveBeenLastCalledWith(null);
  });

  it("never flips the editing host from inside a CodeMirror update", async () => {
    // The real crash this fixes: @replit/codemirror-vim signals
    // vim-mode-change from onBeforeEndOperation — i.e. while CodeMirror is
    // mid-update — whenever a mouse selection reaches handleExternalSelection.
    // A synchronous dispatch there throws, CodeMirror logs once and
    // DEACTIVATES the plugin, and its abandoned cursor layer is the second
    // caret users reported. The flip must therefore land outside the update.
    const f = makeFakes();
    const editableCompartment = new Compartment();
    let modeCb: ((m: null | VimModeName) => void) | undefined;
    const attachGuard = vi.fn((_view: unknown, _cm: unknown, cb?: unknown) => {
      modeCb = cb as (m: null | VimModeName) => void;
      return f.guardDispose;
    });
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard,
      editableCompartment,
      loadModule: () => Promise.resolve(asModule(f.mod)),
    });
    controller.apply(true);
    await flush();

    // Stand in for CodeMirror's own re-entrancy guard.
    let inUpdate = true;
    f.view.dispatch.mockImplementation(() => {
      if (inUpdate) {
        throw new Error(
          "Calls to EditorView.update are not allowed while an update is in progress",
        );
      }
    });

    const before = f.view.dispatch.mock.calls.length;
    expect(() => modeCb!("normal")).not.toThrow();
    expect(f.view.dispatch.mock.calls.length).toBe(before); // nothing yet

    inUpdate = false; // CodeMirror's update has unwound
    await flush();
    expect(f.view.dispatch.mock.calls.length).toBe(before + 1);
  });

  it("drops a deferred editing-host flip after dispose", async () => {
    const f = makeFakes();
    const editableCompartment = new Compartment();
    let modeCb: ((m: null | VimModeName) => void) | undefined;
    const attachGuard = vi.fn((_view: unknown, _cm: unknown, cb?: unknown) => {
      modeCb = cb as (m: null | VimModeName) => void;
      return f.guardDispose;
    });
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard,
      editableCompartment,
      loadModule: () => Promise.resolve(asModule(f.mod)),
    });
    controller.apply(true);
    await flush();

    modeCb!("normal");
    controller.dispose(); // unmount lands between the request and the flush
    const before = f.view.dispatch.mock.calls.length;
    await flush();
    // Dispatching into a view the component is tearing down would throw on a
    // destroyed CodeMirror instance.
    expect(f.view.dispatch.mock.calls.length).toBe(before);
  });

  it("apply after dispose is a no-op (does not even hit the loader)", () => {
    const f = makeFakes();
    const loadModule = vi.fn(() => Promise.resolve(asModule(f.mod)));
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule,
    });
    controller.dispose();
    controller.apply(true);
    expect(loadModule).not.toHaveBeenCalled();
  });

  // issue 475 — exitToNormal contract: bare-normal convergence, the C-o
  // spring (one Esc is NOT idempotent), best-effort failure policy, and the
  // same generation contract as the guards (no session after dispose).

  interface FakeVimState {
    inputState: { keyBuffer: string[]; operator: null | string };
    insertMode: boolean;
    insertModeReturn: boolean;
    visualMode: boolean;
  }

  function vimState(over: Partial<FakeVimState> = {}): FakeVimState {
    return {
      inputState: { keyBuffer: [], operator: null },
      insertMode: false,
      insertModeReturn: false,
      visualMode: false,
      ...over,
    };
  }

  async function enabledWithVim(
    state: FakeVimState,
    handleKey: (state: FakeVimState) => void,
    onOperationError?: (e: unknown) => void,
  ) {
    const f = makeFakes();
    const cm = { state: { vim: state } };
    const handleKeySpy = vi.fn(() => handleKey(state));
    const mod = {
      getCM: vi.fn(() => cm),
      vim: vi.fn(() => []),
      Vim: { handleKey: handleKeySpy },
    };
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule: () => Promise.resolve(asModule(mod)),
      onOperationError,
    });
    controller.apply(true);
    await flush();
    return { controller, handleKeySpy };
  }

  it("exitToNormal: bare normal is a no-op true — no Esc injected", async () => {
    const { controller, handleKeySpy } = await enabledWithVim(
      vimState(),
      () => {},
    );
    expect(controller.exitToNormal()).toBe(true);
    expect(handleKeySpy).not.toHaveBeenCalled();
  });

  it("exitToNormal: one Esc ends a plain insert session", async () => {
    const { controller, handleKeySpy } = await enabledWithVim(
      vimState({ insertMode: true }),
      (state) => {
        state.insertMode = false;
      },
    );
    expect(controller.exitToNormal()).toBe(true);
    expect(handleKeySpy).toHaveBeenCalledTimes(1);
    expect(handleKeySpy).toHaveBeenCalledWith(
      expect.anything(),
      "<Esc>",
      "user",
    );
  });

  it("exitToNormal: the C-o spring takes TWO Esc — first re-enters insert", async () => {
    // Real vim: Esc during insertModeReturn runs as the pending normal
    // command, and its vim-command-done fires the armed one-shot listener
    // that re-enters insert; the second Esc ends that insert for good.
    let presses = 0;
    const { controller, handleKeySpy } = await enabledWithVim(
      vimState({ insertModeReturn: true }),
      (state) => {
        presses += 1;
        if (presses === 1) {
          state.insertModeReturn = false;
          state.insertMode = true; // the one-shot listener fired
        } else {
          state.insertMode = false;
        }
      },
    );
    expect(controller.exitToNormal()).toBe(true);
    expect(handleKeySpy).toHaveBeenCalledTimes(2);
  });

  it("exitToNormal: a throw reports through onOperationError and returns false", async () => {
    // onError는 설치 실패 롤백 트리거다 — 일시적 handleKey throw가 그리로
    // 흐르면 정상 island의 editing host가 벗겨진다 (quality review M3).
    const boom = new Error("vim blew up");
    const onOperationError = vi.fn();
    const { controller } = await enabledWithVim(
      vimState({ insertMode: true }),
      () => {
        throw boom;
      },
      onOperationError,
    );
    expect(controller.exitToNormal()).toBe(false);
    expect(onOperationError).toHaveBeenCalledWith(boom);
  });

  it("exitToNormal: no-op true before attach and after dispose", async () => {
    const f = makeFakes();
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule: () => Promise.resolve(asModule(f.mod)),
    });
    expect(controller.exitToNormal()).toBe(true); // still loading — nothing
    controller.apply(true);
    await flush();
    controller.dispose();
    expect(controller.exitToNormal()).toBe(true); // session died with dispose
  });

  // issue 477 — ensureInsert contract: "ensure", not "send i". Replace and
  // visual end first (upstream maps lowercase i only in bare normal),
  // already-insert is idempotent, refusal reports, and the queued microtask
  // obeys the session generation.

  async function enabledWithVimKeys(
    state: FakeVimState & { overwrite?: boolean },
    onKey: (st: typeof state, key: string) => void,
    onOperationError?: (e: unknown) => void,
  ) {
    const f = makeFakes();
    const { overwrite, ...vim } = state;
    const cm = { state: { overwrite, vim } };
    const handleKeySpy = vi.fn((_cm: unknown, key: string) => {
      onKey(state, key);
      // 뮤테이터가 바꾼 값을 cm.state에 반영 (vim 객체는 공유 참조)
      Object.assign(vim, { ...state, overwrite: undefined });
      cm.state.overwrite = state.overwrite;
    });
    const mod = {
      getCM: vi.fn(() => cm),
      vim: vi.fn(() => []),
      Vim: { handleKey: handleKeySpy },
    };
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule: () => Promise.resolve(asModule(mod)),
      onOperationError,
    });
    controller.apply(true);
    await flush();
    return { controller, handleKeySpy };
  }

  const keysOf = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => c[1]);

  it("ensureInsert: bare normal sends exactly one i", async () => {
    const { controller, handleKeySpy } = await enabledWithVimKeys(
      vimState(),
      (st, key) => {
        if (key === "i") st.insertMode = true;
      },
    );
    expect(controller.ensureInsert()).toBe(true);
    await flush();
    expect(keysOf(handleKeySpy)).toEqual(["i"]);
  });

  it("ensureInsert: already plain insert is a no-op", async () => {
    const { controller, handleKeySpy } = await enabledWithVimKeys(
      vimState({ insertMode: true }),
      () => {},
    );
    expect(controller.ensureInsert()).toBe(true);
    await flush();
    expect(handleKeySpy).not.toHaveBeenCalled();
  });

  it("ensureInsert: a REPLACE session ends first, then plain insert", async () => {
    const { controller, handleKeySpy } = await enabledWithVimKeys(
      { ...vimState({ insertMode: true }), overwrite: true },
      (st, key) => {
        if (key === "<Esc>") {
          st.insertMode = false;
          st.overwrite = false;
        }
        if (key === "i") st.insertMode = true;
      },
    );
    expect(controller.ensureInsert()).toBe(true);
    await flush();
    expect(keysOf(handleKeySpy)).toEqual(["<Esc>", "i"]);
  });

  it("ensureInsert: a stale VISUAL session ends first", async () => {
    const { controller, handleKeySpy } = await enabledWithVimKeys(
      vimState({ visualMode: true }),
      (st, key) => {
        if (key === "<Esc>") st.visualMode = false;
        if (key === "i") st.insertMode = true;
      },
    );
    expect(controller.ensureInsert()).toBe(true);
    await flush();
    expect(keysOf(handleKeySpy)).toEqual(["<Esc>", "i"]);
  });

  it("ensureInsert: a refusal is SILENT — delivery confirmation is the publish", async () => {
    // 거부(readOnly 창)는 오류가 아니다: onError는 설치 실패 롤백 트리거라
    // 여기 흘리면 normal 모드에서 IME 장벽을 여는 잘못된 복구가 발화한다.
    // 재시도는 caller의 publish-주도 메모가 소유한다 (adversarial review).
    const onOperationError = vi.fn();
    const { controller, handleKeySpy } = await enabledWithVimKeys(
      vimState(),
      () => {}, // i가 무시됨 (readOnly 거부 시뮬레이션)
      onOperationError,
    );
    expect(controller.ensureInsert()).toBe(true);
    await flush();
    expect(handleKeySpy).toHaveBeenCalled();
    expect(onOperationError).not.toHaveBeenCalled();
  });

  it("ensureInsert: no session false; dispose before the microtask drops it", async () => {
    const { controller, handleKeySpy } = await enabledWithVimKeys(
      vimState(),
      (st, key) => {
        if (key === "i") st.insertMode = true;
      },
    );
    expect(controller.ensureInsert()).toBe(true);
    controller.dispose(); // 큐잉과 flush 사이에 세대가 죽음
    await flush();
    expect(handleKeySpy).not.toHaveBeenCalled();
    expect(controller.ensureInsert()).toBe(false); // 세션 소멸 후
  });
});
