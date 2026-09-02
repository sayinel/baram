// §324-e 붙여넣기 경로의 크기 상한.
//
// ‼️ 이 파일이 따로 있는 이유: 붙여넣기는 **Rust를 거치지 않는다.** 클립보드의
// `File`은 이미 웹뷰 안에 있어 `FileReader`가 바로 읽으므로, 드랍 경로에서 상한을
// 집행하는 `read_media_data_url`의 거절이 여기에는 적용되지 않는다. 두 경로가 같은
// 상한을 쓰지 않으면 같은 파일이 붙여넣기로는 들어가고 드랍으로는 거절돼, 사용자
// 눈에는 무작위로 보인다. 값 자체가 어긋나지 않는 것은
// `utils/__tests__/media-extension-parity.test.ts`가 지키고, 붙여넣기가 그 값을
// 실제로 **집행하는지**는 여기가 지킨다.
import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

const showToastMock = vi.hoisted(() => vi.fn());
vi.mock("../../stores/ui/ui", () => ({
  useUIStore: { getState: () => ({ showToast: showToastMock }) },
}));

import { MAX_INLINE_MEDIA_BYTES } from "../../utils/media-data-url";
import { createBaramExtensions } from "../index";

/**
 * 실제 바이트를 25 MiB 만들지 않는다 — `File.size`만 크게 보이게 한다. 상한은
 * 크기를 보고 판단하므로 이것으로 충분하고, 테스트가 수십 MB를 할당하지 않는다.
 */
