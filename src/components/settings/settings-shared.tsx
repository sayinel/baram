// Shared components used across all settings tabs
import type { ReactNode } from "react";

export function SettingsRow({
  label,
  description,
  children,
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <span className="settings-row-label">{label}</span>
        {description && (
          <span className="settings-row-description">{description}</span>
        )}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function SettingsSectionHeader({ title }: { title: string }) {
  return <div className="settings-section-header">{title}</div>;
}

export function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      className={`settings-toggle ${checked ? "settings-toggle-on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}
