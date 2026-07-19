import type { SnapshotEntry } from "../../../ipc/types";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSnapshotStore } from "../../../stores/editor/snapshot";
import { useFileStore } from "../../../stores/file/file";
import { FileHistoryView } from "../FileHistoryView";

const entry = (id: string, ts: string, cksum: string): SnapshotEntry =>
  ({
    id,
    timestamp: ts,
    type: "auto",
    label: null,
    totalSizeBytes: 0,
    files: [{ path: "notes/a.md", checksum: cksum, sizeBytes: 1 }],
  }) as unknown as SnapshotEntry;

beforeEach(() => {
  useFileStore.setState({ rootPath: "/vault" });
  useSnapshotStore.setState({
    fileHistoryPath: "notes/a.md",
    fileHistory: [
      entry("s1", "2026-01-01T00-00-00", "A"),
      entry("s2", "2026-01-02T00-00-00", "B"),
    ],
    activeDiff: null,
    loading: false,
  });
});

describe("FileHistoryView", () => {
  it("shows the file name and its distinct versions", () => {
    render(<FileHistoryView />);
    expect(screen.getByText(/a\.md/)).toBeInTheDocument();
    // two distinct checksums → two version rows
    expect(document.querySelectorAll(".file-history-version").length).toBe(2);
  });

  it("returns to vault mode via the back control", () => {
    render(<FileHistoryView />);
    fireEvent.click(screen.getByRole("button", { name: /all snapshots/i }));
    expect(useSnapshotStore.getState().fileHistoryPath).toBeNull();
  });
});