function fileOfSize(name: string, size: number): File {
  const file = new File(["x"], name, { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function mediaCount(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image" || node.type.name === "video") n++;
  });
  return n;
}

function pasteInto(editor: Editor, file: File): void {
  const event = {
    clipboardData: { files: [file], getData: () => "" },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
  editor.view.someProp("handlePaste", (f) =>
    f(editor.view, event, Slice.empty),
  );
}

describe("§324-e 캡처 붙여넣기 — 크기 상한", () => {
  let editor: Editor;

  beforeEach(() => {
    showToastMock.mockReset();
    editor = new Editor({
      content: "",
      extensions: createBaramExtensions({ profile: "capture" }),
    });
  });

  it("상한 이하는 그대로 들어간다", async () => {
    pasteInto(editor, fileOfSize("ok.png", MAX_INLINE_MEDIA_BYTES));
    await vi.waitFor(() => expect(mediaCount(editor)).toBe(1));
    expect(showToastMock).not.toHaveBeenCalled();
    editor.destroy();
  });

  // ‼️ 거절이 조용하면 사용자에게는 "붙여넣기가 안 되는 앱"이 된다. 문구는 크기와
  // 상한을 **둘 다** 말해야 한다 — 하나만으로는 무엇을 바꿔야 할지 알 수 없다.
  it("상한을 넘으면 넣지 않고, 크기와 상한을 말한다", async () => {
    pasteInto(editor, fileOfSize("huge.png", MAX_INLINE_MEDIA_BYTES + 1));
    await vi.waitFor(() => expect(showToastMock).toHaveBeenCalled());

    expect(mediaCount(editor)).toBe(0);
    const [message, type] = showToastMock.mock.calls[0] as [string, string];
    expect(type).toBe("error");
    expect(message).toContain("huge.png");
    expect(message).toContain("26"); // 26 MB, 올림
    expect(message).toContain("25"); // 상한
    editor.destroy();
  });

  // ‼️ 상한과 같은 이유로 여기 있다: 읽기 실패도 **보여야** 한다. 상한 초과만
  // 알리고 읽기 실패는 삼키면, 파일이 사라졌거나 권한이 없는 경우 붙여넣기가
  // 아무 반응 없이 무시된다 — 사용자가 이 브랜치에서 세 번 겪은 그 실패 방식이다.
  it("FileReader가 실패해도 조용히 넘어가지 않는다", async () => {
    const spy = vi
      .spyOn(FileReader.prototype, "readAsDataURL")
      .mockImplementation(function (this: FileReader) {
        // jsdom의 FileReader는 이벤트를 비동기로 쏜다 — 같은 형태를 유지한다.
        setTimeout(
          () =>
            this.onerror?.(
              new ProgressEvent("error") as ProgressEvent<FileReader>,
            ),
          0,
        );
      });

    pasteInto(editor, fileOfSize("gone.png", 1024));
    await vi.waitFor(() => expect(showToastMock).toHaveBeenCalled());

    expect(mediaCount(editor)).toBe(0);
    const [message, type] = showToastMock.mock.calls[0] as [string, string];
    expect(type).toBe("error");
    expect(message).toContain("gone.png");
    spy.mockRestore();
    editor.destroy();
  });

  // ‼️ 총량 예산. 파일당 상한(25 MiB)만으로는 웹뷰가 들고 있는 바이트가 묶이지
  // 않는다 — 24 MiB 파일 스무 개는 어느 하나도 상한을 위반하지 않으면서 ~480 MiB가
  // 된다. `MAX_PENDING_MEDIA_BYTES`가 그것을 문서 기준으로 묶는다.
  //
  // ‼️ 예산(64 MiB)이 파일당 상한(25 MiB)보다 **위**에 있으므로 파일 하나로는 절대
  // 넘길 수 없다. 그래서 이 테스트는 문서에 ~40 MiB치 pending 미디어를 실제로
  // 심는다 — 대역을 끼우지 않고 진짜 경로를 태우기 위해서다. 심는 비용은 base64
  // **문자열** 하나뿐이다: `pendingMediaBytes`는 길이만 재고 디코딩하지 않으며,
  // `fileOfSize`는 크기만 속인다. 실제 이미지 바이트는 어디에도 만들지 않는다.
  describe("총량 예산", () => {
    /** 디코딩하면 `bytes`가 되는 payload. 유효한 base64 문자면 내용은 무관하다. */
    function seedPending(target: Editor, bytes: number): void {
      const payload = "A".repeat(Math.ceil((bytes * 4) / 3));
      target.commands.setContent(
        `<p><img src="data:image/png;base64,${payload}" alt="held.png"></p>`,
      );
    }

    function srcs(target: Editor): string[] {
      const out: string[] = [];
      target.state.doc.descendants((n) => {
        if (n.type.name === "image") out.push(n.attrs.src as string);
      });
      return out;
    }

    it("문서가 이미 들고 있는 양 때문에 거절될 수 있다", async () => {
      // 40 MiB 보유 + 25 MiB 파일 = 65 MiB > 64 MiB 예산. 파일 자체는 상한 이내라
      // 파일당 검사만으로는 통과한다 — 그것이 이 테스트가 가르는 것이다.
      seedPending(editor, 40 * 1024 * 1024);
      const seeded = srcs(editor);

      pasteInto(editor, fileOfSize("fits-alone.png", MAX_INLINE_MEDIA_BYTES));
      await vi.waitFor(() => expect(showToastMock).toHaveBeenCalled());

      // 새 이미지는 들어가지 않았다 — 심어 둔 것이 그대로다.
      expect(srcs(editor)).toEqual(seeded);
      const [message, type] = showToastMock.mock.calls[0] as [string, string];
      expect(type).toBe("error");
      expect(message).toContain("fits-alone.png");
      expect(message).toContain("64");
      editor.destroy();
    });

    // ‼️ 대조군. 위 테스트만 있으면 "25 MiB 파일은 늘 거절"하는 구현도 통과한다.
    // 같은 파일이 빈 문서에서는 들어가야 한다.
    it("같은 파일이 빈 문서에서는 들어간다", async () => {
      pasteInto(editor, fileOfSize("fits-alone.png", MAX_INLINE_MEDIA_BYTES));
      await vi.waitFor(() => expect(mediaCount(editor)).toBe(1));
      expect(showToastMock).not.toHaveBeenCalled();
      editor.destroy();
    });
  });

  // 문서 편집기에는 이 상한이 없다 — 그 표면은 바이트를 메모리에 들고 있지 않고
  // 곧바로 디스크에 쓰므로, 상한이 지키려는 비용 자체가 발생하지 않는다.
  // 대조군이 없으면 위 두 테스트는 "상한이 모든 표면에 걸린다"는 더 넓은(그리고
  // 틀린) 구현도 그대로 통과시킨다.
  it("문서 편집기에는 이 상한이 걸리지 않는다", async () => {
    const doc = new Editor({
      content: "",
      extensions: createBaramExtensions(),
    });
    pasteInto(doc, fileOfSize("huge.png", MAX_INLINE_MEDIA_BYTES + 1));
    // 저장 시도는 다른 경로(활성 탭)로 가고 여기서는 상한 토스트가 뜨지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const messages = showToastMock.mock.calls.map((c) => c[0] as string);
    expect(
      messages.filter((m) => m.includes("huge.png") && m.includes("25")),
    ).toEqual([]);
    doc.destroy();
    editor.destroy();
  });
});
