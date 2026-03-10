// §72c Skill Panel Registry — dynamic section registration for PropertiesPanel
import type { ComponentType } from "react";

export interface SkillPanelSection {
  component: ComponentType;
  id: string;
  order: number;
  title: string;
}

const sections: SkillPanelSection[] = [];

export function getSkillSections(): SkillPanelSection[] {
  return [...sections].sort((a, b) => a.order - b.order);
}

export function registerSkillSection(section: SkillPanelSection): void {
  const idx = sections.findIndex((s) => s.id === section.id);
  if (idx >= 0) sections[idx] = section;
  else sections.push(section);
}
