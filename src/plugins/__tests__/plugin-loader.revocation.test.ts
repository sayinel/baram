// §69 — a revoked plugin does not run.
//
// The assertion that matters in every blocking case is that the IMPORTER WAS NEVER
// CALLED. "loadPlugin threw" is compatible with the module having been imported and its
// top-level code having already run, which for malware is the whole ballgame — by the
// time `activate()` is reached it is far too late.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import type { RevocationEntry } from "../revocation";
import type { PluginManifest } from "../types";

import en from "../../i18n/en.json";
import ko from "../../i18n/ko.json";
import { useSettingsStore } from "../../stores/settings/store";
import { usePluginStore } from "../../stores/system/plugin";
import { PluginLoader } from "../plugin-loader";

// Read from the shipped catalogue rather than pasted here, so a copy edit does not need a
// test edit. What these pin is the SHAPE of the refusal; the assertions that carry weight
// are the ones about the importer.
const BLOCKED_EN = en["plugin.revoked.blockedLoad"];

const manifest: PluginManifest = {
  author: "test",
  capabilities: ["commands"],
  description: "test",
  engines: { baram: ">=0.2.0" },
  id: "revoked-x",
  license: "MIT",
  main: "index.mjs",
  name: "Revoked X",
  trust: "trusted",
  version: "2.0.1",
};

function entry(over: Partial<RevocationEntry> = {}): RevocationEntry {
  return {
    id: "revoked-x",
    reason: "exfiltrates the vault",
    severity: "malicious",
    versions: "*",
    ...over,
  };
}

function revoke(...entries: RevocationEntry[]): void {
  usePluginStore.setState({ revocations: { revoked: entries, version: 1 } });
}

describe("PluginLoader revocation gate (§69)", () => {
  beforeEach(() => {
    usePluginStore.setState({ revocations: null });
    // The refusal is translated, so the locale is part of this suite's fixture.
    useSettingsStore.setState({ locale: "en" });
  });

  it("never imports the module of a maliciously revoked plugin", async () => {
    revoke(entry());
    const importer = vi.fn(async () => ({ activate: () => undefined }));

    await expect(
      new PluginLoader(importer).loadPlugin("/p/revoked-x", manifest),
    ).rejects.toThrow(BLOCKED_EN);
    expect(importer).not.toHaveBeenCalled();
  });

  it("states the refusal in the reader's language", async () => {
    // The Installed row renders this string directly above the withdrawal notice, which
    // has been translated since it was written — so an untranslated refusal put two
    // languages side by side stating one fact. This pins that the LOCALE IS READ; a
    // hardcoded "en" passes every other test in this file.
    useSettingsStore.setState({ locale: "ko" });
    revoke(entry());
    const importer = vi.fn(async () => ({ activate: () => undefined }));

    await expect(
      new PluginLoader(importer).loadPlugin("/p/revoked-x", manifest),
    ).rejects.toThrow(ko["plugin.revoked.blockedLoad"]);
    expect(importer).not.toHaveBeenCalled();
  });

  it("puts the stated reason in the error, so the UI can show why", async () => {
    revoke(entry({ reason: "ships a keylogger" }));
    const importer = vi.fn(async () => ({ activate: () => undefined }));

    await expect(
      new PluginLoader(importer).loadPlugin("/p/revoked-x", manifest),
    ).rejects.toThrow(/ships a keylogger/);
  });

  it("loads normally when nothing is revoked", async () => {
    const importer = vi.fn(async () => ({ activate: () => undefined }));
    await new PluginLoader(importer).loadPlugin("/p/revoked-x", manifest);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it.each(["unlisted", "vulnerable"] as const)(
    "still loads a %s plugin — most of a real list is bookkeeping",
    async (severity) => {
      revoke(entry({ severity }));
      const importer = vi.fn(async () => ({ activate: () => undefined }));
      await new PluginLoader(importer).loadPlugin("/p/revoked-x", manifest);
      expect(importer).toHaveBeenCalledTimes(1);
    },
  );

  it("only blocks the versions the entry names", async () => {
    // The installed version is 2.0.1; the window stops at 2.0.1 exclusive.
    revoke(entry({ versions: { gte: "1.0.0", lt: "2.0.1" } }));
    const importer = vi.fn(async () => ({ activate: () => undefined }));
    await new PluginLoader(importer).loadPlugin("/p/revoked-x", manifest);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("blocks when the installed version falls inside the window", async () => {
    revoke(entry({ versions: { gte: "2.0.0", lt: "2.0.4" } }));
    const importer = vi.fn(async () => ({ activate: () => undefined }));
    await expect(
      new PluginLoader(importer).loadPlugin("/p/revoked-x", manifest),
    ).rejects.toThrow(BLOCKED_EN);
    expect(importer).not.toHaveBeenCalled();
  });

  it("does not revoke a different plugin that shares the version", async () => {
    revoke(entry({ id: "some-other-plugin" }));
    const importer = vi.fn(async () => ({ activate: () => undefined }));
    await new PluginLoader(importer).loadPlugin("/p/revoked-x", manifest);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("exempts a dev load — a local folder is the author's own code", async () => {
    revoke(entry());
    const importer = vi.fn(async () => ({ activate: () => undefined }));
    await new PluginLoader(importer).loadPlugin("/dev/revoked-x", manifest, {
      isDev: true,
    });
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("blocks a sandboxed plugin too, not just a trusted one", async () => {
    // The tier bounds what a plugin can REACH; revocation says what it reaches is
    // being abused. Routing by tier before checking revocation would let the
    // sandboxed half through, and the gate sits above that split for this reason.
    revoke(entry());
    const importer = vi.fn(async () => ({ activate: () => undefined }));
    await expect(
      new PluginLoader(importer).loadPlugin("/p/revoked-x", {
        ...manifest,
        trust: "sandboxed",
      }),
    ).rejects.toThrow(BLOCKED_EN);
    expect(importer).not.toHaveBeenCalled();
  });
});
