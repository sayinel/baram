import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCaptureEditor } from "../use-capture-editor";

describe("§323 useCaptureEditor", () => {
  it("닫혀 있으면 편집기를 만들지 않는다", () => {
    const { result } = renderHook(() => useCaptureEditor(false));
    expect(result.current.editor).toBeNull();
  });

  it("열리면 편집기를 만들고 빈 상태로 시작한다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    expect(result.current.editor).not.toBeNull();
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.getMarkdown()).toBe("");
  });

  it("입력한 내용을 마크다운으로 돌려준다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    await act(async () => {
      result.current.editor!.commands.setContent("<h2>제목</h2><p>본문</p>");
    });
    const md = result.current.getMarkdown();
    expect(md).toContain("## 제목");
    expect(md).toContain("본문");
    expect(result.current.isEmpty).toBe(false);
  });

  it("reset은 문서를 비운다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    await act(async () => {
      result.current.editor!.commands.setContent("<p>x</p>");
    });
    await act(async () => result.current.reset());
    expect(result.current.isEmpty).toBe(true);
  });

  // 다이얼로그는 열고 닫기가 잦다. 파기하지 않으면 인스턴스가 쌓인다.
  it("언마운트하면 편집기를 파기한다", async () => {
    const { result, unmount } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    unmount();
    expect(editor.isDestroyed).toBe(true);
  });

  it("캡처 프로파일이 적용된다 — vim이 실려 있지 않다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const loaded = result.current.editor!.extensionManager.extensions.map(
      (e) => e.name,
    );
    expect(loaded).not.toContain("wysiwygVim");
  });
});
