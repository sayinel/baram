// §395 spec 0074 D10 · D12 — the journal migration is a rename to plugins: one `file:rename` per migrated
// entry once its old file is gone, the journal's `vault:changed` held until then, and nothing told for an
// entry that failed — its decoration stays where it was (§7 "IPC 가 던지면 알림 0번 · store 그대로").
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  createDir: vi.fn(async () => undefined),
  deleteFile: vi.fn(),
  listDir: vi.fn(async () => []),
  readFile: vi.fn(async () => "body"),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  ...ipc,
}));
vi.mock("../../../utils/journal/journal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/journal/journal")>()),
  buildMigrationPlan: () => [
    { from: "/j/2026-10-01.md", to: "/j/daily/2026/10/2026-10-01.md" },
    { from: "/j/2026-10-02.md", to: "/j/daily/2026/10/2026-10-02.md" },
  ],
  detectFlatJournalFiles: () => [],
}));

import { recordNotices } from "../../../plugins/file-decorations/__tests__/notice-recorder";
import {
  __resetFileDecorations,
  applyDecorations,
  useFileDecorationStore,
} from "../../../plugins/file-decorations/file-decoration-store";
import {
  __resetVaultChangeHolds,
  publishVaultChange,
} from "../../../services/vault-changes";
import { useContextStore } from "../../../stores/context/context";
import { MigrationDialog } from "../MigrationDialog";

let recorder: ReturnType<typeof recordNotices>;

beforeEach(() => {
  useContextStore.setState({
    contexts: [{ contextType: "vault", id: "ctx-j", path: "/j" }] as never,
  });
  recorder = recordNotices();
});
afterEach(() => {
  recorder.stop();
  __resetFileDecorations();
  __resetVaultChangeHolds();
});

describe("journal migration notices (§395)", () => {
  it("tells file:rename per migrated entry after its old file is gone", async () => {
    applyDecorations("p", "P", [
      { decoration: { badge: "1" }, where: { absolute: "/j/2026-10-01.md" } },
      { decoration: { badge: "2" }, where: { absolute: "/j/2026-10-02.md" } },
    ]);
    ipc.deleteFile
      .mockImplementationOnce(async () => {
        publishVaultChange("ctx-j");
      })
      .mockImplementationOnce(async () => {
        publishVaultChange("ctx-j");
        throw new Error("locked");
      });
    const { container } = render(
      <MigrationDialog
        direction="toHierarchy"
        journalDir="/j"
        onClose={vi.fn()}
        open
      />,
    );
    const migrate = await waitFor(() => {
      const button = container.querySelector(
        ".migration-dialog-btn-primary",
      ) as HTMLButtonElement | null;
      expect(button?.disabled).toBe(false);
      return button!;
    });
    fireEvent.click(migrate);
    await waitFor(() => expect(recorder.events).toHaveLength(3));
    expect(recorder.events).toEqual([
      "rename /j/2026-10-01.md → /j/daily/2026/10/2026-10-01.md",
      "vault ctx-j",
      "vault ctx-j",
    ]);
    const { merged } = useFileDecorationStore.getState();
    expect(merged.get("/j/daily/2026/10/2026-10-01.md")?.badges[0]?.text).toBe(
      "1",
    );
    // The entry whose deleteFile threw: told nothing, its decoration where it was.
    expect(merged.get("/j/2026-10-02.md")?.badges[0]?.text).toBe("2");
    expect(merged.has("/j/daily/2026/10/2026-10-02.md")).toBe(false);
  });
});
