import type { DevFolderRow } from "../../../ipc/plugin-invoke";
import type {
  InstalledPlugin,
  PluginConsent,
  PluginManifest,
} from "../../../plugins/types";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pickDevFolder: vi.fn(),
  recordDevConsent: vi.fn(),
  refreshDevPlugins: vi.fn(),
  reloadDevFolder: vi.fn(),
  removeDevFolder: vi.fn(),
  setDeveloperMode: vi.fn(),
  unloadDevPlugins: vi.fn(),
}));

// Keep the real `toInstalledDevPlugin` mapper; only the Tauri-invoking wrappers are mocked.
vi.mock("../../../ipc/plugin-invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/plugin-invoke")>()),
  pluginPickDevFolder: (...a: unknown[]) => mocks.pickDevFolder(...a),
  pluginRecordDevConsent: (...a: unknown[]) => mocks.recordDevConsent(...a),
  pluginReloadDevFolder: (...a: unknown[]) => mocks.reloadDevFolder(...a),
  pluginRemoveDevFolder: (...a: unknown[]) => mocks.removeDevFolder(...a),
  pluginSetDeveloperMode: (...a: unknown[]) => mocks.setDeveloperMode(...a),
}));
// `devConsentToAsk` stays real — it is the rule these tests are about.
vi.mock("../../../plugins/dev-plugins", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../plugins/dev-plugins")>()),
  refreshDevPlugins: () => mocks.refreshDevPlugins(),
  unloadDevPlugins: () => mocks.unloadDevPlugins(),
}));
vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: {
    loadPlugin: vi.fn(async () => {}),
    reloadPlugin: vi.fn(async () => {}),
    unloadPlugin: vi.fn(async () => {}),
  },
}));

import {
  countAnywhere,
  findSurface,
} from "../../../__tests__/helpers/security-surface";
import en from "../../../i18n/en.json";
import { pluginLoader } from "../../../plugins/plugin-loader";
import { usePluginStore } from "../../../stores/system/plugin";
import { useUIStore } from "../../../stores/ui/ui";
import { PluginDeveloperSection } from "../PluginDeveloperSection";

const MANIFEST: PluginManifest = {
  author: "",
  capabilities: ["statusbar"],
  description: "",
  engines: { baram: ">=0.2.0" },
  id: "dev-x",
  license: "MIT",
  main: "index.mjs",
  name: "Dev X",
  trust: "sandboxed",
  version: "1.0.0",
};
const APPROVED: PluginConsent = {
  capabilities: ["statusbar"],
  trust: "sandboxed",
};
const DEV_BUILD = { active: true, devBuild: true, enabled: false };
const RELEASE_ON = { active: true, devBuild: false, enabled: true };
const RELEASE_OFF = { active: false, devBuild: false, enabled: false };

function devPlugin(
  manifest: PluginManifest = MANIFEST,
  consent?: PluginConsent,
): InstalledPlugin {
  return {
    checksum: "",
    ...(consent ? { consent } : {}),
    enabled: true,
    installedAt: 0,
    installPath: "/dev/dev-x",
    isDev: true,
    manifest,
    updatedAt: 0,
  };
}

function row(over: Partial<DevFolderRow> = {}): DevFolderRow {
  return {
    consent: null,
    error: null,
    ids: [],
    path: "/dev/dev-x",
    plugin: {
      checksum: "",
      install_path: "/dev/dev-x",
      is_dev: true,
      manifest: MANIFEST,
    },
    ...over,
  };
}

const loadButton = () =>
  screen.getByRole("button", { name: /load dev plugin folder/i });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pickDevFolder.mockResolvedValue(row());
  mocks.recordDevConsent.mockResolvedValue(undefined);
  mocks.refreshDevPlugins.mockResolvedValue(undefined);
  mocks.reloadDevFolder.mockResolvedValue(row());
  mocks.removeDevFolder.mockResolvedValue(undefined);
  mocks.setDeveloperMode.mockResolvedValue(true);
  mocks.unloadDevPlugins.mockResolvedValue(undefined);
  usePluginStore.setState({
    devFolderIssues: [],
    devMode: DEV_BUILD,
    devPlugins: {},
    pluginErrors: {},
  });
});

