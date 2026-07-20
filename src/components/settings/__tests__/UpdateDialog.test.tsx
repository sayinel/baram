import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.3.0"),
}));

const installAppUpdateMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
vi.mock("../../../services/app-update", () => ({
  installAppUpdate: installAppUpdateMock,
}));

import { useAppUpdateStore } from "../../../stores/system/app-update";
import { UpdateDialog } from "../UpdateDialog";

const RESET = {
  status: "idle" as const,
  availableVersion: null,
  notes: null,
  progress: null,
  lastCheckedAt: null,
  error: null,
  dialogOpen: false,
  fallbackOpened: false,
};

beforeEach(() => {
  installAppUpdateMock.mockClear();
  useAppUpdateStore.setState(RESET);
});

afterEach(() => {
  useAppUpdateStore.setState(RESET);
});

describe("UpdateDialog — §206-review FIX 1: busy close-guard", () => {
  it("Escape does NOT close the dialog while downloading", () => {
    useAppUpdateStore.setState({
      dialogOpen: true,
      status: "downloading",
      availableVersion: "0.4.0",
    });
    render(<UpdateDialog />);
    expect(screen.getByText("Update Available")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(useAppUpdateStore.getState().dialogOpen).toBe(true);
    expect(screen.getByText("Update Available")).toBeTruthy();
  });

  it("Escape does NOT close the dialog while installing", () => {
    useAppUpdateStore.setState({
      dialogOpen: true,
      status: "installing",
      availableVersion: "0.4.0",
    });
    render(<UpdateDialog />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(useAppUpdateStore.getState().dialogOpen).toBe(true);
  });

  it("Escape DOES close the dialog when idle/available/error", () => {
    useAppUpdateStore.setState({
      dialogOpen: true,
      status: "available",
      availableVersion: "0.4.0",
    });
    render(<UpdateDialog />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(useAppUpdateStore.getState().dialogOpen).toBe(false);
  });

  it("overlay click does NOT close the dialog while downloading", () => {
    useAppUpdateStore.setState({
      dialogOpen: true,
      status: "downloading",
      availableVersion: "0.4.0",
    });
    const { container } = render(<UpdateDialog />);
    const overlay = container.querySelector(".update-dialog-overlay");
    expect(overlay).toBeTruthy();

    fireEvent.click(overlay!);

    expect(useAppUpdateStore.getState().dialogOpen).toBe(true);
  });

  it("overlay click DOES close the dialog when not busy", () => {
    useAppUpdateStore.setState({
      dialogOpen: true,
      status: "available",
      availableVersion: "0.4.0",
    });
    const { container } = render(<UpdateDialog />);
    const overlay = container.querySelector(".update-dialog-overlay");

    fireEvent.click(overlay!);

    expect(useAppUpdateStore.getState().dialogOpen).toBe(false);
  });

  it("the Cancel button stays disabled while busy (belt-and-suspenders)", () => {
    useAppUpdateStore.setState({
      dialogOpen: true,
      status: "installing",
      availableVersion: "0.4.0",
    });
    render(<UpdateDialog />);
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  });
});

describe("UpdateDialog — §206-review FIX 2: error state", () => {
  it("renders the fallback-opened message when the install error had a fallback", () => {
    useAppUpdateStore.setState({
      dialogOpen: true,
      status: "error",
      availableVersion: "0.4.0",
      error: "unsupported package format",
      fallbackOpened: true,
    });
    render(<UpdateDialog />);

    expect(screen.getByText("Update Failed")).toBeTruthy();
    expect(
      screen.getByText(/opened the releases page in your browser/i),
    ).toBeTruthy();
    expect(screen.queryByText(/unsupported package format/)).toBeNull();
  });

  it("renders a generic error message with the raw error when there was no fallback", () => {
    useAppUpdateStore.setState({
      dialogOpen: true,
      status: "error",
      availableVersion: "0.4.0",
      error: "network timed out",
      fallbackOpened: false,
    });
    render(<UpdateDialog />);

    expect(screen.getByText("Update Failed")).toBeTruthy();
    expect(
      screen.getByText(/The update failed: network timed out/),
    ).toBeTruthy();
  });
});
