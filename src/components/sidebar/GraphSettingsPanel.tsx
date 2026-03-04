// §30 Graph View — inline settings panel overlay
import { useState } from "react";
import { useGraphSettingsStore } from "../../stores/graph-settings-store";

function SettingsSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="graph-settings-section">
      <button
        className="graph-settings-section-title"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`graph-settings-disclosure ${open ? "open" : ""}`}>
          &#9654;
        </span>
        {title}
      </button>
      {open && <div className="graph-settings-section-body">{children}</div>}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="graph-settings-row">
      <label className="graph-settings-label">{label}</label>
      <div className="graph-settings-slider-group">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="graph-settings-slider"
        />
        <span className="graph-settings-value">{value}</span>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="graph-settings-row">
      <label className="graph-settings-label">{label}</label>
      <button
        className={`graph-settings-toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span className="graph-settings-toggle-knob" />
      </button>
    </div>
  );
}

export function GraphSettingsPanel() {
  const s = useGraphSettingsStore();

  return (
    <div className="graph-settings-panel">
      <SettingsSection title="Filters">
        <div className="graph-settings-row">
          <label className="graph-settings-label">Search</label>
          <input
            type="text"
            className="graph-settings-search"
            value={s.searchQuery}
            onChange={(e) => s.setSearchQuery(e.target.value)}
            placeholder="Filter nodes..."
          />
        </div>
        <ToggleRow
          label="Orphans"
          checked={s.showOrphans}
          onChange={s.setShowOrphans}
        />
        <ToggleRow
          label="Existing only"
          checked={s.existingFilesOnly}
          onChange={s.setExistingFilesOnly}
        />
        <ToggleRow
          label="Tags"
          checked={s.showTags}
          onChange={s.setShowTags}
        />
      </SettingsSection>

      <SettingsSection title="Display">
        <SliderRow
          label="Node size"
          value={s.nodeSize}
          min={10}
          max={80}
          step={1}
          onChange={s.setNodeSize}
        />
        <SliderRow
          label="Link width"
          value={s.linkThickness}
          min={0.5}
          max={5}
          step={0.5}
          onChange={s.setLinkThickness}
        />
        <SliderRow
          label="Text fade"
          value={s.textFadeThreshold}
          min={0}
          max={2}
          step={0.1}
          onChange={s.setTextFadeThreshold}
        />
        <ToggleRow
          label="Arrows"
          checked={s.showArrows}
          onChange={s.setShowArrows}
        />
      </SettingsSection>

      <SettingsSection title="Forces">
        <SliderRow
          label="Center"
          value={s.centerForce}
          min={0}
          max={1}
          step={0.05}
          onChange={s.setCenterForce}
        />
        <SliderRow
          label="Repel"
          value={s.repelForce}
          min={0}
          max={50}
          step={0.5}
          onChange={s.setRepelForce}
        />
        <SliderRow
          label="Link"
          value={s.linkForce}
          min={0}
          max={1}
          step={0.05}
          onChange={s.setLinkForce}
        />
        <SliderRow
          label="Distance"
          value={s.linkDistance}
          min={30}
          max={500}
          step={10}
          onChange={s.setLinkDistance}
        />
      </SettingsSection>
    </div>
  );
}
