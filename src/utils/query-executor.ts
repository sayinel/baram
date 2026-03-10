// §5.13 Query Executor — executes queries against a list of vault files
import type { QueryDef, QueryFilter, QuerySort } from "./query-parser";

export type { QueryDef, QueryFilter, QuerySort };

export interface VaultFile {
  content?: string; // lazy-loaded, only needed for body search
  createdAt?: number;
  frontmatter: Record<string, unknown>;
  modifiedAt: number; // Unix timestamp in ms
  name: string;
  path: string;
  tags: string[];
}

export function applyFilters(
  files: VaultFile[],
  filters: QueryFilter[],
): VaultFile[] {
  if (filters.length === 0) return files;

  // Split filters into OR-separated groups.
  // Each group is an array of AND conditions that all must be true.
  // A file matches if any group fully matches.
  const groups: QueryFilter[][] = [];
  let current: QueryFilter[] = [];

  for (const filter of filters) {
    if (filter.combinator === "OR" && current.length > 0) {
      groups.push(current);
      current = [filter];
    } else {
      current.push(filter);
    }
  }
  groups.push(current);

  return files.filter((file) =>
    groups.some((group) => group.every((f) => matchesFilter(file, f))),
  );
}

export function applySort(
  files: VaultFile[],
  sort: null | QuerySort,
): VaultFile[] {
  const result = [...files];
  if (!sort) return result;

  const { field, direction } = sort;
  const sign = direction === "asc" ? 1 : -1;

  result.sort((a, b) => {
    if (field === "updated_at") {
      return (a.modifiedAt - b.modifiedAt) * sign;
    }
    if (field === "created_at") {
      return ((a.createdAt ?? 0) - (b.createdAt ?? 0)) * sign;
    }
    if (field === "name") {
      return a.name.localeCompare(b.name) * sign;
    }
    if (field === "path") {
      return a.path.localeCompare(b.path) * sign;
    }
    // Frontmatter key
    const av = String(a.frontmatter[field] ?? "");
    const bv = String(b.frontmatter[field] ?? "");
    return av.localeCompare(bv) * sign;
  });

  return result;
}

export function executeQuery(files: VaultFile[], query: QueryDef): VaultFile[] {
  const filtered = applyFilters(files, query.filters);
  const sorted = applySort(filtered, query.sort);
  return sorted.slice(0, query.limit);
}

export function matchesFilter(file: VaultFile, filter: QueryFilter): boolean {
  const { field, operator, value } = filter;

  if (field === "tags") {
    if (operator === "contains") return file.tags.includes(value);
    if (operator === "not_contains") return !file.tags.includes(value);
    return false;
  }

  if (field === "path") {
    if (operator === "starts") return file.path.startsWith(value);
    if (operator === "contains") return file.path.includes(value);
    if (operator === "regex") return new RegExp(value).test(file.path);
    return false;
  }

  if (field === "body") {
    if (operator === "contains") {
      return (
        file.content !== undefined &&
        file.content.toLowerCase().includes(value.toLowerCase())
      );
    }
    return false;
  }

  if (field === "updated_at" || field === "created_at") {
    const fileTime =
      field === "updated_at" ? file.modifiedAt : (file.createdAt ?? 0);
    const compareTime = new Date(value).getTime();
    if (operator === "before") return fileTime < compareTime;
    if (operator === "after") return fileTime > compareTime;
    return false;
  }

  // Frontmatter field
  const fmValue = file.frontmatter[field];
  if (operator === "empty") {
    return fmValue === null || fmValue === undefined || fmValue === "";
  }
  if (operator === "=") return String(fmValue ?? "") === value;
  if (operator === "!=") return String(fmValue ?? "") !== value;
  if (operator === "contains") return String(fmValue ?? "").includes(value);

  return false;
}
