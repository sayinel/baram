---
title: "Publishing to the community registry"
---

Anyone with a personal GitHub account can publish a sandboxed plugin to
Baram's marketplace. In Baram versions that read the community registry, it is
listed next to Baram's own plugins, marked **Community**, with your GitHub
account shown as its publisher.

You keep the source and the releases in your own repository. The registry
keeps its own copy of each release and serves it from its own address, and the
bytes of a published version never change.

## What the community registry accepts

- **Sandboxed plugins only** — `"trust": "sandboxed"` in `baram-plugin.json`.
  A sandboxed plugin runs in its own webview and can do only what its
  capabilities allow ([Trust model, security, and errors](/en/docs/plugin-dev/trust-model-and-errors/)).
  Trusted plugins, which includes every plugin that declares
  `tiptapExtensions`, cannot be submitted yet.
- **A public repository owned by your personal account.** Repositories owned
  by an organization are not accepted yet.
- **An id that does not start with `baram-`.** That prefix is reserved for
  Baram's own plugins. An id is lowercase letters, digits and hyphens, and
  starts with a letter or a digit.

Baram does not review your code: the check reads your ZIP as data and never
runs your code or scans it for what it does. Users see the capabilities your
plugin asks for before they install it, and that list is everything it can do.

## 1. Start from the template

