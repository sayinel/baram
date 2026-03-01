/**
 * §56a — Journal templates/ folder management
 * Creates and initialises the templates/ subdirectory inside the journal directory.
 */
import { createDir, writeFile } from "../ipc/invoke";

const DAILY_TEMPLATE = `---
type: daily
date: {{date}}
mood:
---

# {{date}} — {{dayName}}

## Today

## Reflection

`;

const WEEKLY_TEMPLATE = `---
type: weekly
week: {{week_number}}
week_start: {{week_start}}
week_end: {{week_end}}
---

# {{year}} {{week_number}}

## Review

## Goals

## Notes

`;

const MONTHLY_TEMPLATE = `---
type: monthly
month: {{month}}
year: {{year}}
---

# {{month_name}} {{year}}

## Summary

## Highlights

## Notes

`;

const YEARLY_TEMPLATE = `---
type: yearly
year: {{year}}
---

# {{year}} Year in Review

## Highlights

## Goals & Reflections

## Notes

`;

/**
 * Creates `{journalDir}/templates/` and writes the 4 default template files.
 * Existing files are not overwritten.
 */
export async function initJournalTemplatesDir(journalDir: string): Promise<void> {
  const templatesDir = `${journalDir}/templates`;
  await createDir(templatesDir);

  const files: [string, string][] = [
    [`${templatesDir}/daily-default.md`, DAILY_TEMPLATE],
    [`${templatesDir}/weekly-default.md`, WEEKLY_TEMPLATE],
    [`${templatesDir}/monthly-default.md`, MONTHLY_TEMPLATE],
    [`${templatesDir}/yearly-default.md`, YEARLY_TEMPLATE],
  ];

  await Promise.all(
    files.map(async ([path, content]) => {
      try {
        await writeFile(path, content);
      } catch {
        // File already exists or write failed — skip silently
      }
    }),
  );
}
