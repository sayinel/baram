---
title: "Vaults and folder access"
---


## What is a Vault?

A **vault** is a folder that Baram treats as a first-class workspace. When a folder contains a `.baram/config.json` file, Baram recognizes it as a vault and enables additional features: vault-level settings, Journal integration, and cross-vault linking.

A regular folder opened in Baram works fine without being a vault — vaults simply unlock extra capabilities.

To initialize a folder as a vault, go to **Settings > Vault** and click **Initialize as Vault**. To revert back to a plain folder, click **Revert to Folder** (this removes `.baram/config.json` but leaves your files untouched).

## Context Types

Baram has three context types, shown as tabs in the **Context Tab Bar** across the top of the window:

| Context | Icon | Description |
| ------- | ---- | ----------- |
| **Vault** | 🏠 | A fully initialized vault folder (has `.baram/config.json`) |
| **Folder** | 📁 | A plain folder opened without vault initialization |
| **File** | 📄 | A single file opened outside any workspace folder |

Each context is independent — it has its own file tree, settings, and tab history.

## Opening and Switching Vaults

- **Open a vault**: Use **File > Open Folder** (`Cmd+Shift+O` / `Ctrl+Shift+O`) and select a folder. If it contains `.baram/config.json`, it opens as a vault context.
- **Switch between contexts**: Click the tabs in the Context Tab Bar across the top of the window. Each tab shows the vault/folder name and its context icon.
- **Close a context**: Right-click a context tab and select **Close**.

Multiple vaults can be open simultaneously, each as its own tab in the Context Tab Bar.

## Journal and Vaults

The Journal feature integrates with vaults. Each vault can have its own journal directory configured in **Settings > Vault > Journal Directory**. When you switch to a vault context, the Calendar sidebar and date links (`[[2026-02-27]]`) create journal entries in that vault's journal directory.

---

## Folder Access Approval

Baram asks before it reads a location it has not been allowed into. The first time you open a folder or a file outside an already-approved location, a dialog appears — *Allow Baram to read and write this folder and everything under it?* — with **Allow** and **Deny**.

- An approved **folder** covers everything beneath it, so you are asked once per workspace, not once per file.
- An approved **single file** covers that file and images sitting in the same folder, so the pictures in it still render.
- **Denying is not an error.** The location simply does not open and a toast says so. Nothing is recorded, so you can pick the same folder again later and be asked again.
- Choosing a folder yourself through **File > Open Folder** is the approval — the act of picking it in the system dialog is what grants access.
- At startup, a saved context that is no longer approved is asked for again. If you deny it, **only that context is skipped** and the rest of your workspace still restores.

Approvals are recorded by Baram itself, in its application data directory — not inside your vault and not in any file the editor can write, so a document or plugin cannot approve locations on your behalf.

**Settings > Vault > Approved locations** lists everything you have approved and lets you **Revoke** any of it. Revoking removes the approval and closes that vault's tab; it takes full effect after a restart.

> On macOS this is separate from the system's own **Files and Folders** permission prompt, which is macOS asking on behalf of every app. You may see both once: macOS deciding whether Baram may touch Documents or Desktop at all, and Baram deciding which folder you meant to open. See the [FAQ](/baram/en/docs/faq/general/) if a folder opens but shows no files.
