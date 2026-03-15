// §47 Skill Inline Test — parse Skill file and build test prompts

export interface SkillPrompt {
  system: string;
  user: string;
  variables: string[];
}

/**
 * Extract system/user prompts and required variables from a Skill markdown file.
 * Parses frontmatter for metadata and finds <system>/<user> XML blocks.
 */
export function extractSkillPrompt(markdown: string): SkillPrompt {
  // Extract system prompt
  const systemMatch = markdown.match(/<system>([\s\S]*?)<\/system>/);
  const system = systemMatch ? systemMatch[1].trim() : "";

  // Extract user prompt
  const userMatch = markdown.match(/<user>([\s\S]*?)<\/user>/);
  const user = userMatch ? userMatch[1].trim() : "";

  // Find all template variables used in the prompts
  const combined = system + "\n" + user;
  const varRegex = /\{\{(\w+)\}\}/g;
  const variableSet = new Set<string>();
  let match;
  while ((match = varRegex.exec(combined)) !== null) {
    variableSet.add(match[1]);
  }

  return {
    system,
    user,
    variables: Array.from(variableSet),
  };
}

/**
 * Build a test run by substituting variables in the Skill prompts.
 * Returns the final systemPrompt and userPrompt ready for LLM invocation.
 */
export function runSkillTest(
  markdown: string,
  variables: Record<string, string>,
): { systemPrompt: string; userPrompt: string } {
  const { system, user } = extractSkillPrompt(markdown);

  let systemPrompt = system;
  let userPrompt = user;

  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    systemPrompt = systemPrompt.replace(pattern, value);
    userPrompt = userPrompt.replace(pattern, value);
  }

  return { systemPrompt, userPrompt };
}
