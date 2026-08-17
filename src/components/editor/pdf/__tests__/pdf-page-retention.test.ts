// §282.3 페이지 렌더 캐시 수명 — refcount + 놓인 것만 세는 LRU.
import type { PDFPageProxy } from "pdfjs-dist";
import type { Mock } from "vitest";

import { describe, expect, it, vi } from "vitest";

import {
  MAX_RELEASED_PDF_PAGES,
  PdfPageRetention,
} from "../pdf-page-retention";

// cleanup() 호출만 관찰하면 되므로 진짜 프록시는 필요 없다. 반환값이 boolean인
// 것은 흉내 낼 가치가 있다 — pdfjs의 cleanup()은 렌더가 진행 중이면 false를
// 돌려주고, 레지스트리가 그 false를 어떻게 다루는지가 아래 한 테스트의 주제다.
interface FakePage {
  cleanup: Mock<() => boolean>;
  pageNumber: number;
}

function asProxy(page: FakePage): PDFPageProxy {
  return page as unknown as PDFPageProxy;
}

function fakePage(pageNumber: number, result = true): FakePage {
  return { cleanup: vi.fn(() => result), pageNumber };
}

/** 잡았다가 즉시 놓는다 — "지나간 페이지" 한 건. */
function touch(r: PdfPageRetention, page: FakePage): void {
  r.retain(asProxy(page))();
}

