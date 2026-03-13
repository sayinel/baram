// §41 Prompt Highlight — regex unit tests
import { describe, expect, test } from "vitest";

describe("§41 Prompt Highlight", () => {
  test("XML tag regex matches correctly", () => {
    const regex = /<\/?[a-zA-Z][\w-]*(?:\s+[^>]*)?\s*\/?>/g;
    const text = "Hello <system> world </system> and <br/>";
    const matches: string[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push(m[0]);
    }
    expect(matches).toEqual(["<system>", "</system>", "<br/>"]);
  });

  test("Mustache variable regex matches correctly", () => {
    const regex = /\{\{[\w.]+\}\}/g;
    const text = "Use {{selection}} and {{document.title}} here";
    const matches: string[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push(m[0]);
    }
    expect(matches).toEqual(["{{selection}}", "{{document.title}}"]);
  });

  test("File path regex matches correctly", () => {
    const regex = /(?:\.\/|\/)[a-zA-Z0-9_\-./]+\.[a-zA-Z]+/g;
    const text = "See ./src/utils/helper.ts and /etc/config.json";
    const matches: string[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push(m[0]);
    }
    expect(matches).toEqual(["./src/utils/helper.ts", "/etc/config.json"]);
  });

  test("Skills file detection checks frontmatter type", () => {
    // Simple regex test for type: skill detection
    const yaml1 = "name: my-skill\ntype: skill\ndescription: test";
    const yaml2 = "name: my-doc\ntype: document";
    expect(/type\s*:\s*skill/i.test(yaml1)).toBe(true);
    expect(/type\s*:\s*skill/i.test(yaml2)).toBe(false);
  });
});
