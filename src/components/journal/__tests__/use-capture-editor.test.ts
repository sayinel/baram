import type { Editor } from "@tiptap/react";

import { act, renderHook } from "@testing-library/react";
import { Slice } from "@tiptap/pm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useCaptureEditor } from "../use-capture-editor";

const savePhotoToAssets = vi.fn(
  async (_bytes: Uint8Array, name: string) => `assets/${name}`,
);
vi.mock("../../../utils/journal/journal-photo", () => ({
  savePhotoToAssets: (...a: unknown[]) =>
    savePhotoToAssets(...(a as [Uint8Array, string])),
}));

/**
 * 입력 규칙을 실제로 발동시키며 텍스트를 넣는다 — `task-input-rules.test.ts`와
 * 같은 패턴. `setContent`는 노드를 직접 만들어 입력 규칙 매칭 경로
 * (`@tiptap/core`의 `InputRule.ts` → `inputRulesPlugin`)를 절대 태우지 않는다.
 * `applyInputRules: true`는 `tr.setMeta('applyInputRules', ...)`만 남기고 실제
 * 매칭은 `apply()`가 `setTimeout`으로 다음 macrotask에서 수행하므로, 그 tick을
 * 흘려보낸 뒤에 반환한다.
 */
async function type(editor: Editor, text: string): Promise<void> {
  editor.commands.focus("end");
  const pos = editor.state.selection.from;
  editor.commands.insertContentAt(pos, text, { applyInputRules: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

  // ‼️ Finding 1 회귀 핀. `Editor.isEmpty`(→ `isNodeEmpty`)는 기본값
  // `ignoreWhitespace: false`라 공백만 있는 텍스트 노드를 "비어 있지 않다"고
  // 본다. `setContent(html)`은 HTML 파싱 중 공백 전용 텍스트 노드를 접어
  // 없애 버리므로 이 결함에 절대 닿지 못한다 — 그래서 실제 트랜잭션
  // (`tr.insertText`)으로 공백을 넣는다.
  it("공백만 있는 본문은 비어 있다고 본다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    await act(async () => {
      const { view } = editor;
      view.dispatch(view.state.tr.insertText("   ", 1));
    });
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.getMarkdown()).toBe("");
  });

  // ‼️ Finding 2 회귀 핀. Task 2의 유일한 헤딩 테스트는 `setContent("<h2>...")`로
  // 노드를 직접 만들어, "## "를 타이핑하면 실제로 헤딩이 되는지(입력 규칙 매칭
  // 경로)는 아무도 확인한 적이 없었다 — Finding 1이 모든 테스트를 통과한 채로
  // 숨어 있었던 이유이기도 하다(`setContent`가 공백 전용 텍스트 노드를 접기
  // 때문). `type()` 헬퍼로 실제 입력 규칙 파이프라인을 태운다.
  it("'## '를 실제로 타이핑하면 heading 입력 규칙이 발동한다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;

    await act(async () => {
      await type(editor, "## ");
    });
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");

    await act(async () => {
      await type(editor, "제목");
    });

    const md = result.current.getMarkdown();
    expect(md).toContain("## 제목");
  });

  // §324-e — 브리프의 두 테스트는 dropHandler가 실려 있는지·이미지 노드가
  // 마크다운으로 직렬화되는지만 본다. 둘 다 캡처와 무관한 메인 창 문서로
  // 오염되는 버그를 못 잡는다 — 아래 세 번째 테스트가 그 간극을 메운다.
  describe("§324-e 이미지", () => {
    it("캡처 편집기에 드롭 핸들러가 실려 있다", async () => {
      const { result } = renderHook(() => useCaptureEditor(true));
      await act(async () => {});
      const loaded = result.current.editor!.extensionManager.extensions.map(
        (e) => e.name,
      );
      expect(loaded).toContain("dropHandler");
    });

    it("이미지 노드가 마크다운으로 직렬화된다", async () => {
      const { result } = renderHook(() => useCaptureEditor(true));
      await act(async () => {});
      await act(async () => {
        result.current.editor!.commands.setContent(
          '<p><img src="assets/x.png" alt="그림"></p>',
        );
      });
      expect(result.current.getMarkdown()).toContain("![그림](assets/x.png)");
    });

    function makePasteEvent(file: File): ClipboardEvent {
      return {
        clipboardData: { files: [file], getData: () => "" },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
    }

    // ‼️ 이 테스트가 실제로 재현하는 회귀: 메인 창에 문서 탭이 열려 있으면
    // (드롭 핸들러가 `useEditorStore`의 활성 탭을 읽으므로) 캡처 다이얼로그에
    // 붙여넣은 이미지가 그 무관한 문서 옆에 저장되고, 캡처 노트에 남는
    // 상대경로(`assets/x.png`)는 실제 저장 위치(`{zettelDir}/inbox/`)에서
    // 풀리지 않는다 — 참조는 있는데 파일은 없는 조용한 데이터 손실.
    describe("메인 창의 무관한 탭으로부터 오염되지 않는다", () => {
      const originalEditorState = useEditorStore.getState();
      const originalFileState = useFileStore.getState();
      const originalSettingsState = useSettingsStore.getState();

      beforeEach(() => {
        savePhotoToAssets.mockClear();
        // 메인 창에 "저널"이 아닌, 캡처와 전혀 무관한 문서가 열려 있다 —
        // 저널 여부와 무관하게 캡처는 항상 자기 목적지를 알아야 한다.
        useEditorStore.setState({
          activeTabId: "t1",
          tabs: [{ id: "t1", filePath: "/vault/notes/unrelated.md" }],
        } as never);
        useFileStore.setState({ rootPath: "/vault" } as never);
        useSettingsStore.setState({
          zettelkastenEnabled: true,
          zettelkastenDirectory: "/vault/zettel",
          journalDirectory: "/vault/daily",
        } as never);
      });

      afterEach(() => {
        useEditorStore.setState(originalEditorState, true);
        useFileStore.setState(originalFileState, true);
        useSettingsStore.setState(originalSettingsState, true);
      });

      it("붙여넣은 이미지를 zettel inbox 아래에 저장한다 — 무관한 탭 옆이 아니라", async () => {
        const { result } = renderHook(() => useCaptureEditor(true));
        await act(async () => {});
        const editor = result.current.editor!;

        const event = makePasteEvent(
          new File(["x"], "shot.png", { type: "image/png" }),
        );
        const handled = editor.view.someProp("handlePaste", (f) =>
          f(editor.view, event, Slice.empty),
        );
        expect(handled).toBe(true);

        await vi.waitFor(() => {
          expect(savePhotoToAssets).toHaveBeenCalled();
        });

        // 다섯 번째 인자(activeFilePath)가 곧 `savePhotoToAssets`가 assets/를
        // 걸어 두는 디렉터리를 정한다(`journal-photo.ts`의 `dirname`) —
        // 무관한 문서(`/vault/notes/...`)가 아니라 zettel inbox 아래여야
        // 그 디렉터리에서 저장한 파일과 캡처 노트에 남는 `assets/…`
        // 상대경로가 같은 곳을 가리킨다.
        expect(savePhotoToAssets).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          "shot.png",
          expect.anything(),
          expect.anything(),
          expect.stringMatching(/^\/vault\/zettel\/inbox\//),
        );

        expect(result.current.getMarkdown()).toBe(
          "![shot.png](assets/shot.png)",
        );
      });

      // 동영상은 원래 더 쉽게 터졌다: `insertVideoFromBytes`는 저널 여부와
      // 무관하게 `ctx.filePath`만 있으면 그 옆에 저장한다 — 메인 창에 아무
      // 탭이나 열려 있으면(저널이 아니어도) 캡처로 넣은 동영상이 그 옆에
      // 저장됐다. 탭이 아예 없으면 캡처 노트가 실존하는데도 "문서가
      // 저장되지 않았다" 토스트로 거부됐다.
      it("붙여넣은 동영상도 zettel inbox 아래에 저장한다 — 메인 창 탭 유무와 무관하게", async () => {
        const { result } = renderHook(() => useCaptureEditor(true));
        await act(async () => {});
        const editor = result.current.editor!;

        const event = makePasteEvent(
          new File(["x"], "clip.mp4", { type: "video/mp4" }),
        );
        const handled = editor.view.someProp("handlePaste", (f) =>
          f(editor.view, event, Slice.empty),
        );
        expect(handled).toBe(true);

        await vi.waitFor(() => {
          expect(savePhotoToAssets).toHaveBeenCalled();
        });

        expect(savePhotoToAssets).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          "clip.mp4",
          expect.anything(),
          expect.anything(),
          expect.stringMatching(/^\/vault\/zettel\/inbox\//),
        );
        expect(result.current.getMarkdown()).toBe(
          "![clip.mp4](assets/clip.mp4)",
        );
      });
    });
  });
});
