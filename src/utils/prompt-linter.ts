// §46 Prompt Optimization — static analysis rules for Skill prompts

export interface LintResult {
  rule: string;
  message: string;
  from: number;
  to: number;
  severity: "warning" | "error";
}

// Ambiguous words that indicate vague instructions
const AMBIGUOUS_WORDS = [
  "good",
  "better",
  "appropriate",
  "nice",
  "proper",
  "reasonable",
  "suitable",
  "adequate",
];

// Conflicting instruction pairs
const CONFLICTING_PAIRS: [RegExp, RegExp, string][] = [
  [/be concise/i, /provide detailed/i, '"be concise" conflicts with "provide detailed"'],
  [/be brief/i, /be thorough/i, '"be brief" conflicts with "be thorough"'],
  [/keep it short/i, /elaborate/i, '"keep it short" conflicts with "elaborate"'],
  [/respond in one sentence/i, /explain in detail/i, '"respond in one sentence" conflicts with "explain in detail"'],
];

/**
 * Parse YAML frontmatter from markdown text.
 * Returns the frontmatter string and the offset where body starts.
 */
function parseFrontmatter(text: string): {
  frontmatter: string;
  frontmatterEnd: number;
  bodyStart: number;
} {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return { frontmatter: "", frontmatterEnd: 0, bodyStart: 0 };
  }
  return {
    frontmatter: fmMatch[1],
    frontmatterEnd: fmMatch[0].length,
    bodyStart: fmMatch[0].length,
  };
}

/**
 * Rule: ambiguousInstruction
 * Detects vague words that weaken prompt quality.
 */
function checkAmbiguousInstruction(text: string): LintResult[] {
  const results: LintResult[] = [];
  const { bodyStart } = parseFrontmatter(text);
  const body = text.slice(bodyStart);

  for (const word of AMBIGUOUS_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    let match;
    while ((match = regex.exec(body)) !== null) {
      results.push({
        rule: "ambiguousInstruction",
        message: `Vague word "${match[0]}" — consider being more specific`,
        from: bodyStart + match.index,
        to: bodyStart + match.index + match[0].length,
        severity: "warning",
      });
    }
  }
  return results;
}

/**
 * Rule: missingOutputFormat
 * No output_format in frontmatter and no explicit format instruction in body.
 */
function checkMissingOutputFormat(text: string): LintResult[] {
  const { frontmatter, bodyStart } = parseFrontmatter(text);
  if (!frontmatter) return [];

  const hasOutputFormatKey = /output_format\s*:/i.test(frontmatter);
  if (hasOutputFormatKey) return [];

  const body = text.slice(bodyStart);
  const formatIndicators = /output format|respond in|format.*as|return.*as|output.*json|output.*markdown/i;
  if (formatIndicators.test(body)) return [];

  // Point to the end of frontmatter
  return [
    {
      rule: "missingOutputFormat",
      message: "No output_format specified — consider adding one to frontmatter or body",
      from: 0,
      to: Math.min(bodyStart, 3), // Highlight the opening ---
      severity: "warning",
    },
  ];
}

/**
 * Rule: missingRequiredField
 * Skill frontmatter missing name or description.
 */
function checkMissingRequiredField(text: string): LintResult[] {
  const { frontmatter, frontmatterEnd } = parseFrontmatter(text);
  if (!frontmatter) return [];

  const results: LintResult[] = [];
  if (!/^name\s*:/m.test(frontmatter)) {
    results.push({
      rule: "missingRequiredField",
      message: 'Frontmatter is missing required field "name"',
      from: 0,
      to: Math.min(frontmatterEnd, 3),
      severity: "error",
    });
  }
  if (!/^description\s*:/m.test(frontmatter)) {
    results.push({
      rule: "missingRequiredField",
      message: 'Frontmatter is missing required field "description"',
      from: 0,
      to: Math.min(frontmatterEnd, 3),
      severity: "error",
    });
  }
  return results;
}

/**
 * Rule: excessiveLength
 * Prompt body exceeds 4000 characters.
 */
function checkExcessiveLength(text: string): LintResult[] {
  const { bodyStart } = parseFrontmatter(text);
  const body = text.slice(bodyStart);
  if (body.length > 4000) {
    return [
      {
        rule: "excessiveLength",
        message: `Prompt body is ${body.length} characters — consider shortening (max recommended: 4000)`,
        from: bodyStart + 3990,
        to: bodyStart + Math.min(body.length, 4010),
        severity: "warning",
      },
    ];
  }
  return [];
}

/**
 * Rule: unusedVariable
 * Variable declared in frontmatter but not used in body.
 */
