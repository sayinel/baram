import {
  appendCapture,
  captureBlockIdStamp,
  captureHeadingText,
  countCaptures,
  formatSourceLine,
  nextCaptureBlockId,
} from "../capture-append";

describe("formatSourceLine", () => {
  it("returns null for empty or whitespace-only input", () => {
    expect(formatSourceLine("")).toBeNull();
    expect(formatSourceLine("   ")).toBeNull();
  });

  it("leaves plain text alone", () => {
    expect(formatSourceLine("코너 맥그리거")).toBe("Source: 코너 맥그리거");
  });

  // §324-f 실제 데이터는 대부분 "제목 URL" 한 칸이다. 마지막 토큰이 URL이면 앞의
  // 나머지가 제목이다.
  it("turns a trailing URL into a link titled by the text before it", () => {
    expect(
      formatSourceLine("정소영, Daily Prompt https://blog.example.com/p/1"),
    ).toBe("Source: [정소영, Daily Prompt](https://blog.example.com/p/1)");
  });

  it("uses the URL as its own link text when there is no title", () => {
    expect(formatSourceLine("https://example.com/a")).toBe(
      "Source: [https://example.com/a](https://example.com/a)",
    );
  });

  // ‼️ http/https만 링크로 만든다. 닫힌 집합이다 — `javascript:`·`file:`은 평문으로
  // 남아야 한다. 이 문자열은 사용자의 노트에 마크다운 링크로 들어가고, 그 노트는
  // 나중에 앱이 렌더링한다.
  it("does not linkify a non-http scheme", () => {
    expect(formatSourceLine("javascript:alert(1)")).toBe(
      "Source: javascript:alert(1)",
    );
    expect(formatSourceLine("보기 file:///etc/passwd")).toBe(
      "Source: 보기 file:///etc/passwd",
    );
  });

  // ‼️ 제목의 `[`·`]`를 escape하지 않으면 링크가 그 자리에서 끊긴다.
  it("escapes brackets in the title", () => {
    expect(formatSourceLine("[특집] 기사 https://example.com/a")).toBe(
      "Source: [\\[특집\\] 기사](https://example.com/a)",
    );
  });

  // ‼️ 괄호를 품은 URL은 angle-bracket 목적지로 감싼다 — 안 하면 `)`가 링크를 조기
  // 종료하고 나머지가 본문 텍스트로 새어 나온다. 위키백과 URL에 흔하다.
  it("wraps a destination containing parentheses in angle brackets", () => {
    expect(
      formatSourceLine("문서 https://en.wikipedia.org/wiki/Foo_(bar)"),
    ).toBe("Source: [문서](<https://en.wikipedia.org/wiki/Foo_(bar)>)");
  });
});

describe("captureBlockIdStamp / captureHeadingText", () => {
  it("formats the stamp as m + YYMMDDHHmm and the heading as YYYY-MM-DD HH:MM", () => {
    const d = new Date(2026, 8, 2, 14, 15); // 2026-09-02 14:15 (local)
    expect(captureBlockIdStamp(d)).toBe("m2609021415");
    expect(captureHeadingText(d)).toBe("2026-09-02 14:15");
  });

  it("zero-pads single-digit month, day, hour and minute", () => {
    const d = new Date(2026, 0, 5, 9, 7);
    expect(captureBlockIdStamp(d)).toBe("m2601050907");
    expect(captureHeadingText(d)).toBe("2026-01-05 09:07");
  });
});

