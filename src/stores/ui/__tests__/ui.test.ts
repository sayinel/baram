import { beforeEach, describe, expect, it } from "vitest";

import { useUIStore } from "../ui";

describe("useUIStore.showToast", () => {
  beforeEach(() => useUIStore.setState({ toast: null }));

  it("stores an optional type and bumps id", () => {
    useUIStore.getState().showToast("hi");
    expect(useUIStore.getState().toast).toMatchObject({ message: "hi" });
    expect(useUIStore.getState().toast?.type).toBeUndefined();

    useUIStore.getState().showToast("careful", "warning");
    expect(useUIStore.getState().toast).toMatchObject({
      message: "careful",
      type: "warning",
    });
  });
});
