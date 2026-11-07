// §56f · §5.12 Issue 793: an export embeds every journal-photos cell from its source,
// through a queue as wide as the backend, and stops at its deadline.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const photoThumbnail = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
vi.mock("../../../stores/editor/editor", () => ({
  useEditorStore: {
    getState: () => ({
      activeTabId: "t1",
      tabs: [{ filePath: "/vault/notes/today.md", id: "t1" }],
    }),
  },
}));
vi.mock("../../../ipc/thumbnail", () => ({
  photoThumbnail: (path: string, maxPx: number) =>
    photoThumbnail(path, maxPx) as Promise<string>,
}));

const { embedJournalPhotos, photoCellsOf } =
  await import("../export-journal-photos");
const { registerCellPhoto } = await import("../../journal/journal-photo-cells");
const { convertImagesToDataURIs, IMAGE_CONVERSION_CONCURRENCY } =
  await import("../export-html-media");
const { _resetThumbCache } = await import("../../journal/photo-thumbnail");
const { captureEditorHTML } = await import("../export-html");

/** `n` live cells that never came into view, registered the way `JournalPhotoCell` does. */
function liveCells(n: number): HTMLElement {
  const live = document.createElement("div");
  for (let i = 0; i < n; i++) {
    const cell = document.createElement("div");
    cell.className = "journal-photos-cell";
    registerCellPhoto(cell, {
      alt: `p${i}.jpg`,
      path: `/vault/journal/assets/2026-08/p${i}.jpg`,
      px: 640,
      revision: "1:1",
    });
    live.append(cell);
  }
  return live;
}

/** The clone of `live` and its cells, as `captureEditorHTML` pairs them. */
function cloneOf(live: HTMLElement) {
  const root = live.cloneNode(true) as HTMLElement;
  return { cells: photoCellsOf(live, root), root };
}

/** A cloned block of `n` cells: no image in any of them. */
function cells(n: number) {
  return cloneOf(liveCells(n));
}

/** `fetch` answering every URL with a few bytes, or `status` for URLs matching `fail`. */
function stubFetch(fail?: RegExp, status = 404) {
  let inFlight = 0;
  let peak = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      if (fail?.test(url)) return new Response(null, { status });
      return new Response(new Blob(["x"], { type: "image/jpeg" }));
    }),
  );
  return () => peak;
}

