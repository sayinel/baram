import { getSchema } from "@tiptap/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const copyBytesToDir = vi.fn(
  async (_dir: string, preferredName: string) => preferredName,
);
vi.mock("../media-copy", () => ({
  copyBytesToDir: (...a: unknown[]) =>
    copyBytesToDir(...(a as [string, string])),
}));

import { createBaramExtensions } from "../../extensions";
import {
  collectPendingMedia,
  decodeBase64DataUrl,
  extractPendingMedia,
  MAX_INLINE_MEDIA_BYTES,
  MAX_PENDING_MEDIA_BYTES,
  mediaSizeRefusal,
  pendingMediaBytes,
  preferredMediaName,
} from "../media-data-url";

const schema = getSchema(createBaramExtensions({ profile: "capture" }));

/** "hi" 두 글자의 base64 — 바이트를 눈으로 확인할 수 있는 최소 페이로드. */
const HI = "aGk=";
const PNG = `data:image/png;base64,${HI}`;
const MP4 = "data:video/mp4;base64,QUJD";

function docOf(
  ...nodes: { attrs: Record<string, unknown>; type: string }[]
): ReturnType<typeof schema.nodes.doc.create> {
  return schema.nodes.doc.create(
    null,
    nodes.map((n) => schema.nodes[n.type].create(n.attrs)),
  );
}

describe("collectPendingMedia (§324-e)", () => {
  it("이미지와 동영상의 data URL을 함께 모으고 alt를 그대로 싣는다", () => {
    const found = collectPendingMedia(
      docOf(
        { attrs: { alt: "pearl-2.png", src: PNG }, type: "image" },
        { attrs: { alt: "clip.mp4", src: MP4 }, type: "video" },
      ),
    );
    expect(found).toEqual([
      { alt: "pearl-2.png", src: PNG },
      { alt: "clip.mp4", src: MP4 },
    ]);
  });

  // 같은 이미지를 두 번 붙여넣으면 파일도 하나여야 한다 — 두 참조가 그것을 가리킨다.
  it("같은 src가 여러 번 나와도 한 번만 센다", () => {
    const found = collectPendingMedia(
      docOf(
        { attrs: { alt: "a.png", src: PNG }, type: "image" },
        { attrs: { alt: "a.png", src: PNG }, type: "image" },
      ),
    );
    expect(found).toHaveLength(1);
  });

  // ‼️ 이 두 줄이 "저장 때 흩뿌리지 않는다"의 경계다. 이미 디스크에 있는 파일을
  // 가리키는 상대·절대·원격 참조는 추출 대상이 아니고, 손으로 적힌 비-base64
  // data URI도 우리가 만든 것이 아니므로 손대지 않는다.
  it("data URL이 아닌 src와 비-base64 data URI는 건드리지 않는다", () => {
    const found = collectPendingMedia(
      docOf(
        { attrs: { alt: "", src: "assets/already-there.png" }, type: "image" },
        { attrs: { alt: "", src: "/abs/x.png" }, type: "image" },
        { attrs: { alt: "", src: "https://x.test/y.png" }, type: "image" },
        { attrs: { alt: "", src: "data:text/plain,hello" }, type: "image" },
      ),
    );
    expect(found).toEqual([]);
  });
});

describe("decodeBase64DataUrl (§324-e)", () => {
  it("바이트와 MIME을 돌려준다", () => {
    const decoded = decodeBase64DataUrl(PNG);
    expect(decoded?.mime).toBe("image/png");
    // "hi" = 0x68 0x69. 길이만 보는 단정은 어떤 페이로드로도 통과한다.
    expect(Array.from(decoded!.bytes)).toEqual([0x68, 0x69]);
  });

  it("base64가 깨졌으면 null — 호출부가 조용히 넘기지 않도록", () => {
    expect(decodeBase64DataUrl("data:image/png;base64,!!!not-base64!!!")).toBe(
      null,
    );
  });
});

