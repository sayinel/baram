// §56d Photo Gallery 스캔 — 캡션을 채우려고 md를 읽는 방식.
//
// 이 파일이 지키는 것은 결과만이 아니라 **비용**이다. 예전 구현은 달마다 그 달의 md를
// 하나씩 await 했고, 그 하나하나가 Tauri IPC 왕복이라 저널이 커질수록 정직하게 느려졌다
// (실측 449개 md = Year 뷰 한 번에 순차 왕복 449번). 읽기 순서에는 의미가 없고 적용 순서에만
// 의미가 있다.
import { beforeEach, describe, expect, test, vi } from "vitest";

const listDir = vi.fn();
const readFile = vi.fn();

vi.mock("../../ipc/invoke", () => ({
  createDir: vi.fn(),
  listDir: (path: string) => listDir(path) as Promise<unknown>,
  readFile: (path: string) => readFile(path) as Promise<string>,
  writeBinaryFile: vi.fn(),
}));

const { scanJournalPhotos } = await import("../journal/journal-photo");

const dir = (name: string) => ({
  name,
  path: name,
  isDir: true,
  size: 0,
  modifiedAt: 0,
});
const file = (name: string) => ({
  name,
  path: name,
  isDir: false,
  size: 1,
  modifiedAt: 0,
});

/** daily/2026/{01,02}/ 각각 md 12개 + 사진 1장. */
function vaultWithTwoMonths() {
  listDir.mockImplementation((path: string) => {
    if (path === "/vault/journal/daily") return Promise.resolve([dir("2026")]);
    if (path === "/vault/journal/daily/2026")
      return Promise.resolve([dir("01"), dir("02")]);
    if (path.endsWith("/assets")) {
      const month = path.split("/")[5];
      return Promise.resolve([file(`2026${month}05-101500-photo.jpg`)]);
    }
    // 달 디렉터리: md 12개 + assets 폴더
    const month = path.split("/")[5];
    return Promise.resolve([
      dir("assets"),
      ...Array.from({ length: 12 }, (_, i) =>
        file(`2026-${month}-${String(i + 1).padStart(2, "0")}.md`),
      ),
    ]);
  });
}

describe("scanJournalPhotos caption pass", () => {
  beforeEach(() => {
    listDir.mockReset();
    readFile.mockReset();
  });

  test("reads a month's markdown concurrently rather than one at a time", async () => {
    vaultWithTwoMonths();
    let inFlight = 0;
    let peak = 0;
    readFile.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return "no images here";
    });

    await scanJournalPhotos("/vault", "/vault/journal");

    expect(readFile).toHaveBeenCalledTimes(24);
    expect(peak).toBeGreaterThan(1);
  });

  test("matches a photo to the journal that references it", async () => {
    vaultWithTwoMonths();
    readFile.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/vault/journal/daily/2026/01/2026-01-05.md"
          ? "![첫눈](assets/202601 05-101500-photo.jpg)".replace(" ", "")
          : "",
      ),
    );

    const photos = await scanJournalPhotos("/vault", "/vault/journal");

    const january = photos.find((p) => p.filename.startsWith("202601"));
    expect(january?.caption).toBe("첫눈");
    expect(january?.journalPath).toBe(
      "/vault/journal/daily/2026/01/2026-01-05.md",
    );
  });

  test("a caption never leaks from one month's journal to another month's photo", async () => {
    vaultWithTwoMonths();
    // 두 달의 사진 파일명이 다르므로, 1월 저널의 참조가 2월 사진을 물들이면 안 된다.
    readFile.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("/01/") ? "![1월](assets/20260105-101500-photo.jpg)" : "",
      ),
    );

    const photos = await scanJournalPhotos("/vault", "/vault/journal");

    expect(photos.find((p) => p.filename.startsWith("202602"))?.caption).toBe(
      "",
    );
    expect(
      photos.find((p) => p.filename.startsWith("202602"))?.journalPath,
    ).toBeNull();
  });

  test("the last journal referencing a photo wins, in directory order", async () => {
    vaultWithTwoMonths();
    // 같은 사진을 1월의 두 저널이 참조한다. 완료 순서가 아니라 디렉터리 순서로 결정돼야 한다.
    readFile.mockImplementation(async (path: string) => {
      if (path === "/vault/journal/daily/2026/01/2026-01-03.md") {
        return "![이른 쪽](assets/20260105-101500-photo.jpg)";
      }
      if (path === "/vault/journal/daily/2026/01/2026-01-09.md") {
        // 나중 파일이 **먼저** 끝나도 결과는 같아야 한다.
        return "![늦은 쪽](assets/20260105-101500-photo.jpg)";
      }
      return "";
    });

    const photos = await scanJournalPhotos("/vault", "/vault/journal");

    expect(photos.find((p) => p.filename.startsWith("202601"))?.caption).toBe(
      "늦은 쪽",
    );
  });

  test("skips months outside the requested year", async () => {
    listDir.mockImplementation((path: string) => {
      if (path === "/vault/journal/daily")
        return Promise.resolve([dir("2025"), dir("2026")]);
      if (path.endsWith("/2025") || path.endsWith("/2026"))
        return Promise.resolve([dir("01")]);
      if (path.endsWith("/assets"))
        return Promise.resolve([file("20260105-101500-photo.jpg")]);
      return Promise.resolve([dir("assets"), file("2026-01-05.md")]);
    });
    readFile.mockResolvedValue("");

    await scanJournalPhotos("/vault", "/vault/journal", { year: 2026 });

    // 2025는 달 목록조차 열지 않는다.
    expect(listDir).not.toHaveBeenCalledWith(
      "/vault/journal/daily/2025/01/assets",
    );
  });
});
