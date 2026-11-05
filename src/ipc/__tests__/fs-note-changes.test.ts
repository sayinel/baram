// §34 issue 791 — the webview's text writes announce the note they wrote, at once
// (`services/note-changes.ts`: the fast publisher; the watcher is the complete one).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { onNoteChanges } from "../../services/note-changes";
import { createFile, writeFile } from "../fs";

let heard: string[][] = [];
let stop: () => void = () => undefined;

beforeEach(() => {
  invokeMock.mockReset();
  heard = [];
  stop = onNoteChanges((paths) => heard.push([...paths]));
});
afterEach(() => stop());

describe("§34 note-change announcements from the webview's writes", () => {
  // 이것을 실패시키는 것: `writeFile` · `createFile` 의 `announceNoteChanges([path])` 를 지운다.
  it("announces a note once writeFile or createFile succeeded", async () => {
    invokeMock.mockResolvedValue(undefined);

    await writeFile("/v/a.md", "a");
    await createFile("/v/b.md", "b");

    expect(heard).toEqual([["/v/a.md"], ["/v/b.md"]]);
  });

  it("announces nothing for a write that failed", async () => {
    invokeMock.mockRejectedValue("파일 쓰기 실패: denied");

    await expect(writeFile("/v/a.md", "a")).rejects.toBe(
      "파일 쓰기 실패: denied",
    );
    await expect(createFile("/v/b.md", "b")).rejects.toBe(
      "파일 쓰기 실패: denied",
    );

    expect(heard).toEqual([]);
  });

  it("announces nothing for a file that cannot be a note", async () => {
    invokeMock.mockResolvedValue(undefined);

    await writeFile("/v/data.json", "{}");

    expect(heard).toEqual([]);
  });
});
