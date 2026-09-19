import type { RevocationEntry } from "../../../plugins/revocation";
import type { RegistryEntry } from "../../../plugins/types";

// §69 — what a user actually sees when a plugin has been withdrawn.
//
// The load gate is tested against the loader; this file covers the half the gate cannot
// speak for. A refused load with no explanation reads as "the app is broken", which is
// the outcome the severity split and the keep-your-files wording exist to avoid.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  countAnywhere,
  withinSurface,
} from "../../../__tests__/helpers/security-surface";
import en from "../../../i18n/en.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { PluginCard } from "../PluginCard";
import { PluginDetail } from "../PluginDetail";

const LABELS = en as Record<string, string>;

const ENTRY: RegistryEntry = {
  author: "Someone",
  capabilities: ["commands"],
  checksum: "0".repeat(64),
  description: "test plugin",
  downloadUrl: "https://example.test/p.zip",
  engines: { baram: ">=0.5.0" },
  id: "revoked-x",
  license: "MIT",
  name: "Revoked X",
  trust: "sandboxed",
  version: "2.0.1",
};

function detail(revoked: null | RevocationEntry) {
  return render(
    <PluginDetail
      entry={ENTRY}
      onBack={() => undefined}
      onInstall={() => undefined}
      onToggleEnabled={() => undefined}
      onUninstall={() => undefined}
      onUpdate={() => undefined}
      revocation={revoked}
      status="enabled"
    />,
  );
}

function revocation(over: Partial<RevocationEntry> = {}): RevocationEntry {
  return {
    id: "revoked-x",
    reason: "exfiltrates the vault",
    severity: "malicious",
    versions: "*",
    ...over,
  };
}

// §359 — the notice renders inside a shadow root, which `screen` cannot reach: it
// queries `document.body`, and a shadow root is not part of that tree. The "shows
// nothing" cases therefore count `.plugin-revoked` across BOTH trees: `screen` finds
// nothing either way now, so their old form would have passed with the notice
// rendered in full, and counting only surfaces would still pass if the notice were
// ever rendered without the wrapper.
const notice = () => withinSurface(".plugin-revoked");

describe("the withdrawal notice", () => {
  it("states that the plugin is not running, and why", () => {
    detail(revocation());
    expect(
      notice().getByText(LABELS["plugin.revoked.blockedLoad"]),
    ).toBeInTheDocument();
    expect(notice().getByText(/exfiltrates the vault/)).toBeInTheDocument();
  });

  it("says the files were kept, and offers removal as the user's choice", () => {
    // The product decision this asserts: revocation refuses to RUN the plugin, it does
    // not delete it. Microsoft's public apology for pulling extensions used by millions
    // is why — a refused load is reversible, a deleted directory is not.
    detail(revocation());
    expect(
      notice().getByText(LABELS["plugin.revoked.keepFiles"]),
    ).toBeInTheDocument();
    expect(
      notice().getByRole("button", { name: LABELS["plugin.revoked.remove"] }),
    ).toBeInTheDocument();
  });

  it("warns without claiming it is stopped, for a vulnerable version", () => {
    detail(revocation({ severity: "vulnerable" }));
    expect(
      notice().getByText(LABELS["plugin.revoked.vulnerable"]),
    ).toBeInTheDocument();
    // It is still running, so neither the stopped wording nor the removal offer belong.
    expect(
      notice().queryByText(LABELS["plugin.revoked.blockedLoad"]),
    ).toBeNull();
    expect(
      notice().queryByRole("button", { name: LABELS["plugin.revoked.remove"] }),
    ).toBeNull();
  });

  it("shows nothing at all for an unlisted plugin", () => {
    // `unlisted` is bookkeeping — the author went quiet, the plugin merged elsewhere.
    // Most of a real withdrawal list is this, and alarming the user about it would
    // make the notice worth ignoring when it finally matters.
    detail(revocation({ severity: "unlisted" }));
    expect(countAnywhere(".plugin-revoked")).toBe(0);
  });

  it("shows nothing when the plugin is not withdrawn", () => {
    detail(null);
    expect(countAnywhere(".plugin-revoked")).toBe(0);
  });

  it("prefers a translated reason key over the English prose when one exists", () => {
    useSettingsStore.setState({ locale: "en" });
    detail(
      revocation({ reason: "raw prose", reasonKey: "plugin.trust.legacy" }),
    );
    expect(
      notice().getByText(new RegExp(LABELS["plugin.trust.legacy"])),
    ).toBeInTheDocument();
    expect(notice().queryByText(/raw prose/)).toBeNull();
  });

  it("falls back to the prose when the key resolves to nothing", () => {
    // `t()` returns the key itself on a miss, so an unknown key must not be rendered
    // AS the reason — the user would see `plugin.revoked.whatever` where the
    // explanation should be.
    detail(
      revocation({ reason: "raw prose", reasonKey: "plugin.revoked.nope" }),
    );
    expect(notice().getByText(/raw prose/)).toBeInTheDocument();
    expect(notice().queryByText(/plugin\.revoked\.nope/)).toBeNull();
  });
});

describe("the withdrawal badge in the list", () => {
  function card(revoked: boolean) {
    return render(
      <PluginCard
        entry={ENTRY}
        onInstall={() => undefined}
        onSelect={() => undefined}
        onUninstall={() => undefined}
        onUpdate={() => undefined}
        revoked={revoked}
        status="enabled"
      />,
    );
  }

  it("marks a withdrawn plugin without needing the detail view opened", () => {
    card(true);
    expect(
      screen.getByText(LABELS["plugin.revoked.badge"]),
    ).toBeInTheDocument();
  });

  it("marks nothing otherwise", () => {
    card(false);
    expect(screen.queryByText(LABELS["plugin.revoked.badge"])).toBeNull();
  });
});
