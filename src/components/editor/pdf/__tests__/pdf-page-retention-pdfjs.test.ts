// §282.3 보관 정책이 딛고 선 pdfjs 계약 — **모킹 없이** 진짜 문서로 확인한다.
//
// 왜 이 파일이 따로 있는가: pdf-page-retention.test.ts는 가짜 페이지로 "언제
// cleanup()을 부르는가"(우리 정책)를 고정한다. 그 테스트는 cleanup()이 실제로
// 무엇이든 **비운다는 사실 자체**는 한 번도 확인하지 않는다 — 가짜의 cleanup은
// vi.fn()이다. 정책이 완벽해도 그 전제가 틀리면 기능은 통째로 죽는다.
// cf. [[mocked-integration-hides-total-failure]] — §272 찾기에서 정확히 그
// 모양의 구멍이 실제로 났다(스위트 4,988개 초록, 실앱에서 찾기 완전 사망).
//
// ‼️ `_intentStates`는 underscore 필드다. 그럼에도 여기서 읽는 이유는, 이것이
// "메모리가 실제로 잡혀 있다/풀렸다"를 pdfjs 밖에서 관찰할 수 있는 유일한
// 지점이기 때문이다. 공개 표면(cleanup()의 boolean)은 "성공했다"는 자기 신고일
// 뿐이라 무엇이 비워졌는지 말해 주지 않는다. pdfjs 업그레이드로 이 필드가
// 사라지면 이 테스트가 깨지는 것이 맞다 — 그때 정책의 전제를 다시 확인해야 한다.
import { describe, expect, it } from "vitest";

import { PdfPageRetention } from "../pdf-page-retention";
import { buildTinyPdf } from "./fixtures/tiny-pdf";

/** pdfjs 내부 표현 — 위 주석의 이유로 의도적으로 들여다본다. */
interface PageInternals {
  _intentStates: Map<string, unknown>;
}

async function openPage() {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: buildTinyPdf() }).promise;
  const page = await doc.getPage(1);
  return { doc, internals: page as unknown as PageInternals, page };
}

/** 레지스트리의 축출은 마이크로태스크로 미뤄진다 — 단정 전에 흘려준다. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

describe("the pdfjs contract PdfPageRetention depends on", () => {
  // 누수의 존재 증명. getOperatorList는 render()가 채우는 것과 같은 자리를
  // 채우되 캔버스가 필요 없다(jsdom에는 2D 컨텍스트가 없다).
  it("retains parsed page state after the work is done, with nothing clearing it", async () => {
    const { doc, internals, page } = await openPage();
    expect(internals._intentStates.size).toBe(0);

    await page.getOperatorList();
    // 아무도 cleanup()을 부르지 않으면 이 상태가 탭이 닫힐 때까지 남는다 —
    // 실측으로 텍스트만 있는 페이지가 ~687 KB, 300페이지면 유휴 메모리 목표를
    // 이것 하나로 넘긴다(pdf-page-retention.ts 맨 위).
    expect(internals._intentStates.size).toBeGreaterThan(0);

    await doc.loadingTask.destroy();
  }, 20000);

  it("frees that state when cleanup() is called", async () => {
    const { doc, internals, page } = await openPage();
    await page.getOperatorList();

    expect(page.cleanup()).toBe(true);
    expect(internals._intentStates.size).toBe(0);

    await doc.loadingTask.destroy();
  }, 20000);

  // 래치. 진행 중일 때의 cleanup()은 false를 돌려주지만 **없던 일이 되지 않는다**
  // — 그 작업이 끝나는 순간 pdfjs가 대신 비운다. 세 컴포넌트의 effect cleanup이
  // `cancel()` 다음에 `release()`를 부르는 유일한 이유가 이것이라, 그 주석이
  // 주장하는 동작을 여기서 실제로 관찰해 둔다.
  it("defers a refused cleanup until the in-flight work finishes", async () => {
    const { doc, internals, page } = await openPage();

    const inFlight = page.getOperatorList();
    // 아직 operator list가 다 오지 않았다 — lastChunk가 없어 거절된다.
    expect(page.cleanup()).toBe(false);

    await inFlight;
    // 우리가 다시 부르지 않았는데도 비어 있다: 거절된 cleanup이 래치로 남아
    // 스트림 완료 시점에 발화했다.
    expect(internals._intentStates.size).toBe(0);

    await doc.loadingTask.destroy();
  }, 20000);

  // 정책과 전제를 한 줄에 꿴다 — 레지스트리를 통해 놓았을 때 진짜 페이지의
  // 상태가 실제로 사라지는가.
  it("frees a real page through the registry once the last surface releases it", async () => {
    const { doc, internals, page } = await openPage();
    // 상한 0 = 놓는 즉시 축출. 정책 자체는 가짜 페이지 테스트가 고정한다.
    const retention = new PdfPageRetention(0);

    const fromMainView = retention.retain(page);
    const fromThumbnail = retention.retain(page);
    await page.getOperatorList();
    expect(internals._intentStates.size).toBeGreaterThan(0);

    fromThumbnail();
    await settle();
    // 한 표면이 놓았을 뿐이다 — 본문이 아직 띄우고 있으므로 그대로여야 한다.
    expect(internals._intentStates.size).toBeGreaterThan(0);

    fromMainView();
    await settle();
    expect(internals._intentStates.size).toBe(0);

    await doc.loadingTask.destroy();
  }, 20000);
});
