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
});
