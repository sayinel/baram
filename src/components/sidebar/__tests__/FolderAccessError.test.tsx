import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openUrlMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

Object.defineProperty(navigator, "userAgent", {
  value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  configurable: true,
});

import { FolderAccessError } from "../FolderAccessError";

describe("FolderAccessError", () => {
  beforeEach(() => openUrlMock.mockReset());

  it("renders the title and calls onRetry when retry is clicked", () => {
    const onRetry = vi.fn();
    render(
      <FolderAccessError
        loadError={{ kind: "permission-denied", path: "/x" }}
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByRole("button", { name: /다시 시도|Retry/i }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /다시 시도|Retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("opens Full Disk Access settings via openUrl", () => {
    render(
      <FolderAccessError
        loadError={{ kind: "permission-denied", path: "/x" }}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /전체 디스크 접근|Full Disk Access/i,
      }),
    );
    expect(openUrlMock).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    );
  });

  it("renders the generic body and no deep-link buttons for a generic error", () => {
    render(
      <FolderAccessError
        loadError={{ kind: "generic", path: "/x", message: "disk exploded" }}
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", {
        name: /전체 디스크 접근|Full Disk Access/i,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /파일 및 폴더|Files & Folders/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /다시 시도|Retry/i }),
    ).toBeTruthy();
  });

  it("hides the macOS deep-link buttons on a non-macOS platform", () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (X11; Linux x86_64)",
      configurable: true,
    });
    try {
      render(
        <FolderAccessError
          loadError={{ kind: "permission-denied", path: "/x" }}
          onRetry={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", {
          name: /전체 디스크 접근|Full Disk Access/i,
        }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: /다시 시도|Retry/i }),
      ).toBeTruthy();
    } finally {
      Object.defineProperty(navigator, "userAgent", {
        value: original,
        configurable: true,
      });
    }
  });
});
