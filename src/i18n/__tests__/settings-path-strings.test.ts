import { describe, expect, it } from "vitest";

import en from "../en.json";
import ko from "../ko.json";

describe("settings-path strings (§342)", () => {
  it("no app string routes a moved setting through General", () => {
    // Scan for "Settings > General", "Settings › General", "Settings → General" (en)
    const enGeneralRe = /Settings\s*[>›→]\s*General/u;
    const enKeys = Object.entries(en)
      .filter(([, v]) => enGeneralRe.test(v))
      .map(([k]) => k);
    expect(enKeys).toEqual([]);

    // Scan for "설정 > 일반", "설정 › 일반", "설정 → 일반" (ko)
    const koGeneralRe = /설정\s*[>›→]\s*일반/u;
    const koKeys = Object.entries(ko)
      .filter(([, v]) => koGeneralRe.test(v))
      .map(([k]) => k);
    expect(koKeys).toEqual([]);
  });

  it("still points at the tabs that did NOT move", () => {
    // Over-replacement controls — these should NOT be touched
    // These four items are load-bearing: a global normalization sweep could corrupt them

    // plugin.error.updateUnverifiableFloor — contains `>=x.y.z` code syntax
    expect(en["plugin.error.updateUnverifiableFloor"]).toContain("`>=x.y.z`");
    expect(ko["plugin.error.updateUnverifiableFloor"]).toContain("`>=x.y.z`");

    // update.dialog.versionChange — contains version arrow
    expect(en["update.dialog.versionChange"]).toContain("→");
    expect(ko["update.dialog.versionChange"]).toContain("→");

    // journal.capture.target.* — contain target pointers
    expect(en["journal.capture.target.one"]).toContain("→");
    expect(en["journal.capture.target.many"]).toContain("→");
    expect(en["journal.capture.target.none"]).toContain("→");
    expect(en["journal.capture.target.scanFailed"]).toContain("→");
    expect(ko["journal.capture.target.one"]).toContain("→");
    expect(ko["journal.capture.target.many"]).toContain("→");
    expect(ko["journal.capture.target.none"]).toContain("→");
    expect(ko["journal.capture.target.scanFailed"]).toContain("→");

    // fileTree.accessDenied.* — quote macOS System Settings (unchanged)
    expect(en["fileTree.accessDenied.step1"]).toContain("System Settings");
    expect(en["fileTree.accessDenied.step2"]).toContain("→");
    expect(ko["fileTree.accessDenied.step1"]).toContain("시스템 설정");
    expect(ko["fileTree.accessDenied.step2"]).toContain("→");
  });

  it("uses › separator in all settings-path strings", () => {
    // After the change, all settings paths should use › exactly
    const settingsPathKeys = [
      "journal.capture.error.taskNoHome",
      "journal.search.disabled",
      "journal.search.noDirectory",
      "query.tasksDisabled",
      "space.journal.disabled",
      "space.journal.noDirectory",
      "space.journal.openFailed",
      "space.zettel.disabled",
      "space.zettel.noDirectory",
      "tasks.archive.noHome",
      "viewer.noPlugin",
    ];

    for (const key of settingsPathKeys) {
      // Should contain Settings › or 설정 ›
      const enValue = en[key as keyof typeof en];
      const koValue = ko[key as keyof typeof ko];

      // Check for the › separator (not > or →)
      if (enValue.includes("Settings")) {
        expect(enValue).toContain("Settings ›");
        expect(enValue).not.toContain("Settings >");
        expect(enValue).not.toContain("Settings →");
      }
      if (koValue.includes("설정")) {
        expect(koValue).toContain("설정 ›");
        expect(koValue).not.toContain("설정 >");
        expect(koValue).not.toContain("설정 →");
      }
    }
  });

  it("names the correct new tabs for moved features", () => {
    // Verify the target tabs are correct
    expect(en["space.journal.disabled"]).toContain("Settings › Journal");
    expect(en["space.zettel.disabled"]).toContain("Settings › Zettel");
    expect(en["query.tasksDisabled"]).toContain("Settings › Tasks");
    expect(en["viewer.noPlugin"]).toContain("Plugins");

    expect(ko["space.journal.disabled"]).toContain("설정 › 저널");
    expect(ko["space.zettel.disabled"]).toContain("설정 › Zettel");
    expect(ko["query.tasksDisabled"]).toContain("설정 › 태스크");
    expect(ko["viewer.noPlugin"]).toContain("플러그인");
  });
});
