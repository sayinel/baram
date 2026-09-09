// §340 A disabled feature can leave a persisted UI pointer aimed at a seat
// that no longer has an icon to close it (rightPanelMode defaults to "chat",
// and both sidebarPanel/rightPanelMode are persisted). Two layers guard
// against that: ⓐ an effect (in useSettingsEffects) that moves the pointer
// off a hidden seat, and ⓑ a render guard on each affected panel — the
// effect alone leaves the first paint after rehydration unguarded, and the
// guard alone leaves the user staring at an empty panel with no way out.
import { act } from "react";

import { render, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ‼️ `useSettingsEffects` syncs two native menus through a LAZY `import()` (§82). A test
// that renders this hook (directly, or indirectly via <EffectHost>) starts those loads —
// and one resolving after vitest tears the environment down fails the WHOLE run with every
// test passing (see ThemeEditor.test.tsx / use-settings-effects-menu-sync.test.tsx, which
// document the same guard). Mocking both modules makes that structurally impossible.
const menuIpc = vi.hoisted(() => ({
  syncMenuLocale: vi.fn(() => Promise.resolve()),
  syncRecentMenu: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../ipc/menu-locale", () => ({
  syncMenuLocale: menuIpc.syncMenuLocale,
}));
vi.mock("../../../ipc/recent-menu", () => ({
  syncRecentMenu: menuIpc.syncRecentMenu,
}));

import { useSettingsEffects } from "../../../hooks/use-settings-effects";
import { useAIStore } from "../../../stores/ai/ai";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { AIChatPanel } from "../../ai/AIChatPanel";
import { MemoriesPanel } from "../../journal/MemoriesPanel";
import { PhotoGalleryPanel } from "../../journal/PhotoGalleryPanel";
import { Sidebar } from "../Sidebar";

// ⓐ 이동 이펙트는 `useSettingsEffects` 안에 산다. 그 훅은 editor 를 받으므로
// 여기서는 최소 호출자를 하나 세운다.
function EffectHost() {
  useSettingsEffects(null);
  return null;
}

// ⓑ Both guarded sidebar panels are `React.lazy`, so the FIRST dynamic import of either
// module pays a real transform cost (Vite parses and transforms it plus its whole
// dependency tree on demand) — observed >1s cold in this suite for CalendarPanel. Warming
// the module cache here, before any test's `waitFor` clock starts, keeps the assertions'
// timeouts meaningful (a short window that must not elapse for the negative cases) instead
// of padded out to hide a one-time transform cost that has nothing to do with the guard.
beforeAll(async () => {
  await import("../../sidebar/CalendarPanel");
  await import("../../zettelkasten/ZettelHubPanel");
});

describe("seat pointer recovery (§340)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      journalEnabled: true,
      tasksEnabled: true,
      zettelkastenEnabled: true,
    });
    useAIStore.setState({ aiEnabled: true });
    useUIStore.setState({
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: true,
      rightPanelMode: "none",
    });
  });

  describe("ⓐ move-off-a-hidden-seat effect", () => {
    it("moves sidebarPanel off a hidden seat", () => {
      useUIStore.setState({ sidebarPanel: "calendar" });
      render(<EffectHost />);
      act(() => {
        useSettingsStore.setState({ journalEnabled: false });
      });
      expect(useUIStore.getState().sidebarPanel).toBe("files");
    });

    it("moves rightPanelMode off a hidden seat", () => {
      useUIStore.setState({ rightPanelMode: "chat" });
      render(<EffectHost />);
      act(() => {
        useAIStore.setState({ aiEnabled: false });
      });
      expect(useUIStore.getState().rightPanelMode).toBe("none");
    });

    it("leaves an unrelated seat alone — non-vacuity control", () => {
      // 조건 없는 리셋도 위 두 단정을 통과한다. 이 절만이 그것을 배제한다.
      useUIStore.setState({
        sidebarPanel: "graph",
        rightPanelMode: "properties",
      });
      render(<EffectHost />);
      act(() => {
        useSettingsStore.setState({ journalEnabled: false });
      });
      expect(useUIStore.getState().sidebarPanel).toBe("graph");
      expect(useUIStore.getState().rightPanelMode).toBe("properties");
    });
  });

  describe("ⓑ render guards", () => {
    // ‼️ RULING 1: `.sidebar-content` is the WRONG marker for the Sidebar guards —
    // `Sidebar.tsx` gives its Suspense `fallback` the identical class with no children
    // (`<Suspense fallback={<div className="sidebar-content" />}>`), so counting that
    // div's children passes on the fallback alone, before any lazy panel resolves, and
    // would pass identically with the guard deleted.
    //
    // Both CalendarPanel and ZettelHubPanel render an unconditional wrapper element
    // (`.calendar-panel`, `.zettel-hub`) even in their own "not configured" / "disabled"
    // branches — so the wrapper's mere presence is a genuine "this panel actually
    // mounted" signal, distinct from the fallback. Both panels are `React.lazy`, so a
    // real `import()` has to resolve before that wrapper can appear; that is why the
    // positive control below is `await`ed with `waitFor` rather than asserted
    // synchronously right after `render`.
    describe("Sidebar", () => {
      it("mounts CalendarPanel once journal resolves (positive control)", async () => {
        useUIStore.setState({ sidebarPanel: "calendar" });
        const { container } = render(<Sidebar />);
        await waitFor(
          () => {
            expect(container.querySelector(".calendar-panel")).not.toBeNull();
          },
          { timeout: 1000 },
        );
      });

      it("never mounts CalendarPanel while journal is disabled (stale sidebar pointer)", async () => {
        // 재하이드레이션 직후 첫 페인트는 이동 이펙트(ⓐ)보다 빠르다 — 두 겹이
        // 필요한 이유. 여기서는 이펙트를 아예 세우지 않고 ⓑ 렌더 가드 단독으로
        // 막히는지만 본다.
        useSettingsStore.setState({ journalEnabled: false });
        useUIStore.setState({ sidebarPanel: "calendar" });
        const { container } = render(<Sidebar />);
        // 위 positive control과 같은 방식(`waitFor`, 같은 timeout)으로 기다린다 —
        // "안 나타났다"가 충분히 안 기다려서가 아니라는 것을 보이기 위해서다.
        await expect(
          waitFor(
            () => {
              expect(container.querySelector(".calendar-panel")).not.toBeNull();
            },
            { timeout: 1000 },
          ),
        ).rejects.toThrow();
      });

      it("mounts ZettelHubPanel once zettelkasten resolves (positive control)", async () => {
        useUIStore.setState({ sidebarPanel: "zettel" });
        const { container } = render(<Sidebar />);
        await waitFor(
          () => {
            expect(container.querySelector(".zettel-hub")).not.toBeNull();
          },
          { timeout: 1000 },
        );
      });

      it("never mounts ZettelHubPanel while zettelkasten is disabled (stale sidebar pointer)", async () => {
        useSettingsStore.setState({ zettelkastenEnabled: false });
        useUIStore.setState({ sidebarPanel: "zettel" });
        const { container } = render(<Sidebar />);
        await expect(
          waitFor(
            () => {
              expect(container.querySelector(".zettel-hub")).not.toBeNull();
            },
            { timeout: 1000 },
          ),
        ).rejects.toThrow();
      });
    });

    // AIChatPanel is imported directly (not lazy) at its render site, so a plain
    // synchronous `container.firstChild` check is sound here — no lazy import to await.
    describe("AIChatPanel", () => {
      it("renders nothing for a stale chat pointer", () => {
        useAIStore.setState({ aiEnabled: false });
        useUIStore.setState({ rightPanelMode: "chat", rightPanelOpen: true });
        const { container } = render(<AIChatPanel />);
        expect(container.firstChild).toBeNull();
      });

      it("still renders the chat panel when ai is on", () => {
        useUIStore.setState({ rightPanelMode: "chat", rightPanelOpen: true });
        const { container } = render(<AIChatPanel />);
        expect(container.firstChild).not.toBeNull();
      });
    });

    // Neither panel is lazy at its render site here either — same reasoning as
    // AIChatPanel above. journalDirectory/rootPath are left at their default
    // (empty/null), so each panel's own data-loading effects no-op and never touch
    // IPC, keeping this focused on the guard rather than journal content.
    describe("MemoriesPanel", () => {
      it("renders nothing for a stale memories pointer", () => {
        useSettingsStore.setState({ journalEnabled: false });
        useUIStore.setState({
          rightPanelMode: "memories",
          rightPanelOpen: true,
        });
        const { container } = render(<MemoriesPanel />);
        expect(container.firstChild).toBeNull();
      });

      it("still renders the memories panel when journal is on", () => {
        useUIStore.setState({
          rightPanelMode: "memories",
          rightPanelOpen: true,
        });
        const { container } = render(<MemoriesPanel />);
        expect(container.firstChild).not.toBeNull();
      });
    });

    describe("PhotoGalleryPanel", () => {
      it("renders nothing for a stale photo-gallery pointer", () => {
        useSettingsStore.setState({ journalEnabled: false });
        useUIStore.setState({
          rightPanelMode: "photo-gallery",
          rightPanelOpen: true,
        });
        const { container } = render(<PhotoGalleryPanel />);
        expect(container.firstChild).toBeNull();
      });

      it("still renders the gallery panel when journal is on", () => {
        useUIStore.setState({
          rightPanelMode: "photo-gallery",
          rightPanelOpen: true,
        });
        const { container } = render(<PhotoGalleryPanel />);
        expect(container.firstChild).not.toBeNull();
      });
    });
  });
});
