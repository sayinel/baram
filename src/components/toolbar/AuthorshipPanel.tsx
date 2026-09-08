// §11.7 AuthorshipPanel — percentage breakdown and visual progress bar

import type { AuthorshipStats } from "../../utils/authorship-tracker";

import { useTranslation } from "../../i18n/useTranslation";

interface AuthorshipPanelProps {
  stats: AuthorshipStats;
}

export function AuthorshipPanel({ stats }: AuthorshipPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="authorship-panel">
      <div className="authorship-stats">
        <div className="authorship-stat">
          <span className="authorship-label">{t("authorship.human")}</span>
          <span className="authorship-value">{stats.humanPercent}%</span>
        </div>
        <div className="authorship-stat">
          <span className="authorship-label">
            {t("authorship.aiGenerated")}
          </span>
          <span className="authorship-value">{stats.aiGeneratedPercent}%</span>
        </div>
        <div className="authorship-stat">
          <span className="authorship-label">{t("authorship.aiModified")}</span>
          <span className="authorship-value">{stats.aiModifiedPercent}%</span>
        </div>
      </div>
      <div className="authorship-bar">
        <div
          className="authorship-bar-segment authorship-bar-human"
          style={{ width: `${stats.humanPercent}%` }}
        />
        <div
          className="authorship-bar-segment authorship-bar-ai-generated"
          style={{ width: `${stats.aiGeneratedPercent}%` }}
        />
        <div
          className="authorship-bar-segment authorship-bar-ai-modified"
          style={{ width: `${stats.aiModifiedPercent}%` }}
        />
      </div>
    </div>
  );
}