describe("PluginDeveloperSection — dev build (§379: unchanged)", () => {
  it("has no switch, and loads a picked folder without asking", async () => {
    render(<PluginDeveloperSection />);
    expect(screen.queryByRole("switch")).toBeNull();

    fireEvent.click(loadButton());

    await waitFor(() =>
      expect(pluginLoader.loadPlugin).toHaveBeenCalledWith(
        "/dev/dev-x",
        MANIFEST,
        { devConsent: undefined, isDev: true },
      ),
    );
    expect(mocks.recordDevConsent).not.toHaveBeenCalled();
  });

  it("renders the settings form for a dev plugin's declared fields", () => {
    // §260 Phase 4c — REACHABILITY: a dev plugin never opens `PluginDetail`, so the form must
    // be reachable from here or its fields are unreachable for exactly the plugins developed
    // against them.
    usePluginStore.getState().setDevPlugins([
      devPlugin({
        ...MANIFEST,
        capabilities: ["settings"],
        contributions: {
          settings: [
            { default: 3, key: "depth", label: "Depth", type: "number" },
          ],
        },
      }),
    ]);
    render(<PluginDeveloperSection />);
    fireEvent.click(screen.getByText("Dev X"));
    expect((screen.getByLabelText("Depth") as HTMLInputElement).value).toBe(
      "3",
    );
  });

  it("marks a dev row as in development and unverified (F1)", () => {
    usePluginStore.getState().setDevPlugins([devPlugin()]);
    render(<PluginDeveloperSection />);
    expect(
      screen.getByText(new RegExp(en["plugin.dev.badge"], "u")),
    ).toBeInTheDocument();
  });

  it("removes a dev plugin and unloads it", async () => {
    usePluginStore.getState().setDevPlugins([devPlugin()]);
    render(<PluginDeveloperSection />);
    fireEvent.click(screen.getByText("Dev X"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mocks.removeDevFolder).toHaveBeenCalledWith("/dev/dev-x"),
    );
    await waitFor(() =>
      expect(pluginLoader.unloadPlugin).toHaveBeenCalledWith("dev-x"),
    );
    await waitFor(() => expect(screen.queryByText("Dev X")).toBeNull());
  });

  // Fix round 1, M5 — the old code deselected unconditionally; a failed removal must not
  // lose the selection over a row that is, in fact, still there.
  it("keeps the selection when Remove fails", async () => {
    usePluginStore.getState().setDevPlugins([devPlugin()]);
    mocks.removeDevFolder.mockRejectedValue(new Error("fail"));
    render(<PluginDeveloperSection />);
    fireEvent.click(
      screen.getByText("Dev X", { selector: ".vault-tab-item__name" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mocks.removeDevFolder).toHaveBeenCalledWith("/dev/dev-x"),
    );
    expect(pluginLoader.unloadPlugin).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(
      screen.getByText("Dev X", { selector: ".vault-tab-item__name" }),
    ).toBeInTheDocument();
  });

  // Fix round 1, I1 — a dev build must drop a consent the row carries (from a prior release
  // run of the SAME shared `plugin-dev.json`) exactly as `refreshDevPlugins` already does; the
  // hook's own `admit` path must read through the same rule (`devRowConsent`), not `row.consent`.
  it("drops a recorded consent when loading a picked folder in a dev build", async () => {
    mocks.pickDevFolder.mockResolvedValue(row({ consent: APPROVED }));
    render(<PluginDeveloperSection />);
    fireEvent.click(loadButton());

    await waitFor(() =>
      expect(pluginLoader.loadPlugin).toHaveBeenCalledWith(
        "/dev/dev-x",
        MANIFEST,
        { devConsent: undefined, isDev: true },
      ),
    );
    expect(mocks.recordDevConsent).not.toHaveBeenCalled();
    expect(
      usePluginStore.getState().devPlugins["dev-x"]?.consent,
    ).toBeUndefined();
  });

  it("drops a recorded consent when reloading a folder in a dev build", async () => {
    usePluginStore.getState().setDevPlugins([devPlugin()]);
    mocks.reloadDevFolder.mockResolvedValue(row({ consent: APPROVED }));
    render(<PluginDeveloperSection />);
    fireEvent.click(
      screen.getByText("Dev X", { selector: ".vault-tab-item__name" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() =>
      expect(pluginLoader.reloadPlugin).toHaveBeenCalledWith(
        "/dev/dev-x",
        MANIFEST,
        { devConsent: undefined, isDev: true },
      ),
    );
    expect(mocks.recordDevConsent).not.toHaveBeenCalled();
    expect(
      usePluginStore.getState().devPlugins["dev-x"]?.consent,
    ).toBeUndefined();
  });

  it("toggles the detail panel on repeated title clicks", () => {
    usePluginStore.getState().setDevPlugins([devPlugin()]);
    render(<PluginDeveloperSection />);
    const title = () =>
      screen.getByText("Dev X", { selector: ".vault-tab-item__name" });
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    fireEvent.click(title());
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    fireEvent.click(title());
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  // Kept from the pre-§379 suite: Reload in a dev build re-reads through Rust and reloads
  // WITHOUT asking — and `isDev` is asserted, not tolerated (§260 Phase 5 round 4, G1).
  it("reloads a dev plugin and shows a toast", async () => {
    usePluginStore.getState().setDevPlugins([devPlugin()]);
    const showToast = vi.spyOn(useUIStore.getState(), "showToast");
    render(<PluginDeveloperSection />);
    fireEvent.click(
      screen.getByText("Dev X", { selector: ".vault-tab-item__name" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() =>
      expect(pluginLoader.reloadPlugin).toHaveBeenCalledWith(
        "/dev/dev-x",
        MANIFEST,
        { devConsent: undefined, isDev: true },
      ),
    );
    expect(mocks.reloadDevFolder).toHaveBeenCalledWith("/dev/dev-x");
    expect(mocks.recordDevConsent).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Reloaded dev plugin: Dev X"),
    );
  });

  // Kept from the pre-§379 suite: a load that fails says so, and leaves no card.
  it("shows a failure toast when loading a dev plugin folder fails", async () => {
    vi.mocked(pluginLoader.loadPlugin).mockRejectedValueOnce(new Error("boom"));
    const showToast = vi.spyOn(useUIStore.getState(), "showToast");
    render(<PluginDeveloperSection />);
    fireEvent.click(loadButton());

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load dev plugin"),
      ),
    );
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("boom"));
    // No plugin card — but the pick put the folder on Rust's list, so it stays visible (and
    // removable) as an issue row (verification pass, M2b).
    expect(screen.queryByText("Dev X")).toBeNull();
    expect(await screen.findByText("/dev/dev-x")).toBeInTheDocument();
    expect(usePluginStore.getState().devFolderIssues).toEqual([
      { error: "boom", ids: [], path: "/dev/dev-x" },
    ]);
  });
});

describe("PluginDeveloperSection — release build (§379 F1·F2)", () => {
  it("hides the list and Load until developer mode is on", () => {
    usePluginStore.setState({ devMode: RELEASE_OFF });
    render(<PluginDeveloperSection />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.getByText(en["plugin.dev.mode.off"])).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /load dev plugin folder/i }),
    ).toBeNull();
  });

  it("turning it on asks Rust, then reloads the list", async () => {
    usePluginStore.setState({ devMode: RELEASE_OFF });
    render(<PluginDeveloperSection />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mocks.refreshDevPlugins).toHaveBeenCalled());
    expect(mocks.setDeveloperMode).toHaveBeenCalledWith(true);
    expect(mocks.unloadDevPlugins).not.toHaveBeenCalled();
  });

  // M7(c) (fix round 1) — Rust's native warning can itself be declined; the resolved value is
  // the state AFTER the call, so a decline resolves `false` and the switch must stay off.
  it("a refused native warning leaves the switch off", async () => {
    usePluginStore.setState({ devMode: RELEASE_OFF });
    mocks.setDeveloperMode.mockResolvedValue(false);
    render(<PluginDeveloperSection />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mocks.refreshDevPlugins).toHaveBeenCalled());
    expect(mocks.setDeveloperMode).toHaveBeenCalledWith(true);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  // M7(d) (fix round 1) — Rust itself can fail (not merely decline) to change the mode.
  it("shows a toast when changing developer mode fails", async () => {
    usePluginStore.setState({ devMode: RELEASE_OFF });
    mocks.setDeveloperMode.mockRejectedValue(new Error("boom"));
    const showToast = vi.spyOn(useUIStore.getState(), "showToast");
    render(<PluginDeveloperSection />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "Could not change developer mode: boom",
      ),
    );
    expect(mocks.refreshDevPlugins).not.toHaveBeenCalled();
  });

  it("turning it off unloads the folders before the list is re-read", async () => {
    usePluginStore.setState({ devMode: RELEASE_ON });
    mocks.setDeveloperMode.mockResolvedValue(false);
    render(<PluginDeveloperSection />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mocks.refreshDevPlugins).toHaveBeenCalled());
    expect(mocks.setDeveloperMode).toHaveBeenCalledWith(false);
    expect(mocks.unloadDevPlugins.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refreshDevPlugins.mock.invocationCallOrder[0],
    );
  });

  it("asks before a picked folder's code runs, and records the answer in Rust first", async () => {
    usePluginStore.setState({ devMode: RELEASE_ON });
    render(<PluginDeveloperSection />);
    fireEvent.click(loadButton());

    const dialog = await findSurface(".plugin-consent");
    expect(
      dialog.getByText(
        en["plugin.consent.title.load"].replace("{name}", "Dev X"),
      ),
    ).toBeTruthy();
    expect(pluginLoader.loadPlugin).not.toHaveBeenCalled();
    fireEvent.click(
      dialog.getByRole("button", { name: en["plugin.consent.confirm.load"] }),
    );

    await waitFor(() =>
      expect(pluginLoader.loadPlugin).toHaveBeenCalledWith(
        "/dev/dev-x",
        MANIFEST,
        { devConsent: APPROVED, isDev: true },
      ),
    );
    expect(mocks.recordDevConsent).toHaveBeenCalledWith("/dev/dev-x", APPROVED);
    expect(mocks.recordDevConsent.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(pluginLoader.loadPlugin).mock.invocationCallOrder[0],
    );
  });

  it("a refused first pick loads nothing and takes the folder back off the list", async () => {
    usePluginStore.setState({ devMode: RELEASE_ON });
    render(<PluginDeveloperSection />);
    fireEvent.click(loadButton());
    const dialog = await findSurface(".plugin-consent");
    fireEvent.click(
      dialog.getByRole("button", { name: en["plugin.consent.cancel"] }),
    );
    await waitFor(() =>
      expect(mocks.removeDevFolder).toHaveBeenCalledWith("/dev/dev-x"),
    );
    expect(mocks.recordDevConsent).not.toHaveBeenCalled();
    expect(pluginLoader.loadPlugin).not.toHaveBeenCalled();
  });

  it("Reload asks again, with NEW on what the folder added", async () => {
    usePluginStore.setState({ devMode: RELEASE_ON });
    usePluginStore.getState().setDevPlugins([devPlugin(MANIFEST, APPROVED)]);
    const grown = {
      ...MANIFEST,
      capabilities: ["statusbar", "network"] as const,
    };
    mocks.reloadDevFolder.mockResolvedValue(
      row({
        consent: APPROVED,
        plugin: {
          checksum: "",
          install_path: "/dev/dev-x",
          is_dev: true,
          manifest: { ...grown, capabilities: [...grown.capabilities] },
        },
      }),
    );
    render(<PluginDeveloperSection />);
    fireEvent.click(
      screen.getByText("Dev X", { selector: ".vault-tab-item__name" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    const dialog = await findSurface(".plugin-consent");
    expect(dialog.getByText(en["plugin.consent.new"])).toBeTruthy();
    // M7(a) (fix round 1) — before Confirm, nothing has run yet.
    expect(pluginLoader.reloadPlugin).not.toHaveBeenCalled();
    fireEvent.click(
      dialog.getByRole("button", { name: en["plugin.consent.confirm.load"] }),
    );
    const widened: PluginConsent = {
      capabilities: ["statusbar", "network"],
      trust: "sandboxed",
    };
    await waitFor(() =>
      expect(pluginLoader.reloadPlugin).toHaveBeenCalledWith(
        "/dev/dev-x",
        expect.objectContaining({ id: "dev-x" }),
        { devConsent: widened, isDev: true },
      ),
    );
    expect(mocks.recordDevConsent).toHaveBeenCalledWith("/dev/dev-x", widened);
    // M7(a) — the record must land in Rust before the reload runs on it.
    expect(mocks.recordDevConsent.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(pluginLoader.reloadPlugin).mock.invocationCallOrder[0],
    );
  });

  // M1 (fix round 1) — declining a Reload escalation must leave the row alone: the previous
  // instance keeps running under its old consent (`reloadPlugin` is never reached), so nothing
  // changed and no error should describe it as unloaded.
  it("declining a Reload escalation changes nothing", async () => {
    usePluginStore.setState({ devMode: RELEASE_ON });
    usePluginStore.getState().setDevPlugins([devPlugin(MANIFEST, APPROVED)]);
    const grown = {
      ...MANIFEST,
      capabilities: ["statusbar", "network"] as const,
    };
    mocks.reloadDevFolder.mockResolvedValue(
      row({
        consent: APPROVED,
        plugin: {
          checksum: "",
          install_path: "/dev/dev-x",
          is_dev: true,
          manifest: { ...grown, capabilities: [...grown.capabilities] },
        },
      }),
    );
    render(<PluginDeveloperSection />);
    fireEvent.click(
      screen.getByText("Dev X", { selector: ".vault-tab-item__name" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    const dialog = await findSurface(".plugin-consent");
    fireEvent.click(
      dialog.getByRole("button", { name: en["plugin.consent.cancel"] }),
    );

    await waitFor(() => expect(countAnywhere(".plugin-consent")).toBe(0));
    expect(pluginLoader.reloadPlugin).not.toHaveBeenCalled();
    expect(mocks.recordDevConsent).not.toHaveBeenCalled();
    expect(usePluginStore.getState().pluginErrors["dev-x"]).toBeUndefined();
  });

  it("a release folder whose load threw keeps the ids it holds visible (M2b)", async () => {
    // Rust recorded the id at the pick, before the load; `activate` may have written storage
    // and then thrown. The issue row carries the ids so the install flow's early refusal
    // (`devFolderHoldsId`) still sees the folder.
    usePluginStore.setState({ devMode: RELEASE_ON });
    mocks.pickDevFolder.mockResolvedValue(
      row({ consent: APPROVED, ids: ["dev-x"] }),
    );
    vi.mocked(pluginLoader.loadPlugin).mockRejectedValueOnce(new Error("boom"));
    render(<PluginDeveloperSection />);
    fireEvent.click(loadButton());

    await waitFor(() =>
      expect(usePluginStore.getState().devFolderIssues).toEqual([
        { error: "boom", ids: ["dev-x"], path: "/dev/dev-x" },
      ]),
    );
  });

  it("declining a re-picked folder that is already an issue row keeps it listed (P13)", async () => {
    // The twin of "a refused first pick … takes the folder back off the list": the only
    // difference is that the folder was on the list before this pick.
    usePluginStore.setState({
      devFolderIssues: [
        { error: "DEV_FOLDER_NOT_APPROVED", ids: [], path: "/dev/dev-x" },
      ],
      devMode: RELEASE_ON,
    });
    render(<PluginDeveloperSection />);
    fireEvent.click(loadButton());
    const dialog = await findSurface(".plugin-consent");
    fireEvent.click(
      dialog.getByRole("button", { name: en["plugin.consent.cancel"] }),
    );
    await waitFor(() => expect(countAnywhere(".plugin-consent")).toBe(0));
    expect(mocks.removeDevFolder).not.toHaveBeenCalled();
  });

  it("says why Rust refused a pick, in the user's words", async () => {
    usePluginStore.setState({ devMode: RELEASE_ON });
    mocks.pickDevFolder.mockRejectedValue("DEV_PLUGIN_NOT_SANDBOXED");
    const showToast = vi.spyOn(useUIStore.getState(), "showToast");
    render(<PluginDeveloperSection />);
    fireEvent.click(loadButton());
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining(en["plugin.dev.error.notSandboxed"]),
      ),
    );
  });

  it("shows a refused folder as a row with its reason, and removes it", async () => {
    usePluginStore.setState({
      devFolderIssues: [
        { error: "DEV_PLUGIN_ID_INSTALLED", ids: [], path: "/dev/other" },
      ],
      devMode: RELEASE_ON,
    });
    render(<PluginDeveloperSection />);
    expect(screen.getByText("/dev/other")).toBeInTheDocument();
    expect(
      screen.getByText(en["plugin.dev.error.idInstalled"]),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mocks.removeDevFolder).toHaveBeenCalledWith("/dev/other"),
    );
    await waitFor(() => expect(screen.queryByText("/dev/other")).toBeNull());
  });
});
