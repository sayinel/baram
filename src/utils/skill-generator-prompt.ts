// §45 Skills Auto-generation — system prompt builder for LLM-based Skill generation

export interface SkillGenOptions {
  description: string;
  outputFormat: "json" | "markdown" | "text";
  variables: string[];
}

/**
 * Build a system prompt + user prompt for generating a complete Skill file
 * from a natural language description.
 */
export function buildSkillGenPrompts(options: SkillGenOptions): {
  systemPrompt: string;
  userPrompt: string;
} {
  const variablesList =
    options.variables.length > 0
      ? options.variables.map((v) => `{{${v}}}`).join(", ")
      : "(none)";

  const systemPrompt = `You are a Skill file generator for Baram, a markdown editor.
A Skill file is a markdown document with YAML frontmatter and XML-tagged prompt blocks.

Structure:
1. YAML frontmatter with: name, description, and optionally output_format
2. <system> block with the system prompt
3. <user> block with the user prompt, using template variables

Available template variables: {{selection}}, {{document}}, {{input}}, {{clipboard}}

Rules:
- The system prompt should be clear and specific
- Use the requested template variables in the user prompt
- Output ONLY the Skill file content (frontmatter + body), no explanation
- Use the specified output format in frontmatter if not "text"`;

  const userPrompt = `Generate a Skill file with the following specifications:

Description: ${options.description}
Template variables to use: ${variablesList}
Output format: ${options.outputFormat}

Generate the complete Skill file:`;

  return { systemPrompt, userPrompt };
}
