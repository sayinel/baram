import { describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  createDir: vi.fn().mockResolvedValue(undefined),
}));

import { createDir } from "../../../ipc/invoke";
import { ensureZettelkastenScaffold, resolveZettelDir } from "../zettelkasten";

// NOTE: resolveZettelDir mirrors the real resolveJournalDir (src/utils/journal/journal.ts),
// which ignores rootPath entirely and only accepts absolute paths (Unix or Windows drive
// letter) — relative paths are not supported. This differs from a naive `${root}/${dir}`
// join; see the real function's `_rootPath` (unused) parameter.
describe("zettelkasten scaffold", () => {
  it("resolves an absolute dir; relative dirs are not supported", () => {
    expect(resolveZettelDir("/vault", "/vault/zettel")).toBe("/vault/zettel");
    expect(resolveZettelDir(null, "/zettel")).toBe("/zettel");
    expect(resolveZettelDir("/vault", "C:\\zettel")).toBe("C:\\zettel");
    expect(resolveZettelDir("/vault", "zettel")).toBeNull();
    expect(resolveZettelDir(null, "")).toBeNull();
  });

  it("creates inbox/ and notes/ under root", async () => {
    await ensureZettelkastenScaffold("/z");
    expect(createDir).toHaveBeenCalledWith("/z/inbox");
    expect(createDir).toHaveBeenCalledWith("/z/notes");
  });
});
