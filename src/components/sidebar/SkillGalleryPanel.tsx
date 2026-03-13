// §72c SkillGalleryPanel — browse and search workspace skills
import { useEffect, useMemo, useState } from "react";

import type { SkillMeta } from "../../utils/skill-dependency-analyzer";

import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSkillStore } from "../../stores/skill-store";
import { logger } from "../../utils/logger";

export function SkillGalleryPanel() {
  const allSkills = useSkillStore((s) => s.allSkills);
  const scanning = useSkillStore((s) => s.scanning);
  const [searchQuery, setSearchQuery] = useState("");

  // Auto-scan on mount if no skills loaded
  useEffect(() => {
    if (allSkills.length === 0 && !scanning) {
      useSkillStore.getState().scanWorkspace();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter by name/description (case-insensitive)
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return allSkills;
    const q = searchQuery.toLowerCase();
    return allSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [allSkills, searchQuery]);

  // Collect unique output formats for display
  const outputFormats = useMemo(() => {
    const fmts = new Set<string>();
    for (const s of allSkills) {
      if (s.outputFormat) fmts.add(s.outputFormat);
    }
    return Array.from(fmts);
  }, [allSkills]);

  const handleOpenSkill = async (skill: SkillMeta) => {
    const { openTab, setActiveTab, tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === skill.filePath);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    try {
      const content = await readFile(skill.filePath);
      useFileStore.getState().setFileContent(skill.filePath, content);
      const tabId = `tab-${skill.filePath}`;
      const fileName = skill.filePath.split("/").pop() ?? skill.name;
      openTab({
        id: tabId,
        filePath: skill.filePath,
        title: fileName,
        isDirty: false,
        isPinned: false,
      });
      setActiveTab(tabId);
    } catch (err) {
      logger.error("Failed to open skill file:", err);
    }
  };

  const handleScan = () => {
    useSkillStore.getState().scanWorkspace();
  };

  return (
    <div className="skill-gallery">
      <div className="skill-gallery-toolbar">
        <input
          className="skill-gallery-search"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search skills..."
          type="text"
          value={searchQuery}
        />
        {outputFormats.length > 0 && (
          <div className="skill-gallery-tags">
            {outputFormats.map((fmt) => (
              <span
                className={`skill-gallery-tag ${searchQuery === fmt ? "skill-gallery-tag--active" : ""}`}
                key={fmt}
                onClick={() => setSearchQuery(searchQuery === fmt ? "" : fmt)}
              >
                {fmt}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="skill-gallery-list">
        {scanning && (
          <div className="skill-gallery-empty">Scanning workspace...</div>
        )}

        {!scanning && filtered.length === 0 && (
          <div className="skill-gallery-empty">
            No skills found
            <br />
            <button className="skill-gallery-scan-btn" onClick={handleScan}>
              Scan Workspace
            </button>
          </div>
        )}

        {filtered.map((skill) => (
          <div
            className="skill-gallery-card"
            key={skill.filePath}
            onClick={() => handleOpenSkill(skill)}
          >
            <div className="skill-gallery-card-name">{skill.name}</div>
            {skill.description && (
              <div className="skill-gallery-card-desc">{skill.description}</div>
            )}
            <div className="skill-gallery-card-meta">
              {skill.requires.length > 0 && (
                <span className="skill-gallery-badge">
                  {skill.requires.length} dep
                  {skill.requires.length > 1 ? "s" : ""}
                </span>
              )}
              {skill.outputFormat && (
                <span className="skill-gallery-chip">{skill.outputFormat}</span>
              )}
              {skill.version && (
                <span className="skill-gallery-chip">v{skill.version}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
