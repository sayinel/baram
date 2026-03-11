import type { LintResult } from "../utils/prompt-linter";
import type {
  DependencyWarning,
  SkillMeta,
} from "../utils/skill-dependency-analyzer";
import type { FileEntry } from "./file-store";

// §72c Skill Store — shared state for skill mode features
import { create } from "zustand";

import { readFile } from "../ipc/invoke";
import {
  analyzeSkillDependencies,
  parseSkillFrontmatter,
} from "../utils/skill-dependency-analyzer";
import { isSkillFrontmatter } from "../utils/skill-frontmatter";
import { useFileStore } from "./file-store";

interface SkillState {
  allSkills: SkillMeta[];
  currentSkill: null | SkillMeta;
  dependencyWarnings: DependencyWarning[];
  isSkill: boolean;
  lintResults: LintResult[];
  scanning: boolean;

  scanWorkspace: () => Promise<void>;
  setLintResults: (results: LintResult[]) => void;
  updateCurrentFile: (yaml: string, filePath: string) => void;
}

/** Recursively collect .md files from the file tree */
function collectMdFiles(entries: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = [];
  for (const e of entries) {
    if (!e.isDir && e.name.endsWith(".md")) result.push(e);
    if (e.isDir && e.children) result.push(...collectMdFiles(e.children));
  }
  return result;
}

export const useSkillStore = create<SkillState>()((set, get) => ({
  isSkill: false,
  currentSkill: null,
  allSkills: [],
  lintResults: [],
  dependencyWarnings: [],
  scanning: false,

  updateCurrentFile: (yaml: string, filePath: string) => {
    if (isSkillFrontmatter(yaml)) {
      const meta = parseSkillFrontmatter(yaml, filePath);
      set({ isSkill: true, currentSkill: meta });
    } else {
      set({ isSkill: false, currentSkill: null });
    }
  },

  scanWorkspace: async () => {
    set({ scanning: true });
    try {
      const { fileTree } = useFileStore.getState();
      const mdFiles = collectMdFiles(fileTree);

      const skills: SkillMeta[] = [];
      for (const file of mdFiles) {
        try {
          const content = await readFile(file.path);
          const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (fmMatch) {
            const yaml = fmMatch[1];
            if (isSkillFrontmatter(yaml)) {
              skills.push(parseSkillFrontmatter(yaml, file.path));
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }

      const existingFiles = new Set(skills.map((s) => s.name));
      const warnings = analyzeSkillDependencies(skills, existingFiles);
      set({ allSkills: skills, dependencyWarnings: warnings });
    } finally {
      set({ scanning: false });
    }
  },

  setLintResults: (results: LintResult[]) => {
    if (results.length === 0 && get().lintResults.length === 0) return;
    set({ lintResults: results });
  },
}));