function checkUnusedVariable(text: string): LintResult[] {
  const { frontmatter, bodyStart } = parseFrontmatter(text);
  if (!frontmatter) return [];

  const body = text.slice(bodyStart);
  const results: LintResult[] = [];

  // Look for variables: [...] in frontmatter
  const varsMatch = frontmatter.match(/variables\s*:\s*\[([^\]]*)\]/);
  if (!varsMatch) return [];

  const declaredVars = varsMatch[1]
    .split(",")
    .map((v) => v.trim().replace(/['"]/g, ""))
    .filter(Boolean);

  for (const v of declaredVars) {
    const pattern = `{{${v}}}`;
    if (!body.includes(pattern)) {
      // Find the variable in frontmatter for position
      const varIdx = text.indexOf(v);
      results.push({
        rule: "unusedVariable",
        message: `Variable "${v}" is declared but never used in the prompt body`,
        from: varIdx >= 0 ? varIdx : 0,
        to: varIdx >= 0 ? varIdx + v.length : 3,
        severity: "warning",
      });
    }
  }
  return results;
}

/**
 * Rule: conflictingInstructions
 * Detects contradictory phrases in the prompt body.
 */
function checkConflictingInstructions(text: string): LintResult[] {
  const { bodyStart } = parseFrontmatter(text);
  const body = text.slice(bodyStart);
  const results: LintResult[] = [];

  for (const [pattern1, pattern2, message] of CONFLICTING_PAIRS) {
    const match1 = pattern1.exec(body);
    const match2 = pattern2.exec(body);
    if (match1 && match2) {
      // Highlight the second conflicting phrase
      results.push({
        rule: "conflictingInstructions",
        message: `Conflicting instructions: ${message}`,
        from: bodyStart + match2.index,
        to: bodyStart + match2.index + match2[0].length,
        severity: "warning",
      });
    }
  }
  return results;
}

/**
 * Rule: emptyRequires
 * requires array contains empty or whitespace-only entries.
 */
function checkEmptyRequires(text: string): LintResult[] {
  const { frontmatter } = parseFrontmatter(text);
  if (!frontmatter) return [];

  const requiresMatch = frontmatter.match(/^requires\s*:\s*\[([^\]]*)\]/m);
  if (!requiresMatch) return [];

  const items = requiresMatch[1].split(",").map((s) => s.trim());
  const hasEmpty = items.some((item) => item === "" || item === '""' || item === "''");

  if (hasEmpty) {
    const reqIdx = text.indexOf(requiresMatch[0]);
    return [{
      rule: "emptyRequires",
      message: "requires array contains empty entries",
      from: reqIdx >= 0 ? reqIdx : 0,
      to: reqIdx >= 0 ? reqIdx + requiresMatch[0].length : 3,
      severity: "warning",
    }];
  }
  return [];
}

/**
 * Rule: duplicateRequires
 * requires array contains duplicate entries.
 */
function checkDuplicateRequires(text: string): LintResult[] {
  const { frontmatter } = parseFrontmatter(text);
  if (!frontmatter) return [];

  const requiresMatch = frontmatter.match(/^requires\s*:\s*\[([^\]]*)\]/m);
  if (!requiresMatch) return [];

  const items = requiresMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const item of items) {
    if (seen.has(item)) {
      duplicates.push(item);
    }
    seen.add(item);
  }

  if (duplicates.length > 0) {
    const reqIdx = text.indexOf(requiresMatch[0]);
    return [{
      rule: "duplicateRequires",
      message: `Duplicate requires: ${duplicates.join(", ")}`,
      from: reqIdx >= 0 ? reqIdx : 0,
      to: reqIdx >= 0 ? reqIdx + requiresMatch[0].length : 3,
      severity: "warning",
    }];
  }
  return [];
}

/**
 * Run all 8 lint rules on a Skill prompt.
 */
export function lintPrompt(text: string): LintResult[] {
  return [
    ...checkAmbiguousInstruction(text),
    ...checkMissingOutputFormat(text),
    ...checkMissingRequiredField(text),
    ...checkExcessiveLength(text),
    ...checkUnusedVariable(text),
    ...checkConflictingInstructions(text),
    ...checkEmptyRequires(text),
    ...checkDuplicateRequires(text),
  ];
}

// Export individual rules for testing
export const rules = {
  checkAmbiguousInstruction,
  checkMissingOutputFormat,
  checkMissingRequiredField,
  checkExcessiveLength,
  checkUnusedVariable,
  checkConflictingInstructions,
  checkEmptyRequires,
  checkDuplicateRequires,
};
