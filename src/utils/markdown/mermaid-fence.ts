// Shared fenced-block scanner: isolates TOP-LEVEL ```mermaid blocks so a mermaid
// fence nested inside another fenced code block (e.g. a ```` wrapper or a doc
// quoting a ```mermaid example) is left untouched. Fence matching follows
// CommonMark: a block opened by N backticks/tildes closes on a line of the same
// character with >= N of them and no info string.

export type MarkdownSegment = MermaidBlockSegment | TextSegment;

export interface MermaidBlockSegment {
  body: string[];
  close: null | string;
  kind: "mermaid";
  open: string;
}

export interface TextSegment {
  kind: "text";
  lines: string[];
}

const FENCE_RE = /^(`{3,}|~{3,})(.*)$/;

export function segmentMarkdownByMermaid(markdown: string): MarkdownSegment[] {
  const lines = markdown.split("\n");
  const segments: MarkdownSegment[] = [];
  let text: string[] = [];
  const flushText = () => {
    if (text.length) {
      segments.push({ kind: "text", lines: text });
      text = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(FENCE_RE);
    if (!m) {
      text.push(lines[i]);
      i++;
      continue;
    }
    const fenceChar = m[1][0];
    const fenceLen = m[1].length;
    const info = m[2].trim();
    const isClose = (line: string): boolean => {
      const cm = line.match(FENCE_RE);
      return (
        cm !== null &&
        cm[1][0] === fenceChar &&
        cm[1].length >= fenceLen &&
        cm[2].trim() === ""
      );
    };

    if (info === "mermaid") {
      flushText();
      const open = lines[i];
      const body: string[] = [];
      let j = i + 1;
      let close: null | string = null;
      while (j < lines.length) {
        if (isClose(lines[j])) {
          close = lines[j];
          break;
        }
        body.push(lines[j]);
        j++;
      }
      segments.push({ body, close, kind: "mermaid", open });
      i = close !== null ? j + 1 : j;
    } else {
      text.push(lines[i]);
      let j = i + 1;
      while (j < lines.length) {
        text.push(lines[j]);
        if (isClose(lines[j])) {
          j++;
          break;
        }
        j++;
      }
      i = j;
    }
  }
  flushText();
  return segments;
}
