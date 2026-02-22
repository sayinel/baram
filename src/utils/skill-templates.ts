// §42 Skill Templates — predefined templates for new Skills files

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: "prompt",
    name: "Prompt",
    description: "Simple prompt template with input/output",
    content: `---
name: my-prompt
type: skill
description: A simple prompt skill
---

<system>
You are a helpful assistant.
</system>

<user>
{{input}}
</user>
`,
  },
  {
    id: "chain",
    name: "Chain",
    description: "Multi-step prompt chain with intermediate processing",
    content: `---
name: my-chain
type: skill
description: A multi-step chain skill
steps: 2
---

## Step 1: Analyze

<system>
Analyze the following input and extract key concepts.
</system>

<user>
{{input}}
</user>

## Step 2: Generate

<system>
Based on the analysis, generate a structured output.
</system>

<user>
Key concepts: {{step1.output}}
Generate a detailed response.
</user>
`,
  },
  {
    id: "analyzer",
    name: "Analyzer",
    description: "Content analysis with structured output format",
    content: `---
name: my-analyzer
type: skill
description: Analyzes content and produces structured output
output_format: json
---

<system>
You are an expert analyst. Analyze the given content and produce a structured JSON response.

Output format:
{
  "summary": "brief summary",
  "key_points": ["point1", "point2"],
  "sentiment": "positive|negative|neutral",
  "suggestions": ["suggestion1"]
}
</system>

<user>
Analyze this content:

{{selection}}
</user>
`,
  },
  {
    id: "generator",
    name: "Generator",
    description: "Content generation from specifications",
    content: `---
name: my-generator
type: skill
description: Generates content based on specifications
---

<system>
You are a skilled content generator. Create content based on the user's specifications.
Follow the style and tone of the existing document context.
</system>

<user>
Document context:
{{document}}

Generate the following:
{{input}}
</user>
`,
  },
  {
    id: "transformer",
    name: "Transformer",
    description: "Transform selected text according to rules",
    content: `---
name: my-transformer
type: skill
description: Transforms selected text
---

<system>
You are a text transformer. Apply the specified transformation to the input text.
Output ONLY the transformed text, nothing else.
</system>

<user>
Transform the following text:

{{selection}}

Transformation: {{input}}
</user>
`,
  },
];

export function getTemplate(id: string): SkillTemplate | undefined {
  return SKILL_TEMPLATES.find((t) => t.id === id);
}
