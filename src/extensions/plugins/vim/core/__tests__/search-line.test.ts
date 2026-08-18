// §298 vim `/` 검색 — search line 상태기계 (#372 티어 3에서 승격).
//
// vim의 `/`는 현재 버퍼 안에서만 검색한다 — Baram에서 버퍼 = 열린 문서.
// ex line(`:`)과 같은 입력 누적 구조: `/` 또는 `?`로 열고, Enter가 search
// 명령을 emit하며 lastSearch를 기록, `n`/`N`이 그것을 재사용한다. 패턴
// 언어는 JS RegExp(에뮬레이터 관행 — vim 방언이 아니라), smartcase는
// 어댑터 소관이므로 여기서는 문자열만 나른다.

import type { CoreCommand, KeyToken, VimCoreState } from "../types";

import { describe, expect, it } from "vitest";

import { step } from "../state-machine";
import { initialCoreState } from "../types";

function key(k: string, mods: Partial<KeyToken> = {}): KeyToken {
  return { alt: false, ctrl: false, key: k, mod: false, shift: false, ...mods };
}

function run(
  keys: string[],
  start: VimCoreState = initialCoreState(),
  cursor = 10,
): { commands: CoreCommand[]; state: VimCoreState } {
  const commands: CoreCommand[] = [];
  let state = start;
  for (const k of keys) {
    const r = step(state, key(k), { cursor });
    state = r.state;
    if (r.command) commands.push(r.command);
  }
  return { commands, state };
}

describe("search line open / accumulate / close", () => {
  it("`/` opens a forward search line (a count prefix is dropped)", () => {
    const { state } = run(["3", "/"]);
    expect(state.searchLine).toEqual({ direction: "forward", text: "" });
    expect(state.count).toBeNull();
  });

  it("`?` opens a backward search line", () => {
    const { state } = run(["?"]);
    expect(state.searchLine).toEqual({ direction: "backward", text: "" });
  });

  it("printable keys accumulate — including the raw (IME) character", () => {
    const { state } = run(["/", "t", "e"]);
    expect(state.searchLine?.text).toBe("te");

    const r = step(state, { ...key("r"), raw: "ㄱ" }, { cursor: 10 });
    expect(r.state.searchLine?.text).toBe("teㄱ");
  });

  it("Backspace deletes; on empty it closes the line", () => {
    const one = run(["/", "t", "Backspace"]).state;
    expect(one.searchLine?.text).toBe("");

    const closed = run(["/", "Backspace"]).state;
    expect(closed.searchLine).toBeNull();
  });

  it("Escape closes without emitting", () => {
    const { commands, state } = run(["/", "t", "e", "Escape"]);
    expect(state.searchLine).toBeNull();
    expect(commands).toHaveLength(0);
  });

  it("keys while the line is open never leak to the app", () => {
    let state = run(["/"]).state;
    for (const token of [key("s", { mod: true }), key("Tab"), key("F1")]) {
      const r = step(state, token, { cursor: 10 });
      expect(r.handled).toBe(true);
      state = r.state;
    }
  });
});

describe("Enter emits the search and records it", () => {
  it("`/te` Enter emits a forward search and sets lastSearch", () => {
    const { commands, state } = run(["/", "t", "e", "Enter"]);
    expect(commands).toEqual([
      { count: 1, direction: "forward", pattern: "te", type: "search" },
    ]);
    expect(state.searchLine).toBeNull();
    expect(state.lastSearch).toEqual({ direction: "forward", pattern: "te" });
  });

  it("`?x` Enter emits backward", () => {
    const { commands } = run(["?", "x", "Enter"]);
    expect(commands[0]).toMatchObject({
      direction: "backward",
      type: "search",
    });
  });

  it("empty Enter repeats the last search in the line's direction", () => {
    const first = run(["/", "a", "Enter"]).state;
    const { commands } = run(["?", "Enter"], first);
    expect(commands).toEqual([
      { count: 1, direction: "backward", pattern: "a", type: "search" },
    ]);
  });

  it("empty Enter with no history just closes (silent)", () => {
    const { commands, state } = run(["/", "Enter"]);
    expect(commands).toHaveLength(0);
    expect(state.searchLine).toBeNull();
  });
});

describe("n / N repeat", () => {
  const searched = run(["/", "a", "Enter"]).state;

  it("`n` repeats in the same direction, `N` flips it", () => {
    expect(run(["n"], searched).commands).toEqual([
      { count: 1, direction: "forward", pattern: "a", type: "search" },
    ]);
    expect(run(["N"], searched).commands).toEqual([
      { count: 1, direction: "backward", pattern: "a", type: "search" },
    ]);
  });

  it("`N` after a backward search goes forward", () => {
    const back = run(["?", "a", "Enter"]).state;
    expect(run(["N"], back).commands[0]).toMatchObject({
      direction: "forward",
    });
  });

  it("a count multiplies: `3n`", () => {
    expect(run(["3", "n"], searched).commands[0]).toMatchObject({ count: 3 });
  });

  it("`n` with no history is a silent no-op (still handled)", () => {
    const r = step(initialCoreState(), key("n"), { cursor: 10 });
    expect(r.handled).toBe(true);
    expect(r.command).toBeNull();
  });
});