describe("embedJournalPhotos", () => {
  beforeEach(() => {
    _resetThumbCache();
    photoThumbnail.mockReset();
    photoThumbnail.mockImplementation((path: string, maxPx: number) =>
      Promise.resolve(`/cache/${maxPx}/${path.split("/").at(-1)}`),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** 이것을 실패시키는 것: 칸을 채우지 않는 것, 또는 `data-photo-*`(절대 경로)를 남기는 것. */
  test("fills every cell the reader never scrolled to, and ships no source path", async () => {
    stubFetch();
    const { cells: five, root } = cells(5);
    const result = await embedJournalPhotos(five);

    expect(result).toEqual({ embedded: 5, fallback: 0 });
    const imgs = [...root.querySelectorAll("img")];
    expect(imgs).toHaveLength(5);
    expect(imgs.every((img) => img.src.startsWith("data:"))).toBe(true);
    expect(photoThumbnail.mock.calls.every(([, px]) => px === 640)).toBe(true);
    expect(root.innerHTML).not.toContain("/vault/");
  });

  /** A cell the reader scrolled to holds its live image, an asset URL; its copy holds it too.
   *  이것을 실패시키는 것: 사본의 자식을 비우지 않는 것 — 칸에 사진이 둘 들어간다. */
  test("a cell the reader scrolled to exports one image, not its live one too", async () => {
    stubFetch();
    const live = liveCells(1);
    const shown = document.createElement("img");
    shown.setAttribute("src", "asset://localhost//cache/640/p0.jpg");
    live.firstElementChild!.append(shown);
    const { cells: one, root } = cloneOf(live);

    await embedJournalPhotos(one);

    const imgs = [...root.querySelectorAll("img")];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toMatch(/^data:/);
  });

  /** 이것을 실패시키는 것: 동시 요청 수를 backend 의 2 보다 넓히는 것. */
  test("asks for at most two thumbnails at a time", async () => {
    stubFetch();
    let inFlight = 0;
    let peak = 0;
    photoThumbnail.mockImplementation(async (path: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return `/cache/${path}`;
    });
    await embedJournalPhotos(cells(10).cells);

    expect(photoThumbnail).toHaveBeenCalledTimes(10);
    expect(peak).toBe(2);
  });

  /** Past the deadline nothing new starts, and the cells not reached show their names.
   *  이것을 실패시키는 것: 반복 조건에서 deadline 검사를 지우는 것 — 남은 칸마다 요청이 나간다
   *  (또는 `beforeDeadline` 을 지우는 것 — 답하지 않는 요청에서 export 가 멈춘다). */
  test("stops at its deadline: no request after it, the rest by name", async () => {
    stubFetch();
    photoThumbnail.mockImplementation(() => new Promise<string>(() => {}));
    const { cells: ten, root } = cells(10);
    // Fake timers, so the deadline passes when the test moves the clock and not
    // when a loaded machine gets round to it: with real time, both workers can
    // find the 30 ms already gone before their first request, and the count
    // below drops under 2.
    vi.useFakeTimers();
    let result;
    try {
      const pending = embedJournalPhotos(ten, { deadlineMs: 30 });
      await vi.advanceTimersByTimeAsync(31);
      result = await pending;
    } finally {
      vi.useRealTimers();
    }

    expect(photoThumbnail).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ embedded: 0, fallback: 10 });
    expect(root.querySelectorAll("img")).toHaveLength(0);
    expect(root.querySelector(".journal-photos-missing")?.textContent).toBe(
      "p0.jpg",
    );
  });

  /** 이것을 실패시키는 것: 읽지 못한 사진에 asset URL 을 그대로 건 <img> 를 남기는 것. */
  test("a photo whose bytes cannot be read exports as its name, not a broken image", async () => {
    stubFetch(/p1\.jpg/);
    const { cells: three, root } = cells(3);
    const result = await embedJournalPhotos(three);

    expect(result).toEqual({ embedded: 2, fallback: 1 });
    const second = root.children[1];
    expect(second.querySelector("img")).toBeNull();
    expect(second.querySelector(".journal-photos-missing")?.textContent).toBe(
      "p1.jpg",
    );
  });

  /** A note can write the class and any `data-*` attribute: `sanitizeHtmlBlock` and
   *  `sanitizeSvg` keep both. Neither an HTML block nor an ```svg fence makes a cell.
   *  이것을 실패시키는 것: `photoCellsOf` 가 등록이 아니라 class 나 속성으로 칸을 고르는 것 —
   *  저자의 내용이 지워지고, 저자가 적은 경로의 파일이 내보내기에 들어간다. */
  test.each([
    [
      "an HTML block",
      '<div class="html-block-render"><div class="journal-photos-cell" data-photo-path="/vault/private/secret.md" data-photo-px="320">my text</div></div>',
    ],
    [
      "an svg fence",
      '<div class="svg-block-render"><svg><g class="journal-photos-cell" data-photo-path="/vault/private/secret.md" data-photo-px="320"><text>my text</text></g></svg></div>',
    ],
  ])("leaves a forged cell in %s as written", async (_where, markup) => {
    stubFetch();
    const live = liveCells(1);
    const forged = document.createElement("div");
    forged.innerHTML = markup;
    live.append(forged);
    const { cells: found, root } = cloneOf(live);
    const copy = root.lastElementChild!;
    const written = copy.innerHTML;

    const result = await embedJournalPhotos(found);

    expect(result).toEqual({ embedded: 1, fallback: 0 });
    expect(copy.innerHTML).toBe(written);
    expect(photoThumbnail.mock.calls.map(([path]) => path)).toEqual([
      "/vault/journal/assets/2026-08/p0.jpg",
    ]);
  });

  test("a photo the backend cannot thumbnail embeds the original, marked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch();
    photoThumbnail.mockRejectedValue(new Error("unsupported"));
    const { cells: one, root } = cells(1);
    await embedJournalPhotos(one);

    const img = root.querySelector("img")!;
    expect(img.src.startsWith("data:")).toBe(true);
    expect(img.dataset.thumbSource).toBe("original");
  });
});

describe("captureEditorHTML", () => {
  beforeEach(() => {
    _resetThumbCache();
    photoThumbnail.mockReset();
    photoThumbnail.mockImplementation((path: string) =>
      Promise.resolve(`/cache/${path}`),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function editorOver(dom: HTMLElement) {
    return {
      state: { doc: { descendants() {} } },
      view: { dom },
    } as unknown as Parameters<typeof captureEditorHTML>[0];
  }

  /** The HTML and PDF capture fills the cells — the reader never scrolled to them.
   *  이것을 실패시키는 것: `captureEditorHTML` 에서 `embedJournalPhotos` 호출을 지우는 것. */
  test("captures every cell of a block the reader never scrolled to", async () => {
    stubFetch();
    const html = await captureEditorHTML(editorOver(liveCells(4)));
    const out = document.createElement("div");
    out.innerHTML = html;
    expect(out.querySelectorAll(".journal-photos-cell img")).toHaveLength(4);
    expect(html).not.toContain("/vault/journal");
  });

  /** The settle pass says so when a block falls back; a photo exported as its name is the same
   *  kind of loss. 이것을 실패시키는 것: `embedJournalPhotos` 의 결과를 버리는 것. */
  test("says how many photos were exported as their names", async () => {
    stubFetch(/p[02]\.jpg/);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await captureEditorHTML(editorOver(liveCells(3)));

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("2 of 3 journal photo(s)"),
    );
  });
});

describe("convertImagesToDataURIs", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 이것을 실패시키는 것: 모든 이미지를 한꺼번에 읽는 것(`Promise.all` 로 전부). */
  test("reads a bounded number of images at once", async () => {
    const peak = stubFetch();
    const clone = document.createElement("div");
    for (let i = 0; i < 12; i++) {
      const img = document.createElement("img");
      img.setAttribute("src", `asset://localhost//vault/i${i}.png`);
      clone.append(img);
    }
    await convertImagesToDataURIs(clone, document.createElement("div"));

    expect(
      [...clone.querySelectorAll("img")].every((img) =>
        img.getAttribute("src")!.startsWith("data:"),
      ),
    ).toBe(true);
    expect(peak()).toBe(IMAGE_CONVERSION_CONCURRENCY);
  });
});
