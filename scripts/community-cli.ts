/**
 * §380/§381 — the environment and argument readers the community CLIs share.
 *
 * Side-effect free on purpose: `run-community-gate.ts` runs the gate when it is imported, so a
 * second CLI cannot import helpers from it. Both readers exit 2 on a missing value — that code
 * means the workflow calling the CLI is wrong, never a verdict about what it judges. `tool`
 * names the CLI in the message, so a workflow log says which step was called wrong.
 */
export function flag(tool: string, name: string, argv: readonly string[] = process.argv): string {
  const at = argv.indexOf(name);
  const value = at === -1 ? undefined : argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`✗ ${tool}: ${name} <value> is required`);
    process.exit(2);
  }
  return value;
}

export function need(tool: string, name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`✗ ${tool}: ${name} is not set — a bug in the workflow that runs this, not a verdict`);
    process.exit(2);
  }
  return value;
}

/**
 * A numeric id the workflow passes (`PR_AUTHOR_ID`), as a positive decimal integer. The text is
 * checked before `Number()` reads it: `Number` alone turns hex (`0x1F`), an exponent (`1e3`), a
 * sign (`+5`), a whole-valued fraction (`5.0`), a leading zero (`012`) and surrounding
 * whitespace into safe integers (measured with `node -e`), and a GitHub id is spelled as none
 * of them.
 */
export function needId(tool: string, name: string): number {
  const raw = need(tool, name);
  const value = Number(raw);
  if (!/^[1-9]\d*$/u.test(raw) || !Number.isSafeInteger(value)) {
    console.error(`✗ ${tool}: ${name} must be a positive decimal integer — a bug in the workflow that runs this, not a verdict`);
    process.exit(2);
  }
  return value;
}
