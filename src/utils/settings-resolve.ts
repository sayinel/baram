// §86 Settings resolve — merge global settings with vault config overrides
import type { VaultConfig } from "../ipc/types";

/**
 * Merge global settings with vault-scoped overrides.
 * Vault config fields override global when present.
 * Returns a flat ResolvedSettings object.
 */
/** §86 Frontmatter fields that can override settings (3rd tier). */
export interface FrontmatterOverrides {
  aiModel?: string;
  enableMermaid?: boolean;
  enableWikilink?: boolean;
  theme?: string;
}

/**
 * Resolved settings for the active context.
 * Global settings with vault-scoped overrides applied.
 */
export interface ResolvedSettings {
  aiContextScope?: string;
  // AI
  aiModel?: string;
  aiPrivacyMode?: boolean;
  // Editor
  dailyNotesFolder?: string;
  defaultNewFileLocation?: string;
  enableMermaid?: boolean;
  enableWikilink?: boolean;
  extensionsDisabled?: string[];
  // Extensions
  extensionsEnabled?: string[];
  // Git
  gitAutoFetchInterval?: number;
  gitAutoPushOnCommit?: boolean;
  // Markdown
  markdownSerializationRules?: Record<string, unknown>;
  skillsFolder?: string;
  // Snapshot
  snapshotIntervalMinutes?: number;
  snapshotMaxCount?: number;
  // Appearance (opt-in)
  themeOverride?: string;
}

export function resolveSettings(
  globalSettings: {
    aiModel?: string;
    dailyNotesFolder?: string;
    enableMermaid?: boolean;
    enableWikilink?: boolean;
    privacyMode?: boolean;
    skillsFolder?: string;
    themeId?: string;
  },
  vaultConfig: null | undefined | VaultConfig,
  frontmatter?: FrontmatterOverrides | null,
): ResolvedSettings {
  const resolved: ResolvedSettings = {
    aiModel: globalSettings.aiModel,
    aiPrivacyMode: globalSettings.privacyMode,
    enableWikilink: globalSettings.enableWikilink,
    enableMermaid: globalSettings.enableMermaid,
    dailyNotesFolder: globalSettings.dailyNotesFolder,
    skillsFolder: globalSettings.skillsFolder,
  };

  if (!vaultConfig) return applyFrontmatter(resolved, frontmatter);

  // AI overrides
  if (vaultConfig.ai) {
    if (vaultConfig.ai.model !== undefined)
      resolved.aiModel = vaultConfig.ai.model;
    if (vaultConfig.ai.privacyMode !== undefined)
      resolved.aiPrivacyMode = vaultConfig.ai.privacyMode;
    if (vaultConfig.ai.contextScope !== undefined)
      resolved.aiContextScope = vaultConfig.ai.contextScope;
  }

  // Markdown overrides
  if (vaultConfig.markdown) {
    if (vaultConfig.markdown.serializationRules !== undefined)
      resolved.markdownSerializationRules =
        vaultConfig.markdown.serializationRules;
    if (vaultConfig.markdown.enableWikilink !== undefined)
      resolved.enableWikilink = vaultConfig.markdown.enableWikilink;
    if (vaultConfig.markdown.enableMermaid !== undefined)
      resolved.enableMermaid = vaultConfig.markdown.enableMermaid;
  }

  // Editor overrides
  if (vaultConfig.editor) {
    if (vaultConfig.editor.dailyNotesFolder !== undefined)
      resolved.dailyNotesFolder = vaultConfig.editor.dailyNotesFolder;
    if (vaultConfig.editor.skillsFolder !== undefined)
      resolved.skillsFolder = vaultConfig.editor.skillsFolder;
    if (vaultConfig.editor.defaultNewFileLocation !== undefined)
      resolved.defaultNewFileLocation =
        vaultConfig.editor.defaultNewFileLocation;
  }

  // Git overrides
  if (vaultConfig.git) {
    if (vaultConfig.git.autoFetchInterval !== undefined)
      resolved.gitAutoFetchInterval = vaultConfig.git.autoFetchInterval;
    if (vaultConfig.git.autoPushOnCommit !== undefined)
      resolved.gitAutoPushOnCommit = vaultConfig.git.autoPushOnCommit;
  }

  // Appearance (opt-in override)
  if (vaultConfig.appearance?.theme !== undefined) {
    resolved.themeOverride = vaultConfig.appearance.theme;
  }

  // Extensions
  if (vaultConfig.extensions) {
    resolved.extensionsEnabled = vaultConfig.extensions.enabled;
    resolved.extensionsDisabled = vaultConfig.extensions.disabled;
  }

  // Snapshot
  if (vaultConfig.snapshot) {
    if (vaultConfig.snapshot.intervalMinutes !== undefined)
      resolved.snapshotIntervalMinutes = vaultConfig.snapshot.intervalMinutes;
    if (vaultConfig.snapshot.maxCount !== undefined)
      resolved.snapshotMaxCount = vaultConfig.snapshot.maxCount;
  }

  return applyFrontmatter(resolved, frontmatter);
}

/** §86 Apply frontmatter overrides (3rd tier, limited set). */
function applyFrontmatter(
  resolved: ResolvedSettings,
  frontmatter?: FrontmatterOverrides | null,
): ResolvedSettings {
  if (!frontmatter) return resolved;
  if (frontmatter.aiModel !== undefined) resolved.aiModel = frontmatter.aiModel;
  if (frontmatter.enableMermaid !== undefined)
    resolved.enableMermaid = frontmatter.enableMermaid;
  if (frontmatter.enableWikilink !== undefined)
    resolved.enableWikilink = frontmatter.enableWikilink;
  if (frontmatter.theme !== undefined)
    resolved.themeOverride = frontmatter.theme;
  return resolved;
}
