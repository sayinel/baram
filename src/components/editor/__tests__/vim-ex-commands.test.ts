// §298 vim S3 — :w / :q ex-command wiring.
//
// One test because registerExCommands is deliberately once-per-app (Vim is a
// module singleton): the once-flag makes separate test cases order-coupled.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearActions,
  registerAction,
} from "../../../keybindings/keybinding-actions";
import { registerExCommands } from "../vim-mode";

type ExCallback = () => void;

function makeFakeModule() {
  const defs = new Map<string, { callback: ExCallback; prefix: string }>();
  return {
    defs,
    mod: {
      Vim: {
        defineEx: vi.fn((name: string, prefix: string, cb: ExCallback) => {
          defs.set(name, { callback: cb, prefix });
        }),
      },
    } as unknown as Parameters<typeof registerExCommands>[0],
  };
}

describe("registerExCommands (§298 S3)", () => {
  afterEach(() => {
    clearActions();
  });

  it("registers :write/:w and :quit/:q once, resolving actions at invocation time", () => {
    const first = makeFakeModule();
    registerExCommands(first.mod);
    expect(first.defs.get("write")?.prefix).toBe("w");
    expect(first.defs.get("quit")?.prefix).toBe("q");

    // Actions not registered yet — callbacks must no-op, not crash.
    expect(() => {
      first.defs.get("write")?.callback();
      first.defs.get("quit")?.callback();
    }).not.toThrow();

    // Late registration still routes: resolution happens per invocation
    // (App.tsx registers actions at startup, after module load in dev HMR).
    const save = vi.fn();
    const closeTab = vi.fn();
    registerAction("file.save", save);
    registerAction("file.closeTab", closeTab);
    first.defs.get("write")?.callback();
    first.defs.get("quit")?.callback();
    expect(save).toHaveBeenCalledTimes(1);
    expect(closeTab).toHaveBeenCalledTimes(1);

    // Re-registration (e.g. loader retry after a failed chunk) is a no-op —
    // no duplicate global overrides on the Vim singleton.
    const second = makeFakeModule();
    registerExCommands(second.mod);
    expect(second.mod.Vim.defineEx).not.toHaveBeenCalled();
  });
});
