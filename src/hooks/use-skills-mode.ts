// §72 Skills 전용 모드 — 활성 파일의 frontmatter 감지, UI 자동 전환
import { useEffect, useRef } from "react";

import { useEditorStore } from "../stores/editor-store";
import { useFileStore } from "../stores/file-store";
import { useSkillStore } from "../stores/skill-store";
import { useUIStore } from "../stores/ui-store";
import { isSkillFrontmatter } from "../utils/skill/skill-frontmatter";
// Re-export for backward compatibility
export { isSkillFrontmatter };

/** Auto-detect skill files and switch right panel to "properties" mode */
export function useSkillsMode() {
  const filePath = useEditorStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.filePath ?? null,
  );
  const content = useFileStore((s) =>
    filePath ? (s.openFiles.get(filePath) ?? "") : "",
  );
  const prevModeRef = useRef<null | { mode: string; open: boolean }>(null);

  // Extract YAML from frontmatter
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const yaml = fmMatch ? fmMatch[1] : "";
  const isSkill = isSkillFrontmatter(yaml);

  // §72c Update skill store when frontmatter or file changes
  useEffect(() => {
    if (filePath) {
      useSkillStore.getState().updateCurrentFile(yaml, filePath);
    } else {
      useSkillStore.setState({ isSkill: false, currentSkill: null });
    }
  }, [yaml, filePath]);

  useEffect(() => {
    const ui = useUIStore.getState();

    if (isSkill) {
      // Save previous state only on first activation
      if (!prevModeRef.current) {
        prevModeRef.current = {
          mode: ui.rightPanelMode,
          open: ui.rightPanelOpen,
        };
      }
      ui.setRightPanelMode("properties");
      if (!ui.rightPanelOpen) ui.toggleRightPanel();
    } else if (prevModeRef.current) {
      // Restore previous state
      const prev = prevModeRef.current;
      ui.setRightPanelMode(
        prev.mode as
          | "chat"
          | "help"
          | "memories"
          | "none"
          | "photo-gallery"
          | "properties",
      );
      if (ui.rightPanelOpen !== prev.open) {
        ui.toggleRightPanel();
      }
      prevModeRef.current = null;
    }
  }, [isSkill]);

  return { isSkill, yaml };
}
