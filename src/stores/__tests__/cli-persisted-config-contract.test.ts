// §387 — `baram` CLI 가 config.json 에서 읽는 필드가 실제 persist 출력에 있는가.
//
// CLI(`src-tauri/src/cli/app_config.rs`)는 이 스토어들이 쓴 JSON 을 Rust 에서 직접 읽는다.
// 모르는 필드는 무시하지만, 읽는 필드의 이름이나 타입이 바뀌면 조용히 빈 목록이 된다 —
// 그래서 같은 픽스처를 양쪽이 읽는다: Rust 시험은 픽스처에서 값을 뽑고, 이 시험은 진짜
// 스토어가 그 픽스처와 같은 모양으로 쓰는지 본다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const persisted = vi.hoisted(() => new Map<string, string>());

// persist 가 스토리지에 넘기는 문자열을 그대로 잡는다. 진짜 `tauriStorage` 는 이 문자열을
// 바꾸지 않고 `set_config` 로 넘긴다.
vi.mock("../system/tauri-storage", () => ({
  tauriStorage: {
    getItem: (name: string) => Promise.resolve(persisted.get(name) ?? null),
    removeItem: (name: string) => {
      persisted.delete(name);
      return Promise.resolve();
    },
    setItem: (name: string, value: string) => {
      persisted.set(name, value);
      return Promise.resolve();
    },
  },
}));

// `add_context` 는 받은 것을 돌려준다 — persist 목록에 들어가는 것은 그 반환값이다.
vi.mock("../../ipc/context", () => ({
  addContext: vi.fn((info: unknown) => Promise.resolve(info)),
  getContexts: vi.fn(() => Promise.resolve([])),
  removeContext: vi.fn(() => Promise.resolve()),
  setActiveContext: vi.fn(() => Promise.resolve()),
  updateContextAlias: vi.fn(() => Promise.resolve()),
  updateContextColor: vi.fn(() => Promise.resolve()),
  updateContextLabel: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../services/vault-context-loader", () => ({
  refreshInactiveContextIndex: vi.fn(),
  switchContext: vi.fn(),
}));

import { useContextStore } from "../context/context";
import { useSettingsStore } from "../settings/store";

const FIXTURE_PATH = "src-tauri/src/cli/fixtures/persisted-config.json";

/** `app_config.rs` 의 `read_contexts` 가 읽는 경로. 그 함수와 함께 고친다. */
const CONTEXT_PATHS = [
  "state.contexts.0.id",
  "state.contexts.0.contextType",
  "state.contexts.0.path",
  "state.contexts.0.label",
  "state.contexts.0.alias",
  "state.activeContextId",
];

/** `app_config.rs` 의 `read_settings` 가 읽는 경로. */
const SETTINGS_PATHS = ["state.tasksExcludePaths"];

function at(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}

function fixture(key: string): unknown {
  const file = JSON.parse(
    readFileSync(join(process.cwd(), FIXTURE_PATH), "utf8"),
  ) as Record<string, string>;
  return JSON.parse(file[key]);
}

async function flushPersist(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** `typeof` 에 배열과 null 을 더한다 — Rust 쪽은 그 셋을 구분해 읽는다. */
function shape(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

describe("§387 the CLI's view of config.json", () => {
  beforeAll(async () => {
    await flushPersist();
    // 빈 목록의 "모양" 을 보면 필드를 하나도 검사하지 못한다 — vault 를 하나 넣는다.
    await useContextStore.getState().addContext("vault", "/vaults/notes");
    useSettingsStore.getState().setTasksExcludePaths(["archive"]);
    await flushPersist();
  });

  it("writes every context field the CLI reads, typed as in the fixture", () => {
    const written = persisted.get("baram:context");
    expect(written).toBeDefined();
    const actual: unknown = JSON.parse(written ?? "null");
    const expected = fixture("baram:context");
    for (const path of CONTEXT_PATHS) {
      expect(
        { path, shape: shape(at(actual, path)) },
        `baram:context ${path}`,
      ).toEqual({ path, shape: shape(at(expected, path)) });
      expect(shape(at(actual, path)), path).not.toBe("undefined");
    }
  });

  it("writes the task exclusion list the CLI applies", () => {
    const written = persisted.get("baram:settings");
    expect(written).toBeDefined();
    const actual: unknown = JSON.parse(written ?? "null");
    const expected = fixture("baram:settings");
    for (const path of SETTINGS_PATHS) {
      expect(
        { path, shape: shape(at(actual, path)) },
        `baram:settings ${path}`,
      ).toEqual({ path, shape: shape(at(expected, path)) });
    }
    expect(at(actual, "state.tasksExcludePaths")).toEqual(["archive"]);
  });

  it("spells the context kinds the CLI matches on", () => {
    const actual: unknown = JSON.parse(
      persisted.get("baram:context") ?? "null",
    );
    // `read_contexts` 가 문자열로 가른다: "vault" · "folder" · "file".
    expect(at(actual, "state.contexts.0.contextType")).toBe("vault");
  });
});
