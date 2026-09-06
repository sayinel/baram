// issue 265 — the unhandled-rejection policy: suppress only the evidenced
// WKWebView teardown shape, report everything else, prevent the browser
// default for those only in production.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyRejection,
  describeReason,
  installUnhandledRejectionPolicy,
  reportCaughtError,
  subscribeToAsyncErrors,
} from "../async-error-policy";

/** The exact message WebKit produces for the dereference in Tauri's _unlisten
 *  once the webview is being torn down. */
const TEARDOWN =
  "TypeError: undefined is not an object (evaluating 'window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener')";

function rejection(reason: unknown) {
  const event = new Event("unhandledrejection", {
    cancelable: true,
  }) as PromiseRejectionEvent;
  Object.defineProperty(event, "reason", { value: reason });
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyRejection", () => {
  it("recognises the Tauri teardown dereference as an Error, a string, or an object", () => {
    expect(classifyRejection(new TypeError(TEARDOWN))).toBe("webkit-teardown");
    expect(classifyRejection(TEARDOWN)).toBe("webkit-teardown");
    expect(classifyRejection({ message: TEARDOWN })).toBe("webkit-teardown");
  });

  it("treats everything else as unexpected — including the sync-error signatures", () => {
    expect(classifyRejection(new Error("boom"))).toBe("unexpected");
    expect(classifyRejection("Can't find variable: document")).toBe(
      "unexpected",
    );
    expect(classifyRejection("listeners[3] is undefined")).toBe("unexpected");
    expect(classifyRejection(undefined)).toBe("unexpected");
    expect(classifyRejection(42)).toBe("unexpected");
  });

  it("describes any reason without throwing", () => {
    expect(describeReason(new Error("x"))).toBe("x");
    expect(describeReason("s")).toBe("s");
    expect(describeReason({ a: 1 })).toBe('{"a":1}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(typeof describeReason(cyclic)).toBe("string");
  });
});

describe("reportCaughtError", () => {
  it("logs at error level and notifies subscribers until they unsubscribe", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    const off = subscribeToAsyncErrors((r) => seen.push(r.scope));
    reportCaughtError("ghost-text prefetch", new Error("nope"));
    off();
    reportCaughtError("later", new Error("unseen"));
    expect(seen).toEqual(["ghost-text prefetch"]);
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe("the reporting path never throws", () => {
  it("isolates a throwing subscriber from the others and from the caller", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error("subscriber bug");
    });
    const good = vi.fn();
    const offBad = subscribeToAsyncErrors(bad);
    const offGood = subscribeToAsyncErrors(good);
    expect(() => reportCaughtError("scope", new Error("x"))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    // The subscriber's own failure is logged, not re-reported to subscribers.
    expect(bad).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
    offBad();
    offGood();
  });

  it("describes a reason whose conversions throw", () => {
    const hostile = {
      toJSON() {
        throw new Error("no json");
      },
      toString() {
        throw new Error("no string");
      },
    };
    expect(describeReason(hostile)).toBe("[unprintable reason]");
    expect(classifyRejection(hostile)).toBe("unexpected");
  });

  it("describes an Error whose message getter throws, and a Proxy whose traps throw", () => {
    const hostileError = new Error("x");
    Object.defineProperty(hostileError, "message", {
      get() {
        throw new Error("no message");
      },
    });
    expect(typeof describeReason(hostileError)).toBe("string");
    expect(classifyRejection(hostileError)).toBe("unexpected");
    const hostileProxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("no prototype");
        },
        get() {
          throw new Error("no props");
        },
      },
    );
    expect(describeReason(hostileProxy)).toBe("[unprintable reason]");
    expect(classifyRejection(hostileProxy)).toBe("unexpected");
  });

  it("survives a console that throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console gone");
    });
    expect(() => reportCaughtError("scope", new Error("x"))).not.toThrow();
  });
});

describe("installUnhandledRejectionPolicy", () => {
  it("in production a hostile reason cannot defeat the crash guard", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("no prototype");
        },
      },
    );
    const target = new EventTarget();
    const uninstall = installUnhandledRejectionPolicy(target as Window, {
      isProduction: true,
    });
    const event = rejection(hostile);
    expect(() => target.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
    uninstall();
  });

  it("in production the default is prevented before any reporting runs, even if it throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console gone");
    });
    const off = subscribeToAsyncErrors(() => {
      throw new Error("subscriber gone");
    });
    const target = new EventTarget();
    const uninstall = installUnhandledRejectionPolicy(target as Window, {
      isProduction: true,
    });
    const event = rejection(new Error("anything"));
    expect(() => target.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
    uninstall();
    off();
  });

  it("suppresses the teardown rejection with a warning and no report", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    const target = new EventTarget();
    const uninstall = installUnhandledRejectionPolicy(target as Window, {
      isProduction: false,
    });
    const event = rejection(new TypeError(TEARDOWN));
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(reports).not.toHaveBeenCalled();
    uninstall();
    off();
  });

  it("reports an unexpected rejection and leaves the default alone outside production", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    const target = new EventTarget();
    const uninstall = installUnhandledRejectionPolicy(target as Window, {
      isProduction: false,
    });
    const event = rejection(new Error("leaked listener"));
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(reports).toHaveBeenCalledWith({
      error: event.reason,
      scope: "unhandledrejection",
    });
    uninstall();
    off();
  });

  it("prevents the default for an unexpected rejection in production, still reporting it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    const target = new EventTarget();
    const uninstall = installUnhandledRejectionPolicy(target as Window, {
      isProduction: true,
    });
    const event = rejection("stale IPC call");
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(reports).toHaveBeenCalledTimes(1);
    uninstall();
    off();
  });

  it("stops listening once uninstalled", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    const target = new EventTarget();
    installUnhandledRejectionPolicy(target as Window, {
      isProduction: false,
    })();
    target.dispatchEvent(rejection(new Error("after uninstall")));
    expect(reports).not.toHaveBeenCalled();
    off();
  });
});
