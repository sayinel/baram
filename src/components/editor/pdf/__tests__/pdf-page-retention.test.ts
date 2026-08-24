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

/**
 * 축출 판정은 마이크로태스크로 미뤄진다(#scheduleEviction) — 단정 전에 흘려준다.
 *
 * 이 한 줄이 이 파일에서 가장 중요한 계약이다: 미뤄지지 않으면 React가 한 커밋에서
 * 모든 페이지를 동시에 놓는 순간(줌 변경) 화면에 떠 있는 페이지들이 서로를 축출한다.
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

/** 잡았다가 즉시 놓는다 — "지나간 페이지" 한 건. */
function touch(r: PdfPageRetention, page: FakePage): void {
  r.retain(asProxy(page))();
}

describe("PdfPageRetention", () => {
  it("never cleans up a page while it is still retained", async () => {
    const r = new PdfPageRetention(1);
    const held = fakePage(1);
    r.retain(asProxy(held));
    // 상한을 한참 넘기도록 다른 페이지를 흘려보낸다.
    for (let i = 2; i <= 20; i++) touch(r, fakePage(i));
    await settle();
    expect(held.cleanup).not.toHaveBeenCalled();
  });

  // 이것이 이 클래스의 존재 이유다. pdfjs의 cleanup()은 "지금 그리는 중"만
  // 막아 주므로, 본문이 띄워 둔 페이지를 썸네일이 스크롤로 지나갔다는 이유로
  // 비우는 것은 pdfjs가 막아 주지 않는다.
  it("does not clean up a page one surface released while another still holds it", async () => {
    const r = new PdfPageRetention(0);
    const shared = fakePage(1);
    const fromMainView = r.retain(asProxy(shared));
    const fromThumbnail = r.retain(asProxy(shared));

    fromThumbnail();
    await settle();
    expect(shared.cleanup).not.toHaveBeenCalled();

    fromMainView();
    await settle();
    expect(shared.cleanup).toHaveBeenCalledTimes(1);
  });

  // ‼️ 리뷰가 실측으로 찾은 결함의 회귀 테스트.
  //
  // React는 한 커밋에서 트리 전체의 effect destroy를 **전부** 돌린 뒤 create를
  // **전부** 돌린다. 줌이 한 스텝 바뀌면 보이는 PdfPage가 모두 재실행되므로,
  // destroy 패스가 끝난 찰나에 **모든 페이지의 refCount가 동시에 0**이 된다.
  // 그 순간에 축출을 판정하면 "아무도 안 보는 페이지"가 아니라 화면에 떠 있는
  // 페이지를 세게 되고, 상한을 넘는 만큼이 비워진다 — 곧바로 다시 그려야 하는,
  // 하필 뷰포트 최상단의 페이지들이.
  it("does not evict pages that are all released and re-retained within one commit", async () => {
    const r = new PdfPageRetention(10);
    const pages = Array.from({ length: 14 }, (_, i) => fakePage(i + 1));
    const releases = pages.map((p) => r.retain(asProxy(p)));

    // ── React의 destroy 패스: 보이는 페이지가 전부 한꺼번에 놓인다.
    for (const release of releases) release();
    // ── React의 create 패스: 같은 커밋에서 곧바로 다시 잡는다.
    for (const p of pages) r.retain(asProxy(p));

    await settle();

    for (const p of pages) {
      expect(
        p.cleanup,
        `page ${String(p.pageNumber)} was evicted while still on screen`,
      ).not.toHaveBeenCalled();
    }
    expect(r.trackedCount).toBe(14);
  });

  // 위 테스트의 짝 — 미루기가 축출 **자체**를 없애 버리면 누수가 그대로 남는다.
  it("still evicts once the burst settles and the pages are not taken again", async () => {
    const r = new PdfPageRetention(10);
    const pages = Array.from({ length: 14 }, (_, i) => fakePage(i + 1));
    for (const p of pages) r.retain(asProxy(p))();

    await settle();

    expect(r.trackedCount).toBe(10);
    // 가장 먼저 놓인 4개가 희생된다.
    for (const p of pages.slice(0, 4)) {
      expect(p.cleanup).toHaveBeenCalledTimes(1);
    }
    for (const p of pages.slice(4)) {
      expect(p.cleanup).not.toHaveBeenCalled();
    }
  });

  it("keeps exactly the cap's worth of released pages before evicting", async () => {
    const r = new PdfPageRetention(2);
    const p1 = fakePage(1);
    const p2 = fakePage(2);
    const p3 = fakePage(3);

    touch(r, p1);
    touch(r, p2);
    await settle();
    // 상한과 같은 수까지는 아무것도 비우지 않는다.
    expect(p1.cleanup).not.toHaveBeenCalled();
    expect(p2.cleanup).not.toHaveBeenCalled();

    touch(r, p3);
    await settle();
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
  it("evicts by when a page was last let go, not by when it was first taken", async () => {
    const r = new PdfPageRetention(1);
    const takenFirst = fakePage(1);
    const takenSecond = fakePage(2);

    // 둘 다 화면에 오래 떠 있었다 (예: 본문과 레일이 각각 붙잡고 있는 상태).
    const releaseFirst = r.retain(asProxy(takenFirst));
    const releaseSecond = r.retain(asProxy(takenSecond));

    // 나중에 잡은 쪽을 **먼저** 놓는다.
    releaseSecond();
    releaseFirst();
    await settle();

    // 놓은 순서가 기준이면 takenSecond가 가장 오래 방치된 것이다.
    // 잡은 순서가 기준이면 거꾸로 takenFirst를 고르게 된다 — 사용자가 방금
    // 지나온 페이지를 먼저 버리는, LRU의 정확히 반대편 동작이다.
    expect(takenSecond.cleanup).toHaveBeenCalledTimes(1);
    expect(takenFirst.cleanup).not.toHaveBeenCalled();
  });

  it("ignores a duplicate release instead of letting the refcount go negative", async () => {
    const r = new PdfPageRetention(0);
    const page = fakePage(1);
    const releaseA = r.retain(asProxy(page));
    const releaseB = r.retain(asProxy(page));

    releaseA();
    releaseA(); // 두 번째 호출은 무시돼야 한다
    await settle();
    expect(page.cleanup).not.toHaveBeenCalled();

    releaseB();
    await settle();
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  // cleanup()이 false를 돌려주는 경우(진행 중인 렌더가 남아 있었다) 항목을
  // 그대로 두면, 다음 릴리스마다 같은 페이지를 다시 고르면서 축출이 한 발짝도
  // 나아가지 못한다 — 뒤에 놓인 페이지들이 영원히 안 비워진다.
  it("stops tracking an evicted page even when pdfjs refuses the cleanup", async () => {
    const r = new PdfPageRetention(1);
    const stubborn = fakePage(1, false);
    const p2 = fakePage(2);
    const p3 = fakePage(3);

    touch(r, stubborn);
    touch(r, p2); // stubborn 축출 시도 → cleanup()이 false
    await settle();
    expect(stubborn.cleanup).toHaveBeenCalledTimes(1);

    touch(r, p3); // 다음 축출은 stubborn이 아니라 p2를 골라야 한다
    await settle();
    expect(stubborn.cleanup).toHaveBeenCalledTimes(1);
    expect(p2.cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans up the pages nobody is holding when disposed", async () => {
    const r = new PdfPageRetention(10);
    const released = fakePage(2);
    touch(r, released);
    await settle();

    r.dispose();
    expect(released.cleanup).toHaveBeenCalledTimes(1);
    expect(r.trackedCount).toBe(0);
  });

  // ‼️ 붙잡힌 페이지는 dispose **시점에는** 건드리지 않는다. React의 passive destroy는
  // 언마운트와 StrictMode 더블 인보크에서 **부모가 먼저** 돌기 때문에(리뷰 실측),
  // 여기서 비우면 아직 렌더 중인 페이지에 cleanup()이 걸리고 — 거절당하면서 남은
  // 래치가 곧이어 도착하는 자식의 cancel()에서 발화한다. 이 커밋이 막으려던 바로
  // 그 시나리오다.
  it("leaves a page that is still held alone when disposed", () => {
    const r = new PdfPageRetention(10);
    const held = fakePage(1);
    r.retain(asProxy(held));

    r.dispose();

    expect(held.cleanup).not.toHaveBeenCalled();
    expect(r.trackedCount).toBe(0);
  });

  // ‼️ **그러나 결국은 비워져야 한다.** 예전에는 "문서 파기(loadingTask.destroy())가
  // 어차피 회수한다"에 기댔는데, 그 전제가 사라졌다 — pdf-doc-cache의 임대로 문서가
  // 표면보다 오래 산다(재방문 시 워커 파싱을 건너뛰기 위해). 그러면 언마운트 순간 화면에
  // 있던 페이지들의 operator list가 LRU가 문서를 파기할 때까지 남는다. 페이지당 ~687KB
  // 실측이고, 스캔본의 디코드된 비트맵은 측정조차 안 된 크기다.
  //
  // 비우기에 안전한 시점은 홀더가 놓는 순간이다 — 호출부가 `cancel(); release()` 순서를
  // 지키므로 그때는 렌더가 끝나 있고, 래치를 남기지 않는다.
  it("cleans a held page once its holder lets go after dispose", async () => {
    const r = new PdfPageRetention(10);
    const held = fakePage(1);
    const release = r.retain(asProxy(held));

    r.dispose();
    expect(held.cleanup).not.toHaveBeenCalled();

    release();
    await settle();
    expect(held.cleanup).toHaveBeenCalledTimes(1);
    expect(r.trackedCount).toBe(0);
  });

  // 세 표면이 같은 프록시를 그린다(본문·썸네일·영역 크롭). dispose 뒤에도 그 계약은
  // 같다 — **마지막** 홀더가 놓을 때만 비운다.
  it("waits for the last holder after dispose", async () => {
    const r = new PdfPageRetention(10);
    const held = fakePage(1);
    const releaseA = r.retain(asProxy(held));
    const releaseB = r.retain(asProxy(held));

    r.dispose();
    releaseA();
    await settle();
    expect(held.cleanup).not.toHaveBeenCalled();

    releaseB();
    await settle();
    expect(held.cleanup).toHaveBeenCalledTimes(1);
  });

  // 버려진 레지스트리가 새 페이지를 받아 들면 그 페이지는 아무도 정리하지 않는다.
  // 지금은 React의 effect 순서 덕에 이 경로를 타는 호출부가 없지만, 그 순서는 이
  // 클래스 바깥에 있고 어디에도 적혀 있지 않다 — 스스로 지키게 하고 그것을 고정한다.
  it("takes nothing new once it has been disposed", async () => {
    const r = new PdfPageRetention(0);
    const page = fakePage(1);
    r.dispose();

    const release = r.retain(asProxy(page));
    expect(r.trackedCount).toBe(0);

    // 릴리스는 여전히 부를 수 있어야 한다 — 호출부(effect cleanup)는 조건 없이 부른다.
    expect(() => release()).not.toThrow();
    await settle();
    expect(page.cleanup).not.toHaveBeenCalled();
  });

  it("bounds what it tracks so a long scroll cannot grow the registry", async () => {
    const r = new PdfPageRetention(3);
    for (let i = 1; i <= 300; i++) touch(r, fakePage(i));
    await settle();
    expect(r.trackedCount).toBe(3);
  });

  // 상한이 pdfjs 자체 뷰어의 DEFAULT_CACHE_SIZE와 같다는 사실을 고정한다 —
  // 근거 없이 바뀌면 여기서 걸린다(legacy/web/pdf_viewer.mjs).
  it("defaults to the same buffer size pdfjs's own viewer uses", async () => {
    expect(MAX_RELEASED_PDF_PAGES).toBe(10);
    const r = new PdfPageRetention();
    for (let i = 1; i <= MAX_RELEASED_PDF_PAGES; i++) touch(r, fakePage(i));
    await settle();
    expect(r.trackedCount).toBe(MAX_RELEASED_PDF_PAGES);
    touch(r, fakePage(999));
    await settle();
    expect(r.trackedCount).toBe(MAX_RELEASED_PDF_PAGES);
  });
});
