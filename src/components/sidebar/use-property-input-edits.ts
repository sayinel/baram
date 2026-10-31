// §72 The Properties panel's value inputs: each edit in progress, and the YAML text typed that
// is not valid YAML yet. The input writes on every keystroke; this decides what each keystroke
// writes, and what the input shows instead of the value while nothing is written.
import { useRef, useState } from "react";

import type { PropertyEntry } from "../../utils/markdown/yaml-properties";

import {
  isWritableYamlValue,
  setYamlPropertyValue,
} from "../../utils/markdown/yaml-properties";

/**
 * A value input's edit in progress. Typing must not change the value's type on the way (`-1` →
 * `-` → `-1`), so each write is spelled against the value as the edit found it
 * (`setYamlPropertyValue`'s `original`), not as the previous keystroke left it. The edit ends
 * when the input loses focus, or when the front matter is no longer what it left (`after`) —
 * another file, an undo, an edit from elsewhere.
 */
interface InputEdit {
  after: string;
  /** The field was a `yaml` one when the edit began: emptying it does not make it a string. */
  asYaml: boolean;
  file: string;
  /** The value's spelling when the edit began. */
  raw: string;
}

/** `yaml` text typed that is not valid YAML there: shown in the input, not written. */
interface YamlDraft {
  file: string;
  text: string;
  /** The front matter it was typed on; another one drops the draft. */
  yaml: string;
}

/**
 * The value inputs' edits on the front matter `yaml` of the file `filePath`:
 * - `change(entry, text)` — the front matter `text` typed into `entry`'s input makes, or null
 *   when it writes nothing: `yaml` text that is not valid YAML there (`isWritableYamlValue`) is
 *   kept as a draft instead;
 * - `draftOf(key)` — the draft the input shows instead of its value, if one was typed on this
 *   front matter;
 * - `end(key)` — ends the input's edit and drops its draft (the input lost focus).
 */
export function usePropertyInputEdits(
  yaml: null | string,
  filePath: null | string,
) {
  const editsRef = useRef(new Map<string, InputEdit>());
  const [drafts, setDrafts] = useState<ReadonlyMap<string, YamlDraft>>(
    () => new Map(),
  );

  const setDraft = (key: string, draft: null | YamlDraft) =>
    setDrafts((current) => {
      if (draft === null && !current.has(key)) return current;
      const next = new Map(current);
      if (draft === null) next.delete(key);
      else next.set(key, draft);
      return next;
    });

  const draftOf = (key: string): string | undefined => {
    const draft = drafts.get(key);
    return draft && draft.file === filePath && draft.yaml === yaml
      ? draft.text
      : undefined;
  };

  const change = (entry: PropertyEntry, text: string): null | string => {
    if (yaml === null || filePath === null) return null;
    const { key } = entry;
    let edit = editsRef.current.get(key);
    if (!edit || edit.file !== filePath || edit.after !== yaml) {
      edit = {
        after: yaml,
        asYaml: entry.type === "yaml",
        file: filePath,
        raw: entry.raw ?? "",
      };
      editsRef.current.set(key, edit);
    }
    let newYaml: string;
    if (edit.asYaml) {
      // YAML text (`{a: 1}`, `&a x`) is written as typed, and only once it is valid YAML.
      if (!isWritableYamlValue(yaml, key, text)) {
        setDraft(key, { file: filePath, text, yaml });
        return null;
      }
      setDraft(key, null);
      newYaml = setYamlPropertyValue(yaml, key, text, { asYaml: true });
    } else {
      newYaml = setYamlPropertyValue(yaml, key, text, { original: edit.raw });
    }
    edit.after = newYaml;
    return newYaml;
  };

  const end = (key: string) => {
    editsRef.current.delete(key);
    setDraft(key, null);
  };

  return { change, draftOf, end };
}