describe("preferredMediaName (§324-e 원본 파일명 보존)", () => {
  // ‼️ 이 함수가 하는 일의 전부다. data URL은 이름을 담지 못하므로 alt가 원본
  // 파일명이 살아남은 유일한 자리이고, 이것이 없으면 캡처의 이미지가 모두
  // `image.png`, `image-1.png`으로 떨어져 나중에 무엇이 무엇이었는지 알 수 없다.
  it.each([
    // 붙여넣기 경로의 alt — `file.name` 그대로(확장자 포함)
    ["pearl-2.png", "image/png", "pearl-2.png"],
    // OS 드랍 경로의 alt — 확장자를 뗀 이름
    ["pearl-2", "image/png", "pearl-2.png"],
    // 확장자는 MIME의 관용 표기를 따른다 — `.jpeg`가 아니라 `.jpg`
    ["photo.jpeg", "image/jpeg", "photo.jpg"],
    ["clip", "video/mp4", "clip.mp4"],
    ["clip.mov", "video/quicktime", "clip.mov"],
    // 표에 없는 MIME은 subtype에서 유도한다
    ["shot", "image/heic", "shot.heic"],
    // 공백·특수문자는 하이픈으로, 대문자는 소문자로
    ["My Photo (1).PNG", "image/png", "my-photo-1.png"],
    // 한글 파일명은 보존한다
    ["여행사진.png", "image/png", "여행사진.png"],
  ])("alt %s + %s → %s", (alt, mime, expected) => {
    expect(preferredMediaName(alt, mime)).toBe(expected);
  });

  it("이름이 하나도 없으면 종류만은 정직하게 말한다", () => {
    expect(preferredMediaName("", "image/png")).toBe("image.png");
    expect(preferredMediaName("", "video/mp4")).toBe("video.mp4");
  });

  // 정제가 이름을 통째로 지워도 경로 조각이 파일명으로 남지 않아야 한다.
  it("경로 구분자와 상위 참조는 파일명으로 살아남지 못한다", () => {
    expect(preferredMediaName("../../etc/passwd", "image/png")).toBe(
      "etc-passwd.png",
    );
    expect(preferredMediaName("../..", "image/png")).toBe("image.png");
  });
});

describe("extractPendingMedia (§324-e)", () => {
  beforeEach(() => {
    copyBytesToDir.mockClear();
    copyBytesToDir.mockImplementation(
      async (_dir: string, preferredName: string) => preferredName,
    );
  });

  it("각 data URL을 파일로 쓰고 마크다운의 참조를 상대경로로 바꾼다", async () => {
    const md = `![pearl-2.png](${PNG})`;
    const result = await extractPendingMedia(
      md,
      [{ alt: "pearl-2.png", src: PNG }],
      "/vault/zettel/inbox/assets",
    );
    expect(copyBytesToDir).toHaveBeenCalledWith(
      "/vault/zettel/inbox/assets",
      "pearl-2.png",
      expect.any(Uint8Array),
    );
    expect(result.markdown).toBe("![pearl-2.png](assets/pearl-2.png)");
    expect(result.written).toEqual(["assets/pearl-2.png"]);
  });

  // ‼️ 폭이 지정된 이미지는 `![]()`가 아니라 `<img src="…">`로 직렬화된다
  // (image-transformer.ts). 마크다운 문법을 파싱하는 구현은 이 형태를 놓쳐 노트에
  // data URL을 그대로 남긴다 — src 문자열을 그대로 찾아 바꾸기 때문에 둘 다 잡힌다.
  it("HTML `<img>` 형태의 참조도 바꾼다", async () => {
    const md = `<img src="${PNG}" alt="pearl-2.png" width="640" />`;
    const result = await extractPendingMedia(
      md,
      [{ alt: "pearl-2.png", src: PNG }],
      "/dest/assets",
    );
    expect(result.markdown).toBe(
      '<img src="assets/pearl-2.png" alt="pearl-2.png" width="640" />',
    );
  });

  it("같은 src의 참조 여러 개를 한 파일로 모두 바꾼다", async () => {
    const md = `![a](${PNG})\n\n![a](${PNG})`;
    const result = await extractPendingMedia(
      md,
      [{ alt: "a", src: PNG }],
      "/dest/assets",
    );
    expect(result.markdown).toBe("![a](assets/a.png)\n\n![a](assets/a.png)");
    expect(copyBytesToDir).toHaveBeenCalledTimes(1);
  });

  // 이름이 같은 이미지 둘은 서로 다른 파일이 되어야 한다 — 충돌 해소는
  // `copyBytesToDir`가 하고, 이 함수는 **실제로 쓰인 이름**을 참조에 반영해야 한다.
  // 요청한 이름을 그대로 쓰는 구현은 두 참조가 한 파일을 가리키게 만든다.
  it("실제로 쓰인 파일명을 참조에 반영한다 — 요청한 이름이 아니라", async () => {
    const second = "data:image/png;base64,QUJD";
    const taken = new Set<string>();
    copyBytesToDir.mockImplementation(
      async (_dir: string, preferredName: string) => {
        const name = taken.has(preferredName)
          ? preferredName.replace(/\.png$/, "-1.png")
          : preferredName;
        taken.add(name);
        return name;
      },
    );

    const md = `![shot.png](${PNG})\n\n![shot.png](${second})`;
    const result = await extractPendingMedia(
      md,
      [
        { alt: "shot.png", src: PNG },
        { alt: "shot.png", src: second },
      ],
      "/dest/assets",
    );
    expect(result.markdown).toBe(
      "![shot.png](assets/shot.png)\n\n![shot.png](assets/shot-1.png)",
    );
    expect(result.written).toEqual(["assets/shot.png", "assets/shot-1.png"]);
  });

  it("아무것도 pending이 아니면 파일을 쓰지 않고 마크다운을 그대로 돌려준다", async () => {
    const result = await extractPendingMedia("그냥 글", [], "/dest/assets");
    expect(result.markdown).toBe("그냥 글");
    expect(copyBytesToDir).not.toHaveBeenCalled();
  });

  // ‼️ 삼키면 이 data URL이 노트에 그대로 실리고, 태스크 모드에서는 그 거대한
  // 문자열이 plain-text 태스크 목록의 한 줄이 된다.
  it("디코딩할 수 없는 페이로드는 조용히 넘기지 않고 던진다", async () => {
    await expect(
      extractPendingMedia(
        "![x](data:image/png;base64,!!!)",
        [{ alt: "x", src: "data:image/png;base64,!!!" }],
        "/dest/assets",
      ),
    ).rejects.toThrow(/base64/);
  });

  it("쓰기가 실패하면 던진다 — 참조만 바뀐 노트를 남기지 않는다", async () => {
    copyBytesToDir.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      extractPendingMedia(
        `![a](${PNG})`,
        [{ alt: "a", src: PNG }],
        "/dest/assets",
      ),
    ).rejects.toThrow("disk full");
  });
});

