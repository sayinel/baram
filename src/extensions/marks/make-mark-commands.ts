import type { CommandProps, RawCommands } from "@tiptap/core";

export function makeMarkCommands(name: string): Partial<RawCommands> {
  const stem = name.charAt(0).toUpperCase() + name.slice(1);
  return {
    [`set${stem}`]:
      () =>
      ({ commands }: CommandProps) =>
        commands.setMark(name),
    [`toggle${stem}`]:
      () =>
      ({ commands }: CommandProps) =>
        commands.toggleMark(name),
    [`unset${stem}`]:
      () =>
      ({ commands }: CommandProps) =>
        commands.unsetMark(name),
  } as Partial<RawCommands>;
}
