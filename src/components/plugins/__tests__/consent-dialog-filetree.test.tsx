// §395 spec 0074 D3 · §4 · §7 "capability" — the install dialog names `filetree` in the app's
// language. The other capability-list places have guards of their own: Rust = TS
// (`capability-parity.test.ts`), a hue that passes contrast (`capability-badge-contrast.test.tsx`), a
// key in both catalogs (`capability-i18n.test.tsx`).
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withinSurface } from "../../../__tests__/helpers/security-surface";
import { useSettingsStore } from "../../../stores/settings/store";
import { PluginConsentDialog } from "../PluginConsentDialog";

const surface = () => withinSurface(".plugin-consent");

afterEach(() => {
  useSettingsStore.setState({ locale: "en" });
});

describe("PluginConsentDialog — filetree (§395)", () => {
  /** What fails this: no `plugin.capability.filetree` key — the line falls back to the capability
   *  name itself (`capabilityLabel`), or to the Korean `CAPABILITY_DESCRIPTIONS` text in the English
   *  UI. Both locales, so a key added to one catalog only is caught here too. */
  it.each([
    [
      "en",
      "Show icons and badges on files in the file tree, and add items to its right-click menu",
    ],
    ["ko", "파일 트리에 아이콘 · 배지를 달고, 우클릭 메뉴에 항목을 더합니다"],
  ] as const)("names filetree in %s", (locale, line) => {
    useSettingsStore.setState({ locale });
    render(
      <PluginConsentDialog
        consent={{ capabilities: ["filetree"], trust: "sandboxed" }}
        intent="install"
        name="Demo"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(surface().getByText(line)).toBeTruthy();
  });
});
