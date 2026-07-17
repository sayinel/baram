// §30 Graph View — inline settings panel overlay
import { useState } from "react";

import { useShallow } from "zustand/shallow";

import { useGraphSettingsStore } from "../../stores/ui/graph-settings";

export function GraphSettingsPanel() {
  const s = useGraphSettingsStore(
    useShallow((state) => ({
      searchQuery: state.searchQuery,
      setSearchQuery: state.setSearchQuery,
      showOrphans: state.showOrphans,
      setShowOrphans: state.setShowOrphans,
      existingFilesOnly: state.existingFilesOnly,
      setExistingFilesOnly: state.setExistingFilesOnly,
      showTags: state.showTags,
      setShowTags: state.setShowTags,
      colorByNamespace: state.colorByNamespace,
      setColorByNamespace: state.setColorByNamespace,
      namespaceFilter: state.namespaceFilter,
      setNamespaceFilter: state.setNamespaceFilter,
      excludedPaths: state.excludedPaths,
      clearExcluded: state.clearExcluded,
      graphScope: state.graphScope,
      localDepth: state.localDepth,
      setLocalDepth: state.setLocalDepth,
      localIncoming: state.localIncoming,
      setLocalIncoming: state.setLocalIncoming,
      localOutgoing: state.localOutgoing,
      setLocalOutgoing: state.setLocalOutgoing,
      localNeighborLinks: state.localNeighborLinks,
      setLocalNeighborLinks: state.setLocalNeighborLinks,
      nodeSize: state.nodeSize,
      setNodeSize: state.setNodeSize,
      linkThickness: state.linkThickness,
      setLinkThickness: state.setLinkThickness,
      textFadeThreshold: state.textFadeThreshold,
      setTextFadeThreshold: state.setTextFadeThreshold,
      showArrows: state.showArrows,
      setShowArrows: state.setShowArrows,
      centerForce: state.centerForce,
      setCenterForce: state.setCenterForce,
      repelForce: state.repelForce,
      setRepelForce: state.setRepelForce,
      linkForce: state.linkForce,
      setLinkForce: state.setLinkForce,
      linkDistance: state.linkDistance,
      setLinkDistance: state.setLinkDistance,
    })),
  );

  return (
    <div className="graph-settings-panel">
      <SettingsSection title="Filters">
        <div className="graph-settings-row">
          <label className="graph-settings-label">Search</label>
          <input
            className="graph-settings-search"
            onChange={(e) => s.setSearchQuery(e.target.value)}
            placeholder="Filter nodes..."
            type="text"
            value={s.searchQuery}
          />
        </div>
        <ToggleRow
          checked={s.showOrphans}
          label="Orphans"
          onChange={s.setShowOrphans}
        />
        <ToggleRow
          checked={s.existingFilesOnly}
          label="Existing only"
          onChange={s.setExistingFilesOnly}
        />
        <ToggleRow checked={s.showTags} label="Tags" onChange={s.setShowTags} />
        <ToggleRow
          checked={s.colorByNamespace}
          label="Color by namespace"
          onChange={s.setColorByNamespace}
        />
        <div className="graph-settings-row">
          <label className="graph-settings-label">Namespace</label>
          <input
            className="graph-settings-search"
            onChange={(e) => s.setNamespaceFilter(e.target.value)}
            placeholder="e.g. notes/ai"
            type="text"
            value={s.namespaceFilter}
          />
        </div>
        {s.graphScope === "local" && (
          <>
            <SliderRow
              label="Local depth"
              max={3}
              min={1}
              onChange={s.setLocalDepth}
              step={1}
              value={s.localDepth}
            />
            <ToggleRow
              checked={s.localIncoming}
              label="Incoming links"
              onChange={s.setLocalIncoming}
            />
            <ToggleRow
              checked={s.localOutgoing}
              label="Outgoing links"
              onChange={s.setLocalOutgoing}
            />
            <ToggleRow
              checked={s.localNeighborLinks}
              label="Neighbor links"
              onChange={s.setLocalNeighborLinks}
            />
          </>
        )}
        {s.excludedPaths.length > 0 && (
          <div className="graph-settings-row">
            <label className="graph-settings-label">Excluded</label>
            <button
              className="graph-settings-clear-btn"
              onClick={s.clearExcluded}
              title="Show all excluded nodes again"
            >
              Clear ({s.excludedPaths.length})
            </button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Display">
        <SliderRow
          label="Node size"
          max={80}
          min={10}
          onChange={s.setNodeSize}
          step={1}
          value={s.nodeSize}
        />
        <SliderRow
          label="Link width"
          max={5}
          min={0.5}
          onChange={s.setLinkThickness}
          step={0.5}
          value={s.linkThickness}
        />
        <SliderRow
          label="Text fade"
          max={2}
          min={0}
          onChange={s.setTextFadeThreshold}
          step={0.1}
          value={s.textFadeThreshold}
        />
        <ToggleRow
          checked={s.showArrows}
          label="Arrows"
          onChange={s.setShowArrows}
        />
      </SettingsSection>

      <SettingsSection title="Forces">
        <SliderRow
          label="Center"
          max={1}
          min={0}
          onChange={s.setCenterForce}
          step={0.05}
          value={s.centerForce}
        />
        <SliderRow
          label="Repel"
          max={50}
          min={0}
          onChange={s.setRepelForce}
          step={0.5}
          value={s.repelForce}
        />
        <SliderRow
          label="Link"
          max={1}
          min={0}
          onChange={s.setLinkForce}
          step={0.05}
          value={s.linkForce}
        />
        <SliderRow
          label="Distance"
          max={500}
          min={30}
          onChange={s.setLinkDistance}
          step={10}
          value={s.linkDistance}
        />
      </SettingsSection>
    </div>
  );
}

function SettingsSection({
  title,
  defaultOpen = true,
  children,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  title: string;
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
  max: number;
  min: number;
  onChange: (v: number) => void;
  step: number;
  value: number;
}) {
  return (
    <div className="graph-settings-row">
      <label className="graph-settings-label">{label}</label>
      <div className="graph-settings-slider-group">
        <input
          className="graph-settings-slider"
          max={max}
          min={min}
          onChange={(e) => onChange(Number(e.target.value))}
          step={step}
          type="range"
          value={value}
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
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="graph-settings-row">
      <label className="graph-settings-label">{label}</label>
      <button
        aria-checked={checked}
        className={`graph-settings-toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
      >
        <span className="graph-settings-toggle-knob" />
      </button>
    </div>
  );
}
