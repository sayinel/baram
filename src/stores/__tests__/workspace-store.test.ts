import { beforeEach, describe, expect, it } from "vitest";

import { t } from "../../i18n";
import {
  BUILTIN_PRESETS,
  useWorkspaceStore,
  type WorkspaceLayout,
} from "../file/workspace";
import { useSettingsStore } from "../settings/store";
import { useUIStore } from "../ui/ui";

describe("§52 Workspace Store", () => {
  beforeEach(async () => {
    // Flush pending microtasks from persist middleware async callbacks
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Reset stores to default state
    useWorkspaceStore.setState({
      activePresetId: null,
      customPresets: [],
    });
    useUIStore.setState({
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "chat",
      // §370 모든 내장 프리셋은 셋 다 true 다 — false 로 리셋해야 "프리셋이
      // 적용했다" 는 단언이 비공허하다(true 로 리셋하면 프리셋이 손도 안
      // 대도 통과한다).
      activityBarVisible: false,
      statusBarVisible: false,
      tabBarVisible: false,
    });
  });

  // --- Built-in Presets ---

  it("has 5 built-in presets", () => {
    expect(BUILTIN_PRESETS).toHaveLength(5);
    expect(BUILTIN_PRESETS.map((p) => p.id)).toEqual([
      "writing",
      "zettelkasten",
      "journal",
      "skills",
      "focus",
    ]);
  });

  it("all built-in presets are marked as builtIn", () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.builtIn).toBe(true);
    }
  });

  it("getAllPresets returns built-in + custom presets", () => {
    const store = useWorkspaceStore.getState();
    expect(store.getAllPresets()).toHaveLength(5);
  });

  it("getPreset finds built-in preset by id", () => {
    const store = useWorkspaceStore.getState();
    const writing = store.getPreset("writing");
    expect(writing).toBeDefined();
    expect(writing!.name).toBe("Writing");
  });

  // --- Apply Preset ---

  // §370 A preset chosen by hand ("writing"'s own description says "Hide
  // sidebar and focus on the editor") now closes the sidebar just like it
  // opens one — the old asymmetric guard (open-only) is narrowed to the
  // implicit revert path only (see "implicit applyPreset (opts.implicit)
  // never force-closes an open sidebar" below, same describe block).
  it("explicit applyPreset('writing') closes an open sidebar, closes right panel", () => {
    // §82 sidebar starts open (beforeEach).
    useWorkspaceStore.getState().applyPreset("writing");

    const ui = useUIStore.getState();
    expect(ui.sidebarOpen).toBe(false);
    expect(ui.rightPanelOpen).toBe(false);
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
  });

  it("explicit applyPreset matches the sidebar to the preset in both directions", () => {
    // closed → Skills (sidebarOpen:true) opens it
    useUIStore.setState({ sidebarOpen: false });
    useWorkspaceStore.getState().applyPreset("skills");
    expect(useUIStore.getState().sidebarOpen).toBe(true);

    // open → Writing (sidebarOpen:false) now closes it too (explicit calls
    // are symmetric since §370 — see the narrowed guard's own comment in
    // workspace.ts).
    useWorkspaceStore.getState().applyPreset("writing");
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });

  // §370/§82 The narrowed guard (open-only, never close) survives for the ONE
  // caller that never chose the transition — revertSpaceIfContextClosed.
  it("implicit applyPreset (opts.implicit) never force-closes an open sidebar", () => {
    useUIStore.setState({ sidebarOpen: true });
    useWorkspaceStore.getState().applyPreset("writing", { implicit: true });
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  // §370 The implicit path skips chrome visibility entirely — not "open-only"
  // like the sidebar. The sidebar's open-only rule exists because a preset
  // may legitimately want to REVEAL something on a revert; chrome has no such
  // case, since the revert target is always "writing" and forcing chrome back
  // on is exactly the override this rule set out to exclude. Corpus: the one
  // implicit caller is revertSpaceIfContextClosed (§82).
  it("implicit applyPreset never touches chrome visibility, even to reveal it", () => {
    useUIStore.setState({
      activityBarVisible: false,
      statusBarVisible: false,
      tabBarVisible: false,
    });
    useWorkspaceStore.getState().applyPreset("writing", { implicit: true });
    const ui = useUIStore.getState();
    expect(ui.activityBarVisible).toBe(false);
    expect(ui.statusBarVisible).toBe(false);
    expect(ui.tabBarVisible).toBe(false);
  });

  // 비공허성 짝: 같은 시작 상태에서 명시적 호출은 셋 다 바꾼다(writing 의
  // 레이아웃은 셋 다 true) — 위 단언이 "applyPreset 이 크롬을 아예 안
  // 건드린다"는 일반 버그를 우연히 통과시키는 것이 아님을 확인한다.
  it("explicit applyPreset does change chrome visibility (non-vacuity pair)", () => {
    useUIStore.setState({
      activityBarVisible: false,
      statusBarVisible: false,
      tabBarVisible: false,
    });
    useWorkspaceStore.getState().applyPreset("writing");
    const ui = useUIStore.getState();
    expect(ui.activityBarVisible).toBe(true);
    expect(ui.statusBarVisible).toBe(true);
    expect(ui.tabBarVisible).toBe(true);
  });

  // §370 옛 프리셋에는 가시성 필드가 없다. 그것이 "숨김" 으로 읽히면 사용자가
  // 저장해 둔 화면구성을 고르는 것만으로 크롬이 사라진다.
  it("가시성 필드가 없는 사용자 프리셋은 전부 보임으로 적용된다", () => {
    useWorkspaceStore.setState({
      customPresets: [
        {
          builtIn: false,
          description: "",
          id: "legacy",
          // 옛 저장분의 모양 그대로 — 런타임 캐스트다.
          layout: {
            rightPanelMode: "none",
            rightPanelOpen: false,
            sidebarOpen: true,
            sidebarPanel: "files",
          } as WorkspaceLayout,
          name: "Legacy",
        },
      ],
    });
    useUIStore.setState({
      activityBarVisible: false,
      statusBarVisible: false,
      tabBarVisible: false,
    });
    useWorkspaceStore.getState().applyPreset("legacy");
    const ui = useUIStore.getState();
    expect(ui.activityBarVisible).toBe(true);
    expect(ui.statusBarVisible).toBe(true);
    expect(ui.tabBarVisible).toBe(true);
  });

  // 비공허성: 위 단언은 `applyPreset` 이 가시성을 **아예 안 건드려도** 통과할 수 있다
  // (초기값이 true 라면). 이것이 그 구현을 배제한다 — 값을 가진 프리셋은 그 값을 쓴다.
  it("가시성 필드를 가진 프리셋은 그 값을 적용한다", () => {
    useWorkspaceStore.setState({
      customPresets: [
        {
          builtIn: false,
          description: "",
          id: "quiet",
          layout: {
            activityBarVisible: false,
            rightPanelMode: "none",
            rightPanelOpen: false,
            sidebarOpen: false,
            sidebarPanel: "files",
            statusBarVisible: false,
            tabBarVisible: true,
          },
          name: "Quiet",
        },
      ],
    });
    useUIStore.setState({ activityBarVisible: true, statusBarVisible: true });
    useWorkspaceStore.getState().applyPreset("quiet");
    const ui = useUIStore.getState();
    expect(ui.activityBarVisible).toBe(false);
    expect(ui.statusBarVisible).toBe(false);
    expect(ui.tabBarVisible).toBe(true);
  });

  it("applyPreset with unknown id does nothing", () => {
    useWorkspaceStore.getState().applyPreset("nonexistent");
    expect(useWorkspaceStore.getState().activePresetId).toBeNull();
  });

  // --- Custom Presets ---

  it("saveCustomPreset captures current UI state", () => {
    useUIStore.setState({
      sidebarOpen: true,
      sidebarPanel: "outline",
      rightPanelOpen: true,
      rightPanelMode: "memories",
    });

    const id = useWorkspaceStore
      .getState()
      .saveCustomPreset("My Layout", "테스트용");

    const preset = useWorkspaceStore.getState().getPreset(id);
    expect(preset).toBeDefined();
    expect(preset!.name).toBe("My Layout");
    expect(preset!.description).toBe("테스트용");
    expect(preset!.builtIn).toBe(false);
    expect(preset!.layout.sidebarOpen).toBe(true);
    expect(preset!.layout.sidebarPanel).toBe("outline");
    expect(preset!.layout.rightPanelOpen).toBe(true);
    expect(preset!.layout.rightPanelMode).toBe("memories");
    expect(useWorkspaceStore.getState().activePresetId).toBe(id);
  });

  it("saveCustomPreset without description defaults to empty string", () => {
    const id = useWorkspaceStore.getState().saveCustomPreset("Simple");
    const preset = useWorkspaceStore.getState().getPreset(id);
    expect(preset!.description).toBe("");
  });

  it("getAllPresets includes custom presets after built-ins", () => {
    useWorkspaceStore.getState().saveCustomPreset("Custom 1");
    useWorkspaceStore.getState().saveCustomPreset("Custom 2");

    const all = useWorkspaceStore.getState().getAllPresets();
    expect(all).toHaveLength(7);
    expect(all[0].builtIn).toBe(true);
    expect(all[5].builtIn).toBe(false);
    expect(all[5].name).toBe("Custom 1");
  });

  it("deleteCustomPreset removes preset and clears activePresetId when active", () => {
    // Use setState directly to avoid persist middleware race conditions
    const presets = [
      {
        id: "test-1",
        name: "First",
        description: "",
        builtIn: false,
        layout: {
          sidebarOpen: true,
          sidebarPanel: "files" as const,
          rightPanelOpen: false,
          rightPanelMode: "none" as const,
          activityBarVisible: true,
          statusBarVisible: true,
          tabBarVisible: true,
        },
      },
      {
        id: "test-2",
        name: "Second",
        description: "",
        builtIn: false,
        layout: {
          sidebarOpen: false,
          sidebarPanel: "files" as const,
          rightPanelOpen: true,
          rightPanelMode: "chat" as const,
          activityBarVisible: true,
          statusBarVisible: true,
          tabBarVisible: true,
        },
      },
    ];
    useWorkspaceStore.setState({
      customPresets: presets,
      activePresetId: "test-2",
    });

    // Delete non-active — activePresetId stays
    useWorkspaceStore.getState().deleteCustomPreset("test-1");
    expect(useWorkspaceStore.getState().activePresetId).toBe("test-2");
    expect(useWorkspaceStore.getState().customPresets).toHaveLength(1);

    // Delete active — activePresetId becomes null
    useWorkspaceStore.getState().deleteCustomPreset("test-2");
    expect(useWorkspaceStore.getState().activePresetId).toBeNull();
    expect(useWorkspaceStore.getState().customPresets).toHaveLength(0);
  });

  it("renameCustomPreset updates the name", () => {
    const id = useWorkspaceStore.getState().saveCustomPreset("Old Name");
    useWorkspaceStore.getState().renameCustomPreset(id, "New Name");

    const preset = useWorkspaceStore.getState().getPreset(id);
    expect(preset!.name).toBe("New Name");
  });

  // --- Apply Custom Preset ---

  it("skills preset activates properties panel", () => {
    useWorkspaceStore.getState().applyPreset("skills");
    const ui = useUIStore.getState();
    expect(ui.rightPanelOpen).toBe(true);
    expect(ui.rightPanelMode).toBe("properties");
    expect(ui.sidebarOpen).toBe(true);
  });

  it("applyPreset works with custom presets", () => {
    useUIStore.setState({
      sidebarOpen: false,
      sidebarPanel: "graph",
      rightPanelOpen: true,
      rightPanelMode: "memories",
    });
    const id = useWorkspaceStore.getState().saveCustomPreset("Graph Layout");

    // Reset UI
    useUIStore.setState({
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "chat",
    });

    // Apply saved preset
    useWorkspaceStore.getState().applyPreset(id);

    const ui = useUIStore.getState();
    // §370 explicit applyPreset is symmetric — sidebar was open, but this
    // custom preset was saved with sidebarOpen:false, so it closes (the
    // narrowed open-only guard applies only to the implicit revert path).
    expect(ui.sidebarOpen).toBe(false);
    expect(ui.sidebarPanel).toBe("graph");
    expect(ui.rightPanelOpen).toBe(true);
    expect(ui.rightPanelMode).toBe("memories");
  });
});

