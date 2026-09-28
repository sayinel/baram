# Baram community plugin template

A sandboxed Baram plugin that shows the current document's character count in the status bar,
ready to publish to the community registry.

## Make it yours

1. Copy this directory into a new repository, **together with** `examples/plugins/plugin-api.d.ts`
   and `examples/plugins/types.d.ts` from the Baram repository. Put those two next to `src/` and
   change the import in `src/index.ts` to `../plugin-api`, and the `include` in `tsconfig.json`
   to `["src", "plugin-api.d.ts", "types.d.ts"]`.
2. In `baram-plugin.json`, set your own `id` (lowercase letters, digits and hyphens, starting
   with a letter or digit, not with `baram-`), `name`, `description` and `author`. Keep
   `"trust": "sandboxed"`. Declare only the capabilities your code uses.
3. Add a `LICENSE` file for the license you name in `license`, and replace this README with
   your plugin's own: it ships inside the ZIP, and Baram shows it on the plugin's page.
4. `npm install`, then `npm run build`.
5. Try it in Baram: open **Settings → Plugins**, and in the **Developer** section turn on
   **Developer mode** (a release build starts with it off; a development build has no switch),
   then use **Load dev plugin folder** to pick this folder.

## Publish

Push a tag that matches `version`, such as `v1.0.0`. `.github/workflows/release.yml` builds the
ZIP, publishes the Release and prints the descriptor. Then open a pull request to
[sayinel/baram-plugins](https://github.com/sayinel/baram-plugins) that adds that descriptor as
`community/<id>.json`.

The full guide: https://baram.ing/en/docs/plugin-dev/community-registry/
