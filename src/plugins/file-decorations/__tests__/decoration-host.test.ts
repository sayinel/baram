// §395 spec 0074 D14 · D15 · §6 · §7 "빈도 · 줄" — one line per plugin for its three file tree methods and
// two token buckets: a call beyond a bucket waits its turn and is never refused for being early. Fake
// timers; counted in calls and settled promises, never in elapsed real time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetDecorationHost,
  clearFileDecorationsFor,
  defineFileIconFor,
  releaseFileTree,
  setFileDecorationsFor,
} from "../decoration-host";
import { useFileDecorationStore } from "../file-decoration-store";
import { iconClassOf } from "../icons";
import {
  DECORATION_BURST,
  DECORATION_INTERVAL_MS,
  ICON_BURST,
  ICON_INTERVAL_MS,
} from "../limits";
import { RELEASED_MESSAGE, trustedLocate } from "../validate";

const SHAPE = "<svg><path d='M0 0'/></svg>";

const set = (badge: string, path = "/v/a.md", pluginId = "p") =>
  setFileDecorationsFor(
    pluginId,
    pluginId.toUpperCase(),
    [{ decoration: { badge }, path }],
    trustedLocate,
  );

const badgeAt = (path = "/v/a.md") =>
  useFileDecorationStore.getState().merged.get(path)?.badges[0]?.text;

/** Whether `promise` has settled, read without awaiting it. */
function watch(promise: Promise<unknown>): { done: boolean } {
  const state = { done: false };
  promise.then(
    () => {
      state.done = true;
    },
    () => {
      state.done = true;
    },
  );
  return state;
}

beforeEach(() => {
  // Only the clock the buckets run on — `startRefill`'s `setTimeout` and `dropLine`'s `clearTimeout` —
  // so `vi.getTimerCount()` counts refills and nothing else. jsdom 31.0.0 queues the `load` event of a
  // connected style element with `setImmediate` each time its style block is updated, and the first
  // `defineIcon` updates one twice (inserted, then its text set): with every timer faked, those two
  // tasks were counted as refills.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  __resetDecorationHost();
  vi.useRealTimers();
});

