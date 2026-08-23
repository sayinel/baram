// §293 갤러리 헤더의 매체 필터가 **그룹 짓기 앞에서** 걸리는지 본다.
//
// 순서가 요점이다. 뒤에서 거르면 그룹 헤더의 개수와 라이트박스가 좌우로 넘기는 목록이
// 화면에 보이는 칸과 어긋난다 — 화면에 한 칸인데 헤더가 3이라고 적고, 오른쪽 화살표가
// 보이지도 않는 사진으로 넘어간다. 그래서 단정은 "동영상만 남는다"가 아니라 "동영상만
// 남고 **개수도 같이** 줄어든다"다.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const listDir = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
vi.mock("../../../ipc/thumbnail", () => ({
  photoThumbnail: vi.fn().mockResolvedValue("/cache/thumb.jpg"),
}));
vi.mock("../../../ipc/invoke", () => ({
  createDir: vi.fn(),
  listDir: (path: string) => listDir(path) as Promise<unknown>,
  readFile: vi.fn().mockResolvedValue(""),
  writeBinaryFile: vi.fn(),
}));

const { PhotoGalleryPanel } = await import("../PhotoGalleryPanel");
const { useFileStore } = await import("../../../stores/file/file");
const { useSettingsStore } = await import("../../../stores/settings/store");
const { useUIStore } = await import("../../../stores/ui/ui");

const entry = (name: string) => ({
  name,
  path: name,
  isDir: false,
  size: 1,
  modifiedAt: 0,
});
const folder = (name: string) => ({ ...entry(name), isDir: true, size: 0 });

/** 스캔이 끝나 그리드가 그려질 때까지 흘린다. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** daily/2026/08/assets/에 주어진 파일들만 있는 저널. */
function vaultWith(names: string[]) {
  listDir.mockImplementation((path: string) => {
    if (path === "/vault/journal/daily")
      return Promise.resolve([folder("2026")]);
    if (path === "/vault/journal/daily/2026")
      return Promise.resolve([folder("08")]);
    if (path.endsWith("/assets"))
      return Promise.resolve(names.map((n) => entry(n)));
    return Promise.resolve([folder("assets"), entry("2026-08-05.md")]);
  });
}

const cells = (c: HTMLElement) => c.querySelectorAll(".photo-gallery-item");
const counts = (c: HTMLElement) =>
  [...c.querySelectorAll(".photo-gallery-group-count")].map(
    (el) => el.textContent,
  );

describe("PhotoGalleryPanel — media filter", () => {
  beforeEach(() => {
    // Day 모드의 기본 창은 "오늘"이다 — 픽스처가 달력에 걸리지 않게 시계를 고정한다.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 15));
    listDir.mockReset();
    useFileStore.getState().setRootPath("/vault");
    useSettingsStore.getState().setJournalDirectory("/vault/journal");
    useUIStore.setState({
      rightPanelMode: "photo-gallery",
      rightPanelOpen: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("shows photos and clips together until a filter is chosen", async () => {
    vaultWith(["20260805-101500-a.jpg", "20260805-102000-c.mp4"]);
    const { container } = render(<PhotoGalleryPanel />);
    await settle();

    expect(cells(container)).toHaveLength(2);
    expect(counts(container)).toEqual(["2"]);
  });

  test("Videos leaves the clips — and the group count agrees with the grid", async () => {
    vaultWith([
      "20260805-101500-a.jpg",
      "20260805-102000-c.mp4",
      "20260805-103000-b.jpg",
    ]);
    const { container } = render(<PhotoGalleryPanel />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Videos" }));

    expect(cells(container)).toHaveLength(1);
    // ‼️ 이 줄이 순서를 고정한다. 그룹 뒤에서 걸렀다면 화면은 1칸인데 여기는 "3"이다.
    expect(counts(container)).toEqual(["1"]);
  });

  test("Photos leaves the stills", async () => {
    vaultWith([
      "20260805-101500-a.jpg",
      "20260805-102000-c.mp4",
      "20260805-103000-b.jpg",
    ]);
    const { container } = render(<PhotoGalleryPanel />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Photos" }));

    expect(cells(container)).toHaveLength(2);
    expect(counts(container)).toEqual(["2"]);
  });

  test("All brings everything back", async () => {
    vaultWith(["20260805-101500-a.jpg", "20260805-102000-c.mp4"]);
    const { container } = render(<PhotoGalleryPanel />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));

    expect(cells(container)).toHaveLength(2);
  });

  // 빈 화면이 "저널에 아무것도 없다"고 말하면 거짓말이다 — 사진은 세 장 있고 필터가
  // 동영상일 뿐이다. 그 상태에서 "이미지를 드래그하세요"라고 안내하면 더 나쁘다.
  test("says which filter is empty, not that the journal is", async () => {
    vaultWith(["20260805-101500-a.jpg"]);
    render(<PhotoGalleryPanel />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Videos" }));

    expect(screen.getByText(/동영상이 없습니다/)).toBeTruthy();
  });

  // 갤러리가 이제 둘 다 담으므로 빈 안내도 둘 다 말해야 한다 — "이미지를 드래그하세요"만
  // 남겨 두면 동영상을 넣을 수 있다는 사실이 어디에도 안 적힌다.
  test("names both kinds when the journal really is empty", async () => {
    vaultWith([]);
    render(<PhotoGalleryPanel />);
    await settle();

    expect(screen.getByText(/사진이나 동영상이 없습니다/)).toBeTruthy();
  });
});
