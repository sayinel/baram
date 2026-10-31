// §395 spec 0074 D7 · plan 0127 P8 — `absoluteInContext` is the inverse of `locateInContext`: a sandboxed
// plugin names a path the way it was told one, and the host finds the absolute path — the one the tree's
// row is keyed by — again.
import { beforeEach, describe, expect, it } from "vitest";

import { useContextStore } from "../../stores/context/context";
import { decorationKey } from "../file-decorations/file-decoration-store";
import { absoluteInContext, locateInContext } from "../locate-in-context";

beforeEach(() => {
  useContextStore.setState({
    contexts: [
      { contextType: "vault", id: "ctx-a", path: "/vaults/a" },
      { contextType: "vault", id: "ctx-b", path: "/vaults/a/nested" },
      { contextType: "folder", id: "ctx-t", path: "/tmp/notes//" },
      { contextType: "file", id: "ctx-f", path: "/elsewhere/single.md" },
      { contextType: "vault", id: "ctx-w", path: "C:\\v" },
    ] as never,
  });
});

describe("absoluteInContext (D7)", () => {
  /** What fails this: a join that loses or doubles the separator, ignores `contextRootOf`'s trailing
   *  separators, or treats `""` as a name. */
  it.each([
    "/vaults/a/x.md",
    "/vaults/a/sub/y.md",
    "/vaults/a/nested/z.md",
    "/vaults/a/nested",
    "/tmp/notes/k.md",
    "/elsewhere/single.md",
  ])("round-trips %s through locateInContext", (absolute) => {
    const located = locateInContext(absolute)!;
    expect(absoluteInContext(located.context, located.path)).toBe(absolute);
  });

  /** A Windows root keeps its backslashes and the relative part its slashes; the key is the same. */
  it("round-trips a Windows path to the same key", () => {
    const located = locateInContext("C:\\v\\n\\a.md")!;
    const absolute = absoluteInContext(located.context, located.path)!;
    expect(decorationKey(absolute)).toBe(decorationKey("C:\\v\\n\\a.md"));
  });

  it("names a vault's root with an empty path, and a file context's file only with an empty path", () => {
    expect(absoluteInContext("ctx-a", "")).toBe("/vaults/a");
    expect(absoluteInContext("ctx-f", "")).toBe("/elsewhere/single.md");
    expect(absoluteInContext("ctx-f", "x.md")).toBeNull();
    expect(absoluteInContext("ctx-zz", "x.md")).toBeNull();
  });
});