describe("nextCaptureBlockId", () => {
  it("returns the stamp itself when the document does not hold it", () => {
    expect(
      nextCaptureBlockId(`## Captures\n\n### x ^m2609021000\n`, "m2609021415"),
    ).toBe("m2609021415");
  });

  // ‼️ 이 테스트가 이 함수의 존재 이유다. `generateZettelId`로는 초록이 되지 않는다 —
  // 그 함수가 보는 `existingIds`는 **파일명**에서 모으고(`collectExistingIds`),
  // append 경로는 파일을 만들지 않으므로 방금 붙인 캡처의 id가 거기 영원히 들어가지
  // 않는다. 같은 분에 두 번 캡처하면 같은 id가 나오고, 그러면 `((영감노트#^…))`가
  // 어느 항목을 가리키는지 정해지지 않는다.
  it("appends seconds when the stamp is already in the document", () => {
    const doc = `## Captures\n\n### 2026-09-02 14:15 ^m2609021415\n\nbody\n`;
    const next = nextCaptureBlockId(doc, "m2609021415");
    expect(next).not.toBe("m2609021415");
    expect(next).toMatch(/^m2609021415\d{2}$/);
  });

  it("keeps widening while each candidate collides", () => {
    const doc = `## Captures\n\n### a ^m2609021415\n\n### b ^m260902141500\n\n### c ^m260902141501\n`;
    expect(nextCaptureBlockId(doc, "m2609021415")).toBe("m260902141502");
  });

  // ‼️ 판정은 **대상 문서 단위**다. 다른 문서의 같은 id는 무해하다 — 참조가
  // `((대상#^id))`로 문서를 함께 지목하기 때문이다. 이 테스트는 스캔이 문서 전체를
  // 보되 문서 **밖**을 보지 않음을 고정한다.
  it("only considers ids present in the given content", () => {
    expect(nextCaptureBlockId("", "m2609021415")).toBe("m2609021415");
  });
});

describe("countCaptures", () => {
  it("counts the capture-stamped headings inside the Captures section", () => {
    const doc = [
      `# 영감노트`,
      ``,
      `서문 ^m9901010000`, // 절 밖 — 세지 않는다
      ``,
      `## Captures`,
      ``,
      `### 2026-09-02 14:15 ^m2609021415`,
      ``,
      `첫째`,
      ``,
      `### 2026-09-02 10:30 ^m2609021030`,
      ``,
      `둘째`,
      ``,
      `### 손으로 넣은 헤딩`, // 캡처 표시가 없다 — 세지 않는다
      ``,
    ].join("\n");
    expect(countCaptures(doc)).toBe(2);
  });

  it("returns 0 when there is no Captures section", () => {
    expect(countCaptures(`# x\n\n### 2026-09-02 10:00 ^m2609021000\n`)).toBe(0);
  });
});

