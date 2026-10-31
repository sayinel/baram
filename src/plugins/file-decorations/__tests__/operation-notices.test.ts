// §395 spec 0074 D10 · D12 · P14 — a notice moves or drops decorations first, then tells listeners; the
// gate holds every context holding a touched path, so the held `vault:changed` follows the notice.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetVaultChangeHolds,
  publishVaultChange,
} from "../../../services/vault-changes";
import { useContextStore } from "../../../stores/context/context";
import { logger } from "../../../utils/logger";
import {
  __resetFileDecorations,
  applyDecorations,
  useFileDecorationStore,
} from "../file-decoration-store";
import {
  beginFileOperation,
  notifyDeleted,
  notifyRenamed,
  onFileNotice,
} from "../operation-notices";
import { recordNotices } from "./notice-recorder";

const badgeAt = (path: string) =>
  useFileDecorationStore.getState().merged.get(path)?.badges[0]?.text;

beforeEach(() => {
  useContextStore.setState({
    contexts: [
      { contextType: "vault", id: "ctx-v", path: "/v" },
      { contextType: "vault", id: "ctx-sub", path: "/v/sub" },
      { contextType: "file", id: "ctx-f", path: "/v/sub/a.md" },
      { contextType: "vault", id: "ctx-w", path: "/w" },
    ] as never,
  });
});
afterEach(() => {
  __resetFileDecorations();
  __resetVaultChangeHolds();
});

describe("operation notices (D10 · D12)", () => {
  /** P14 — the store moved before a listener runs. What fails this: telling first (a listener reading
   *  the store would see the old key). */
  it("moves the decoration before telling, and tells once", () => {
    applyDecorations("p", "P", [
      { decoration: { badge: "1" }, where: { absolute: "/v/a.md" } },
    ]);
    const seen: Array<string | undefined> = [];
    const stop = onFileNotice(() => seen.push(badgeAt("/v/b.md")));
    notifyRenamed("/v/a.md", "/v/b.md", false);
    expect(seen).toEqual(["1"]);
    stop();
  });

  /** §7 — held during the operation, out after the notice; both nested contexts held. What fails this:
   *  only the innermost context held (the parent's change would come first). */
  it("holds every context holding the paths, and lets the change follow the notice", () => {
    const recorder = recordNotices();
    const release = beginFileOperation(["/v/sub/a.md", "/v/sub/b.md"]);
    publishVaultChange("ctx-v");
    publishVaultChange("ctx-sub");
    publishVaultChange("ctx-w");
    notifyRenamed("/v/sub/a.md", "/v/sub/b.md", false);
    release();
    expect(recorder.events).toEqual([
      "vault ctx-w",
      "rename /v/sub/a.md → /v/sub/b.md",
      "vault ctx-v",
      "vault ctx-sub",
    ]);
    recorder.stop();
  });

  it("drops a deleted folder's decorations and tells", () => {
    applyDecorations("p", "P", [
      { decoration: { badge: "1" }, where: { absolute: "/v/d/x.md" } },
    ]);
    expect(badgeAt("/v/d/x.md")).toBe("1");
    const recorder = recordNotices();
    notifyDeleted("/v/d", true);
    expect(badgeAt("/v/d/x.md")).toBeUndefined();
    expect(recorder.events).toEqual(["delete /v/d dir"]);
    recorder.stop();
  });

  it("keeps a throwing listener from stopping the others", () => {
    const heard = vi.fn();
    const stopThrowing = onFileNotice(() => {
      throw new Error("plugin gone");
    });
    const stop = onFileNotice(heard);
    const errors = vi.spyOn(logger, "error").mockImplementation(() => {});
    expect(() => notifyDeleted("/v/a.md", false)).not.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
    stopThrowing();
    stop();
  });
});
