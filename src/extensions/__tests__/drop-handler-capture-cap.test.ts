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
