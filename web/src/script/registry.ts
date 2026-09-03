/**
 * Assembling a dispatch table out of per-module tables, with the one check a
 * spread cannot make: **no key may be claimed twice.**
 *
 * `{ ...camera, ...collision, ...region }` has exactly one behaviour for a
 * collision — the last spread silently wins — and a table assembled that way
 * cannot tell "this opcode moved" from "this opcode is now handled twice by
 * two modules that disagree". `ops/` has ten modules and `state/camera_action`
 * four handlers; the two tables that grow are the two where a name landing in
 * the wrong file is a plausible mistake and an invisible one.
 *
 * It throws at **module load**, which is the point: every entry point that
 * imports `script/` imports the table, so a duplicate cannot reach a build.
 */

/**
 * Merge named tables into one, refusing a key two of them both register.
 *
 * `parts` is `[module name, table]` pairs — the name is only ever used to say
 * *which two* modules collided, which is the whole value of the message.
 *
 * `format` renders a key for that message; opcode tables pass {@link hexKey},
 * because "duplicate opcode 48" reads as a different opcode from the `0x30`
 * every file, doc and disassembly listing calls it.
 */
export function mergeTables<T extends object>(
  what: string,
  parts: readonly (readonly [string, T])[],
  format: (key: string) => string = (k) => k,
): T {
  const out: Record<string, unknown> = {};
  const owner = new Map<string, string>();
  for (const [module, table] of parts) {
    for (const [key, value] of Object.entries(table)) {
      const prev = owner.get(key);
      if (prev !== undefined) {
        throw new Error(
          `duplicate ${what} ${format(key)}: registered by ${prev}, `
          + `and again by ${module}`);
      }
      owner.set(key, module);
      out[key] = value;
    }
  }
  return out as T;
}

/** An opcode key, back in the base the rest of the project speaks. */
export function hexKey(key: string): string {
  const n = Number(key);
  return Number.isFinite(n) ? `0x${n.toString(16)}` : key;
}
