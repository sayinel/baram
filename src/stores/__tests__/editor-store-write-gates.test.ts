// §513/§318 editor store 고빈도 write 동등성 관문 핀 — CLAUDE.md 규약:
// "고빈도 경로의 store write는 동등성 관문 필수 — 값이 같으면 set을 호출하지
// 말 것 (partial은 새 root가 되어 모든 리스너를 깨운다)". markDirty와
// setCurrentSelection이 값이 같을 때도 알림을 내면 안 된다는 걸 알림
// 횟수와 참조 동일성으로 고정한다.
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../editor/editor";

beforeEach(() => {
  useEditorStore.setState({
    activeTabId: null,
    tabs: [],
    mruOrder: [],
    currentSelection: "",
  });
});

describe("editor store write gates", () => {
  describe("markDirty", () => {
    beforeEach(() => {
      useEditorStore.setState({
        tabs: [
          {
            contextId: "",
            id: "a",
            filePath: "a.md",
            title: "A",
            isDirty: false,
            isPinned: false,
          },
        ],
      });
    });

    it("notifies once when isDirty actually changes", () => {
      let notifications = 0;
      const unsub = useEditorStore.subscribe(() => {
        notifications++;
      });
      useEditorStore.getState().markDirty("a", true);
      unsub();
      expect(notifications).toBe(1);
      expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    });

    it("does not notify when called again with the same value", () => {
      useEditorStore.getState().markDirty("a", true);
      const tabsBefore = useEditorStore.getState().tabs;

      let notifications = 0;
      const unsub = useEditorStore.subscribe(() => {
        notifications++;
      });
      useEditorStore.getState().markDirty("a", true);
      unsub();

      expect(notifications).toBe(0);
      expect(useEditorStore.getState().tabs).toBe(tabsBefore);
    });

    it("does not notify for a tabId that does not exist", () => {
      let notifications = 0;
      const unsub = useEditorStore.subscribe(() => {
        notifications++;
      });
      useEditorStore.getState().markDirty("missing", true);
      unsub();
      expect(notifications).toBe(0);
    });
  });

  describe("setCurrentSelection", () => {
    it("notifies once when the text actually changes", () => {
      let notifications = 0;
      const unsub = useEditorStore.subscribe(() => {
        notifications++;
      });
      useEditorStore.getState().setCurrentSelection("x");
      unsub();
      expect(notifications).toBe(1);
      expect(useEditorStore.getState().currentSelection).toBe("x");
    });

    it("does not notify when called again with the same text", () => {
      useEditorStore.getState().setCurrentSelection("x");

      let notifications = 0;
      const unsub = useEditorStore.subscribe(() => {
        notifications++;
      });
      useEditorStore.getState().setCurrentSelection("x");
      unsub();

      expect(notifications).toBe(0);
    });
  });
});
