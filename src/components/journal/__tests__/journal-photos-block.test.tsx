// §56f `journal-photos` 블록이 원본 대신 썸네일 계층을 쓴다는 것을 지키는 테스트(이슈 793).
//
// 원본을 <img>에 걸면 80px 칸에 그리려는 것이라도 브라우저가 원본을 통째로 디코드한다(12 MP 한 장에
// 48 MB). 그래서 확인하는 것은 "썸네일이 결국 뜬다"가 아니라, 블록이 한 번이라도 건 src 가운데
// 원본 경로가 0건이라는 것이다 — 썸네일을 기다리는 동안도 포함해서.

import { createRoot } from "react-dom/client";

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const photoThumbnail = vi.fn();
const listDir = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../ipc/thumbnail", () => ({
  photoThumbnail: (path: string, maxPx: number) =>
    photoThumbnail(path, maxPx) as Promise<string>,
}));
vi.mock("../../../ipc/invoke", () => ({
  listDir: (path: string) => listDir(path) as Promise<unknown>,
  getConfig: vi.fn().mockResolvedValue(null),
  readFile: vi.fn().mockResolvedValue(""),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));

const { JournalDynamicBlock } = await import("../JournalDynamicBlock");
const { _resetForTest, onFirstVisible } =
  await import("../../../extensions/nodes/views/lazy-visible");
const { _resetThumbCache } =
  await import("../../../utils/journal/photo-thumbnail");
const { useFileStore } = await import("../../../stores/file/file");
const { pendingHeavyBlocks, settleHeavyBlocks } =
  await import("../../../utils/export/export-heavy-blocks");
const { captureEditorHTML } = await import("../../../utils/export/export-html");
const { cellPhotoOf } =
  await import("../../../utils/journal/journal-photo-cells");
const { useSettingsStore } = await import("../../../stores/settings/store");

declare const MockIntersectionObserver: {
  instances: {
    cb: IntersectionObserverCallback;
    elements: Set<Element>;
    triggerIntersect: (v?: boolean) => void;
  }[];
};

const MONTH = "/vault/journal/assets/2026-08";
const NAMES = ["20260801-a.jpg", "20260802-b.jpg", "20260803-c.jpg"];
const ORIGINALS = NAMES.map((n) => `${MONTH}/${n}`);
/** Per-file modification time the mocked listing reports. */
let revisions: Record<string, number> = {};

/** Every src any <img> in `root` was given, from now on. */
function recordSrcs(root: HTMLElement): string[] {
  const seen: string[] = [];
  const note = (el: Element) => {
    const src = el.getAttribute("src");
    if (el.tagName === "IMG" && src) seen.push(src);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") note(r.target as Element);
      for (const n of r.addedNodes) {
        if (n instanceof Element) {
          note(n);
          n.querySelectorAll("img").forEach(note);
        }
      }
    }
  }).observe(root, { attributes: true, childList: true, subtree: true });
  return seen;
}

async function renderBlock(layout: "grid" | "strip", extraParams = "") {
  const view = render(
    <JournalDynamicBlock
      content={`range: 2026-08-01..2026-08-31\nlayout: ${layout}\n${extraParams}`}
      language="journal-photos"
      onShowSource={vi.fn()}
    />,
  );
  await waitFor(() => {
    if (view.container.querySelectorAll(".journal-photos-cell").length !== 3)
      throw new Error("cells not rendered yet");
  });
  // The cells' passive effects (each registers with the visibility queue) run after the
  // commit that showed them; let them run before the test scrolls.
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  return view;
}

/** Scroll every observed cell — or only `cells` — into view and let the idle queue run. */
async function scrollIntoView(cells?: Element[]) {
  await act(async () => {
    const observer = MockIntersectionObserver.instances.at(-1)!;
    if (cells) {
      observer.cb(
        cells.map(
          (target) =>
            ({ isIntersecting: true, target }) as IntersectionObserverEntry,
        ),
        observer as unknown as IntersectionObserver,
      );
    } else {
      observer.triggerIntersect();
    }
    await vi.runAllTimersAsync();
  });
}

