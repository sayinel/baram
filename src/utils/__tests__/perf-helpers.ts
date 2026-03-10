// §8.4 Performance benchmark helpers — generate realistic markdown content

const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "code",
  "blockquote",
  "table",
] as const;

/** Generate a realistic markdown document with approximately `lines` lines */
export function generateMarkdown(lines: number): string {
  const blocks: string[] = [];
  let currentLines = 0;
  let blockIndex = 0;

  while (currentLines < lines) {
    const blockType = BLOCK_TYPES[blockIndex % BLOCK_TYPES.length];
    blockIndex++;

    const block = generateBlock(blockType, blockIndex);
    const blockLines = block.split("\n").length;
    blocks.push(block);
    currentLines += blockLines;
  }

  return blocks.join("\n\n") + "\n";
}

/** Generate a markdown document with N math blocks interspersed with text */
export function generateMathHeavyMarkdown(blockCount: number): string {
  const blocks: string[] = [];

  for (let i = 0; i < blockCount; i++) {
    blocks.push(`Paragraph before equation ${i + 1}.`);
    blocks.push(generateMathBlock(i));
  }

  blocks.push("Final paragraph after all equations.");
  return blocks.join("\n\n") + "\n";
}

function generateBlock(
  type: (typeof BLOCK_TYPES)[number],
  seed: number,
): string {
  switch (type) {
    case "blockquote":
      return `> This is a blockquote number ${seed}. It contains some meaningful text that simulates real content in a document.`;
    case "code":
      return [
        "```typescript",
        `function example${seed}() {`,
        `  const x = ${seed};`,
        `  return x * 2;`,
        "}",
        "```",
      ].join("\n");
    case "heading": {
      const level = (seed % 3) + 1;
      const prefix = "#".repeat(level);
      return `${prefix} Section ${seed}`;
    }
    case "list":
      return [
        `- Item ${seed}a with some text`,
        `- Item ${seed}b with **bold**`,
        `- Item ${seed}c with *italic*`,
        `- Item ${seed}d with \`code\``,
      ].join("\n");
    case "paragraph":
      return `This is paragraph ${seed} with **bold**, *italic*, and \`inline code\`. It contains a [link](https://example.com) and some regular text to simulate real-world content that a user might type into a markdown editor.`;
    case "table":
      return [
        `| Column A | Column B | Column C |`,
        `| --- | --- | --- |`,
        `| Row ${seed}-1 | Value | Data |`,
        `| Row ${seed}-2 | Value | Data |`,
      ].join("\n");
  }
}

const MATH_FORMULAS = [
  "E = mc^2",
  "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
  "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}",
  "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}",
  "\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}",
  "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
  "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1",
  "f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}",
];

function generateMathBlock(index: number): string {
  const formula = MATH_FORMULAS[index % MATH_FORMULAS.length];
  return `$$\n${formula}\n$$`;
}