describe("the line and its buckets (D14)", () => {
  /** §7 — the refill is counted from the first spend, not from the call that waits: the ninth call made
   *  100 ms after the first eight resolves 150 ms later, at 250 ms after the first spend. What fails
   *  this: no bucket (the ninth applies at once), a refusal instead of a wait, or a refill restarted at
   *  the ninth call (it would resolve at 100 + 250 ms, so it is still pending at 150 ms). */
  it("applies eight decoration calls at once and the ninth an interval after the first spend", async () => {
    for (let i = 0; i < DECORATION_BURST; i += 1) await set(String(i));
    expect(badgeAt()).toBe(String(DECORATION_BURST - 1));
    await vi.advanceTimersByTimeAsync(100);
    const ninth = watch(set("9"));
    await vi.advanceTimersByTimeAsync(DECORATION_INTERVAL_MS - 100 - 1);
    expect(ninth.done).toBe(false);
    expect(badgeAt()).toBe(String(DECORATION_BURST - 1));
    await vi.advanceTimersByTimeAsync(1);
    expect(ninth.done).toBe(true);
    expect(badgeAt()).toBe("9");
  });

  /** §7 — eight plus one made together are applied in the order made, none refused. What fails this:
   *  a later call passing a waiting one, or a count-based refusal. */
  it("applies calls made together in order, waiting instead of refusing", async () => {
    const calls = Array.from({ length: DECORATION_BURST + 1 }, (_, i) =>
      set(String(i)),
    );
    expect(badgeAt()).toBe(String(DECORATION_BURST - 1));
    await vi.advanceTimersByTimeAsync(DECORATION_INTERVAL_MS);
    await expect(Promise.all(calls)).resolves.toHaveLength(
      DECORATION_BURST + 1,
    );
    expect(badgeAt()).toBe(String(DECORATION_BURST));
  });

  /** §7 — an icon pack's 64 calls made together resolve in order with no refusal; a decoration call
   *  made after them does not wait for icon tokens; the 65th icon call — a redefinition at the cap —
   *  waits one interval and then succeeds. What fails this: one shared bucket (the decoration would
   *  wait behind 56 icon refills), or no line (the 65th refused). */
  it("defines 64 icons at once, in order, and the 65th call waits", async () => {
    const order: number[] = [];
    const icons = Array.from({ length: ICON_BURST }, (_, i) =>
      defineFileIconFor("p", `i${i}`, SHAPE).then(() => {
        order.push(i);
      }),
    );
    const decoration = watch(set("1"));
    await Promise.all(icons);
    expect(order).toEqual(Array.from({ length: ICON_BURST }, (_, i) => i));
    await vi.advanceTimersByTimeAsync(0);
    expect(decoration.done).toBe(true);
    const again = defineFileIconFor("p", "i0", SHAPE);
    const seen = watch(again);
    await vi.advanceTimersByTimeAsync(ICON_INTERVAL_MS - 1);
    expect(seen.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(again).resolves.toBeUndefined();
  });

  it("keeps one line per plugin", async () => {
    for (let i = 0; i < DECORATION_BURST; i += 1) await set("1");
    await expect(set("1", "/v/a.md", "q")).resolves.toBeUndefined();
  });
});

describe("what is judged when (P26)", () => {
  /** A malformed call is refused at once, even with the bucket empty: it never waits its turn. */
  it("refuses a malformed call without waiting", async () => {
    for (let i = 0; i < DECORATION_BURST; i += 1) await set("1");
    await expect(set("abc")).rejects.toThrow(
      "decoration.badge must be 1–2 characters",
    );
  });

  /** An icon defined earlier in the same line counts; an icon never defined is refused when applied. */
  it("judges an svg icon when the call is applied", async () => {
    await expect(
      Promise.all([
        defineFileIconFor("p", "star", SHAPE),
        setFileDecorationsFor(
          "p",
          "P",
          [{ decoration: { icon: { svg: "star" } }, path: "/v/a.md" }],
          trustedLocate,
        ),
      ]),
    ).resolves.toHaveLength(2);
    await expect(
      setFileDecorationsFor(
        "p",
        "P",
        [{ decoration: { icon: { svg: "moon" } }, path: "/v/b.md" }],
        trustedLocate,
      ),
    ).rejects.toThrow('names "moon"');
  });
});

describe("a call that throws when applied", () => {
  /** A lone surrogate in the SVG makes `encodeURIComponent` throw a `URIError` inside `defineIcon`. The
   *  call is rejected with that same error object and the call behind it is applied. This row pins
   *  only the pass-through (a rejection built from the message alone is not a `URIError`) and that the
   *  line continues; a throw escaping `pump` is caught by the Promise executor on this path and stays
   *  green here — "a call that throws on a refill" below pins the catch. */
  it("rejects the call, then applies the one behind it", async () => {
    const bad = defineFileIconFor(
      "p",
      "bad",
      "<svg><title>\uD800</title></svg>",
    );
    const next = set("5");
    await expect(bad).rejects.toThrow(URIError);
    await expect(next).resolves.toBeUndefined();
    expect(badgeAt()).toBe("5");
    expect(iconClassOf("p", "bad")).toBeUndefined();
  });
});

describe("a call that throws on a refill", () => {
  /** The same throw, but the call waits for a token, so it is applied from the refill timer, where
   *  nothing catches an escape. The call behind it is still applied after the next refill. What fails
   *  this: no `catch` in `pump` — the rejection of `bad` is lost (it stays pending) and the throw
   *  fake timers re-raise out of `advanceTimersByTimeAsync` fails the row (probe: the catch replaced
   *  by `finally {}`). */
  it("rejects the waiting call and keeps the line moving", async () => {
    const fill = Array.from({ length: ICON_BURST }, (_, i) =>
      defineFileIconFor("p", `i${i}`, SHAPE),
    );
    await Promise.all(fill);
    const bad = defineFileIconFor(
      "p",
      "i0",
      "<svg><title>\uD800</title></svg>",
    );
    const badSeen = watch(bad);
    const next = defineFileIconFor("p", "i1", SHAPE);
    const nextSeen = watch(next);
    await vi.advanceTimersByTimeAsync(ICON_INTERVAL_MS);
    expect(badSeen.done).toBe(true);
    await expect(bad).rejects.toThrow(URIError);
    expect(nextSeen.done).toBe(false);
    await vi.advanceTimersByTimeAsync(ICON_INTERVAL_MS);
    await expect(next).resolves.toBeUndefined();
  });
});

describe("clearing and releasing (D15)", () => {
  it("clears decorations and keeps icons", async () => {
    await defineFileIconFor("p", "star", SHAPE);
    await set("1");
    await clearFileDecorationsFor("p");
    expect(badgeAt()).toBeUndefined();
    expect(iconClassOf("p", "star")).toBeDefined();
  });

  /** §6 — a waiting call is rejected on release, never applied after it. What fails this: a queue
   *  left running (the decoration comes back after the unload), or a promise left pending forever. */
  it("rejects what waits, forgets the plugin and stops its refills", async () => {
    await defineFileIconFor("p", "star", SHAPE);
    for (let i = 0; i < DECORATION_BURST; i += 1) await set("1");
    const waiting = set("2");
    expect(vi.getTimerCount()).toBe(2);
    releaseFileTree("p");
    await expect(waiting).rejects.toThrow(RELEASED_MESSAGE);
    expect(badgeAt()).toBeUndefined();
    expect(iconClassOf("p", "star")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(DECORATION_INTERVAL_MS * 4);
    expect(badgeAt()).toBeUndefined();
  });

  /** Refills stop once a bucket is full: after burst × interval nothing is pending. The pair of the
   *  `toBe(0)` above — that count is 2 while the buckets are not full. */
  it("stops refilling once the bucket is full", async () => {
    for (let i = 0; i < DECORATION_BURST; i += 1) await set("1");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(
      DECORATION_BURST * DECORATION_INTERVAL_MS,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  /** A load after a release starts with a full bucket the old refill does not touch: the first eight
   *  calls resolve at once, and the ninth waits the whole interval — had the old timer (due 150 ms after
   *  the release) survived, it would have given the ninth a token early. */
  it("starts a re-load clean", async () => {
    for (let i = 0; i < DECORATION_BURST; i += 1) await set("1");
    await vi.advanceTimersByTimeAsync(100);
    releaseFileTree("p");
    for (let i = 0; i < DECORATION_BURST; i += 1) await set("2");
    const ninth = watch(set("3"));
    await vi.advanceTimersByTimeAsync(DECORATION_INTERVAL_MS - 1);
    expect(ninth.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ninth.done).toBe(true);
  });
});
