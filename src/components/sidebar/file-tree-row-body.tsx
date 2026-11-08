// §395 spec 0074 D8 · D9 · §5.1 — the part of a file tree row a plugin's decoration can change: the icon,
// the name (or its rename input), the badges and the git dot, in one box. It subscribes to ONE key of the
// decoration store (`decorationKey(entry.path)`), so a decoration change re-renders this leaf alone — not
// the row (`FileTreeNode`), which renders a folder's mounted children in its own render and has no `memo`,
// so a subscription there would re-render all of them (spec 0074 §2 "다시 그리기", review I1). The chevron
// stays in the row, outside this box. The box must shrink (`.file-tree-row-body` in `file-tree.css`) or the
// name inside never truncates.
import { useRef } from "react";

import type { DecorationIcon } from "../../plugins/file-decorations/file-decoration-store";
import type { FileEntry } from "../../stores/file/file";

import {
  decorationKey,
  selectDecoration,
  useFileDecorationStore,
} from "../../plugins/file-decorations/file-decoration-store";
import { getFileIcon } from "./file-icon";
import { IconFolder } from "./file-tree-icons";

/** The git dot a row shows: a file's status, a folder that holds changes, or none. */
export type GitDot = "added" | "changes" | "modified" | null;

export function FileTreeRowBody({
  entry,
  git,
  inputRef,
  isRenaming,
  onCancelRename,
  onConfirmRename,
  onStartRename,
}: {
  entry: FileEntry;
  git: GitDot;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isRenaming: boolean;
  onCancelRename: () => void;
  onConfirmRename: (oldPath: string, newName: string) => void;
  onStartRename: (path: string) => void;
}): React.JSX.Element {
  const decoration = useFileDecorationStore(
    selectDecoration(decorationKey(entry.path)),
  );
  const badges = decoration?.badges ?? [];
  return (
    // D8 — the hover text names each plugin, including one whose badge does not fit.
    <div className="file-tree-row-body" title={decoration?.title}>
      {decoration?.icon === undefined ? (
        <span aria-hidden="true" className="file-tree-icon">
          {entry.isDir ? <IconFolder /> : getFileIcon(entry.name)}
        </span>
      ) : (
        <PluginIcon icon={decoration.icon} />
      )}
      {isRenaming ? (
        <RenameInput
          defaultValue={entry.name}
          inputRef={inputRef}
          onCancel={onCancelRename}
          onConfirm={(val) => onConfirmRename(entry.path, val)}
        />
      ) : (
        <span
          className="file-tree-name text-truncate"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartRename(entry.path);
          }}
        >
          {entry.name}
        </span>
      )}
      {(badges.length > 0 || git !== null) && (
        <span className="file-tree-row-end">
          {badges.map((badge, index) => (
            <span
              aria-label={badge.label}
              className="file-tree-plugin-badge"
              key={index}
              style={
                badge.color === undefined ? undefined : { color: badge.color }
              }
            >
              {badge.text}
            </span>
          ))}
          {git !== null && <GitDotView git={git} />}
        </span>
      )}
    </div>
  );
}

/** The app's git dot, always the right-most thing in the row (D8). */
function GitDotView({
  git,
}: {
  git: Exclude<GitDot, null>;
}): React.JSX.Element {
  return git === "changes" ? (
    <span
      aria-label="contains changes"
      className="file-tree-git-badge file-tree-git-badge-dir"
    />
  ) : (
    <span
      aria-label={git}
      className={`file-tree-git-badge file-tree-git-badge-${git}`}
    />
  );
}

/** A plugin's icon in the icon box: one character, clipped to the box, or the host's mask class (D6). */
function PluginIcon({ icon }: { icon: DecorationIcon }): React.JSX.Element {
  if ("glyph" in icon) {
    return (
      <span
        aria-hidden="true"
        className="file-tree-icon file-tree-plugin-glyph"
        style={icon.color === undefined ? undefined : { color: icon.color }}
      >
        {icon.glyph}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="file-tree-icon">
      <span
        className={`file-tree-plugin-mask ${icon.className}`}
        style={
          icon.color === undefined ? undefined : { backgroundColor: icon.color }
        }
      />
    </span>
  );
}

// --- RenameInput (deduplicated from 4 inline occurrences; moved here from FileTreeNode.tsx by §395) ---
export function RenameInput({
  defaultValue,
  onConfirm,
  onCancel,
  inputRef,
  placeholder,
}: {
  defaultValue?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onConfirm: (value: string) => void;
  placeholder?: string;
}): React.JSX.Element {
  // §33 — one input, one outcome: the first of Enter, Escape or a blur decides, and nothing after it does.
  // A blur after Enter or Escape is not the person leaving the input. It is the decision's own effect:
  // `handleConfirmRename` and `handleCancelRename` (use-file-tree-rename.ts) give focus back to the tree
  // while this input is still mounted, and that blur used to confirm again — Enter sent a second rename
  // that found the file already moved, and Escape renamed to whatever had been typed. This input has two
  // parents, `FileTreeRowBody` above and `CreateInputRow` (FileTreeNode.tsx). `FileTree.tsx` gives them
  // the handlers of `useFileTreeRename` and `useFileTreeCrud`, and each of those handlers clears the state
  // that mounts this input on every path, before awaiting anything. So no input ever needs a second
  // outcome, and one that did would have to be mounted anew.
  const decided = useRef(false);
  const decide = (outcome: () => void): void => {
    if (decided.current) return;
    decided.current = true;
    outcome();
  };
  return (
    <input
      autoFocus={!defaultValue}
      className="file-tree-rename-input"
      defaultValue={defaultValue}
      onBlur={(e) => {
        const val = e.target.value;
        decide(() => {
          if (defaultValue !== undefined) {
            onConfirm(val);
          } else {
            if (val.trim()) onConfirm(val);
            else onCancel();
          }
        });
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const val = (e.target as HTMLInputElement).value;
          decide(() => onConfirm(val));
        } else if (e.key === "Escape") {
          e.preventDefault();
          decide(onCancel);
        }
        e.stopPropagation();
      }}
      placeholder={placeholder}
      ref={inputRef}
    />
  );
}
