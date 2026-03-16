// §4.8 Context Menu — shared types
export interface MenuItem {
  action: () => void;
  label: string;
  separator?: boolean;
}
