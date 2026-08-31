import type { TaskState } from "../../../ipc/types";

// §18.18 M4 — the click ring and the attribute reader.
//
// Both are three-line functions, and both are the kind of three-line function
// that is wrong in a way nobody notices for a month: a ring with a state that
// never comes back around, or a reader that hands `undefined` to a `Record`
// lookup downstream.
import { describe, expect, it } from "vitest";

import { TASK_STATE_MARKER } from "../../../ipc/types";
import { asTaskState, nextTaskState } from "../task-state";

const ALL = Object.keys(TASK_STATE_MARKER) as TaskState[];

describe("nextTaskState — the click ring", () => {
  it("walks todo → doing → done → todo", () => {
    expect(nextTaskState("todo")).toBe("doing");
    expect(nextTaskState("doing")).toBe("done");
    expect(nextTaskState("done")).toBe("todo");
  });

  // The property that matters more than the sequence: no state is a dead end.
  // From anywhere — `cancelled` included, which is a one-way exit INTO the ring
  // rather than a member of it — pressing repeatedly reaches all three ring
  // states. An absorbing state would satisfy every assertion above and still
  // trap the user's task.
  it.each(ALL)(
    "from `%s`, pressing repeatedly reaches every ring state",
    (start) => {
      const seen = new Set<TaskState>();
      let state = start;
      for (let i = 0; i < ALL.length * 2; i++) {
        state = nextTaskState(state);
        seen.add(state);
      }
      expect([...seen].sort()).toEqual(["doing", "done", "todo"]);
    },
  );

  // ‼️ Cancelling is a decision, not a step towards finishing. If the ring ever
  // passed through it, everyone who never cancels anything would step over it
  // twice per task — and the slash command that exists to reach it (§18.18 #7)
  // would be redundant, which is how this would be "simplified" back in.
  it("never lands on `cancelled`", () => {
    expect(ALL.map(nextTaskState)).not.toContain("cancelled");
  });

  it("leaves `cancelled` reachable in the other direction", () => {
    expect(nextTaskState("cancelled")).toBe("todo");
  });
});

describe("asTaskState — reading an attribute back", () => {
  it.each(ALL)("passes `%s` through", (state) => {
    expect(asTaskState(state)).toBe(state);
  });

  // A document can carry anything: pasted HTML, an older export, a plugin.
  // Every one of these used to reach a `Record<TaskState, …>` lookup as a key
  // that is not there.
  it.each([
    ["an unknown word", "archived"],
    ["the old boolean", true],
    ["a missing attribute", undefined],
    ["an explicit null", null],
    ["a marker rather than a name", "x"],
  ])("falls back to `todo` for %s", (_label, value) => {
    expect(asTaskState(value)).toBe("todo");
  });
});
