---
title: "Using plugins"
---


Baram can be extended with plugins, managed from **Settings > Plugins**.

- **Browse** — Discover plugins from the registry. Click any plugin to open its **detail page** in
  an editor tab, with the full description, its rendered README, the capabilities it asks for, and
  links to its repository and homepage.
- **Installed** — Everything currently installed, grouped by where it came from: **Built-in**
  (ships with Baram), **From the registry** (installed from the marketplace), and **In
  development** (a local folder you loaded yourself).
- **Updates** — Check for and apply plugin updates.

## Turning plugins on and off

Every plugin has an **On / Off** toggle, built-in ones included — so you can switch off a bundled
feature you do not want, such as the Media Viewer, and your choice is remembered across restarts.
Plugins activate and deactivate one at a time; if one fails to start, the failure is reported on
that plugin's row instead of failing silently.

## Capabilities and trust

Each plugin declares the **capabilities** (permissions) it needs — access to the editor, files, commands, UI, and so on. You review and approve these before installing, and downloads are checksum-verified.

Plugins come in two kinds, and the difference matters:

- **Sandboxed** (the default, and the only kind a community plugin can be) — the plugin's code runs isolated from the editor, and every privileged action is checked against the capabilities you approved. A misbehaving sandboxed plugin cannot crash the editor or reach anything it did not declare.
- **Full trust** — the plugin runs inside Baram itself with no isolation. Its capability list describes what it intends to do but does **not** limit it: it can read and write any file your account can reach, contact any network host, and use every credential the app holds. Baram shows a red warning and requires a separate confirmation before installing one.

> **Upgrading from v0.4.x?** Plugins installed before v0.5.0 predate this model and can no longer be loaded. Use **Remove** on the Installed tab, then install again from the marketplace if a current version is published.

Installation is a staged, all-or-nothing transaction: the download is unpacked and validated
somewhere else first and only swapped into place once every check passes, so a failed or
interrupted install cannot leave you with a half-written plugin.

## Where a plugin comes from

The marketplace lists plugins from two places, and every card says which:

- **Baram** — plugins Baram publishes itself. They may be sandboxed or full trust.
- **Community** — plugins published by someone else, shown with the author's name and the
  publisher's GitHub account (`@name`). Community plugins are always sandboxed: this version
  of Baram does not install one that asks for full trust. Baram does not review their code —
  the capabilities you approve are everything a community plugin can do, and the install
  dialog says so.

The publisher is remembered with your approval. If a later update of a community plugin
comes from a **different GitHub account**, Baram asks again before installing it and shows
the change (`@old → @new`), even when the plugin asks for nothing new. An account that was
only renamed is the same account and does not ask.

Plugins you installed before Baram showed where plugins come from carry no **Baram** or
**Community** mark on the **Installed** tab until their next update.

## Withdrawn plugins

A plugin version can be **withdrawn** after you have already installed it — because a security
issue was found in it, or because it was pulled by its author. Baram fetches a signed withdrawal
list and checks your installed plugins against it.

A plugin withdrawn as harmful is marked **Withdrawn** in the list and **is not run**, with the
reason shown.
Its files are left exactly where they are — nothing is deleted behind your back — and a **Remove
it** action is offered. Where the report is a vulnerability rather than a withdrawal, the plugin
keeps running and you are told to update when a newer version appears.

A version its author pulled, or that was otherwise taken off the registry, is left alone where
you already installed it: it keeps working and is not marked. The marketplace no longer lists
that version, and Baram refuses to install it. Whatever the reason, a withdrawn version is not
offered as an update.

Baram tells you when it cannot rely on that list: if the list has never been received, or could
not be signature-verified, or has not been updated in a long time, it says so rather than quietly
implying that everything you have is fine.

To build your own plugin, see the [Plugin Development Guide](/en/docs/plugin-dev/overview-and-capabilities/) for the manifest format, the `ExtensionContext` API, and bundling/publishing.

---