describe("PdfPageRetention", () => {
  it("never cleans up a page while it is still retained", () => {
    const r = new PdfPageRetention(1);
    const held = fakePage(1);
    r.retain(asProxy(held));
    // 상한을 한참 넘기도록 다른 페이지를 흘려보낸다.
    for (let i = 2; i <= 20; i++) touch(r, fakePage(i));
    expect(held.cleanup).not.toHaveBeenCalled();
  });

  // 이것이 이 클래스의 존재 이유다. pdfjs의 cleanup()은 "지금 그리는 중"만
  // 막아 주므로, 본문이 띄워 둔 페이지를 썸네일이 스크롤로 지나갔다는 이유로
  // 비우는 것은 pdfjs가 막아 주지 않는다.
  it("does not clean up a page one surface released while another still holds it", () => {
    const r = new PdfPageRetention(0);
    const shared = fakePage(1);
    const fromMainView = r.retain(asProxy(shared));
    const fromThumbnail = r.retain(asProxy(shared));

    fromThumbnail();
    expect(shared.cleanup).not.toHaveBeenCalled();

    fromMainView();
    expect(shared.cleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps exactly the cap's worth of released pages before evicting", () => {
    const r = new PdfPageRetention(2);
    const p1 = fakePage(1);
    const p2 = fakePage(2);
    const p3 = fakePage(3);

    touch(r, p1);
    touch(r, p2);
    // 상한과 같은 수까지는 아무것도 비우지 않는다.
    expect(p1.cleanup).not.toHaveBeenCalled();
    expect(p2.cleanup).not.toHaveBeenCalled();

    touch(r, p3);
    // 하나를 넘기면 **가장 오래 전에 놓은 것**만 비운다.
    expect(p1.cleanup).toHaveBeenCalledTimes(1);
    expect(p2.cleanup).not.toHaveBeenCalled();
    expect(p3.cleanup).not.toHaveBeenCalled();
  });

  // LRU의 기준이 **놓은 시점**이라는 것 — "잡은 시점"이 아니다.
  //
  // ‼️ 이 두 동작을 구분하려면 픽스처가 둘을 갈라놓아야 한다. 처음에는 "들렀다
  // 놓기"를 반복하는 형태로 썼는데, 그 경로는 retain도 release도 모두 lastUsed를
  // 찍으므로 어느 쪽 기준이든 같은 답이 나와 뮤테이션이 살아남았다. 두 페이지를
  // **먼저 함께 붙잡은 뒤 잡은 순서와 반대로 놓아야** 비로소 갈린다.
  // cf. [[mutation-survived-fixture-cannot-discriminate]]
  it("evicts by when a page was last let go, not by when it was first taken", () => {
    const r = new PdfPageRetention(1);
    const takenFirst = fakePage(1);
    const takenSecond = fakePage(2);

    // 둘 다 화면에 오래 떠 있었다 (예: 본문과 레일이 각각 붙잡고 있는 상태).
    const releaseFirst = r.retain(asProxy(takenFirst));
    const releaseSecond = r.retain(asProxy(takenSecond));

    // 나중에 잡은 쪽을 **먼저** 놓는다.
    releaseSecond();
    releaseFirst();

    // 놓은 순서가 기준이면 takenSecond가 가장 오래 방치된 것이다.
    // 잡은 순서가 기준이면 거꾸로 takenFirst를 고르게 된다 — 사용자가 방금
    // 지나온 페이지를 먼저 버리는, LRU의 정확히 반대편 동작이다.
    expect(takenSecond.cleanup).toHaveBeenCalledTimes(1);
    expect(takenFirst.cleanup).not.toHaveBeenCalled();
  });

  it("ignores a duplicate release instead of letting the refcount go negative", () => {
    const r = new PdfPageRetention(0);
    const page = fakePage(1);
    const releaseA = r.retain(asProxy(page));
    const releaseB = r.retain(asProxy(page));

    releaseA();
    releaseA(); // 두 번째 호출은 무시돼야 한다
    expect(page.cleanup).not.toHaveBeenCalled();

    releaseB();
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  // cleanup()이 false를 돌려주는 경우(진행 중인 렌더가 남아 있었다) 항목을
  // 그대로 두면, 다음 릴리스마다 같은 페이지를 다시 고르면서 축출이 한 발짝도
  // 나아가지 못한다 — 뒤에 놓인 페이지들이 영원히 안 비워진다.
  it("stops tracking an evicted page even when pdfjs refuses the cleanup", () => {
    const r = new PdfPageRetention(1);
    const stubborn = fakePage(1, false);
    const p2 = fakePage(2);
    const p3 = fakePage(3);

    touch(r, stubborn);
    touch(r, p2); // stubborn 축출 시도 → cleanup()이 false
    expect(stubborn.cleanup).toHaveBeenCalledTimes(1);

    touch(r, p3); // 다음 축출은 stubborn이 아니라 p2를 골라야 한다
    expect(stubborn.cleanup).toHaveBeenCalledTimes(1);
    expect(p2.cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans up everything it still tracks when disposed", () => {
    const r = new PdfPageRetention(10);
    const held = fakePage(1);
    const released = fakePage(2);
    r.retain(asProxy(held));
    touch(r, released);

    r.dispose();
    // 붙잡혀 있던 것도 비운다 — 문서가 사라지는 마당에 "사용 중"은 의미가 없다.
    expect(held.cleanup).toHaveBeenCalledTimes(1);
    expect(released.cleanup).toHaveBeenCalledTimes(1);
    expect(r.trackedCount).toBe(0);
  });

  // 버려진 레지스트리가 새 페이지를 받아 들면 그 페이지는 아무도 정리하지 않는다.
  // 지금은 React의 effect 순서 덕에 이 경로를 타는 호출부가 없지만, 그 순서는 이
  // 클래스 바깥에 있고 어디에도 적혀 있지 않다 — 스스로 지키게 하고 그것을 고정한다.
  it("takes nothing new once it has been disposed", () => {
    const r = new PdfPageRetention(0);
    const page = fakePage(1);
    r.dispose();

    const release = r.retain(asProxy(page));
    expect(r.trackedCount).toBe(0);

    // 릴리스는 여전히 부를 수 있어야 한다 — 호출부(effect cleanup)는 조건 없이 부른다.
    expect(() => release()).not.toThrow();
    expect(page.cleanup).not.toHaveBeenCalled();
  });

  it("bounds what it tracks so a long scroll cannot grow the registry", () => {
    const r = new PdfPageRetention(3);
    for (let i = 1; i <= 300; i++) touch(r, fakePage(i));
    expect(r.trackedCount).toBe(3);
  });

  // 상한이 pdfjs 자체 뷰어의 DEFAULT_CACHE_SIZE와 같다는 사실을 고정한다 —
  // 근거 없이 바뀌면 여기서 걸린다(legacy/web/pdf_viewer.mjs).
  it("defaults to the same buffer size pdfjs's own viewer uses", () => {
    expect(MAX_RELEASED_PDF_PAGES).toBe(10);
    const r = new PdfPageRetention();
    for (let i = 1; i <= MAX_RELEASED_PDF_PAGES; i++) touch(r, fakePage(i));
    expect(r.trackedCount).toBe(MAX_RELEASED_PDF_PAGES);
    touch(r, fakePage(999));
    expect(r.trackedCount).toBe(MAX_RELEASED_PDF_PAGES);
  });
});
