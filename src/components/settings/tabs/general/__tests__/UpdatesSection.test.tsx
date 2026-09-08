// §206 The updates row carries ONE button, and its label is the state.
//
// It used to carry two: "Check Now", plus a second "Update to vX" that appeared
// whenever the store held an available update. The background check runs 15s
// after launch and then daily and only raises a toast, so by the time the user
// opened Settings the second button was already there — before they had pressed
// anything, which reads as a bug rather than as state. And it duplicated the
// first button, since pressing "Check Now" while an update exists opens the
// same dialog.
//
// ‼️ THE ASSERTION THAT CARRIES THIS IS THE BUTTON COUNT, not the label. A test
// that only checked "the available label is shown" passes just as happily with
// the old two-button row, because that row showed the label too. Counting is
// what tells the two designs apart.
//
// This file is also the first test of any kind for UpdatesSection, so it pins
// the plain behaviours underneath as well — the check is dispatched, the
// disabled state during a check, and the return to "Check Now" afterwards.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.7.1"),
}));

const checkForAppUpdateMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
vi.mock("../../../../../services/app-update", () => ({
  checkForAppUpdate: checkForAppUpdateMock,
}));

import { type Locale, t } from "../../../../../i18n";
import { useSettingsStore } from "../../../../../stores/settings/store";
import { useAppUpdateStore } from "../../../../../stores/system/app-update";
import { UpdatesSection } from "../UpdatesSection";

const RESET = {
  availableVersion: null,
  dialogOpen: false,
  error: null,
  fallbackOpened: false,
  lastCheckedAt: null,
  notes: null,
  progress: null,
  status: "idle" as const,
};

beforeEach(() => {
  checkForAppUpdateMock.mockClear();
  useAppUpdateStore.setState(RESET);
});

afterEach(() => {
  useAppUpdateStore.setState(RESET);
});

/**
 * The catalog's own value for a key, in whatever locale the app is set to.
 *
 * Derived rather than written out, so the test cannot drift from the catalog
 * and cannot quietly depend on the default locale being English.
 */
function label(key: string, version?: string): string {
  const value = t(key, useSettingsStore.getState().locale as Locale);
  return version === undefined ? value : value.replace("{version}", version);
}

/** Every button in the action row — the count is the point. */
function actionButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => b.classList.contains("settings-key-toggle"),
  );
}

describe("§206 업데이트 행의 단일 버튼", () => {
  it("업데이트가 없으면 버튼 하나로 '지금 확인'을 보여 준다", () => {
    const { container } = render(<UpdatesSection />);
    const buttons = actionButtons(container);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe(
      label("settings.general.updates.checkNow"),
    );
  });

  it("업데이트가 있어도 버튼은 여전히 하나다", () => {
    // The regression this file exists for. With the old row this is 2.
    useAppUpdateStore.setState({
      availableVersion: "0.7.2",
      status: "available",
    });
    const { container } = render(<UpdatesSection />);
    expect(actionButtons(container)).toHaveLength(1);
  });

  it("업데이트가 있으면 그 버튼이 버전을 이름으로 단다", () => {
    useAppUpdateStore.setState({
      availableVersion: "0.7.2",
      status: "available",
    });
    const { container } = render(<UpdatesSection />);
    expect(actionButtons(container)[0].textContent).toBe(
      label("settings.general.updates.available", "0.7.2"),
    );
  });

  it("업데이트가 있을 때 누르면 다시 확인하지 않고 대화상자를 연다", () => {
    // Re-checking here would spend a network round trip to learn what the
    // store already knows, and the dialog is the next step either way.
    useAppUpdateStore.setState({
      availableVersion: "0.7.2",
      status: "available",
    });
    const { container } = render(<UpdatesSection />);
    fireEvent.click(actionButtons(container)[0]);
    expect(useAppUpdateStore.getState().dialogOpen).toBe(true);
    expect(checkForAppUpdateMock).not.toHaveBeenCalled();
  });

  it("업데이트가 없을 때 누르면 수동 확인을 돌린다", () => {
    const { container } = render(<UpdatesSection />);
    fireEvent.click(actionButtons(container)[0]);
    // `true` is the manual flag — it is what makes a found update open the
    // dialog instead of only toasting.
    expect(checkForAppUpdateMock).toHaveBeenCalledWith(true);
    expect(useAppUpdateStore.getState().dialogOpen).toBe(false);
  });

  it("확인 중에는 비활성이고 '확인 중'을 보여 준다", () => {
    useAppUpdateStore.setState({ status: "checking" });
    const { container } = render(<UpdatesSection />);
    const [button] = actionButtons(container);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(label("settings.general.updates.checking"));
  });

  it("최신이라는 답을 받으면 '지금 확인'으로 돌아온다", () => {
    // A merged button whose label depends on status must not get stuck in the
    // last state it was given.
    useAppUpdateStore.setState({ status: "upToDate" });
    const { container } = render(<UpdatesSection />);
    const [button] = actionButtons(container);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe(label("settings.general.updates.checkNow"));
  });

  it("버전 문자열이 없으면 업데이트 상태로 취급하지 않는다", () => {
    // `available` without a version would render "Update to v" and, worse,
    // swallow the click into a dialog that cannot say what it installs.
    useAppUpdateStore.setState({ availableVersion: null, status: "available" });
    const { container } = render(<UpdatesSection />);
    const [button] = actionButtons(container);
    expect(button.textContent).toBe(label("settings.general.updates.checkNow"));
    fireEvent.click(button);
    expect(checkForAppUpdateMock).toHaveBeenCalledWith(true);
  });

  it("현재 버전을 보여 준다", async () => {
    // `getVersion()` is a promise, so the row is blank on the first render and
    // fills in on the effect's resolution — `findByText` is what waits for it.
    render(<UpdatesSection />);
    expect(await screen.findByText("v0.7.1")).toBeTruthy();
  });
});
