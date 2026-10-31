// §395 spec 0074 D10 · D12 — promoting a fleeting note is a rename to plugins, told once the inbox file is
// gone; the gate is raised before the first IPC that writes (`createDir`) and released when that IPC
// fails.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  createDir: vi.fn(),
  deleteFile: vi.fn(),
  listDir: vi.fn(async () => []),
  readFile: vi.fn(async () => "---\ncreated: 2026-10-30T09:00\n---\nbody\n"),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  ...ipc,
}));
vi.mock("../journal-file-service", () => ({
  openFileInTab: vi.fn(async () => undefined),
}));

import { recordNotices } from "../../plugins/file-decorations/__tests__/notice-recorder";
import {
  __resetFileDecorations,
  applyDecorations,
  useFileDecorationStore,
} from "../../plugins/file-decorations/file-decoration-store";
import { useContextStore } from "../../stores/context/context";
import { __resetVaultChangeHolds, publishVaultChange } from "../vault-changes";
import { promoteFleeting } from "../zettelkasten-service";

let recorder: ReturnType<typeof recordNotices>;

beforeEach(() => {
  ipc.createDir.mockReset();
  ipc.deleteFile.mockReset();
  useContextStore.setState({
    contexts: [{ contextType: "vault", id: "ctx-z", path: "/z" }] as never,
  });
  recorder = recordNotices();
});
afterEach(() => {
  recorder.stop();
  __resetFileDecorations();
  __resetVaultChangeHolds();
});

describe("zettel promotion notices (§395)", () => {
  it("tells file:rename once the inbox file is gone, and lets the echo follow", async () => {
    ipc.createDir.mockImplementation(async () => {
      publishVaultChange("ctx-z");
    });
    ipc.deleteFile.mockResolvedValue(undefined);
    await promoteFleeting("/z", "/z/inbox/202610300900.md", "Title");
    expect(recorder.events).toEqual([
      "rename /z/inbox/202610300900.md → /z/notes/202610300900 Title.md",
      "vault ctx-z",
    ]);
  });

  /** The gate comes down when the first writing IPC throws: a later change is not held. §7 "store 그대로":
   *  the inbox note keeps its decoration. */
  it("tells nothing, keeps the decoration and releases the gate when createDir fails", async () => {
    applyDecorations("p", "P", [
      {
        decoration: { badge: "1" },
        where: { absolute: "/z/inbox/202610300900.md" },
      },
    ]);
    ipc.createDir.mockRejectedValue(new Error("read-only"));
    await expect(
      promoteFleeting("/z", "/z/inbox/202610300900.md", "Title"),
    ).rejects.toThrow("read-only");
    publishVaultChange("ctx-z");
    expect(recorder.events).toEqual(["vault ctx-z"]);
    expect(
      useFileDecorationStore.getState().merged.get("/z/inbox/202610300900.md")
        ?.badges[0]?.text,
    ).toBe("1");
  });
});
