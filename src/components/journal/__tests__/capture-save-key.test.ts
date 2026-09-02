// §324-e 캡처 창의 `Mod+Enter` — 저장 제스처이지 하드 브레이크가 아니다.
//
// ‼️ 이 파일이 존재하는 이유는 **픽스처가 결함에 닿아야** 하기 때문이다. 앞선
// 수정은 `"x\\\n"` 같은 손으로 쓴 본문을 먹였는데, 프로덕션은 그 문자열을 절대
// 만들지 않는다 — `getMarkdown()`이 `.trim()`으로 끝나므로 끝의 하드 브레이크는
// 줄바꿈 없이 `x\`로 도착한다. 그래서 여기서는 **실제 저장 제스처**(키맵에 흘리는
// `Mod-Enter`)로 상태를 만들고, `getMarkdown()`이 실제로 돌려주는 것을 단정한다.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildCaptureLine } from "../../../services/task-capture";
import { useCaptureEditor } from "../use-capture-editor";

/**
 * 캡처 편집기에 `Mod+Enter`를 흘린다.
 *
 * ‼️ `ctrlKey`다, `metaKey`가 아니다. ProseMirror는 `navigator.platform`으로 Mac을
 * 판정해 `Mod-`를 Meta/Ctrl로 가르는데 jsdom의 platform은 Mac이 아니다 — `metaKey`로
 * 보내면 키맵이 아예 매칭되지 않아, 이 테스트가 **아무것도 확인하지 못한 채** 통과한다
 * (실제로 처음 그렇게 통과했다).
 */
function pressModEnter(
  editor: NonNullable<ReturnType<typeof useCaptureEditor>["editor"]>,
) {
  const ev = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: "Enter",
  });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev));
}

describe("§324-e Mod+Enter가 하드 브레이크를 넣지 않는다", () => {
  it("저장 제스처 뒤에도 본문이 그대로다 — `\\`가 붙지 않는다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    await act(async () => {
      editor.commands.insertContent("태스크 테스트");
    });
    const before = result.current.getMarkdown();
    expect(before).toBe("태스크 테스트");

    await act(async () => {
      pressModEnter(editor);
    });

    expect(result.current.getMarkdown()).toBe("태스크 테스트");
  });

  // ‼️ 사용자가 본 정확한 줄. 위 단정만 있으면 "본문이 같다"는 말은 하지만
  // 파일에 무엇이 적히는지는 말하지 않는다.
  it("그 본문으로 만든 태스크 줄에 `\\`가 없다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    await act(async () => {
      editor.commands.insertContent("태스크 테스트");
    });
    await act(async () => {
      pressModEnter(editor);
    });

    expect(
      buildCaptureLine(result.current.getMarkdown(), "2026-09-02", []),
    ).toBe("- [ ] 태스크 테스트 ➕2026-09-02");
  });

  // fleeting note는 한 줄로 접지 않으므로 정규화가 구해 주지 않는다 — 하드 브레이크가
  // 들어가면 노트 본문 끝에 `\`가 그대로 남는다. 원인을 없앤 것이 두 경로를 함께
  // 낫게 한다는 주장이 이 단정이다.
  it("fleeting note 본문에도 `\\`가 남지 않는다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    await act(async () => {
      editor.commands.insertContent("메모 본문");
    });
    await act(async () => {
      pressModEnter(editor);
    });

    expect(result.current.getMarkdown()).not.toContain("\\");
  });

  // ‼️ 대조군이자 회귀 핀. 하드 브레이크 자체를 없앤 것이 아니다 — Shift+Enter는
  // 여전히 줄바꿈을 넣어야 한다. 이것이 없으면 "HardBreak를 통째로 배제"하는
  // 구현도 위 테스트들을 통과한다.
  it("Shift+Enter는 여전히 하드 브레이크를 넣는다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    await act(async () => {
      editor.commands.insertContent("첫 줄");
    });
    await act(async () => {
      const ev = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        shiftKey: true,
      });
      editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev));
    });
    await act(async () => {
      editor.commands.insertContent("둘째 줄");
    });

    const md = result.current.getMarkdown();
    expect(md).toContain("첫 줄");
    expect(md).toContain("둘째 줄");
    expect(md).toContain("\\");
  });

  // 그리고 그 정당한 하드 브레이크가 태스크 줄에서는 공백이 된다 — 잔해를 남기지 않고.
  it("Shift+Enter로 만든 하드 브레이크는 태스크 줄에서 공백이 된다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    await act(async () => {
      editor.commands.insertContent("첫 줄");
    });
    await act(async () => {
      const ev = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        shiftKey: true,
      });
      editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev));
    });
    await act(async () => {
      editor.commands.insertContent("둘째 줄");
    });

    const line = buildCaptureLine(
      result.current.getMarkdown(),
      "2026-09-02",
      [],
    )!;
    expect(line).toBe("- [ ] 첫 줄 둘째 줄 ➕2026-09-02");
    expect(line).not.toContain("\\");
  });

  // ‼️ 끝에 놓인 하드 브레이크 — `.trim()`이 줄바꿈을 없앤 뒤의 모양. 이것이 앞선
  // 수정이 발동하지 못한 바로 그 상태다. 픽스처를 손으로 쓰지 않고 **편집기에서**
  // 만든 뒤, 도착한 문자열이 정말 `\`로 끝나는지 먼저 확인한다.
  it("끝에 놓인 하드 브레이크도 태스크 줄에 `\\`를 남기지 않는다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    await act(async () => {
      editor.commands.insertContent("태스크 테스트");
    });
    await act(async () => {
      const ev = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        shiftKey: true,
      });
      editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev));
    });

    // 전제 확인: 픽스처가 결함이 사는 상태에 실제로 도달했는가.
    const md = result.current.getMarkdown();
    expect(md).toBe("태스크 테스트\\");

    expect(buildCaptureLine(md, "2026-09-02", [])).toBe(
      "- [ ] 태스크 테스트 ➕2026-09-02",
    );
  });
});
