import { describe, expect, it, vi } from "vitest";

import { createLinkService } from "../pdf-find";

describe("createLinkService", () => {
  it("exposes pagesCount and reads the current page through getPage", () => {
    let current = 3;
    const svc = createLinkService({
      getPage: () => current,
      pagesCount: 27,
      scrollToPage: vi.fn(),
    });

    expect(svc.pagesCount).toBe(27);
    expect(svc.page).toBe(3);
    current = 9;
    expect(svc.page).toBe(9);
  });

  it("routes page assignment to scrollToPage instead of storing it", () => {
    const scrollToPage = vi.fn();
    const svc = createLinkService({
      getPage: () => 1,
      pagesCount: 5,
      scrollToPage,
    });

    svc.page = 4;

    expect(scrollToPage).toHaveBeenCalledWith(4);
    // setter는 값을 저장하지 않는다 — 진실은 getPage 쪽에 있다
    expect(svc.page).toBe(1);
  });
});
