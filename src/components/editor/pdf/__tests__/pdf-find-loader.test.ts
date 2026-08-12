import { describe, expect, it, vi } from "vitest";

// 별도 파일로 분리한 이유: 아래 두 vi.mock은 파일 전체에 걸린다. 기존
// pdf-find-adapter.test.ts에 합치면 그 파일의 다른 테스트와는 충돌하지
// 않지만(그 테스트들은 pdfjs-dist를 건드리지 않는다), pdf.mjs 목을
// "일부러 지연시켜 완료"하는 비동기 팩토리는 이 로더 전용 관심사라 분리해
// 읽기 쉽게 유지한다.
//
// order는 vi.mock 팩토리 클로저가 참조한다. vi.mock 호출은 파일 최상단으로
// 호이스팅되므로 일반 const 대신 vi.hoisted로 선언해 TDZ를 피한다.
const order = vi.hoisted<string[]>(() => []);

// ‼️ 판별력의 핵심: pdf.mjs 목은 매크로태스크 하나만큼 지연된 뒤에야
// "pdf-done"을 기록한다. pdf_viewer.mjs 목은 평가되는 즉시(동기) "viewer-start"를
// 기록한다. 둘 다 동기 팩토리였다면 import() 호출은 항상 텍스트 순서대로
// 일어나므로 await 유무와 무관하게 기록 순서가 같아져(=늘 통과) 판별력이 없다.
// pdf.mjs를 비동기로 지연시켜야 "await 누락 시 pdf_viewer.mjs가 먼저
// 평가된다"는 진짜 레이스를 재현할 수 있다.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  order.push("pdf-done"); // globalThis.pdfjsLib 설정이 끝났다는 표시
  return {};
});

vi.mock("pdfjs-dist/legacy/web/pdf_viewer.mjs", () => {
  order.push("viewer-start"); // globalThis.pdfjsLib을 구조분해하는 시점
  return {};
});

import { loadPdfViewerModule } from "../pdf-find";

describe("loadPdfViewerModule", () => {
  it("awaits pdf.mjs (which sets globalThis.pdfjsLib) before evaluating pdf_viewer.mjs", async () => {
    await loadPdfViewerModule();

    // pdf.mjs가 완전히 끝난 뒤에야 pdf_viewer.mjs 평가가 시작돼야 한다.
    // await가 빠지면 순서가 ["viewer-start", "pdf-done"]으로 뒤집힌다.
    expect(order).toEqual(["pdf-done", "viewer-start"]);
  });
});
