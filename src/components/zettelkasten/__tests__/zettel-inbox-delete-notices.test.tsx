// §395 spec 0074 D10 · D12 — deleting from the zettel inbox tells `file:delete` once the file is in the
// trash, raised after the confirmation.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ deleteFile: vi.fn() }));

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  ...ipc,
}));
vi.mock("../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn(async () => undefined),
  showConfirm: vi.fn(async () => true),
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
import { useSettingsStore } from "../../../stores/settings/store";
import { ZettelInboxList } from "../ZettelInboxList";

let recorder: ReturnType<typeof recordNotices>;

beforeEach(() => {
  // The labels below are en.json's `zettel.hub.delete.aria` — pin the catalog.
  useSettingsStore.setState({ locale: "en" });
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

function list(onRefresh: () => Promise<void> = async () => undefined): void {
  render(
    <ZettelInboxList
      collapsed={false}
      items={[{ id: "1", path: "/z/inbox/1.md", tags: [], title: "T" }]}
      loading={false}
      onRefresh={onRefresh}
      onToggleCollapse={vi.fn()}
      zettelDir="/z"
    />,
  );
}

describe("zettel inbox delete notices (§395)", () => {
  it("tells file:delete after the IPC, before the held echo", async () => {
    ipc.deleteFile.mockImplementation(async () => {
      publishVaultChange("ctx-z");
    });
    list();
    fireEvent.click(screen.getByLabelText("Delete “T”"));
    await waitFor(() =>
      expect(recorder.events).toEqual(["delete /z/inbox/1.md", "vault ctx-z"]),
    );
  });

  /**
   * D12 — the gate covers the delete, not the hub refresh after it: by the time the refresh starts, the
   * held `vault:changed` is out. What fails this: releasing in a `finally` that runs after
   * `await onRefresh()`.
   */
  it("lets the held vault:changed out before the hub refresh starts", async () => {
    ipc.deleteFile.mockImplementation(async () => {
      publishVaultChange("ctx-z");
    });
    let endRefresh: () => void = () => undefined;
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          endRefresh = resolve;
        }),
    );
    list(onRefresh);
    fireEvent.click(screen.getByLabelText("Delete “T”"));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(recorder.events).toEqual(["delete /z/inbox/1.md", "vault ctx-z"]);
    endRefresh();
  });

  /** §7 "IPC 가 던지면 알림 0번 · store 그대로" — the pair of the first row. */
  it("tells nothing and keeps the decoration when the IPC fails", async () => {
    applyDecorations("p", "P", [
      { decoration: { badge: "1" }, where: { absolute: "/z/inbox/1.md" } },
    ]);
    ipc.deleteFile.mockImplementation(async () => {
      publishVaultChange("ctx-z");
      throw new Error("trash failed");
    });
    list();
    fireEvent.click(screen.getByLabelText("Delete “T”"));
    await waitFor(() => expect(recorder.events).toEqual(["vault ctx-z"]));
    expect(
      useFileDecorationStore.getState().merged.get("/z/inbox/1.md")?.badges[0]
        ?.text,
    ).toBe("1");
  });
});
