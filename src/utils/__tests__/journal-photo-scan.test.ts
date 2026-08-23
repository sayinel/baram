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

// §293 갤러리가 보는 파일 목록. 예전에는 이 파일이 확장자를 손으로 다시 열거했다(네 번째
// 목록) — 그래서 §292–§301이 동영상을 사진과 **같은** assets/에 저장하도록 만든 뒤에도
// 갤러리에는 동영상만 빠져 있었다. 이제 `isMediaFilePath` 하나에 묻는다.
describe("scanJournalPhotos media filter", () => {
  beforeEach(() => {
    listDir.mockReset();
    readFile.mockReset();
  });

  /** daily/2026/08/assets/에 주어진 파일들을 놓고, md는 `content` 하나만 둔다. */
  function vaultWithAssets(names: string[], content = "") {
    listDir.mockImplementation((path: string) => {
      if (path === "/vault/journal/daily")
        return Promise.resolve([dir("2026")]);
      if (path === "/vault/journal/daily/2026")
        return Promise.resolve([dir("08")]);
      if (path.endsWith("/assets"))
        return Promise.resolve(names.map((n) => file(n)));
      return Promise.resolve([dir("assets"), file("2026-08-05.md")]);
    });
    readFile.mockResolvedValue(content);
  }

  test("a video clip in assets/ shows up next to the photos", async () => {
    vaultWithAssets(["20260805-101500-a.jpg", "20260805-102000-clip.mp4"]);

    const entries = await scanJournalPhotos("/vault", "/vault/journal");

    expect(entries.map((e) => e.filename).sort()).toEqual([
      "20260805-101500-a.jpg",
      "20260805-102000-clip.mp4",
    ]);
  });

  test("tags each entry with the kind the single classifier reports", async () => {
    vaultWithAssets([
      "20260805-101500-a.jpg",
      "20260805-102000-clip.mp4",
      "20260805-103000-b.webm",
    ]);

    const entries = await scanJournalPhotos("/vault", "/vault/journal");
    const kindOf = (name: string) =>
      entries.find((e) => e.filename === name)?.kind;

    expect(kindOf("20260805-101500-a.jpg")).toBe("image");
    expect(kindOf("20260805-102000-clip.mp4")).toBe("video-file");
    expect(kindOf("20260805-103000-b.webm")).toBe("video-file");
  });

  // ‼️ 이 테스트가 이 변경에서 제일 중요하다. `classifyMediaSrc` 단독으로 열면 통과하지
  // 못한다 — 그쪽은 못 알아보는 확장자를 "image"로 떨어뜨리는 **파이프라인 fallback
  // 계약**이라(md-to-pm이 의존한다) `.pdf`도 사진 칸이 된다. 갤러리가 물어야 하는 것은
  // "애초에 미디어인가"이고 그 질문에 답하는 함수는 `isMediaFilePath`다.
  test("a pdf or an archive sitting in assets/ is not a gallery entry", async () => {
    vaultWithAssets([
      "20260805-101500-a.jpg",
      "20260805-102000-report.pdf",
      "20260805-103000-backup.zip",
      "20260805-104000-notes.md",
    ]);

    const entries = await scanJournalPhotos("/vault", "/vault/journal");

    expect(entries.map((e) => e.filename)).toEqual(["20260805-101500-a.jpg"]);
  });

  // .mkv는 어느 웹뷰에서도 재생되지 않아 §293의 목록에 일부러 없다. 갤러리가 그것만
  // 따로 허용하면 재생도 포스터도 없는 검은 칸이 된다.
  test("a container no webview can play stays out", async () => {
    vaultWithAssets(["20260805-102000-clip.mkv"]);

    const entries = await scanJournalPhotos("/vault", "/vault/journal");

    expect(entries).toEqual([]);
  });

  // 동영상은 사진과 **같은** `![](…)` 문법으로 문서에 들어간다(§292). 캡션 수집기가
  // 이미 그 정규식을 쓰므로 동영상에도 그대로 붙어야 한다.
  test("a video's caption comes from the journal just like a photo's", async () => {
    vaultWithAssets(
      ["20260805-102000-clip.mp4"],
      "![파도](assets/20260805-102000-clip.mp4)",
    );

    const entries = await scanJournalPhotos("/vault", "/vault/journal");

    expect(entries[0].caption).toBe("파도");
    expect(entries[0].journalPath).toBe(
      "/vault/journal/daily/2026/08/2026-08-05.md",
    );
  });
});
