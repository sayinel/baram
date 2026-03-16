// §72 Skills 전용 모드 — 활성 파일의 frontmatter 감지, UI 자동 전환
import { useEffect, useRef } from "react";

import { useSkillStore } from "../stores/ai/skill";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { type RightPanelMode, useUIStore } from "../stores/ui/ui";
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
  const prevModeRef = useRef<null | { mode: RightPanelMode; open: boolean }>(
    null,
  );

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
      ui.setRightPanelMode(prev.mode);
      if (ui.rightPanelOpen !== prev.open) {
        ui.toggleRightPanel();
      }
      prevModeRef.current = null;
    }
  }, [isSkill]);

  return { isSkill, yaml };
}