// §370.2 포커스 모드는 상태들의 프리셋이다, 별도 모드 플래그가 아니다 — 그것이
// 이 describe 의 주제다: 적용 결과가 개별 상태로 관측된다.
describe("§370 focus preset — the fifth built-in", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activePresetId: null, customPresets: [] });
    useUIStore.setState({
      activityBarVisible: true,
      rightPanelMode: "chat",
      rightPanelOpen: true,
      sidebarOpen: true,
      sidebarPanel: "files",
      statusBarVisible: true,
      tabBarVisible: true,
    });
  });

  it("applyPreset('focus') hides all five chrome surfaces", () => {
    useWorkspaceStore.getState().applyPreset("focus");
    const ui = useUIStore.getState();
    expect(ui.activityBarVisible).toBe(false);
    expect(ui.statusBarVisible).toBe(false);
    expect(ui.tabBarVisible).toBe(false);
    expect(ui.sidebarOpen).toBe(false);
    expect(ui.rightPanelOpen).toBe(false);
  });

  // 포커스에서 나오는 길 — §370.2 의 복귀 경로가 프리셋 층에도 있어야 한다.
  it("choosing another preset brings the chrome back", () => {
    useWorkspaceStore.getState().applyPreset("focus");
    useWorkspaceStore.getState().applyPreset("writing");
    const ui = useUIStore.getState();
    expect(ui.activityBarVisible).toBe(true);
    expect(ui.statusBarVisible).toBe(true);
    expect(ui.tabBarVisible).toBe(true);
  });
});

