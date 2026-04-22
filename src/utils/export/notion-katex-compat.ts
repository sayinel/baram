// §5.3 Notion KaTeX compatibility — map Notion-specific abbreviations to standard KaTeX

// Notion allows bare Greek letter names without backslash.
// This mapping converts unescaped names to proper \commands.
const greekLetters = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "omicron",
  "pi",
  "rho",
  "sigma",
  "tau",
  "upsilon",
  "phi",
  "chi",
  "psi",
  "omega",
  // Uppercase variants
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Upsilon",
  "Phi",
  "Psi",
  "Omega",
  // Variant forms
  "varepsilon",
  "vartheta",
  "varpi",
  "varrho",
  "varsigma",
  "varphi",
];

// Additional Notion-specific shortcuts
const notionShortcuts: Record<string, string> = {
  inf: "\\infty",
  infinity: "\\infty",
  "+-": "\\pm",
  "-+": "\\mp",
  "!=": "\\neq",
  "<=": "\\leq",
  ">=": "\\geq",
  "<<": "\\ll",
  ">>": "\\gg",
  "...": "\\ldots",
  "->": "\\to",
  "<-": "\\leftarrow",
  "<->": "\\leftrightarrow",
  "=>": "\\Rightarrow",
  "<=>": "\\Leftrightarrow",
  "~=": "\\approx",
  "~~": "\\approx",
  "||": "\\|",
  xx: "\\times",
  divide: "\\div",
  deg: "\\degree",
  empty: "\\emptyset",
  oo: "\\infty",
};

// Build regex for bare Greek letters: match word boundaries around unescaped names
const greekPattern = new RegExp(
  `(?<!\\\\)\\b(${greekLetters.join("|")})\\b`,
  "g",
);

// Build regex for shortcuts — sorted by length descending to match longest first
const shortcutKeys = Object.keys(notionShortcuts).sort(
  (a, b) => b.length - a.length,
);
const escapedKeys = shortcutKeys.map((k) =>
  k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);
const shortcutPattern =
  escapedKeys.length > 0
    ? new RegExp(`(?<!\\\\)(${escapedKeys.join("|")})`, "g")
    : null;

// Commands whose brace argument holds content that must not be substituted
// (KaTeX text mode, multi-letter identifier wrappers, operator names).
const protectedCommands = [
  "text",
  "textrm",
  "textbf",
  "textit",
  "textsf",
  "texttt",
  "textmd",
  "textup",
  "textnormal",
  "mathrm",
  "mathbf",
  "mathit",
  "mathsf",
  "mathtt",
  "operatorname",
  "mbox",
];
const protectedCommandPattern = new RegExp(
  `\\\\(?:${protectedCommands.join("|")})\\s*\\{`,
  "g",
);

// Sentinel wraps an index into the regions array. Uses Unicode Private Use
// Area codepoints so placeholders can't be confused with any substitution
// pattern (greek names or ASCII shortcuts) and survive the replace passes.
const PLACEHOLDER_OPEN = "";
const PLACEHOLDER_CLOSE = "";
const PLACEHOLDER_RE = new RegExp(
  `${PLACEHOLDER_OPEN}(\\d+)${PLACEHOLDER_CLOSE}`,
  "g",
);

export function preprocessNotionFormula(formula: string): string {
  const { masked, regions } = extractProtectedRegions(formula);

  let result = masked;
  result = result.replace(greekPattern, "\\$1");
  if (shortcutPattern) {
    result = result.replace(shortcutPattern, (m) => notionShortcuts[m] || m);
  }

  return result.replace(PLACEHOLDER_RE, (_, idx) => regions[Number(idx)]);
}

function extractProtectedRegions(formula: string): {
  masked: string;
  regions: string[];
} {
  const regions: string[] = [];
  let masked = "";
  let cursor = 0;

  const makePlaceholder = (region: string): string => {
    regions.push(region);
    return `${PLACEHOLDER_OPEN}${regions.length - 1}${PLACEHOLDER_CLOSE}`;
  };

  while (cursor < formula.length) {
    protectedCommandPattern.lastIndex = cursor;
    const match = protectedCommandPattern.exec(formula);
    if (!match) {
      masked += formula.slice(cursor);
      break;
    }

    masked += formula.slice(cursor, match.index);

    const contentStart = match.index + match[0].length; // just past `{`
    let depth = 1;
    let j = contentStart;
    while (j < formula.length && depth > 0) {
      const ch = formula[j];
      if (ch === "\\") {
        j += 2; // skip escaped char (e.g. `\{`, `\}`, `\\`)
        continue;
      }
      if (ch === "{") {
        depth++;
        j++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) break;
        j++;
      } else {
        j++;
      }
    }

    if (depth !== 0) {
      // Unbalanced — likely mid-typing. Protect from the command opening
      // through end-of-string so live edits aren't mangled; KaTeX will
      // still surface the missing-brace error on its own.
      masked += makePlaceholder(formula.slice(match.index));
      cursor = formula.length;
      break;
    }

    const endPos = j + 1; // include closing `}`
    masked += makePlaceholder(formula.slice(match.index, endPos));
    cursor = endPos;
  }

  return { masked, regions };
}