describe("journal-photos block", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    _resetForTest();
    _resetThumbCache();
    photoThumbnail.mockReset();
    photoThumbnail.mockImplementation((path: string, maxPx: number) =>
      Promise.resolve(`/cache/${maxPx}/${path.split("/").at(-1)}`),
    );
    revisions = {};
    listDir.mockReset();
    listDir.mockImplementation((path: string) =>
      Promise.resolve(
        path === MONTH
          ? NAMES.map((name) => ({
              isDir: false,
              modifiedAt: revisions[name] ?? 1,
              name,
              size: 100,
            }))
          : [{ isDir: true, name: "2026-08" }],
      ),
    );
    useFileStore.setState({ rootPath: "/vault" });
    useSettingsStore.setState({ journalDirectory: "journal" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 이것을 실패시키는 것: 블록이 배치와 무관하게 한 계층(320 이나 640)만 요청하는 것. */
  test.each([
    ["grid", 640],
    ["strip", 320],
  ] as const)("a %s asks for the %i px tier only", async (layout, px) => {
    await renderBlock(layout);
    await scrollIntoView();

    await waitFor(() => expect(photoThumbnail).toHaveBeenCalledTimes(3));
    expect(photoThumbnail.mock.calls.map(([, maxPx]) => maxPx)).toEqual([
      px,
      px,
      px,
    ]);
  });

  /** A grid cell is as wide as the columns leave it, so the tier has to cover that: 640 does
   *  from three columns up. 이것을 실패시키는 것: 격자의 계층을 열 수와 무관하게 정하는 것. */
  test.each([
    ["columns: 1", 2048],
    ["columns: 2", 2048],
    ["columns: 3", 640],
    ["columns: 4", 640],
    ["columns: 8", 640],
  ] as const)("a grid with %s asks for the %i px tier", async (params, px) => {
    await renderBlock("grid", params);
    await scrollIntoView();

    await waitFor(() => expect(photoThumbnail).toHaveBeenCalledTimes(3));
    expect(
      new Set(photoThumbnail.mock.calls.map(([, maxPx]) => maxPx)),
    ).toEqual(new Set([px]));
  });

  /** The strip's one row and its wrapping in a PDF hang on this class; a grid's column count
   *  is inline, because the note chooses it. 이것을 실패시키는 것: 한 줄 배치에
   *  `.journal-photos-strip` 을 달지 않거나 격자에 달아 버리는 것. */
  test("a strip is marked as one, and a grid carries its column count", async () => {
    const strip = await renderBlock("strip");
    const stripRoot = strip.container.querySelector(".journal-photos-grid")!;
    expect(stripRoot.classList.contains("journal-photos-strip")).toBe(true);
    expect(stripRoot.getAttribute("style")).toBeNull();
    strip.unmount();

    const grid = await renderBlock("grid", "columns: 5");
    const gridRoot = grid.container.querySelector<HTMLElement>(
      ".journal-photos-grid",
    )!;
    expect(gridRoot.classList.contains("journal-photos-strip")).toBe(false);
    expect(gridRoot.style.gridTemplateColumns).toBe("repeat(5, 1fr)");
  });

  /** 이것을 실패시키는 것: 썸네일을 기다리는 동안 칸에 원본을 거는 것. */
  test("never sets an original as a src, while the thumbnail is pending or after", async () => {
    let finish: (() => void) | undefined;
    photoThumbnail.mockImplementation(
      (path: string, maxPx: number) =>
        new Promise<string>((resolve) => {
          const done = () =>
            resolve(`/cache/${maxPx}/${path.split("/").at(-1)}`);
          const previous = finish;
          finish = () => {
            previous?.();
            done();
          };
        }),
    );
    const { container } = await renderBlock("grid");
    const srcs = recordSrcs(container);

    await scrollIntoView();
    expect(photoThumbnail).toHaveBeenCalledTimes(3);
    // Pending: the cells hold their squares with no image at all.
    expect(container.querySelectorAll("img")).toHaveLength(0);

    await act(async () => {
      finish!();
      await vi.runAllTimersAsync();
    });
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs).toHaveLength(3);
    expect(imgs.every((img) => img.dataset.thumbSource === "cache")).toBe(true);
    expect(new Set(srcs).size).toBe(3);
    expect(
      srcs.filter((src) => ORIGINALS.some((o) => src.includes(o))),
    ).toEqual([]);
  });

  /** 이것을 실패시키는 것: 칸이 화면에 들어오기를 기다리지 않고 마운트 때 요청하는 것. */
  test("only a cell on screen asks", async () => {
    const { container } = await renderBlock("grid");
    expect(photoThumbnail).not.toHaveBeenCalled();

    const [first] = container.querySelectorAll(".journal-photos-cell");
    await scrollIntoView([first]);

    expect(photoThumbnail).toHaveBeenCalledTimes(1);
    expect(photoThumbnail).toHaveBeenCalledWith(ORIGINALS[0], 640);
  });

  /** 이것을 실패시키는 것: 칸이 캐시를 `maxPx` 없이(320 계층 key 로) 찾는 것 — 640 격자의
   *  두 번째 렌더가 다시 요청한다. */
  test("a thumbnail resolved once renders again without asking the backend", async () => {
    const first = await renderBlock("grid");
    await scrollIntoView();
    await waitFor(() => expect(photoThumbnail).toHaveBeenCalledTimes(3));
    first.unmount();

    const { container } = await renderBlock("grid");
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs).toHaveLength(3);
    expect(imgs[0].getAttribute("src")).toBe(
      "asset://localhost//cache/640/20260801-a.jpg",
    );
    expect(photoThumbnail).toHaveBeenCalledTimes(3);
    // Rendered at once from the session cache, so the browser is the one left to defer the
    // cells off screen. 이것을 실패시키는 것: `loading="lazy"` 를 빼는 것.
    expect(imgs.every((img) => img.getAttribute("loading") === "lazy")).toBe(
      true,
    );
  });

  /** 이것을 실패시키는 것: 칸이 원본 폴백(`isOriginal`)을 그리지 않는 것 — 썸네일을 만들 수 없는
   *  파일이 빈 칸으로 남는다. */
  test("a photo the backend cannot thumbnail falls back to the original, marked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    photoThumbnail.mockRejectedValue(new Error("unsupported"));
    const { container } = await renderBlock("strip");
    await scrollIntoView();

    await waitFor(() => {
      if (container.querySelectorAll("img").length !== 3)
        throw new Error("fallbacks not rendered yet");
    });
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`asset://localhost/${ORIGINALS[0]}`);
    expect(img.dataset.thumbSource).toBe("original");
  });

  /** An export waits while the block is still listing its photos — before the listing
   *  there are no cells, and the block would export as its loading line. It does not wait
   *  on the cells themselves (`embedJournalPhotos` fills those from their source).
   *  이것을 실패시키는 것: `pendingHeavyBlocks` 에서 `listingBlocksIn` 을 지우거나, 목록을 다
   *  읽은 블록이 `trackListingBlock` 에서 빠지지 않는 것. */
  test("an export waits for the photo list, not for the cells", async () => {
    let finishListing: () => void = () => {};
    listDir.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          const answer = () =>
            resolve(
              path === MONTH
                ? NAMES.map((name) => ({
                    isDir: false,
                    modifiedAt: 1,
                    name,
                    size: 100,
                  }))
                : [{ isDir: true, name: "2026-08" }],
            );
          if (path === MONTH) finishListing = answer;
          else answer();
        }),
    );
    const { container } = render(
      <JournalDynamicBlock
        content="range: 2026-08-01..2026-08-31"
        language="journal-photos"
        onShowSource={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(pendingHeavyBlocks(container).map((b) => b.kind)).toEqual([
      "journal-photos",
    ]);

    await act(async () => {
      finishListing();
      await vi.runAllTimersAsync();
    });
    expect(container.querySelectorAll(".journal-photos-cell")).toHaveLength(3);
    // Listed: nothing left to wait for, though no cell has its image yet.
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(pendingHeavyBlocks(container)).toEqual([]);
    expect(await settleHeavyBlocks(container)).toEqual([]);
    expect(photoThumbnail).not.toHaveBeenCalled();
  });

  /** The test above never reaches the wake pass: with nothing else pending, the settle loop
   *  returns on its first read. Another block still rendering is what sends it there, and
   *  that pass must leave the cells alone: each would queue a request at a backend that
   *  decodes two at a time, behind which the gallery then waits.
   *  이것을 실패시키는 것: `useVisibleThumb` 의 등록에서 `onScreenOnly` 를 빼는 것. */
  test("an export waiting on another block does not wake the cells", async () => {
    const { container } = await renderBlock("grid");
    const diagram = document.createElement("div");
    diagram.className = "mermaid-block";
    diagram.setAttribute("data-render-state", "pending");
    container.append(diagram);
    onFirstVisible(diagram, () => {
      setTimeout(() => diagram.setAttribute("data-render-state", "done"), 100);
    });

    const settled = settleHeavyBlocks(container);
    await vi.advanceTimersByTimeAsync(500);

    expect(await settled).toEqual([]);
    // The pass ran: it woke the diagram, whose `done` is what ended the wait.
    expect(diagram.getAttribute("data-render-state")).toBe("done");
    expect(photoThumbnail).not.toHaveBeenCalled();
  });

  /** The cell's contract with the export, end to end: the real block, `captureEditorHTML`, and
   *  a forged cell beside it in an ```svg fence (`sanitizeSvg` keeps `class` and `data-*`).
   *  이것을 실패시키는 것: `JournalPhotoCell` 이 등록하지 않는 것 — 진짜 칸이 이름으로
   *  내보내진다. 또는 칸을 class 나 속성으로 고르는 것 — 위조한 경로의 파일이 들어간다. */
  test("an export fills the block's own cells, and only those, without a path in the DOM", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["x"], { type: "image/jpeg" }))),
    );
    const { container } = await renderBlock("grid");
    const fence = document.createElement("div");
    fence.className = "svg-block-render";
    fence.innerHTML =
      '<svg><g class="journal-photos-cell" data-photo-path="/vault/private/secret.md" data-photo-px="320"><text>mine</text></g></svg>';
    container.append(fence);
    // The live cells carry no path an export or a note could read.
    expect(container.innerHTML).not.toContain(MONTH);

    const html = await captureEditorHTML({
      state: { doc: { descendants() {} } },
      view: { dom: container },
    } as unknown as Parameters<typeof captureEditorHTML>[0]);
    vi.unstubAllGlobals();

    const out = document.createElement("div");
    out.innerHTML = html;
    expect(out.querySelectorAll(".journal-photos-cell img")).toHaveLength(3);
    expect(out.querySelector("g.journal-photos-cell text")?.textContent).toBe(
      "mine",
    );
    expect(photoThumbnail.mock.calls.map(([path]) => path).sort()).toEqual(
      ORIGINALS,
    );
    expect(html).not.toContain(MONTH);
  });

  /** An export clones the DOM in whatever task finds nothing pending, and that can fall
   *  between the commit that inserts the cells and React's passive effects, which run in a
   *  later task outside `act`. A MutationObserver callback is a microtask after that commit,
   *  so it sees what such an export would see.
   *  이것을 실패시키는 것: 칸의 등록을 `useLayoutEffect` 에서 `useEffect` 로 옮기는 것. */
  test("a cell is registered in the commit that inserts it", async () => {
    vi.useRealTimers();
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.createElement("div");
    document.body.append(host);
    const seen: boolean[] = [];
    const observer = new MutationObserver(() => {
      for (const cell of host.querySelectorAll(".journal-photos-cell")) {
        seen.push(cellPhotoOf(cell) !== undefined);
      }
    });
    observer.observe(host, { childList: true, subtree: true });
    const root = createRoot(host);
    try {
      root.render(
        <JournalDynamicBlock
          content="range: 2026-08-01..2026-08-31"
          language="journal-photos"
          onShowSource={vi.fn()}
        />,
      );
      for (let i = 0; i < 100 && seen.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(Boolean)).toBe(true);
    } finally {
      observer.disconnect();
      root.unmount();
      host.remove();
      env.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
  });

  /** A photo replaced at the same path (new modification time) is asked for again; the
   *  others still render from the session cache. 이것을 실패시키는 것: 칸이 `revision` 을
   *  `useVisibleThumb` 에 넘기지 않는 것. */
  test("a photo replaced in place is asked for again", async () => {
    const first = await renderBlock("grid");
    await scrollIntoView();
    await waitFor(() => expect(photoThumbnail).toHaveBeenCalledTimes(3));
    first.unmount();

    revisions = { [NAMES[1]]: 2 };
    const { container } = await renderBlock("grid");
    expect(container.querySelectorAll("img")).toHaveLength(2);
    await scrollIntoView();
    await waitFor(() => expect(photoThumbnail).toHaveBeenCalledTimes(4));
    expect(photoThumbnail.mock.calls[3]).toEqual([ORIGINALS[1], 640]);
  });
});
