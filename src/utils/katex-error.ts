// §5.3 KaTeX error message parser — user-friendly error messages

const errorPatterns: Array<{
  message: (match: RegExpMatchArray) => string;
  pattern: RegExp;
}> = [
  {
    pattern: /Undefined control sequence:?\s*\\?([\w]+)/i,
    message: (m) => `Unknown command: \\${m[1]}`,
  },
  {
    pattern: /Missing \{/,
    message: () => "Missing opening brace {",
  },
  {
    pattern: /Missing \}/,
    message: () => "Missing closing brace }",
  },
  {
    pattern: /Extra \}/,
    message: () => "Extra closing brace }",
  },
  {
    pattern: /Double (sub|super)script/,
    message: (m) =>
      `Double ${m[1]}script — use braces: ${m[1] === "sub" ? "a_{b_c}" : "a^{b^c}"}`,
  },
  {
    pattern: /Expected 'EOF'/,
    message: () => "Unexpected characters after expression",
  },
  {
    pattern: /Expected group after '([^']+)'/,
    message: (m) => `Expected group after '${m[1]}'`,
  },
  {
    pattern: /No such environment:?\s*(\w+)/i,
    message: (m) => `Unknown environment: ${m[1]}`,
  },
  {
    pattern: /Mismatched \\begin\{(\w+)\}.*\\end\{(\w+)\}/,
    message: (m) =>
      `Mismatched environments: \\begin{${m[1]}} and \\end{${m[2]}}`,
  },
  {
    pattern: /\\[a-z]+ allowed only in math mode/i,
    message: () => "This command is only allowed in math mode",
  },
];

export function parseKaTeXError(error: unknown): string {
  if (!error) return "Unknown error";

  const msg = error instanceof Error ? error.message : String(error);

  for (const { pattern, message } of errorPatterns) {
    const match = msg.match(pattern);
    if (match) return message(match);
  }

  // Fallback: strip "KaTeX parse error:" prefix if present
  return (
    msg.replace(/^KaTeX parse error:\s*/i, "").trim() ||
    "Invalid LaTeX expression"
  );
}
