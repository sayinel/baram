import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginShadowMount } from "../PluginShadowMount";

describe("PluginShadowMount", () => {
  it("mounts into a shadow root and calls onMount with an HTMLElement", () => {
    const onMount = vi.fn((el: HTMLElement) => {
      el.textContent = "from-plugin";
    });
    const { container } = render(<PluginShadowMount onMount={onMount} />);
    const host = container.querySelector(".plugin-shadow-host") as HTMLElement;
    expect(host.shadowRoot).not.toBeNull();
    expect(onMount).toHaveBeenCalledTimes(1);
    const el = onMount.mock.calls[0][0];
    expect(el).toBeInstanceOf(HTMLElement); // inner div, NOT the ShadowRoot
    expect(host.shadowRoot?.textContent).toContain("from-plugin");
  });

  it("calls onUnmount on unmount", () => {
    const onUnmount = vi.fn();
    const { unmount } = render(
      <PluginShadowMount onMount={() => {}} onUnmount={onUnmount} />,
    );
    unmount();
    expect(onUnmount).toHaveBeenCalledTimes(1);
  });
});
