/** Flag to suppress dirty marking during programmatic editor updates (tab switch, file load) */
export const programmaticUpdateRef = { current: false };

/** Mark the next editor update as programmatic (will not trigger dirty flag) */
export function markProgrammaticUpdate(): void {
  programmaticUpdateRef.current = true;
  Promise.resolve().then(() => {
    programmaticUpdateRef.current = false;
  });
}
