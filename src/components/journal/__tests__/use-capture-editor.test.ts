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
    // 상대경로(`assets/x.png`)는 실제 저장 위치에서 풀리지 않는다 — 참조는
    // 있는데 파일은 없는 조용한 데이터 손실. round 2부터 목적지 계산 자체는
    // `QuickCaptureDialog`(태스크 모드 vs zettel)로 옮겨갔으므로
    // (`QuickCaptureDialog.test.tsx`가 그 분기를 검증한다), 여기서는 훅
    // 자신의 계약만 본다: 무슨 리졸버가 오든(또는 아예 안 오든) 활성 탭으로는
    // 절대 새지 않는다.
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

      // 리졸버를 아예 안 넘겨도 — round 1에서는 이럴 때 훅이 내부에서 계산해
      // 통과했지만, round 2는 그 계산을 호출부 책임으로 옮겼다 — 활성 탭으로
      // 새면 안 된다. `use-capture-editor.ts`는 리졸버 부재와 무관하게 항상
      // 실제 함수를 `DropHandler`에 넘기므로(`resolveDropDestinationRef.current
      // ?? null`), `getJournalContext`는 이 경우를 "목적지 없음"으로 보고
      // data URL 자기완결 경로로 간다 — 활성 탭 조회 자체를 안 한다.
      it("리졸버 없이도 활성 탭으로 새지 않는다 — data URL로 떨어진다", async () => {
        const { result } = renderHook(() => useCaptureEditor(true));
        await act(async () => {});
        const editor = result.current.editor!;

        const event = makePasteEvent(
          new File(["x"], "shot.png", { type: "image/png" }),
        );
        editor.view.someProp("handlePaste", (f) =>
          f(editor.view, event, Slice.empty),
        );

        await vi.waitFor(() => {
          expect(result.current.getMarkdown()).not.toBe("");
        });
        expect(savePhotoToAssets).not.toHaveBeenCalled();
        expect(result.current.getMarkdown()).toMatch(
          /^!\[shot\.png\]\(data:image\/png;base64,/,
        );
      });

      it("리졸버가 경로를 주면 그 경로 아래에 저장한다 — 무관한 탭 옆이 아니라", async () => {
        const { result } = renderHook(() =>
          useCaptureEditor(true, () => "/vault/zettel/inbox/__capture__.md"),
        );
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
        // 무관한 문서(`/vault/notes/...`)가 아니라 리졸버가 준 경로 아래여야
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
      it("리졸버가 경로를 주면 동영상도 그 경로 아래에 저장한다", async () => {
        const { result } = renderHook(() =>
          useCaptureEditor(true, () => "/vault/zettel/inbox/__capture__.md"),
        );
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

  // §324-d — 리치 텍스트 붙여넣기. 설계는 이것을 "WYSIWYG 전환의 가장 큰 실질
  // 이득"이라고 부르는데(`part19-capture-to-hub.md` §324-d) 브랜치 전체를 통틀어
  // 검증하는 테스트가 하나도 없었다. 브라우저·문서에서 복사한 서식이 캡처를
  // 거쳐 마크다운으로 남는지가 요점이다.
  describe("§324-d HTML 붙여넣기", () => {
    /** 실제 `paste` 이벤트를 편집기 DOM에 쏜다 — `setContent`로는 붙여넣기
     *  파이프라인(ProseMirror의 `parseFromClipboard`)을 전혀 태우지 못한다. */
    async function paste(
      editor: Editor,
      data: Record<string, string>,
    ): Promise<void> {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          files: [],
          getData: (type: string) => data[type] ?? "",
          types: Object.keys(data),
        },
      });
      await act(async () => {
        editor.view.dom.dispatchEvent(event);
      });
    }

    const HTML =
      "<h2>제목</h2>" +
      "<p><strong>굵게</strong>와 <em>기울임</em>, 그리고 " +
      '<a href="https://example.com">링크</a>.</p>' +
      "<ul><li>하나</li><li>둘</li></ul>";
    /** 같은 내용을 서식 없이 옮겼을 때 클립보드에 담기는 것. */
    const PLAIN = "제목\n굵게와 기울임, 그리고 링크.\n하나\n둘";

    it("서식이 마크다운으로 살아남는다", async () => {
      const { result } = renderHook(() => useCaptureEditor(true));
      await act(async () => {});
      const editor = result.current.editor!;
      document.body.appendChild(editor.view.dom);

      await paste(editor, { "text/html": HTML, "text/plain": PLAIN });

      expect(result.current.getMarkdown().split("\n")).toEqual([
        "## 제목",
        "",
        "**굵게**와 *기울임*, 그리고 [링크](https://example.com).",
        "",
        "- 하나",
        "- 둘",
      ]);
    });

    // ‼️ 대조군. 위 단정이 "붙여넣은 텍스트에 마침 마크다운 기호가 들어 있었다"가
    // 아니라 "HTML 가지를 실제로 탔다"를 말하려면, 같은 내용을 평문으로 넣었을
    // 때는 그 기호들이 없어야 한다. 이게 없으면 HTML 처리를 통째로 들어내도
    // 위 테스트만 보고는 알 수 없다.
    it("평문으로 넣으면 같은 서식이 생기지 않는다", async () => {
      const { result } = renderHook(() => useCaptureEditor(true));
      await act(async () => {});
      const editor = result.current.editor!;
      document.body.appendChild(editor.view.dom);

      await paste(editor, { "text/plain": PLAIN });

      const md = result.current.getMarkdown();
      expect(md).not.toContain("**굵게**");
      expect(md).not.toContain("## 제목");
      expect(md).not.toContain("](https://example.com)");
      // 내용 자체는 들어왔다 — 아무것도 안 붙어서 통과한 것이 아니다.
      expect(md).toContain("굵게");
    });
  });
});
