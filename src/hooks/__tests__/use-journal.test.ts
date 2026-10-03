// §56/§81 `useJournal` creates today's entry when a workspace opens — and only
// creates it. Opening it ("Open today's journal") moved into the journal space's
// startup, which the launch restore runs in order, behind the restored tab: opened
// from this effect it raced the restore and took the active tab.
//
// It also waits for the launch restore: before it, Rust holds no context and
// refuses the read and the write. The order against the journal startup, end to
// end, is in `use-app-startup-restore.test.tsx`.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureJournalFile = vi.hoisted(() =>
  vi.fn(async () => ({ content: "# today", path: "/journal/today.md" })),
);
vi.mock("../../services/journal-file-service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/journal-file-service")
  >()),
  ensureJournalFile,
}));
/** The launch restore; a test settles it when it chooses. */
const restore = vi.hoisted(() => {
  const gate = { settle: () => {}, settled: Promise.resolve() };
  return {
    gate,
    reset() {
      gate.settled = new Promise<void>((resolve) => {
        gate.settle = resolve;
      });
    },
  };
});
vi.mock("../use-app-startup", () => ({
  launchRestoreSettled: () => restore.gate.settled,
}));

import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useJournal } from "../use-journal";

beforeEach(() => {
  ensureJournalFile.mockClear();
  restore.reset();
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
  useContextStore.setState({
    activeContextId: "f",
    contexts: [
      {
        addedAt: 0,
        color: "#fff",
        contextType: "folder",
        id: "f",
        label: "work",
        path: "/work",
      },
      {
        addedAt: 0,
        color: "#fff",
        contextType: "vault",
        id: "j",
        label: "journal",
        path: "/journal",
        vaultType: "journal",
      },
    ],
  });
  useSettingsStore.setState({
    journalDirectory: "/journal",
    journalEnabled: true,
    journalStartupBehavior: "openJournal",
  });
  useFileStore.setState({ rootPath: "/work" });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("§81 useJournal", () => {
  it("creates nothing until the launch restore has settled", async () => {
    renderHook(() => useJournal());
    await flush();
    await flush();
    expect(ensureJournalFile).not.toHaveBeenCalled();

    restore.gate.settle();

    await waitFor(() => expect(ensureJournalFile).toHaveBeenCalledTimes(1));
  });

  it("reads the journal settings after the wait, when they have hydrated", async () => {
    useSettingsStore.setState({ journalDirectory: "" });
    renderHook(() => useJournal());
    // The settings land while the restore is still running.
    useSettingsStore.setState({ journalDirectory: "/journal" });

    restore.gate.settle();

    await waitFor(() =>
      expect(ensureJournalFile).toHaveBeenCalledWith(
        expect.any(Date),
        expect.objectContaining({ journalDirectory: "/journal" }),
      ),
    );
  });

  it("creates today's entry once per journal directory, and opens nothing", async () => {
    restore.gate.settle();
    const { rerender } = renderHook(() => useJournal());

    await waitFor(() => expect(ensureJournalFile).toHaveBeenCalledTimes(1));
    expect(ensureJournalFile).toHaveBeenCalledWith(
      expect.any(Date),
      expect.objectContaining({ journalDirectory: "/journal" }),
    );

    // Another workspace, same journal directory: not again.
    useFileStore.setState({ rootPath: "/other" });
    rerender();
    // The directory setting moved: the new directory gets its entry.
    useSettingsStore.setState({ journalDirectory: "/journal2" });
    useFileStore.setState({ rootPath: "/third" });
    rerender();
    await waitFor(() => expect(ensureJournalFile).toHaveBeenCalledTimes(2));

    // Even with "Open today's journal" on, the tab is the startup's to open.
    await flush();
    expect(useEditorStore.getState().tabs).toEqual([]);
  });
});
