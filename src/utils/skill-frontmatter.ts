// §72 Skill frontmatter detection — shared utility (avoids circular imports)

/** Check if YAML frontmatter has both name and description (skill file convention) */
export function isSkillFrontmatter(yaml: string): boolean {
  const hasName = /^name\s*:/m.test(yaml);
  const hasDescription = /^description\s*:/m.test(yaml);
  return hasName && hasDescription;
}
