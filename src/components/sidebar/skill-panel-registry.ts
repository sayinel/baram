// §72c Skill Panel Registry — dynamic section registration for PropertiesPanel
import type { ComponentType } from "react";

export interface SkillPanelSection {
  id: string;
  title: string;
  order: number;
  component: ComponentType;
}

const sections: SkillPanelSection[] = [];

export function registerSkillSection(section: SkillPanelSection): void {
  const idx = sections.findIndex((s) => s.id === section.id);
  if (idx >= 0) sections[idx] = section;
  else sections.push(section);
}

export function getSkillSections(): SkillPanelSection[] {
  return [...sections].sort((a, b) => a.order - b.order);
}
