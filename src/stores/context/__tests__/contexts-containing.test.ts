// §395 spec 0074 D12 — every registered vault or folder context holding a path: nested contexts both, a
// file context never, the root itself included, a sibling sharing the root's prefix not.
import type { ContextInfo } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { contextsContaining } from "../contexts-containing";

const CONTEXTS = [
  { contextType: "vault", id: "v", path: "/v" },
  { contextType: "folder", id: "sub", path: "/v/sub/" },
  { contextType: "file", id: "f", path: "/v/sub/a.md" },
  { contextType: "vault", id: "v2", path: "/v2" },
  { contextType: "vault", id: "win", path: "C:\\w" },
] as ContextInfo[];

const ids = (path: string) =>
  contextsContaining(path, CONTEXTS).map((context) => context.id);

describe("contextsContaining (D12)", () => {
  /** What fails this: `getContextForPath`'s one answer (only `sub`), or a file context counted. */
  it("finds both nested contexts and leaves the file context out", () => {
    expect(ids("/v/sub/a.md")).toEqual(["v", "sub"]);
  });

  it("finds a context by its root, and not a sibling that shares its prefix", () => {
    expect(ids("/v")).toEqual(["v"]);
    expect(ids("/v2/a.md")).toEqual(["v2"]);
  });

  it("takes either separator at the boundary", () => {
    expect(ids("C:\\w\\a.md")).toEqual(["win"]);
  });
});