describe("pendingMediaBytes (§324-e 총량)", () => {
  it("빈 문서는 0", () => {
    expect(pendingMediaBytes(schema.nodes.doc.create())).toBe(0);
  });

  // ‼️ 길이가 아니라 **디코딩 후 바이트 수**여야 한다. base64 문자 길이를 그대로
  // 쓰면 실제보다 4/3배 크게 세어 예산이 조용히 좁아진다.
  it("디코딩 후 바이트 수를 센다 — base64 문자 길이가 아니라", () => {
    // "hi" = 2바이트, base64 "aGk=" = 4문자.
    const doc = docOf({ attrs: { alt: "a.png", src: PNG }, type: "image" });
    expect(pendingMediaBytes(doc)).toBe(2);
  });

  it("여러 건을 합산한다", () => {
    const doc = docOf(
      { attrs: { alt: "a.png", src: PNG }, type: "image" },
      { attrs: { alt: "b.mp4", src: MP4 }, type: "video" },
    );
    // "hi"(2) + "ABC"(3)
    expect(pendingMediaBytes(doc)).toBe(5);
  });

  // 이미 디스크에 있는 참조는 메모리를 차지하지 않으므로 예산에도 들지 않는다.
  it("상대경로 참조는 세지 않는다", () => {
    const doc = docOf({
      attrs: { alt: "old", src: "assets/old.png" },
      type: "image",
    });
    expect(pendingMediaBytes(doc)).toBe(0);
  });
});

describe("mediaSizeRefusal (§324-e)", () => {
  it("상한 이하이고 예산이 남으면 통과시킨다", () => {
    expect(mediaSizeRefusal(1024, 0)).toBeNull();
    expect(mediaSizeRefusal(MAX_INLINE_MEDIA_BYTES, 0)).toBeNull();
  });

  it("파일 하나가 상한을 넘으면 크기와 상한을 담아 거절한다", () => {
    const r = mediaSizeRefusal(MAX_INLINE_MEDIA_BYTES + 1, 0);
    expect(r?.key).toBe("journal.capture.mediaTooLarge");
    expect(r?.params).toEqual({ limit: "25", size: "26" });
  });

  // ‼️ 파일당 상한만 있으면 24 MiB 파일 스무 개가 전부 통과한다 — 어느 파일도
  // 상한을 위반하지 않으면서 총 ~480 MiB가 된다. 그것을 잡는 것이 이 분기다.
  it("파일당 상한을 지키는 파일도 총량을 넘기면 거절한다", () => {
    const twentyFourMiB = 24 * 1024 * 1024;
    expect(mediaSizeRefusal(twentyFourMiB, 0)).toBeNull();
    const r = mediaSizeRefusal(twentyFourMiB, MAX_PENDING_MEDIA_BYTES - 1024);
    expect(r?.key).toBe("journal.capture.mediaBudgetFull");
    expect(r?.params.budget).toBe("64");
  });

  // 파일당 상한이 먼저다 — 사용자가 바꿀 수 있는 것(이 파일)을 가리켜야 한다.
  it("둘 다 위반하면 파일당 상한 쪽을 말한다", () => {
    const r = mediaSizeRefusal(
      MAX_INLINE_MEDIA_BYTES + 1,
      MAX_PENDING_MEDIA_BYTES,
    );
    expect(r?.key).toBe("journal.capture.mediaTooLarge");
  });

  it("경계에서 정확하다 — 총량과 정확히 같으면 통과", () => {
    expect(mediaSizeRefusal(1024, MAX_PENDING_MEDIA_BYTES - 1024)).toBeNull();
    expect(mediaSizeRefusal(1025, MAX_PENDING_MEDIA_BYTES - 1024)?.key).toBe(
      "journal.capture.mediaBudgetFull",
    );
  });
});
