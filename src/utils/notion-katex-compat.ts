// §5.3 Notion KaTeX compatibility — map Notion-specific abbreviations to standard KaTeX

// Notion allows bare Greek letter names without backslash.
// This mapping converts unescaped names to proper \commands.
const greekLetters = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi",
  "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
  // Uppercase variants
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi",
  "Sigma", "Upsilon", "Phi", "Psi", "Omega",
  // Variant forms
  "varepsilon", "vartheta", "varpi", "varrho", "varsigma", "varphi",
];

// Additional Notion-specific shortcuts
const notionShortcuts: Record<string, string> = {
  "inf": "\\infty",
  "infinity": "\\infty",
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
  "xx": "\\times",
  "divide": "\\div",
  "deg": "\\degree",
  "empty": "\\emptyset",
  "oo": "\\infty",
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

export function preprocessNotionFormula(formula: string): string {
  let result = formula;

  // Replace bare Greek letters with \-prefixed versions
  result = result.replace(greekPattern, "\\$1");

  // Replace Notion-specific shortcuts
  if (shortcutPattern) {
    result = result.replace(shortcutPattern, (match) => {
      return notionShortcuts[match] || match;
    });
  }

  return result;
}
