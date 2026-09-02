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
// §324-e 동영상은 이미지와 **다른** 저장 함수로 샌다 — `insertVideoFromBytes`는
// `isJournal`을 보지 않고 `ctx.filePath`만 있으면 그 옆에 쓴다. 이미지 쪽만
// 막아 두면 그 가지가 열린 채로 남으므로 둘 다 자른다.
const saveMediaToDocAssets = vi.fn(
  async (_bytes: Uint8Array, name: string) => `assets/${name}`,
);
vi.mock("../../../utils/media-assets", () => ({
  saveMediaToDocAssets: (...a: unknown[]) =>
    saveMediaToDocAssets(...(a as [Uint8Array, string])),
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

/** 파일 하나를 담은 붙여넣기 이벤트 — 여러 describe가 함께 쓴다. */
function makePasteEvent(file: File): ClipboardEvent {
  return {
    clipboardData: { files: [file], getData: () => "" },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
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

  // ‼️ §298 불변식 핀 — Extension 배열의 identity 안정성.
  //
  // `use-capture-editor.ts`의 effect deps가 `[open, extensions]`인 것 자체는
  // 밖에서 관측할 수 없다: `extensions`가 `useMemo(..., [])`로 고정돼 있어
  // identity가 절대 바뀌지 않으므로, deps에서 그것을 빼도 effect가 도는 시점이
  // 달라지지 않는다(리뷰 D의 뮤테이션이 살아남은 이유). 관측 가능하고 실제로
  // 지킬 값어치가 있는 것은 그 **전제** 쪽이다 — 배열이 정말 안정적인가.
  //
  // 깨지면 나는 사고: 다이얼로그는 리렌더될 때마다 새 `resolveDropDestination`
  // 함수를 만든다(태스크 모드 토글 등). 그것이 `extensions`의 identity를 바꾸면
  // effect가 다시 돌아 편집기를 파기·재생성하고, 타이핑 중이던 본문이 사라진다.
  describe("§298 리렌더가 편집기를 재생성하지 않는다", () => {
    it("리졸버 identity가 바뀌어도 같은 인스턴스와 본문이 유지된다", async () => {
      const { rerender, result } = renderHook(
        ({ resolve }: { resolve: () => null | string }) =>
          useCaptureEditor(true, resolve),
        { initialProps: { resolve: () => "/vault/zettel/inbox/a.md" } },
      );
      await act(async () => {});
      const first = result.current.editor!;
      await act(async () => {
        first.commands.setContent("<p>쓰던 글</p>");
      });

      // 다이얼로그 리렌더가 만드는 것과 같은, 새 함수 identity.
      rerender({ resolve: () => "/vault/zettel/inbox/b.md" });
      await act(async () => {});

      expect(result.current.editor).toBe(first);
      expect(first.isDestroyed).toBe(false);
      expect(result.current.getMarkdown()).toBe("쓰던 글");
    });

    // 안정성만으로는 부족하다 — 배열을 고정한 대가로 낡은 리졸버를 붙들고
    // 있으면 그것대로 §324-e를 되돌리는 결함이다. ref 우회가 실제로 최신 값을
    // 읽는지까지 같이 본다.
    //
    // §324-e round 3에서 관측 지점이 옮겨졌다: 붙여넣기는 이제 목적지를 아예
    // 묻지 않는다(`deferMediaToHost` — 저장 전에는 디스크에 쓰지 않는다). 남은
    // 소비자는 스토어에 게시되는 접근자(OS 드랍이 읽는다)와 다이얼로그의 저장
    // 경로다. 게시물이 낡으면 드랍한 이미지가 옛 목적지의 assets/로 간다.
    it("그러면서도 최신 리졸버를 게시한다 — 낡은 목적지가 남지 않는다", async () => {
      const { rerender } = renderHook(
        ({ resolve }: { resolve: () => null | string }) =>
          useCaptureEditor(true, resolve),
        { initialProps: { resolve: () => "/vault/zettel/inbox/OLD.md" } },
      );
      await act(async () => {});
      rerender({ resolve: () => "/vault/zettel/inbox/NEW.md" });
      await act(async () => {});

      expect(
        useEditorStore.getState().captureDropAccess?.resolveDestinationPath(),
      ).toBe("/vault/zettel/inbox/NEW.md");
      useEditorStore.getState().registerCaptureDropAccess(null);
    });
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

    // ‼️ §324-e round 3 — 이 describe의 계약이 바뀌었다.
    //
    // 예전 계약은 "리졸버가 준 경로 **아래에 저장한다**"였다. 사용자가 실물에서
    // 찾은 결함 셋이 전부 그 즉시 쓰기에서 나왔다: 취소해도 이미지가 assets/에
    // 남았고(디스크에 이미 쓴 것을 취소가 되돌릴 수 없다), 캡처 상자에는 그림
    // 대신 alt 텍스트만 보였다(탭이 아닌 표면에는 상대참조 `assets/x.png`를 풀
    // baseDir이 없다 — `activeFileDir()`는 메인 창의 활성 탭을 읽는다). 붙여넣기와
    // 드랍 양쪽이 같은 병이었다.
    //
    // 지금 계약은 **"저장을 누르기 전에는 아무것도 디스크에 쓰지 않는다"**이다.
    // 목적지는 버려지지 않고 저장 시점으로 옮겨 갔다 — 어느 디렉터리에 실제로
    // 쓰이는지는 `QuickCaptureDialog.test.tsx`가 본다.
    //
    // 픽스처의 탭 경로 모양이 이 describe 전체의 구분력을 정한다 — 장식이 아니다.
    // `/vault/daily/…`는 `journalDirectory` 밑이므로, 즉시 쓰기가 되살아나면
    // `getJournalContext`가 이 탭을 `isJournal: true`로 보고 `savePhotoToAssets`를
    // 부른다. 저널이 아닌 경로였다면 되살아난 코드도 고친 코드와 **똑같이**
    // data URL로 떨어져 아래 단정이 둘을 구별하지 못한다.
    describe("저장 전에는 아무것도 디스크에 쓰지 않는다", () => {
      const originalEditorState = useEditorStore.getState();
      const originalFileState = useFileStore.getState();
      const originalSettingsState = useSettingsStore.getState();

      beforeEach(() => {
        savePhotoToAssets.mockClear();
        saveMediaToDocAssets.mockClear();
        useEditorStore.setState({
          activeTabId: "t1",
          tabs: [{ id: "t1", filePath: "/vault/daily/2026-09-02.md" }],
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
        useEditorStore.getState().registerCaptureDropAccess(null);
      });

      // ‼️ 두 번째 행이 이 테이블의 요점이다. 목적지를 **아는데도** 쓰지 않는다는
      // 것이 새 계약이고, 예전 코드는 정확히 그 경우에 파일을 만들었다. 첫 행만
      // 있으면 "목적지가 없어서 못 썼다"와 구별되지 않는다.
      const resolvers: [string, (() => null | string) | undefined][] = [
        ["리졸버가 없어도", undefined],
        ["리졸버가 경로를 줘도", () => "/vault/zettel/inbox/__capture__.md"],
      ];

      it.each(resolvers)(
        "%s 붙여넣은 이미지는 data URL로만 들어간다",
        async (_label, resolve) => {
          const { result } = renderHook(() => useCaptureEditor(true, resolve));
          await act(async () => {});
          const editor = result.current.editor!;

          const event = makePasteEvent(
            new File(["x"], "pearl-2.png", { type: "image/png" }),
          );
          editor.view.someProp("handlePaste", (f) =>
            f(editor.view, event, Slice.empty),
          );

          await vi.waitFor(() => {
            expect(result.current.getMarkdown()).not.toBe("");
          });
          expect(savePhotoToAssets).not.toHaveBeenCalled();
          expect(saveMediaToDocAssets).not.toHaveBeenCalled();
          // 원본 파일명이 alt로 살아남는다 — data URL은 이름을 담지 못하므로
          // 이것이 추출이 파일명을 되찾는 유일한 통로다.
          expect(result.current.getMarkdown()).toMatch(
            /^!\[pearl-2\.png\]\(data:image\/png;base64,/,
          );
        },
      );

      // 동영상은 이미지와 다른 가지로 샌다: `insertVideoFromBytes`는 `isJournal`을
      // 보지 않고 `ctx.filePath`만 있으면 그 옆에 쓴다. 즉 즉시 쓰기가 되살아나면
      // 탭이 저널이든 아니든 새므로 이미지와 별도로 고정할 값어치가 있다.
      it.each(resolvers)(
        "%s 붙여넣은 동영상도 data URL로만 들어간다",
        async (_label, resolve) => {
          const { result } = renderHook(() => useCaptureEditor(true, resolve));
          await act(async () => {});
          const editor = result.current.editor!;

          const event = makePasteEvent(
            new File(["x"], "clip.mp4", { type: "video/mp4" }),
          );
          editor.view.someProp("handlePaste", (f) =>
            f(editor.view, event, Slice.empty),
          );

          await vi.waitFor(() => {
            expect(result.current.getMarkdown()).not.toBe("");
          });
          expect(savePhotoToAssets).not.toHaveBeenCalled();
          expect(saveMediaToDocAssets).not.toHaveBeenCalled();
          expect(result.current.getMarkdown()).toMatch(
            /^!\[clip\.mp4\]\(data:video\/mp4;base64,/,
          );
        },
      );

      // ‼️ `data:video/mp4;…`에는 확장자가 없다. `classifyMediaSrc`가 MIME을 읽지
      // 않으면 `extensionOf`가 마지막 `/` 뒤에서 점을 찾다 실패해 `null`을 내고,
      // 동영상이 **image 노드**로 들어간다 — 마크다운은 위 테스트를 그대로
      // 통과하지만(두 노드가 같은 `![]()`로 직렬화된다) 화면에는 재생되지 않는
      // 깨진 그림이 뜬다. 노드 타입까지 봐야 그 둘이 갈린다.
      it("동영상 data URL은 image가 아니라 video 노드가 된다", async () => {
        const { result } = renderHook(() => useCaptureEditor(true));
        await act(async () => {});
        const editor = result.current.editor!;

        const event = makePasteEvent(
          new File(["x"], "clip.mp4", { type: "video/mp4" }),
        );
        editor.view.someProp("handlePaste", (f) =>
          f(editor.view, event, Slice.empty),
        );

        await vi.waitFor(() => {
          expect(result.current.getMarkdown()).not.toBe("");
        });
        const names: string[] = [];
        editor.state.doc.descendants((n) => void names.push(n.type.name));
        expect(names).toContain("video");
        expect(names).not.toContain("image");
      });

      // 저장 경로가 파일로 꺼낼 목록. 여기서 alt가 비면 추출이 원본 파일명을
      // 잃고 모든 이미지가 `image.png`, `image-1.png`이 된다.
      it("getPendingMedia가 붙여넣은 미디어를 원본 이름과 함께 보고한다", async () => {
        const { result } = renderHook(() => useCaptureEditor(true));
        await act(async () => {});
        const editor = result.current.editor!;

        expect(result.current.getPendingMedia()).toEqual([]);

        const event = makePasteEvent(
          new File(["x"], "pearl-2.png", { type: "image/png" }),
        );
        editor.view.someProp("handlePaste", (f) =>
          f(editor.view, event, Slice.empty),
        );

        await vi.waitFor(() => {
          expect(result.current.getPendingMedia()).toHaveLength(1);
        });
        const [pending] = result.current.getPendingMedia();
        expect(pending.alt).toBe("pearl-2.png");
        expect(pending.src).toMatch(/^data:image\/png;base64,/);
      });

      // ‼️ SyntaxReveal 회귀 핀. 커서가 이미지 위에 있으면 그것을 리터럴
      // `![alt](src)` **텍스트**로 펼쳐 두므로, 그 순간의 `state.doc`에는 미디어
      // 노드가 없다. `getPendingMedia`가 `canonicalDoc`이 아니라 `state.doc`을
      // 세면 추출 목록이 비고, 그런데도 `getMarkdown`(=`serializeLiveDoc`)은
      // 접힌 doc을 직렬화하므로 data URL이 노트에 그대로 실린다 — 두 함수가
      // 서로 다른 doc을 보는 순간 조용히 갈라진다.
      it("커서가 이미지 위에 있어도(펼쳐진 상태) pending을 놓치지 않는다", async () => {
        const { result } = renderHook(() => useCaptureEditor(true));
        await act(async () => {});
        const editor = result.current.editor!;

        const event = makePasteEvent(
          new File(["x"], "pearl-2.png", { type: "image/png" }),
        );
        editor.view.someProp("handlePaste", (f) =>
          f(editor.view, event, Slice.empty),
        );
        await vi.waitFor(() => {
          expect(result.current.getPendingMedia()).toHaveLength(1);
        });

        // 펼침을 실제로 일으키는 순서. SyntaxReveal은 (1) 문서가 바뀐 직후의
        // 커서 위치에서는 펼치지 않고(입력 규칙 → 즉시 재펼침 루프 방지),
        // (2) NodeSelection 감지를 `requestAnimationFrame`으로 미룬다. 그래서
        // 뒤에 문단을 하나 만들어 커서를 옮겼다가 이미지로 돌아오고, 프레임을
        // 하나 흘려보낸다.
        await act(async () => {
          editor.commands.insertContentAt(
            editor.state.doc.content.size,
            "<p>tail</p>",
          );
        });
        await act(async () => {
          editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        });
        let imagePos = -1;
        editor.state.doc.descendants((n, pos) => {
          if (n.type.name === "image") imagePos = pos;
        });
        expect(imagePos).toBeGreaterThanOrEqual(0);
        await act(async () => {
          editor.commands.setNodeSelection(imagePos);
        });
        await act(async () => {
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        });

        // 전제 확인 — 정말로 펼쳐져 이미지 노드가 사라졌는가. 이것이 거짓이면
        // 아래 단정은 `state.doc`을 세는 구현도 그대로 통과시킨다.
        const liveNames: string[] = [];
        editor.state.doc.descendants((n) => void liveNames.push(n.type.name));
        expect(liveNames).not.toContain("image");

        expect(result.current.getPendingMedia()).toHaveLength(1);
        // 직렬화도 같은 doc을 본다 — 둘이 갈리면 data URL이 노트에 남는다.
        expect(result.current.getMarkdown()).toContain(
          "data:image/png;base64,",
        );
      });

      // ‼️ 이미 디스크에 있는 참조는 pending이 아니다. 여기가 무너지면 노트를
      // 저장할 때마다 기존 이미지를 다시 assets/에 복사해 사본이 쌓인다.
      it("이미 상대경로인 이미지는 pending이 아니다", async () => {
        const { result } = renderHook(() => useCaptureEditor(true));
        await act(async () => {});
        await act(async () => {
          result.current.editor!.commands.setContent(
            '<p><img src="assets/old.png" alt="old"></p>',
          );
        });
        expect(result.current.getPendingMedia()).toEqual([]);
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

// §324-e OS 파일 드래그는 ProseMirror에 도달하지 않는다(Tauri 네이티브가 먼저
// 가로챈다) — 그것을 받는 훅은 App 수준에서 메인 편집기만 들고 돈다. 그래서 이
// 훅이 자기 인스턴스와 목적지 리졸버를 스토어에 게시하고, 그 게시물의 수명이 곧
// 인스턴스의 수명이어야 한다.
describe("§324-e 캡처 편집기의 드랍 접근자 등록", () => {
  afterEach(() => {
    useEditorStore.getState().registerCaptureDropAccess(null);
  });

  it("열려 있는 동안 살아 있는 인스턴스를 게시한다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});

    const access = useEditorStore.getState().captureDropAccess;
    expect(access).not.toBeNull();
    // 다른 편집기가 아니라 **이** 인스턴스여야 한다 — 아니면 드랍이 화면에
    // 보이지 않는 문서로 들어간다.
    expect(access?.editor).toBe(result.current.editor);
    expect(access?.editor.isDestroyed).toBe(false);
  });

  it("호출부의 리졸버를 그대로 통과시킨다 — 재계산하지 않는다", async () => {
    // 붙여넣기 경로와 같은 함수여야 한다. 훅이 설정에서 목적지를 다시 유도하려
    // 한 것이 애초에 붙여넣기를 태스크 모드에 눈멀게 한 결함이었다(§324-e r1).
    const resolve = vi.fn(() => "/vault/zettel/inbox/__capture__.md");
    renderHook(() => useCaptureEditor(true, resolve));
    await act(async () => {});

    expect(
      useEditorStore.getState().captureDropAccess?.resolveDestinationPath(),
    ).toBe("/vault/zettel/inbox/__capture__.md");
    expect(resolve).toHaveBeenCalled();
  });

  it("닫히면 게시물을 지운다", async () => {
    // ‼️ 남겨 두면 파기된 편집기를 가리키는 접근자가 스토어에 남는다 —
    // `SourceBufferAccess`가 같은 이유로 같은 경고를 달고 있다.
    const { rerender } = renderHook(({ open }) => useCaptureEditor(open), {
      initialProps: { open: true },
    });
    await act(async () => {});
    expect(useEditorStore.getState().captureDropAccess).not.toBeNull();

    rerender({ open: false });
    await act(async () => {});

    expect(useEditorStore.getState().captureDropAccess).toBeNull();
  });

  it("다시 열면 새 인스턴스로 갱신된다 — 죽은 것을 가리키지 않는다", async () => {
    const { rerender, result } = renderHook(
      ({ open }) => useCaptureEditor(open),
      { initialProps: { open: true } },
    );
    await act(async () => {});
    const first = result.current.editor;

    rerender({ open: false });
    await act(async () => {});
    rerender({ open: true });
    await act(async () => {});

    const access = useEditorStore.getState().captureDropAccess;
    expect(access?.editor).toBe(result.current.editor);
    expect(access?.editor).not.toBe(first);
    expect(first?.isDestroyed).toBe(true);
    expect(access?.editor.isDestroyed).toBe(false);
  });
});