describe("appendCapture", () => {
  const preamble = [
    `---`,
    `id: 202609021015`,
    `title: 영감노트`,
    `aliases: []`,
    `---`,
    ``,
    `# 영감노트`,
    ``,
    `#Note #영감노트`,
    ``,
    `떠오르는 생각과 격언을 모으는 자리.`,
    ``,
  ].join("\n");

  // §321: 절이 없으면 문서 **끝**에 만든다 — 기존 내용을 건드리지 않는 유일한 안전한 자리
  it("creates the section at the end of the document, preserving the preamble", () => {
    const out = appendCapture(
      preamble,
      { body: "첫 메모", heading: "2026-09-02 14:15" },
      "m2609021415",
    );
    expect(out.startsWith(preamble.trimEnd())).toBe(true);
    expect(out).toContain(`## Captures`);
    expect(out).toContain(`### 2026-09-02 14:15 ^m2609021415`);
    expect(out).toContain(`첫 메모`);
    expect(out).toContain(`떠오르는 생각과 격언을 모으는 자리.`);
  });

  // §321: 최신이 항상 맨 위 — 최신 항목을 찾으려 스크롤하지 않는다
  it("inserts the new entry directly under the section heading", () => {
    const existing = `${preamble}## Captures\n\n### 2026-09-02 10:30 ^m2609021030\n\n먼저 적은 것\n`;
    const out = appendCapture(
      existing,
      { body: "나중에 적은 것", heading: "2026-09-02 14:15" },
      "m2609021415",
    );
    expect(out.indexOf("나중에 적은 것")).toBeLessThan(
      out.indexOf("먼저 적은 것"),
    );
    expect(out.indexOf("## Captures")).toBeLessThan(
      out.indexOf("나중에 적은 것"),
    );
    // 기존 항목이 그대로 남는 것
    expect(out).toContain(`### 2026-09-02 10:30 ^m2609021030`);
  });

  // ‼️ §326: 같은 날 두 번째 캡처는 기존 헤딩에 **합쳐지지 않고** 자기 헤딩을 갖는다.
  it("gives a same-day second capture its own heading, above the first", () => {
    const first = appendCapture(
      preamble,
      { body: "오전", heading: "2026-09-02 10:30" },
      "m2609021030",
    );
    const second = appendCapture(
      first,
      { body: "오후", heading: "2026-09-02 14:15" },
      "m2609021415",
    );
    expect(second.match(/^### 2026-09-02/gm)).toHaveLength(2);
    expect(second.indexOf("오후")).toBeLessThan(second.indexOf("오전"));
  });

  // ‼️ §326: 경계가 헤딩이라는 것을 고정하는 핀. 앞 항목은 반드시 2문단 이상이어야
  // 한다 — 한 문단이면 "빈 줄이 경계"인 구현도 통과한다.
  it("does not let a multi-paragraph entry bleed into the next one", () => {
    const existing = [
      preamble,
      `## Captures`,
      ``,
      `### 2026-09-02 10:30 ^m2609021030`,
      ``,
      `첫째 문단.`,
      ``,
      `둘째 문단.`,
      ``,
      `셋째 문단.`,
      ``,
    ].join("\n");
    const out = appendCapture(
      existing,
      { body: "새 항목", heading: "2026-09-02 14:15" },
      "m2609021415",
    );
    const oldEntry = out.slice(out.indexOf("### 2026-09-02 10:30"));
    expect(oldEntry).toContain("첫째 문단.");
    expect(oldEntry).toContain("둘째 문단.");
    expect(oldEntry).toContain("셋째 문단.");
    // 새 항목의 헤딩과 본문 사이에 낡은 문단이 끼어들지 않는 것
    const newEntry = out.slice(
      out.indexOf("### 2026-09-02 14:15"),
      out.indexOf("### 2026-09-02 10:30"),
    );
    expect(newEntry).toContain("새 항목");
    expect(newEntry).not.toContain("문단.");
  });

  it("writes the Source line under the body when a source is given", () => {
    const out = appendCapture(
      preamble,
      {
        body: "정확도가 파워를 이긴다.",
        heading: "2026-09-02 14:15",
        source: "코너 맥그리거 https://example.com/m",
      },
      "m2609021415",
    );
    expect(out).toContain(`Source: [코너 맥그리거](https://example.com/m)`);
    expect(out.indexOf("정확도가")).toBeLessThan(out.indexOf("Source:"));
  });

  it("omits the Source line for an empty source", () => {
    const out = appendCapture(
      preamble,
      { body: "본문", heading: "2026-09-02 14:15", source: "   " },
      "m2609021415",
    );
    expect(out).not.toContain("Source:");
  });

  // ‼️ 본문 뒤에 아무것도 없으면(Source도 없고, 첫 항목이면) 여분의 개행이 문서
  // **끝**에만 남아 `\n{3,}`를 못 만든다 — Source 줄을 붙여서 본문과 그 사이에서
  // 여분이 드러나게 한다.
  it("keeps a body that already ends with a newline from doubling blank lines", () => {
    const out = appendCapture(
      preamble,
      {
        body: "본문\n",
        heading: "2026-09-02 14:15",
        source: "https://example.com/x",
      },
      "m2609021415",
    );
    expect(out).not.toMatch(/\n{3,}/);
  });

  // ‼️ 절 헤딩 패턴이 `##`보다 넓으면(`#{2,}` 등) 우연히 "Captures"라는 텍스트를 가진
  // `###` 항목 헤딩을 절 경계로 오인한다. 이 문서엔 진짜 `## Captures` 절이 없으므로
  // 문서 끝에 새로 만들어야 한다 — 이름이 같은 `###` 헤딩 아래에 끼워 넣으면 안 된다.
  it("does not mistake a `###` heading literally named Captures for the section", () => {
    const doc = [
      preamble,
      `### Captures`,
      ``,
      `사용자가 손으로 쓴, 우리 기능과 무관한 헤딩.`,
      ``,
    ].join("\n");
    const out = appendCapture(
      doc,
      { body: "새 캡처", heading: "2026-09-02 14:15" },
      "m2609021415",
    );
    expect(out.indexOf("사용자가 손으로 쓴")).toBeLessThan(
      out.indexOf("새 캡처"),
    );
    expect(out).toMatch(/^## Captures$/m);
  });
});
