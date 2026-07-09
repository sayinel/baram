import { describe, expect, it } from "vitest";

import { safeImageSrc, safeLinkHref } from "../markdown-url";

// §backlog #8 — AI chat markdown must not render dangerous URL schemes that
// would execute in the Tauri webview and reach the IPC bridge.

describe("safeLinkHref", () => {
  it("keeps safe schemes", () => {
    expect(safeLinkHref("https://example.com")).toBe("https://example.com");
    expect(safeLinkHref("http://example.com")).toBe("http://example.com");
    expect(safeLinkHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeLinkHref("tel:+123")).toBe("tel:+123");
    expect(safeLinkHref("#anchor")).toBe("#anchor");
    expect(safeLinkHref("/relative")).toBe("/relative");
    expect(safeLinkHref("./rel")).toBe("./rel");
    expect(safeLinkHref("../rel")).toBe("../rel");
  });

  it("neutralizes dangerous schemes to '#'", () => {
    expect(safeLinkHref("javascript:alert(1)")).toBe("#");
    expect(safeLinkHref("JavaScript:alert(1)")).toBe("#");
    expect(safeLinkHref("  javascript:alert(1)")).toBe("#");
    expect(safeLinkHref("vbscript:msgbox(1)")).toBe("#");
    expect(safeLinkHref("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(safeLinkHref("file:///etc/passwd")).toBe("#");
  });
});

describe("safeImageSrc", () => {
  it("keeps safe schemes and inline images", () => {
    expect(safeImageSrc("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    expect(safeImageSrc("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(safeImageSrc("/rel.png")).toBe("/rel.png");
  });

  it("drops dangerous or non-image data schemes to empty", () => {
    expect(safeImageSrc("javascript:alert(1)")).toBe("");
    expect(safeImageSrc("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(safeImageSrc("vbscript:msgbox(1)")).toBe("");
  });
});
