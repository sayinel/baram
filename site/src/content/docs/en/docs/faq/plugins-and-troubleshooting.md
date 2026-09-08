---
title: "Plugins and troubleshooting"
---

## Plugins

### Does Baram support plugins?

Yes. Open **Settings > Plugins** to browse, install, update, and manage plugins. The tab has three sections: Browse (discover plugins), Installed (everything you have, grouped into Built-in, Community, and In development), and Updates (apply new versions).

Clicking a plugin opens its detail page in an editor tab, with the full description, its rendered
README, the capabilities it asks for, and links to its repository and homepage.

### Can I turn off a plugin that ships with Baram?

Yes. Built-in plugins — the Media Viewer, for example — have the same **On / Off** toggle as any
other, and your choice is remembered across restarts. Turning one off deactivates it without
uninstalling anything.

### One of my plugins says "Withdrawn"

A plugin version can be withdrawn after you install it, either because a security issue was found
or because its author pulled it. Baram checks your installed plugins against a signed withdrawal
list, marks that plugin **Withdrawn**, shows the reason, and **does not run it**.

Its files are left where they are — nothing is deleted without you — and a **Remove it** action is
offered. If the report is a vulnerability rather than a withdrawal, the plugin keeps running and
Baram asks you to update once a newer version is published.

Baram also tells you when it cannot trust that list — if it has never been received, could not be
signature-verified, or has gone stale — rather than implying everything is fine.

### Are plugins safe?

Plugins are capability-gated: each declares the permissions it needs (editor, files, commands, UI, etc.), and you review and approve them before installing. Downloads are verified with a SHA-256 checksum, and installation is staged — unpacked and validated elsewhere, then swapped into place only once every check passes — so an interrupted install cannot leave a half-written plugin behind.

How strongly that approval is enforced depends on the plugin's kind:

- **Sandboxed** — the default, and the only kind published in the marketplace. The plugin's code is isolated from the editor and every privileged action is checked against the capabilities you approved, so the list you saw is a real boundary.
- **Full trust** — runs inside Baram itself with no isolation. The capability list describes what such a plugin intends to do but does not limit it; it can reach any file your account can, any network host, and every credential the app holds. Baram shows a red warning and asks for a separate confirmation before installing one, so you cannot get there by accident.

### I updated Baram and my plugin stopped working

Plugins installed with **v0.4.x** cannot be loaded by v0.5.0 or later. Those versions installed
plugins before Baram had a plugin trust model, so the installed copy does not record whether it
runs sandboxed or with full trust — and Baram will not run a plugin whose kind it cannot
determine. You will see an error on the plugin in **Settings > Plugins > Installed**.

Checking for updates does not fix it, because the plugin has to be re-approved rather than
upgraded. Use **Remove** on the Installed tab, then install it again from the marketplace if a
current version is published there. Some plugins from that era have not been republished; for
those, removing the old copy is all there is to do.

This applies once, to plugins installed before v0.5.0. Anything installed since is unaffected.

### How do I build a plugin?

See the [Plugin Development Guide](/en/docs/plugin-dev/overview-and-capabilities/). A plugin is a directory with a `baram-plugin.json` manifest and an ESM entry point, using the `ExtensionContext` API to add commands, Tiptap extensions, UI, and more.

---

## Troubleshooting

### The app won't start

- **macOS**: Builds from v0.6.0 on are notarized and should open normally. A "damaged" or "can't verify" warning means the copy you have is older, or the download was corrupted — re-download the current release. The prompt asking you to confirm an app downloaded from the internet is normal and not an error.
- **Windows**: If SmartScreen blocks the app, click "More info" then "Run anyway"
- **Linux**: Make sure the AppImage has execute permissions: `chmod +x Baram-*.AppImage`

### macOS asks for folder access

macOS shows a system permission prompt the first time an app reads files in a protected location — **Documents, Desktop, Downloads, or iCloud Drive**. Allow it once and the grant is remembered, including across updates.

**Upgrading from v0.5.x or earlier?** You will be asked once more, even though you already allowed it. Those builds were ad-hoc signed, which gave the app no identity that survived a rebuild, so macOS treated every version as a different app and re-asked every time. From v0.6.0 Baram is signed with an Apple Developer ID certificate, and the identity is stable — this is the last time you should see it.

If the prompt still repeats on v0.6.0 or later, grant **Full Disk Access** under **System Settings > Privacy & Security**, or keep your vault outside the protected folders (e.g. `~/Notes`).

This is macOS asking, not Baram. Baram has a separate approval of its own for the folder you opened — see [Why does Baram ask permission before opening a folder?](/en/docs/faq/appearance-and-workspace/#why-does-baram-ask-permission-before-opening-a-folder).

### The editor feels slow

- **Large files**: Files over 10,000 lines may take up to 1 second to open. Consider splitting very large files
- **Many code blocks**: Each code block runs a CodeMirror instance. Documents with many code blocks use more memory
- **Math rendering**: Complex LaTeX formulas render quickly (under 50ms), but documents with hundreds of math blocks may affect scrolling performance

### Keyboard shortcuts aren't working

- Make sure you're focused on the editor area (click in the editor first)
- On macOS, check that the system hasn't assigned the same shortcut to another action in **System Preferences > Keyboard > Shortcuts**
- Some shortcuts change behavior based on context: `Cmd+K` opens the Quick Switcher, and AI inline editing is accessed via the Floating Toolbar when text is selected

### My markdown file looks different after editing

Baram preserves your markdown with lossless roundtrip fidelity. If something looks different, it may be because:

- Trailing whitespace was normalized
- The file used non-standard markdown syntax that Baram doesn't support
- **A reference-style link was rewritten inline.** `[label][ref]` with a `[ref]: url` definition
  elsewhere loads as the link it names and saves as `[label](url)` — the destination and the words
  survive, the reference form does not

If you believe there's a roundtrip bug, please [report it on GitHub](https://github.com/sayinel/baram/issues).

### Wikilinks aren't working

- Make sure you have a workspace (folder) open — wikilinks link to files within your workspace
- File names are matched case-insensitively
- If autocomplete doesn't show a file, check that the file exists in your workspace folder

### Where are the log files?

Baram writes a plain-text log as it runs. Attaching it to a bug report saves a lot of guesswork:

- **macOS**: `~/Library/Logs/com.inel.baram/baram.log`
- **Windows**: `%LOCALAPPDATA%\com.inel.baram\logs\baram.log`
- **Linux**: `~/.local/share/com.inel.baram/logs/baram.log`

Each launch appends a line naming the version, so one file usually covers several sessions. It rotates at 2 MB, and up to two older files are kept beside it, named `baram_<date>_<time>.log`. Timestamps are UTC.

The log holds Baram's own diagnostics — a file it could not read, a plugin it refused to load, and similar. Your API keys are never written to it. **Names are**, though: file and folder paths, plugin ids, and text taken from a document when something in it could not be loaded — a broken image path, for instance. So a log line can quote a piece of a note, and the paths reveal how your vault is organised. Have a look before posting it in a public issue.

---

See the [User Guide](/en/docs/getting-started/) and [Keyboard Shortcuts](/en/docs/customization/keyboard-shortcuts/) for more information.
