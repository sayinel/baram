// §395 spec 0074 D12 · §7 "순서 관문" — `vault:changed` held per context while an app file operation runs:
// a publish for a held context waits for the context's last release and goes out once; other contexts
// are not held. Released by the operation, never by time.
import { afterEach, describe, expect, it } from "vitest";

import {
  __resetVaultChangeHolds,
  holdVaultChanges,
  publishVaultChange,
  subscribeVaultChanges,
} from "../vault-changes";

function hear(): { heard: string[]; stop: () => void } {
  const heard: string[] = [];
  const stop = subscribeVaultChanges((id) => heard.push(id));
  return { heard, stop };
}

afterEach(() => {
  __resetVaultChangeHolds();
});

describe("holdVaultChanges (D12)", () => {
  it("publishes at once when nothing holds the context", () => {
    const { heard, stop } = hear();
    publishVaultChange("ctx-a");
    expect(heard).toEqual(["ctx-a"]);
    stop();
  });

  /** What fails this: no gate (the change goes out during the operation), or a release that drops what
   *  was held instead of publishing it. */
  it("holds a context's change until the release, then publishes it once", () => {
    const { heard, stop } = hear();
    const release = holdVaultChanges(["ctx-a"]);
    publishVaultChange("ctx-a");
    publishVaultChange("ctx-a");
    expect(heard).toEqual([]);
    release();
    expect(heard).toEqual(["ctx-a"]);
    stop();
  });

  /** Two operations on one context: the first release keeps it held. What fails this: a boolean hold. */
  it("publishes at the last release when two operations overlap", () => {
    const { heard, stop } = hear();
    const first = holdVaultChanges(["ctx-a"]);
    const second = holdVaultChanges(["ctx-a"]);
    publishVaultChange("ctx-a");
    first();
    first();
    expect(heard).toEqual([]);
    second();
    expect(heard).toEqual(["ctx-a"]);
    stop();
  });

  /** Review I2 — a hold on vault A leaves vault B's change alone. What fails this: a global gate. */
  it("lets another context through while one is held", () => {
    const { heard, stop } = hear();
    const release = holdVaultChanges(["ctx-a"]);
    publishVaultChange("ctx-b");
    expect(heard).toEqual(["ctx-b"]);
    release();
    expect(heard).toEqual(["ctx-b"]);
    stop();
  });
});
