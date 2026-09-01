// §4.6 The `/` slash menu's item contract — a UI-neutral leaf so the item builders in
// `src/extensions/plugins/slash-command-items-*.ts` (which own the domain data: what blocks
// exist, their labels, their insert actions) do not have to import the view component
// (`SlashMenu.tsx`) that renders them. `SlashMenu.tsx` imports it back for its own props.
export interface SlashMenuItem {
  action: () => void;
  category: string;
  description: string;
  id: string;
  label: string;
  mdHint?: string;
}
