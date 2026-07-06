import { describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them.
const { writeFile, createDir, listDir } = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  createDir: vi.fn().mockResolvedValue(undefined),
  listDir: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../ipc/invoke", () => ({ writeFile, createDir, listDir }));
const { openFileInTab } = vi.hoisted(() => ({
  openFileInTab: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/journal-file-service", () => ({ openFileInTab }));

import { createZettelNote } from "../zettelkasten-service";

describe("createZettelNote", () => {
  it("writes notes/{id title}.md and opens it", async () => {
    const res = await createZettelNote("/z", "My Idea");
    expect(res).not.toBeNull();
    expect(createDir).toHaveBeenCalledWith("/z/notes");
    const [path, content] = writeFile.mock.calls.at(-1)!;
    expect(path).toMatch(/^\/z\/notes\/\d{12} My Idea\.md$/);
    expect(content).toContain("# My Idea");
    expect(openFileInTab).toHaveBeenCalledWith(res!.path, expect.any(String));
  });
});

describe("captureFleeting", () => {
  it("writes inbox/{id}.md and does not open a tab", async () => {
    openFileInTab.mockClear();
    const { captureFleeting } = await import("../zettelkasten-service");
    const res = await captureFleeting("/z", "quick thought");
    expect(createDir).toHaveBeenCalledWith("/z/inbox");
    const [path, content] = writeFile.mock.calls.at(-1)!;
    expect(path).toMatch(/^\/z\/inbox\/\d{12}\.md$/);
    expect(content).toContain("quick thought");
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(res).not.toBeNull();
  });
});
