// What the icons on the bar are called, and where those words come from.
//
// Two defects met here. The labels were hardcoded English, so a Korean UI had a rail of icons
// that only spoke English; and the two that mention a shortcut spelled it as literal text, which
// a rebind turned into a confident lie.
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KEYBINDING_REGISTRY } from "../../../keybindings/keybinding-registry";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { DEFAULT_ACTIVITY_BAR_CONFIG } from "../../../stores/settings/activity-bar-config";
import { useSettingsStore } from "../../../stores/settings/store";
import { ActivityBar } from "../ActivityBar";

const realPlatform = navigator.platform;

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
}

beforeEach(() => {
  usePluginUIStore.setState({ activePluginPanelId: null, sidebarPanels: [] });
  useSettingsStore.setState({
    activityBarConfig: DEFAULT_ACTIVITY_BAR_CONFIG,
    keybindingOverrides: {},
    locale: "ko",
    tasksEnabled: true,
  });
  setPlatform("MacIntel");
});

afterEach(() => {
  setPlatform(realPlatform);
  useSettingsStore.setState({ keybindingOverrides: {}, locale: "en" });
});

describe("the words on the bar", () => {
  it("names each icon in the app's language", () => {
    render(<ActivityBar />);

    expect(screen.getByRole("button", { name: "파일" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "검색" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
  });

  it("names the Tasks icon, which used to render its own translation key", () => {
    // `settings.activitybar.item.tasks` was defined in neither locale, so `t()` returned the key
    // and this icon announced itself as `settings.activitybar.item.tasks`.
    render(<ActivityBar />);

    expect(screen.getByRole("button", { name: "태스크" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "settings.activitybar.item.tasks",
      }),
    ).toBeNull();
  });

  it("leaves no native title behind for the browser to render late", () => {
    // The native tooltip is what this replaced. One left on a button would show up a second
    // later, underneath the pill, in the browser's own styling.
    const { container } = render(<ActivityBar />);

    expect(container.querySelectorAll("[title]")).toHaveLength(0);
  });
});

describe("the shortcut a label mentions", () => {
  it("follows a rebind instead of repeating the default", () => {
    useSettingsStore.setState({
      keybindingOverrides: { "ai.chatPanel": "Mod+Shift+Z" },
    });
    render(<ActivityBar />);

    expect(
      screen.getByRole("button", { name: "AI 채팅 (⌘⇧Z)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /⌘⇧A/ })).toBeNull();
  });

  it("shows the default when nothing is rebound", () => {
    render(<ActivityBar />);

    expect(
      screen.getByRole("button", { name: "AI 채팅 (⌘⇧A)" }),
    ).toBeInTheDocument();
  });

  it("points at commands that exist", () => {
    // The map is two string literals aimed at ids in another file. If one were renamed there,
    // `find` would return undefined and the label would quietly lose its shortcut — no error,
    // no failing render, just a hint that stopped appearing.
    const ids = new Set(KEYBINDING_REGISTRY.map((e) => e.id));

    expect(ids.has("ai.chatPanel")).toBe(true);
    expect(ids.has("journal.photoGallery")).toBe(true);
  });
});
