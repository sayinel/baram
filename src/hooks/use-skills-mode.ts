// §72 Skills 전용 모드 — 활성 파일의 frontmatter 감지, UI 자동 전환
import { useEffect, useRef } from "react";
import { useEditorStore } from "../stores/editor-store";
import { useFileStore } from "../stores/file-store";
import { useUIStore } from "../stores/ui-store";
import { useSkillStore } from "../stores/skill-store";

import { isSkillFrontmatter } from "../utils/skill-frontmatter";
// Re-export for backward compatibility
export { isSkillFrontmatter };

/** Auto-detect skill files and switch right panel to "properties" mode */
export function useSkillsMode() {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const openFiles = useFileStore((s) => s.openFiles);
  const prevModeRef = useRef<{ mode: string; open: boolean } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;
  const content = filePath ? openFiles.get(filePath) ?? "" : "";

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
      ui.setRightPanelMode(prev.mode as any);
      if (ui.rightPanelOpen !== prev.open) {
        ui.toggleRightPanel();
      }
      prevModeRef.current = null;
    }
  }, [isSkill]);

  return { isSkill, yaml };
}
