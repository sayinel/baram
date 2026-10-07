// §56f `journal-photos` 블록이 원본 대신 썸네일 계층을 쓴다는 것을 지키는 테스트(이슈 793).
//
// 원본을 <img>에 걸면 80px 칸에 그리려는 것이라도 브라우저가 원본을 통째로 디코드한다(12 MP 한 장에
// 48 MB). 그래서 확인하는 것은 "썸네일이 결국 뜬다"가 아니라, 블록이 한 번이라도 건 src 가운데
// 원본 경로가 0건이라는 것이다 — 썸네일을 기다리는 동안도 포함해서.

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
  readFile: vi.fn().mockResolvedValue(""),
}));

const { JournalDynamicBlock } = await import("../JournalDynamicBlock");
const { _resetForTest } =
  await import("../../../extensions/nodes/views/lazy-visible");
const { _resetThumbCache } =
  await import("../../../utils/journal/photo-thumbnail");
const { useFileStore } = await import("../../../stores/file/file");
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

async function renderBlock(layout: "grid" | "strip") {
  const view = render(
    <JournalDynamicBlock
      content={`range: 2026-08-01..2026-08-31\nlayout: ${layout}`}
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
    listDir.mockReset();
    listDir.mockImplementation((path: string) =>
      Promise.resolve(
        path === MONTH
          ? NAMES.map((name) => ({ isDir: false, name }))
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
});
