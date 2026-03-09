// §72c Skill Store — shared state for skill mode features
import { create } from "zustand";
import type {
  SkillMeta,
  DependencyWarning,
} from "../utils/skill-dependency-analyzer";
import type { LintResult } from "../utils/prompt-linter";
import {
  parseSkillFrontmatter,
  analyzeSkillDependencies,
} from "../utils/skill-dependency-analyzer";
import { isSkillFrontmatter } from "../utils/skill-frontmatter";
import type { FileEntry } from "./file-store";
import { useFileStore } from "./file-store";

interface SkillState {
  isSkill: boolean;
  currentSkill: SkillMeta | null;
  allSkills: SkillMeta[];
  lintResults: LintResult[];
  dependencyWarnings: DependencyWarning[];
  scanning: boolean;

  updateCurrentFile: (yaml: string, filePath: string) => void;
  scanWorkspace: () => Promise<void>;
  setLintResults: (results: LintResult[]) => void;
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
      const { readFile } = await import("../ipc/invoke");

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