// §85 — an unconfigured journal must say so, like the Zettel space already does.
//
// The journal branch only ran `if (journalEnabled && resolvedDir)`, with no else. So
// running "Open Today's Journal" (which routes here) with Journal off swapped the
// panels and opened nothing, and the palette closes before the action runs: the whole
// user-visible result was a closing palette. Indistinguishable from a broken app.
describe("§85 journal preset — unconfigured feedback", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activePresetId: null, customPresets: [] });
    useSettingsStore.setState({
      journalDirectory: "/tmp/baram-journal-test",
      journalEnabled: true,
      locale: "en",
    });
    useUIStore.setState({ toast: null });
  });

  it("toasts and does not enter the space when the journal is disabled", () => {
    useSettingsStore.setState({ journalEnabled: false });

    useWorkspaceStore.getState().applyPreset("journal");

    // `t` falls back to the key, so pin the catalogue text too — otherwise deleting
    // the key keeps this green while the user sees "space.journal.disabled".
    const message = useUIStore.getState().toast?.message;
    expect(message).toBe(t("space.journal.disabled", "en"));
    expect(message).toContain("Enable Journal");
    expect(useWorkspaceStore.getState().activePresetId).not.toBe("journal");
  });

  it("toasts when no journal directory resolves", () => {
    // resolveJournalDir only accepts absolute paths, so a relative value resolves
    // to nothing — the same dead end as an empty setting.
    useSettingsStore.setState({ journalDirectory: "journal" });

    useWorkspaceStore.getState().applyPreset("journal");

    const message = useUIStore.getState().toast?.message;
    expect(message).toBe(t("space.journal.noDirectory", "en"));
    expect(message).toContain("Set the Journal directory");
    expect(useWorkspaceStore.getState().activePresetId).not.toBe("journal");
  });

  it("enters the space when the journal is configured", () => {
    useWorkspaceStore.getState().applyPreset("journal");

    expect(useUIStore.getState().toast).toBeNull();
    expect(useWorkspaceStore.getState().activePresetId).toBe("journal");
  });
});

