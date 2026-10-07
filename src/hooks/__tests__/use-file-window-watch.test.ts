// §3.2 issue 797 — a standalone file window asks for its folder's watch only after its
// file context is registered: before then Rust refuses it, and the refusal used to be
// swallowed, leaving the window blind to another program's edits.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const released: string[] = [];
const want = vi.fn((path: string, _options: unknown) => ({
  release: () => released.push(path),
}));
vi.mock("../../services/watch-leases", () => ({
  want: (path: string, options: unknown) => want(path, options),
}));

import { useFileWindowWatch } from "../use-file-window-watch";

function deferred(): {
  promise: Promise<unknown>;
  reject: (e: unknown) => void;
  resolve: () => void;
} {
  let resolve: () => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<unknown>((res, rej) => {
    resolve = () => res(undefined);
    reject = rej;
  });
  return { promise, reject, resolve };
}

beforeEach(() => {
  want.mockClear();
  released.length = 0;
});

describe("useFileWindowWatch", () => {
  // 이것을 실패시키는 것: 등록을 기다리지 않고 바로 `want` 를 부른다.
  it("asks for the folder only once the file context is registered", async () => {
    const registration = deferred();
    const registered = () => registration.promise;
    const hook = renderHook(() => useFileWindowWatch("/out/x.md", registered));
    await act(async () => {});
    expect(want).not.toHaveBeenCalled();
    await act(async () => registration.resolve());
    expect(want).toHaveBeenCalledTimes(1);
    expect(want).toHaveBeenCalledWith("/out", {
      focus: "/out/x.md",
      recursive: false,
    });
    hook.unmount();
    expect(released).toEqual(["/out"]);
  });

  // 이것을 실패시키는 것: 등록이 끝나기 전에 닫힌 창이 그 뒤에 watch 를 건다.
  it("asks for nothing when the window closed first, or the registration failed", async () => {
    const late = deferred();
    const hook = renderHook(() =>
      useFileWindowWatch("/out/x.md", () => late.promise),
    );
    hook.unmount();
    await act(async () => late.resolve());
    const failed = deferred();
    renderHook(() => useFileWindowWatch("/out/y.md", () => failed.promise));
    await act(async () => failed.reject(new Error("denied")));
    expect(want).not.toHaveBeenCalled();
  });
});
