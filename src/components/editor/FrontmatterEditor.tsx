// §40 Frontmatter Visual Editor — property grid for YAML frontmatter
import { useCallback, useState } from "react";

interface FrontmatterEditorProps {
  isSkillFile?: boolean;
  onChange: (yaml: string) => void;
  yaml: string;
}

interface FrontmatterProperty {
  key: string;
  type: "boolean" | "date" | "string" | "tags";
  value: string;
}

export function FrontmatterEditor({
  yaml,
  onChange,
  isSkillFile,
}: FrontmatterEditorProps) {
  const [properties, setProperties] = useState(() => parseYaml(yaml));
  const [showSource, setShowSource] = useState(false);
  const [sourceText, setSourceText] = useState(yaml);

  const updateProperty = useCallback(
    (index: number, key: string, value: string) => {
      const updated = [...properties];
      updated[index] = { ...updated[index], key, value };
      setProperties(updated);
      onChange(serializeYaml(updated));
    },
    [properties, onChange],
  );

  const addProperty = useCallback(() => {
    const updated = [
      ...properties,
      { key: "key", value: "", type: "string" as const },
    ];
    setProperties(updated);
    onChange(serializeYaml(updated));
  }, [properties, onChange]);

  const removeProperty = useCallback(
    (index: number) => {
      const updated = properties.filter((_, i) => i !== index);
      setProperties(updated);
      onChange(serializeYaml(updated));
    },
    [properties, onChange],
  );

  if (showSource) {
    return (
      <div className="frontmatter-editor">
        <div className="frontmatter-editor-header">
          <span className="frontmatter-editor-title">Front Matter</span>
          <button
            className="frontmatter-editor-toggle"
            onClick={() => {
              setShowSource(false);
              const parsed = parseYaml(sourceText);
              setProperties(parsed);
              onChange(sourceText);
            }}
            title="Switch to visual editor"
          >
            Visual
          </button>
        </div>
        <textarea
          className="frontmatter-editor-source"
          onChange={(e) => {
            setSourceText(e.target.value);
            onChange(e.target.value);
          }}
          rows={Math.max(3, sourceText.split("\n").length + 1)}
          value={sourceText}
        />
      </div>
    );
  }

  // Skills file validation
  const missingRequired: string[] = [];
  if (isSkillFile) {
    const keys = new Set(properties.map((p) => p.key));
    if (!keys.has("name")) missingRequired.push("name");
    if (!keys.has("description")) missingRequired.push("description");
  }

  return (
    <div className="frontmatter-editor">
      <div className="frontmatter-editor-header">
        <span className="frontmatter-editor-title">Front Matter</span>
        <button
          className="frontmatter-editor-toggle"
          onClick={() => {
            setShowSource(true);
            setSourceText(serializeYaml(properties));
          }}
          title="Switch to source"
        >
          {"</>"}
        </button>
      </div>
      {missingRequired.length > 0 && (
        <div className="frontmatter-editor-warning">
          Missing required fields: {missingRequired.join(", ")}
        </div>
      )}
      <div className="frontmatter-editor-rows">
        {properties.map((prop, i) => (
          <div className="frontmatter-editor-row" key={i}>
            <input
              className="frontmatter-editor-key"
              onChange={(e) => updateProperty(i, e.target.value, prop.value)}
              placeholder="key"
              value={prop.key}
            />
            <span className="frontmatter-editor-sep">:</span>
            {prop.type === "boolean" ? (
              <button
                className={`frontmatter-editor-bool ${prop.value === "true" ? "on" : ""}`}
                onClick={() =>
                  updateProperty(
                    i,
                    prop.key,
                    prop.value === "true" ? "false" : "true",
                  )
                }
              >
                {prop.value === "true" ? "true" : "false"}
              </button>
            ) : prop.type === "tags" ? (
              <div className="frontmatter-editor-tags">
                {prop.value
                  .replace(/^\[|\]$/g, "")
                  .split(",")
                  .map((tag, ti) => (
                    <span className="frontmatter-editor-tag-chip" key={ti}>
                      {tag.trim()}
                    </span>
                  ))}
                <input
                  className="frontmatter-editor-tag-input"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.currentTarget.value) {
                      const current = prop.value.replace(/^\[|\]$/g, "");
                      const newVal = current
                        ? `[${current}, ${e.currentTarget.value}]`
                        : `[${e.currentTarget.value}]`;
                      updateProperty(i, prop.key, newVal);
                      e.currentTarget.value = "";
                    }
                  }}
                  placeholder="+ tag"
                />
              </div>
            ) : (
              <input
                className="frontmatter-editor-value"
                onChange={(e) => updateProperty(i, prop.key, e.target.value)}
                placeholder="value"
                type={prop.type === "date" ? "date" : "text"}
                value={prop.value}
              />
            )}
            <button
              className="frontmatter-editor-remove"
              onClick={() => removeProperty(i)}
              title="Remove property"
            >
              x
            </button>
          </div>
        ))}
      </div>
      <button className="frontmatter-editor-add" onClick={addProperty}>
        + Add Property
      </button>
    </div>
  );
}

function parseYaml(yaml: string): FrontmatterProperty[] {
  const props: FrontmatterProperty[] = [];
  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();

    let type: FrontmatterProperty["type"] = "string";
    if (value === "true" || value === "false") type = "boolean";
    else if (/^\d{4}-\d{2}-\d{2}/.test(value)) type = "date";
    else if (value.startsWith("[") || value.includes(",")) type = "tags";

    props.push({ key, value, type });
  }
  return props;
}

function serializeYaml(props: FrontmatterProperty[]): string {
  return props.map((p) => `${p.key}: ${p.value}`).join("\n");
}
