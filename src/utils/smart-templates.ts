// §11.8 Smart Templates — built-in template schemas and prompt builders

export interface SmartTemplate {
  contextHints?: string[];
  id: string;
  name: string;
  sections: TemplateSection[];
}

export interface TemplateSection {
  /** Brief guidance for what goes in this section */
  hint: string;
  /** Whether the section is required */
  required?: boolean;
  /** Section heading */
  title: string;
}

const BUILTIN_TEMPLATES: SmartTemplate[] = [
  {
    id: "api-doc",
    name: "API Documentation",
    sections: [
      {
        title: "Overview",
        hint: "Brief description of the API endpoint",
        required: true,
      },
      { title: "Endpoint", hint: "HTTP method and URL path" },
      { title: "Parameters", hint: "Request parameters (query, path, body)" },
      {
        title: "Request Example",
        hint: "Sample request with headers and body",
      },
      { title: "Response", hint: "Response schema and status codes" },
      { title: "Error Handling", hint: "Common error responses" },
    ],
    contextHints: ["projectName", "techStack", "baseUrl"],
  },
  {
    id: "meeting-notes",
    name: "Meeting Notes",
    sections: [
      {
        title: "Meeting Info",
        hint: "Date, attendees, and topic",
        required: true,
      },
      { title: "Agenda", hint: "List of discussion topics" },
      { title: "Discussion", hint: "Key points discussed" },
      { title: "Decisions", hint: "Decisions made during the meeting" },
      {
        title: "Action Items",
        hint: "Tasks assigned with owners and deadlines",
      },
    ],
    contextHints: ["team", "project"],
  },
  {
    id: "tech-spec",
    name: "Technical Spec",
    sections: [
      {
        title: "Problem Statement",
        hint: "What problem are we solving?",
        required: true,
      },
      { title: "Goals & Non-Goals", hint: "What is in and out of scope" },
      { title: "Proposed Solution", hint: "High-level design and approach" },
      { title: "Technical Details", hint: "Implementation specifics" },
      { title: "Alternatives Considered", hint: "Other approaches evaluated" },
      {
        title: "Risks & Mitigations",
        hint: "Potential issues and how to address them",
      },
      { title: "Timeline", hint: "Estimated milestones" },
    ],
    contextHints: ["projectName", "techStack"],
  },
  {
    id: "tutorial",
    name: "Tutorial",
    sections: [
      {
        title: "Introduction",
        hint: "What the reader will learn",
        required: true,
      },
      { title: "Prerequisites", hint: "Required knowledge and setup" },
      {
        title: "Step-by-Step Guide",
        hint: "Detailed walkthrough with code examples",
      },
      { title: "Common Pitfalls", hint: "Mistakes to avoid" },
      { title: "Summary", hint: "Recap of key takeaways" },
    ],
    contextHints: ["audience", "techStack"],
  },
  {
    id: "blog-post",
    name: "Blog Post",
    sections: [
      {
        title: "Title & Hook",
        hint: "Attention-grabbing title and opening",
        required: true,
      },
      { title: "Background", hint: "Context and why this matters" },
      { title: "Main Content", hint: "Core argument or narrative" },
      { title: "Examples", hint: "Concrete illustrations or code samples" },
      { title: "Conclusion", hint: "Summary and call to action" },
    ],
    contextHints: ["audience", "tone"],
  },
  {
    id: "release-notes",
    name: "Release Notes",
    sections: [
      {
        title: "Version & Date",
        hint: "Release version number and date",
        required: true,
      },
      { title: "Highlights", hint: "Key new features" },
      { title: "Improvements", hint: "Enhancements to existing features" },
      { title: "Bug Fixes", hint: "Issues resolved in this release" },
      { title: "Breaking Changes", hint: "Changes that require user action" },
      { title: "Known Issues", hint: "Outstanding problems" },
    ],
    contextHints: ["projectName", "version"],
  },
  {
    id: "research-notes",
    name: "Research Notes",
    sections: [
      {
        title: "Research Question",
        hint: "What are we investigating?",
        required: true,
      },
      { title: "Methodology", hint: "How was the research conducted" },
      { title: "Findings", hint: "Key results and observations" },
      { title: "Analysis", hint: "Interpretation of findings" },
      { title: "References", hint: "Sources and citations" },
    ],
    contextHints: ["domain", "scope"],
  },
];

/**
 * Builds an LLM prompt from a template and user-provided context.
 * The prompt includes the template name, all section titles with hints,
 * and any context key-value pairs the user supplied.
 */
export function buildTemplatePrompt(
  templateId: string,
  context?: Record<string, string>,
): string {
  const template = getTemplateById(templateId);
  if (!template) {
    return "";
  }

  const lines: string[] = [];
  lines.push(`Generate a document using the "${template.name}" template.`);
  lines.push("");
  lines.push("## Sections");
  for (const section of template.sections) {
    const req = section.required ? " (required)" : "";
    lines.push(`- **${section.title}**${req}: ${section.hint}`);
  }

  if (context && Object.keys(context).length > 0) {
    lines.push("");
    lines.push("## Context");
    for (const [key, value] of Object.entries(context)) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  lines.push("");
  lines.push(
    "Output well-structured markdown following the section order above. Use appropriate heading levels.",
  );

  return lines.join("\n");
}

/**
 * Returns all 7 built-in smart templates.
 */
export function getBuiltinTemplates(): SmartTemplate[] {
  return BUILTIN_TEMPLATES;
}

/**
 * Looks up a template by its unique id.
 */
export function getTemplateById(id: string): SmartTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
