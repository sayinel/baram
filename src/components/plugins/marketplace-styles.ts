// §69 — the marketplace shell's own chrome, as inline style objects.
//
// Module-level constants so no new object reference is created on every render, and a
// sibling module so the shell itself stays readable.
//
// ‼️ Deliberately still INLINE rather than migrated to `plugins.css` (Task 12 backlog).
// Doing that in the same commit that moved the §260/#261 install handlers would blur the
// only question this change has to answer — did that logic move unchanged? The 16 keys the
// old Installed-tab markup used were deleted outright; `plugin-row`/`plugin-section` in
// `plugins.css` cover that surface now.
import type React from "react";

export const STYLES = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  } as React.CSSProperties,
  header: { padding: "12px 16px 0" } as React.CSSProperties,
  title: {
    margin: "0 0 12px",
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--color-text-primary)",
  } as React.CSSProperties,
  tabBar: {
    display: "flex",
    gap: "0",
    borderBottom: "1px solid var(--color-border-default)",
    marginBottom: "8px",
  } as React.CSSProperties,
  searchInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "6px",
    fontSize: "13px",
    border: "1px solid var(--color-border-default)",
    backgroundColor: "var(--color-bg-default)",
    color: "var(--color-text-primary)",
    outline: "none",
    boxSizing: "border-box",
    marginBottom: "8px",
  } as React.CSSProperties,
  content: { flex: 1, overflowY: "auto" } as React.CSSProperties,
  centeredMessage: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--color-text-muted)",
    fontSize: "13px",
  } as React.CSSProperties,
  errorMessage: {
    padding: "16px",
    textAlign: "center",
    color: "var(--color-text-muted)",
    fontSize: "13px",
  } as React.CSSProperties,
  errorSubtext: { fontSize: "12px", opacity: 0.7 } as React.CSSProperties,
  retryButton: {
    marginTop: "8px",
    padding: "6px 12px",
    borderRadius: "6px",
    fontSize: "12px",
    cursor: "pointer",
    backgroundColor: "var(--color-accent-solid)",
    color: "var(--color-accent-on-solid)",
    border: "none",
  } as React.CSSProperties,
  loadingMessage: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--color-text-muted)",
    fontSize: "13px",
  } as React.CSSProperties,
  tabButtonActive: {
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--color-accent-default)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    borderBottom: "2px solid var(--color-accent-default)",
    marginBottom: "-1px",
  } as React.CSSProperties,
  tabButtonInactive: {
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 400,
    color: "var(--color-text-muted)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    marginBottom: "-1px",
  } as React.CSSProperties,
  refreshButton: {
    marginLeft: "auto",
    marginBottom: "-1px",
    padding: "6px 12px",
    fontSize: "12px",
    backgroundColor: "transparent",
    border: "none",
  } as React.CSSProperties,
};
