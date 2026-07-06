import { describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them.
const { writeFile, createDir, listDir, readFile, deleteFile } = vi.hoisted(
  () => ({
    writeFile: vi.fn().mockResolvedValue(undefined),
    createDir: vi.fn().mockResolvedValue(undefined),
    listDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(""),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  }),
);
vi.mock("../../ipc/invoke", () => ({
  writeFile,
  createDir,
  listDir,
  readFile,
  deleteFile,
}));
const { openFileInTab } = vi.hoisted(() => ({
  openFileInTab: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/journal-file-service", () => ({ openFileInTab }));

import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { createZettelNote, promoteFleeting } from "../zettelkasten-service";

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

  it("stamps `created` in LOCAL YYYY-MM-DDTHH:mm form matching the id", async () => {
    await createZettelNote("/z", "Timestamped");
    const [path, content] = writeFile.mock.calls.at(-1)!;
    const id = path.match(/\/(\d{12})\s/)![1];
    const createdMatch = content.match(/^created: (.+)$/m);
    expect(createdMatch).not.toBeNull();
    const created = createdMatch![1];
    expect(created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(created.replace(/[-T:]/g, "")).toBe(id);
  });

  it("upserts the new note into the zettel index", async () => {
    useZettelIndexStore.getState().clear();
    const res = await createZettelNote("/z", "Fresh Idea");
    const entries = Object.values(useZettelIndexStore.getState().byId);
    expect(
      entries.some((n) => n.path === res!.path && n.title === "Fresh Idea"),
    ).toBe(true);
  });

  it("seeds the note body under the H1 and returns { path, id }", async () => {
    const res = await createZettelNote("/z", "T", "body text");
    expect(res).not.toBeNull();
    expect(res).toEqual({
      path: expect.stringMatching(/^\/z\/notes\/\d{12} T\.md$/) as string,
      id: expect.stringMatching(/^\d{12}$/) as string,
    });
    const [, content] = writeFile.mock.calls.at(-1)!;
    expect(content).toContain("# T");
    expect(content).toContain("body text");
    // body follows the H1, not the frontmatter
    expect(content.indexOf("# T")).toBeLessThan(content.indexOf("body text"));
  });

  it("skips opening a tab when openTab=false", async () => {
    openFileInTab.mockClear();
    await createZettelNote("/z", "No Tab", "seed", false);
    expect(openFileInTab).not.toHaveBeenCalled();
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

  it("stamps `created` in LOCAL YYYY-MM-DDTHH:mm form matching the id", async () => {
    const { captureFleeting } = await import("../zettelkasten-service");
    const res = await captureFleeting("/z", "another thought");
    const id = res!.path.match(/\/(\d{12})\.md$/)![1];
    const [, content] = writeFile.mock.calls.at(-1)!;
    const created = content.match(/^created: (.+)$/m)![1];
    expect(created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(created.replace(/[-T:]/g, "")).toBe(id);
  });
});

describe("promoteFleeting", () => {
  it("moves inbox/{id}.md to notes/{id title}.md and deletes the inbox file", async () => {
    readFile.mockResolvedValueOnce(
      "---\nid: 202607051530\ncreated: 2026-07-05T15:30\ntags: []\n---\n\nseed body\n",
    );
    const res = await promoteFleeting(
      "/z",
      "/z/inbox/202607051530.md",
      "Real Idea",
    );
    expect(res!.path).toBe("/z/notes/202607051530 Real Idea.md");
    expect(deleteFile).toHaveBeenCalledWith("/z/inbox/202607051530.md");
    const call = writeFile.mock.calls.find((c) => c[0] === res!.path)!;
    expect(call[1]).toContain("# Real Idea");
    expect(call[1]).toContain("seed body");
  });

  it("preserves the fleeting note's original `created` (does not stamp promotion time)", async () => {
    readFile.mockResolvedValueOnce(
      "---\nid: 202601010005\ncreated: 2026-01-01T00:05\ntags: []\n---\n\nold thought\n",
    );
    const res = await promoteFleeting(
      "/z",
      "/z/inbox/202601010005.md",
      "Old Idea",
    );
    const call = writeFile.mock.calls.find((c) => c[0] === res!.path)!;
    expect(call[1]).toContain("created: 2026-01-01T00:05");
  });

  it("falls back to deriving `created` from the id when frontmatter lacks it", async () => {
    readFile.mockResolvedValueOnce("no frontmatter here\n");
    const res = await promoteFleeting(
      "/z",
      "/z/inbox/202603152359.md",
      "No Frontmatter",
    );
    const call = writeFile.mock.calls.find((c) => c[0] === res!.path)!;
    expect(call[1]).toContain("created: 2026-03-15T23:59");
  });
});
