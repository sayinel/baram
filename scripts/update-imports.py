#!/usr/bin/env python3
"""
TypeScript import path updater for file reorganization.
Resolves all relative imports dynamically — handles every depth variant.

Usage: python3 scripts/update-imports.py [--dry-run]
"""

import os
import re
import glob
import sys
from pathlib import Path

SRC_ROOT = Path("src").resolve()

DRY_RUN = "--dry-run" in sys.argv

# All file moves: src-relative source -> src-relative dest
MOVES = {
    # Group: journal (14 files)
    "utils/journal.ts": "utils/journal/journal.ts",
    "utils/journal-capture.ts": "utils/journal/journal-capture.ts",
    "utils/journal-memories.ts": "utils/journal/journal-memories.ts",
    "utils/journal-mood.ts": "utils/journal/journal-mood.ts",
    "utils/journal-periodic.ts": "utils/journal/journal-periodic.ts",
    "utils/journal-photo.ts": "utils/journal/journal-photo.ts",
    "utils/journal-prompts.ts": "utils/journal/journal-prompts.ts",
    "utils/journal-reflection.ts": "utils/journal/journal-reflection.ts",
    "utils/journal-search.ts": "utils/journal/journal-search.ts",
    "utils/journal-stats-cache.ts": "utils/journal/journal-stats-cache.ts",
    "utils/journal-stats.ts": "utils/journal/journal-stats.ts",
    "utils/journal-tags.ts": "utils/journal/journal-tags.ts",
    "utils/journal-templates.ts": "utils/journal/journal-templates.ts",
    "utils/journal-themes.ts": "utils/journal/journal-themes.ts",
    # Group: skill (7 files)
    "utils/skill-chain-runner.ts": "utils/skill/skill-chain-runner.ts",
    "utils/skill-compatibility-prompt.ts": "utils/skill/skill-compatibility-prompt.ts",
    "utils/skill-dependency-analyzer.ts": "utils/skill/skill-dependency-analyzer.ts",
    "utils/skill-frontmatter.ts": "utils/skill/skill-frontmatter.ts",
    "utils/skill-generator-prompt.ts": "utils/skill/skill-generator-prompt.ts",
    "utils/skill-optimize-prompt.ts": "utils/skill/skill-optimize-prompt.ts",
    "utils/skill-test-runner.ts": "utils/skill/skill-test-runner.ts",
    # Group: export (5 files)
    "utils/export-html.ts": "utils/export/export-html.ts",
    "utils/export.ts": "utils/export/export.ts",
    "utils/notion-export.ts": "utils/export/notion-export.ts",
    "utils/notion-katex-compat.ts": "utils/export/notion-katex-compat.ts",
    "utils/pandoc-export.ts": "utils/export/pandoc-export.ts",
}

# Build absolute path lookup
OLD_ABS_TO_NEW: dict[Path, Path] = {
    SRC_ROOT / old: SRC_ROOT / new
    for old, new in MOVES.items()
}


def resolve_relative_import(file_abs: Path, spec: str) -> Path | None:
    """Resolve a relative import spec to absolute .ts/.tsx path (old location)."""
    target_base = (file_abs.parent / spec).resolve()
    for ext in [".ts", ".tsx"]:
        candidate = Path(str(target_base) + ext)
        if candidate.exists():
            return candidate
    return None


def strip_ext(path: Path) -> Path:
    for ext in [".tsx", ".ts"]:
        if str(path).endswith(ext):
            return Path(str(path)[: -len(ext)])
    return path


def compute_rel_import(from_dir: Path, to_file: Path) -> str:
    """Compute relative import string from from_dir to to_file (no extension)."""
    rel = os.path.relpath(strip_ext(to_file), from_dir)
    if not rel.startswith("."):
        rel = "./" + rel
    # Normalize slashes on Windows
    return rel.replace("\\", "/")


def effective_from_dir(file_abs: Path) -> Path:
    """Get the directory this file will live in AFTER all moves."""
    rel = str(file_abs.relative_to(SRC_ROOT))
    if rel in MOVES:
        return (SRC_ROOT / MOVES[rel]).parent
    return file_abs.parent


IMPORT_RE = re.compile(r"""((?:from|import)\s+['"])(\.[^'"]+)(['"])""")


def update_file_imports(file_abs: Path) -> list[tuple[str, str]]:
    """
    Update all relative imports in file_abs.
    Returns list of (old_spec, new_spec) for changed imports.
    """
    content = file_abs.read_text(encoding="utf-8")
    rel_str = str(file_abs.relative_to(SRC_ROOT))
    this_file_moves = rel_str in MOVES
    eff_from = effective_from_dir(file_abs)

    replacements: list[tuple[str, str]] = []

    def replace(m: re.Match) -> str:
        prefix, spec, suffix = m.group(1), m.group(2), m.group(3)

        if not spec.startswith("."):
            return m.group(0)

        resolved = resolve_relative_import(file_abs, spec)
        if resolved is None:
            return m.group(0)

        if resolved in OLD_ABS_TO_NEW:
            # Import target is moving → recompute path to new location
            new_target = OLD_ABS_TO_NEW[resolved]
            new_spec = compute_rel_import(eff_from, new_target)
            if new_spec != spec:
                replacements.append((spec, new_spec))
                return f"{prefix}{new_spec}{suffix}"

        elif this_file_moves:
            # This file is moving, target is NOT → recompute from new location
            new_spec = compute_rel_import(eff_from, resolved)
            if new_spec != spec:
                replacements.append((spec, new_spec))
                return f"{prefix}{new_spec}{suffix}"

        return m.group(0)

    new_content = IMPORT_RE.sub(replace, content)

    if replacements and not DRY_RUN:
        file_abs.write_text(new_content, encoding="utf-8")

    return replacements


# ── Main ──────────────────────────────────────────────────────────────────────

ts_files = sorted(
    glob.glob("src/**/*.ts", recursive=True)
    + glob.glob("src/**/*.tsx", recursive=True)
)

total_files = 0
total_imports = 0

for f in ts_files:
    path = Path(f).resolve()
    changes = update_file_imports(path)
    if changes:
        total_files += 1
        total_imports += len(changes)
        print(f"  {'[DRY] ' if DRY_RUN else ''}{'→ ' if path.relative_to(SRC_ROOT) and str(path.relative_to(SRC_ROOT)) in MOVES else '  '}{f}")
        for old, new in changes:
            print(f"        {old!r:50s} → {new!r}")

print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}Updated {total_imports} imports in {total_files} files.")
if DRY_RUN:
    print("Run without --dry-run to apply changes.")