// §4.2 A custom preset saved before a RightPanelMode was removed (e.g. the deleted
// "help" mode) persists an unknown mode string. Applying it must not leave the right
// panel open with nothing to show — every panel component bails out with `return
// null` for a mode it doesn't own, so open:true + an unrecognized mode renders an
// empty column with no way back short of clicking an unrelated activity-bar icon.
describe("§4.2 applyPreset guards against a removed rightPanelMode", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activePresetId: null, customPresets: [] });
    useUIStore.setState({
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "chat",
    });
  });

  it("falls back to a closed panel instead of an empty column for an unknown persisted mode", () => {
    useWorkspaceStore.setState({
      customPresets: [
        {
          id: "stale-help",
          name: "Stale",
          description: "",
          builtIn: false,
          // §4.2 predates §370 — old-format layout, no visibility fields.
          layout: {
            sidebarOpen: true,
            sidebarPanel: "files",
            rightPanelOpen: true,
            rightPanelMode: "help",
          } as unknown as WorkspaceLayout,
        },
      ],
    });

    useWorkspaceStore.getState().applyPreset("stale-help");

    const ui = useUIStore.getState();
    expect(ui.rightPanelMode).toBe("none");
    expect(ui.rightPanelOpen).toBe(false);
  });

  it("still honors a valid persisted mode", () => {
    useWorkspaceStore.setState({
      customPresets: [
        {
          id: "valid-memories",
          name: "Valid",
          description: "",
          builtIn: false,
          // §4.2 predates §370 — old-format layout, no visibility fields.
          layout: {
            sidebarOpen: true,
            sidebarPanel: "files",
            rightPanelOpen: true,
            rightPanelMode: "memories",
          } as WorkspaceLayout,
        },
      ],
    });

    useWorkspaceStore.getState().applyPreset("valid-memories");

    const ui = useUIStore.getState();
    expect(ui.rightPanelMode).toBe("memories");
    expect(ui.rightPanelOpen).toBe(true);
  });
});