Copy
[`examples/plugins/community-template`](https://github.com/sayinel/baram/tree/main/examples/plugins/community-template)
into a new repository and follow its README. In `baram-plugin.json`, give the
plugin your own `id`, `name`, `description` and `author`, keep
`"trust": "sandboxed"`, declare only the capabilities your code uses, and set
`engines.baram` to the oldest Baram your plugin runs on
([Version floor](/en/docs/plugin-dev/manifest/#version-floor)).

## 2. Publish a GitHub Release

The template includes `.github/workflows/release.yml`. Push a tag that names
the version in `baram-plugin.json`, such as `v1.0.0`, and the workflow checks
that the two agree, builds the plugin, zips `baram-plugin.json`, `dist/` and
`README.md` with the manifest at the root, creates the Release, and writes the
descriptor for the next step — SHA-256 included — to the run's summary.

By hand: `zip -r hello-counter-1.0.0.zip baram-plugin.json dist README.md`,
then `shasum -a 256` the ZIP. Other ZIP tools, Finder's Compress included,
can write what the check refuses (step 6); on Windows, use the release workflow.

**Do not replace a release asset after you submit it.** Publishing downloads
the asset again and checks its SHA-256; if the bytes changed, nothing is
published. Release a new version instead.

## 3. Open a pull request

Fork [`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins) and
add exactly one file, `community/<id>.json`:

```json
{
  "id": "hello-counter",
  "publisher": "octocat",
  "repo": "octocat/baram-hello-counter",
  "release": {
    "tag": "v1.0.0",
    "asset": "hello-counter-1.0.0.zip",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

- `publisher` is your GitHub login, and `repo` is `<login>/<repository>`, both
  spelled exactly as GitHub spells them.
- `release.tag` is the tag (`v1.0.0` or `1.0.0`), `release.asset` the ZIP's
  file name, and `release.sha256` its SHA-256 in lowercase hexadecimal.
- No other field is accepted. The version, name and capabilities come from the
  manifest inside the ZIP.

## 4. What the check verifies

The `validate` check on your pull request runs the community gate: these steps,
in order, stopping at the first that fails. Its log names that step and the
reason, as in `✗ community gate step 5: …`.

0. The pull request changes exactly one file, `community/<id>.json`, and only
   adds or modifies it.
1. The descriptor is at most 4 KiB.
2. The descriptor is UTF-8 JSON with no backslash, no repeated key and no
   field beyond those above. The id follows the id rule, is not reserved, and
   matches the file name; the owner in `repo` is `publisher`; the tag, the
   asset name (letters, digits, `.`, `_`, `-`, ending in `.zip`) and the
   SHA-256 have the forms above.
3. You own the repository: `repo` spells it as GitHub does, it is public, it
   belongs to a personal account, and that account opened the pull request.
   This compares numeric GitHub ids, not names. An update must come from the
   account, and name the repository, recorded for the published plugin. An
   id that is merged but not yet published can be changed only by the account
   whose pull request first added it; a maintainer can release such an id by
   deleting its descriptor.
4. No plugin or theme in Baram's own `index.json` uses the id.
5. The asset downloads from
   `https://github.com/<repo>/releases/download/<tag>/<asset>` — redirects are
   followed only to GitHub's release-asset host — within the app's 32 MiB
   download limit, and its SHA-256 matches `release.sha256`.
6. The ZIP is one the app installs, read more strictly than the app reads it.
   Among its rules:
   - `baram-plugin.json` is at the root, and `main` names a file in the ZIP.
   - At most 2,000 entries and 16 path components; each file at most 64 MiB
     expanded, and all of them at most 256 MiB and at most 100 times the ZIP's
     own size (or 1 MiB, if that is more); stored or deflated entries only; no
     symbolic links and no encryption.
   - Each part of a name uses only ASCII letters, digits, `_`, `-` and `.`,
     and neither starts nor ends with `.`. Windows device names such as `con`
     or `nul` are refused with or without an extension, and so are two names
     that differ only in case.
   - No extra fields other than the timestamps and Unix ids `zip -r` writes.
   - Exactly one end-of-central-directory record, ending the file, with no
     archive comment. Compressed data that happens to contain that record's
     four-byte signature is refused too. It is rare; if it happens, zip the
     plugin again at another compression level.
   - A `README.md` at the root is at most 256 KiB, the most the app reads to
     show it.
7. The manifest passes Baram's own validator, is sandboxed, has the
   descriptor's id and a version written `X.Y.Z` that the tag names, and
   writes `engines.baram` as `>=X.Y.Z`.
8. The `community.json` entry this version would publish passes the
   registry's validator. Among its rules: the name is 1–100 characters and not
   blank, and the name, description and author contain no control characters
   (line breaks and tabs included) or bidirectional-override characters.
9. The version is higher than the one already published.

A pull request that passes logs `✓ community gate: <id> <version> → auto-merge`,
or `→ needs-review` followed by the reasons a maintainer has to look.

## 5. Review, merge and publishing

- A maintainer reviews a **new id** until its first version is published,
  looking for names or ids that impersonate Baram or another project, a
  description that matches the capabilities, and a public repository with a
  LICENSE and a README.
- A **later version merges itself** unless it asks for a capability the
  published version lacked, or changes `name`, `author`, `description`,
  `icon`, `homepage`, `publisher` or `repo`; any of those waits for a
  maintainer. A grant of `files` covers `files:readonly`, and `editor` covers
  `editor:readonly`. A change to `license`, `keywords`, `engines.baram` or the
  README alone merges itself.
- After the merge, the registry's publish job, on its next run, downloads the
  asset again and checks it against `release.sha256`. It then copies the ZIP
  to `plugins/<id>-<version>.zip` and the README to
  `readme/<id>-<version>.md`, and adds the entry to `community.json`
  ([the file's shape](/en/docs/plugin-dev/registry-json-shape/#communityjson)).
  It lands that change through a pull request it opens, validates and merges
  itself; the `community-publish/…` branches in the registry repository belong
  to it.

For the template, with its author filled in, the entry is:

```json
{
  "id": "hello-counter",
  "name": "Hello Counter",
  "description": "Shows the current document's character count in the status bar.",
  "version": "1.0.0",
  "author": "Octo Cat",
  "license": "MIT",
  "downloadUrl": "https://sayinel.github.io/baram-plugins/plugins/hello-counter-1.0.0.zip",
  "checksum": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "trust": "sandboxed",
  "engines": { "baram": ">=0.6.1" },
  "icon": "🔤",
  "readme": "https://sayinel.github.io/baram-plugins/readme/hello-counter-1.0.0.md",
  "publisher": "octocat",
  "publisherId": 583231,
  "repoId": 123456789,
  "repository": "https://github.com/octocat/baram-hello-counter"
}
```

Baram reads `community.json` from the same registry as its own `index.json`,
and never downloads from your repository.

## Updating, renaming and withdrawing

- **A new version:** raise `version`, release it, and open a pull request that
  changes the `release` fields of your descriptor.
- **Renaming your account or the repository:** your identity is your account's
  numeric id and the repository's, and both survive a rename. Write the new
  names in `publisher` and `repo` with your next version; that version waits
  for a maintainer, because the marketplace shows both.
- **Moving the plugin to another repository or account** needs a maintainer:
  open an issue in `sayinel/baram-plugins`.
- **Withdrawing a plugin:** open an issue there. Withdrawal goes through the
  signed revocation list: Baram then refuses to install the plugin — one
  withdrawn at your request also leaves the marketplace's list — and for a
  harmful one also refuses to load the copies already installed. Deleting a
  descriptor withdraws nothing. A pull request that only deletes descriptors
  never merges itself, and a maintainer merges one only to release an id that
  was merged but never published; a published plugin keeps its entry.
