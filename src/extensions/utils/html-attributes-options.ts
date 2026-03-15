/** Shared mixin for Extensions that only need a plain HTMLAttributes option. */
export const htmlAttributesOptions = {
  addOptions() {
    return { HTMLAttributes: {} as Record<string, string> };
  },
} as const;
