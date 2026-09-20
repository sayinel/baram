// §0054 — the recommended colours a `color` settings field offers.
//
// WHY THE APP OWNS THIS LIST, not the plugin: a swatch's whole value is that the colour it
// stores follows the user's theme. `var(--color-accent-default)` is one string in light mode
// and another rendered colour in dark, and a plugin cannot know which tokens this build has.
// Letting a manifest name its own swatches would also put author-chosen colours into the
// app's own settings pane with nothing constraining them.
//
// WHY THERE IS NO `<input type="color">` BESIDE THEM: it can only hold `#rrggbb`. Shown next
// to a token-valued field it would display some unrelated hex — it cannot resolve
// `var(--color-accent-default)` — and touching it would silently convert a theme-following
// value into a fixed one. A user who wants an arbitrary colour types it into the text input;
// what is lost is a colour wheel, and what is kept is that the default follows the theme.
//
// ‼️ EVERY TOKEN BELOW WAS CHECKED IN BOTH `tokens/semantic/color-light.json` AND
// `color-dark.json`. A token defined in only one of them renders as an invalid value in the
// other, which is a blank swatch the user cannot tell from a dark one. If you add a swatch,
// check both files — the generated CSS is what the app reads, and it never fails loudly.

export interface SettingColorSwatch {
  /** i18n key for the visible name. */
  labelKey: string;
  /** What gets STORED when this swatch is picked — a token reference, not a resolved colour. */
  value: string;
}

export const SETTING_COLOR_SWATCHES: readonly SettingColorSwatch[] = [
  {
    labelKey: "plugin.settings.color.accentDefault",
    value: "var(--color-accent-default)",
  },
  {
    labelKey: "plugin.settings.color.textPrimary",
    value: "var(--color-text-primary)",
  },
  {
    labelKey: "plugin.settings.color.textMuted",
    value: "var(--color-text-muted)",
  },
  {
    labelKey: "plugin.settings.color.statusInfo",
    value: "var(--color-status-info)",
  },
  {
    labelKey: "plugin.settings.color.statusSuccess",
    value: "var(--color-status-success)",
  },
  {
    labelKey: "plugin.settings.color.statusWarning",
    value: "var(--color-status-warning)",
  },
  {
    labelKey: "plugin.settings.color.statusDanger",
    value: "var(--color-status-danger)",
  },
  {
    labelKey: "plugin.settings.color.accentAi",
    value: "var(--color-accent-ai)",
  },
];
