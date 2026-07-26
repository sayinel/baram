// §298 Phase 0a S2 — vim controller lifecycle tests.
//
// Codex S2 gate: a guard-level disposer test is not evidence that the caller
// actually calls it. These tests pin the CALLER contract with fakes: attach
// on enable, dispose on toggle-off, stale-load dropping across on/off/on,
// and unmount-before-resolve silence.

import type { VimControllerDeps } from "../vim-controller";
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

  it("unmount after attach: dispose detaches the guard", async () => {
    const f = makeFakes();
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule: () => Promise.resolve(asModule(f.mod)),
    });
    controller.apply(true);
    await flush();
    controller.dispose();
    expect(f.guardDispose).toHaveBeenCalledTimes(1);
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

  it("getCM null (plugin creation failed): runs without a guard, no crash", async () => {
    const f = makeFakes();
    const mod = { getCM: vi.fn(() => null), vim: vi.fn(() => []) };
    const controller = createVimController(asView(f.view), f.compartment, {
      attachGuard: f.attachGuard,
      loadModule: () => Promise.resolve(asModule(mod)),
    });
    controller.apply(true);
    await flush();
    expect(f.view.dispatch).toHaveBeenCalledTimes(1);
    expect(f.attachGuard).not.toHaveBeenCalled();
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
});
