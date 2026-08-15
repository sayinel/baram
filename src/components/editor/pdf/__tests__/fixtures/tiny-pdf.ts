// §272.5 진짜 pdfjs를 돌리기 위한 최소 PDF — 바이트를 여기서 만든다.
//
// 저장소에 바이너리를 커밋하지 않는 이유: 이 문서는 픽스처이면서 동시에
// **문서**다. 어떤 텍스트가 어디에 있는지 코드로 읽히지 않으면, 매치 오프셋을
// 단정하는 테스트가 무엇을 근거로 그 숫자를 쓰는지 알 수 없다.
//
// 왜 이 픽스처가 필요한가: §272의 모든 테스트가 PDFFindController를 가짜로
// 바꾸고 문서도 `{ numPages: 1 }` 껍데기를 썼다. 그래서 진짜 컨트롤러와 우리
// 배선의 통합이 한 번도 실행되지 않았고, 찾기가 실앱에서 완전히 죽은 채로
// (WKWebView의 ReadableStream이 async-iterable이 아니라 getTextContent가
// 던졌다) 스위트 전체가 초록이었다.

/** 이 PDF 1페이지에 실제로 그려지는 두 줄. 매치 오프셋의 근거다. */
export const TINY_PDF_LINES = [
  "Baram find probe alpha",
  "second line beta alpha",
] as const;

/**
 * 텍스트 두 줄을 담은 1페이지 PDF의 바이트. 압축도 폰트 임베딩도 없는
 * 순수 PDF 1.4 — pdfjs가 Helvetica를 표준 14 폰트로 처리하므로 외부 자원이
 * 필요 없다.
 */
export function buildTinyPdf(): Uint8Array {
  const content =
    `BT /F1 18 Tf 20 150 Td (${TINY_PDF_LINES[0]}) Tj ` +
    `0 -30 Td (${TINY_PDF_LINES[1]}) Tj ET`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n` +
    `startxref\n${String(xref)}\n%%EOF\n`;

  // 내용이 전부 ASCII라 코드 유닛 하나가 바이트 하나다.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i);
  return bytes;
}
