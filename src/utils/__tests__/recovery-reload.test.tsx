// §44 오류 화면의 Reload 는 저장 도우미가 실패해도 창을 다시 불러온다 (#800).
//
// 이 버튼은 고장 난 앱에서 빠져나가는 길이라, 저장 쪽이 고장 난 원인이어도 막혀서는 안 된다.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reloadWindow = vi.hoisted(() => vi.fn());

vi.mock("../../services/app-exit", () => ({ reloadWindow }));

import { ErrorBoundary } from "../../components/ErrorBoundary";
import { reloadFromErrorScreen } from "../recovery-reload";

const originalLocation = window.location;
const reload = vi.fn();

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  reload.mockClear();
  reloadWindow.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

// 이것을 실패시키는 것: recovery-reload.ts 의 catch 에서 `window.location.reload()` 를 지우면 저장이 실패한
// 오류 화면에서 다시 불러올 길이 없다.
describe("§44 the error screens' Reload (#800)", () => {
  it("reloads anyway when the save-and-reload helper fails", async () => {
    reloadWindow.mockRejectedValue(new Error("the store is what broke"));
    await reloadFromErrorScreen();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves the reload to the helper when it works", async () => {
    // 긍정 짝 — 도우미가 성공하면 직접 다시 불러오지 않는다(두 번 불러오지 않는다).
    reloadWindow.mockResolvedValue(undefined);
    await reloadFromErrorScreen();
    expect(reloadWindow).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("the error screen's button goes through it", async () => {
    reloadWindow.mockRejectedValue(new Error("broken"));
    function Boom(): never {
      throw new Error("boom");
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Reload"));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
