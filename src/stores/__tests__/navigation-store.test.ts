// §37 Navigation History Store — unit tests
import { beforeEach, describe, expect, it } from "vitest";

import { useNavigationStore } from "../ui/navigation";

// Reset store before each test
beforeEach(() => {
  useNavigationStore.setState({
    backStack: [],
    forwardStack: [],
    _navigating: false,
  });
});

describe("Navigation History Store", () => {
  it("pushHistory adds tabId to backStack", () => {
    const { pushHistory } = useNavigationStore.getState();
    pushHistory("tab-1");
    pushHistory("tab-2");
    expect(useNavigationStore.getState().backStack).toEqual(["tab-1", "tab-2"]);
  });

  it("pushHistory clears forwardStack", () => {
    useNavigationStore.setState({
      backStack: ["tab-1"],
      forwardStack: ["tab-3"],
    });
    useNavigationStore.getState().pushHistory("tab-2");
    expect(useNavigationStore.getState().forwardStack).toEqual([]);
  });

  it("goBack pops from backStack and pushes current to forwardStack", () => {
    useNavigationStore.setState({
      backStack: ["tab-1", "tab-2"],
      forwardStack: [],
    });

    const targetId = useNavigationStore.getState().goBack("tab-3");

    expect(targetId).toBe("tab-2");
    expect(useNavigationStore.getState().backStack).toEqual(["tab-1"]);
    expect(useNavigationStore.getState().forwardStack).toEqual(["tab-3"]);
  });

  it("goBack returns null when backStack is empty", () => {
    const targetId = useNavigationStore.getState().goBack("tab-1");
    expect(targetId).toBeNull();
  });

  it("goForward pops from forwardStack and pushes current to backStack", () => {
    useNavigationStore.setState({
      backStack: ["tab-1"],
      forwardStack: ["tab-3", "tab-4"],
    });

    const targetId = useNavigationStore.getState().goForward("tab-2");

    expect(targetId).toBe("tab-4");
    expect(useNavigationStore.getState().backStack).toEqual(["tab-1", "tab-2"]);
    expect(useNavigationStore.getState().forwardStack).toEqual(["tab-3"]);
  });

  it("goForward returns null when forwardStack is empty", () => {
    const targetId = useNavigationStore.getState().goForward("tab-1");
    expect(targetId).toBeNull();
  });

  it("goBack skips closed tab IDs", () => {
    useNavigationStore.setState({
      backStack: ["tab-1", "tab-closed", "tab-closed"],
      forwardStack: [],
    });

    const openTabIds = new Set(["tab-1", "tab-current"]);
    const targetId = useNavigationStore
      .getState()
      .goBack("tab-current", openTabIds);

    expect(targetId).toBe("tab-1");
    expect(useNavigationStore.getState().backStack).toEqual([]);
    expect(useNavigationStore.getState().forwardStack).toEqual(["tab-current"]);
  });

  it("goBack returns null when all backStack tabs are closed", () => {
    useNavigationStore.setState({
      backStack: ["tab-closed-1", "tab-closed-2"],
      forwardStack: [],
    });

    const openTabIds = new Set(["tab-current"]);
    const targetId = useNavigationStore
      .getState()
      .goBack("tab-current", openTabIds);

    expect(targetId).toBeNull();
    expect(useNavigationStore.getState().backStack).toEqual([]);
  });

  it("goForward skips closed tab IDs", () => {
    useNavigationStore.setState({
      backStack: [],
      forwardStack: ["tab-closed", "tab-5"],
    });

    const openTabIds = new Set(["tab-5", "tab-current"]);
    const targetId = useNavigationStore
      .getState()
      .goForward("tab-current", openTabIds);

    expect(targetId).toBe("tab-5");
    expect(useNavigationStore.getState().backStack).toEqual(["tab-current"]);
    expect(useNavigationStore.getState().forwardStack).toEqual([]);
  });

  it("full navigation flow: push → back → forward", () => {
    const store = useNavigationStore.getState();
    // Simulate: open tab-1, then tab-2, then tab-3
    store.pushHistory("tab-1"); // navigated away from tab-1
    store.pushHistory("tab-2"); // navigated away from tab-2
    // currently on tab-3

    // Go back: tab-3 → tab-2
    const back1 = useNavigationStore.getState().goBack("tab-3");
    expect(back1).toBe("tab-2");

    // Go back: tab-2 → tab-1
    const back2 = useNavigationStore.getState().goBack("tab-2");
    expect(back2).toBe("tab-1");

    // Go forward: tab-1 → tab-2
    const fwd1 = useNavigationStore.getState().goForward("tab-1");
    expect(fwd1).toBe("tab-2");

    // Go forward: tab-2 → tab-3
    const fwd2 = useNavigationStore.getState().goForward("tab-2");
    expect(fwd2).toBe("tab-3");

    // Forward stack should be empty now
    expect(useNavigationStore.getState().forwardStack).toEqual([]);
  });

  it("pushHistory after goBack clears forwardStack (browser behavior)", () => {
    useNavigationStore.setState({
      backStack: ["tab-1", "tab-2"],
      forwardStack: [],
    });

    // Go back from tab-3 to tab-2
    useNavigationStore.getState().goBack("tab-3");
    expect(useNavigationStore.getState().forwardStack).toEqual(["tab-3"]);

    // Now open new tab-4 (pushHistory)
    useNavigationStore.getState().pushHistory("tab-2");
    expect(useNavigationStore.getState().forwardStack).toEqual([]);
    expect(useNavigationStore.getState().backStack).toEqual(["tab-1", "tab-2"]);
  });

  it("limits backStack size to prevent memory leak", () => {
    const store = useNavigationStore.getState();
    for (let i = 0; i < 200; i++) {
      store.pushHistory(`tab-${i}`);
    }
    expect(useNavigationStore.getState().backStack.length).toBeLessThanOrEqual(
      100,
    );
  });
});
