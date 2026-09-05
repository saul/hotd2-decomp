/**
 * `json.dumps`, as Python spells it.
 *
 * The bundle is compared against one the reference implementation wrote, and
 * three of Python's defaults are not JavaScript's:
 *
 * * **Separators.** Python's default is `", "` and `": "`, *with* the spaces.
 *   `bundle.py` relies on the default for `<stage>.script.json`; `gltf.py`
 *   asks for `(",", ":")` because a glTF JSON chunk is padded to four bytes
 *   and nobody wants 200 KB of spaces inside a GLB. `JSON.stringify` emits
 *   neither.
 * * **`ensure_ascii`.** Python escapes every non-ASCII character as `\uXXXX`;
 *   `JSON.stringify` emits it raw. Nothing in a healthy bundle is non-ASCII,
 *   but a `degraded` record carries an exception message, and the one time
 *   that matters is the one time the two files would differ.
 * * **`allow_nan`.** Python writes bare `NaN` and `Infinity`, which is not
 *   JSON; `bundle.py` passes `allow_nan=False` so that a camera curve which
 *   decoded to garbage fails the export rather than writing a file no parser
 *   will read. That refusal is load-bearing and it is reproduced here.
 *
 * **Numbers are formatted by JavaScript, not by Python**, and that is the one
 * deliberate divergence: Python prints a `float` of 8000.0 as `8000.0` and
 * JavaScript has one number type and prints `8000`. Both parse to the same
 * IEEE double, which is what the reader of a bundle sees and what
 * `tools/compare_bundles.py` compares. See docs/TS_PORT.md.
 */

export interface DumpOptions {
  /** `[item, key]`, Python's `separators=`. Defaults to `[", ", ": "]`. */
  separators?: [string, string];
  /** Python's `indent=`. A number of spaces; omitted means one line. */
  indent?: number;
  /** Python's `allow_nan=`. Default true, matching Python; pass false to refuse. */
  allowNan?: boolean;
}

/** Anything this serializer will accept. */
export type Json =
  | null | boolean | number | string
  | Json[] | { [k: string]: Json | undefined };

const ESCAPES: Record<string, string> = {
  '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t",
  "\b": "\\b", "\f": "\\f",
};

function quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const esc = ESCAPES[c];
    if (esc !== undefined) { out += esc; continue; }
    const code = s.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    out += c;
  }
  return out + '"';
}

function num(v: number, allowNan: boolean): string {
  if (Number.isNaN(v)) {
    if (!allowNan) throw new Error("Out of range float values are not JSON compliant");
    return "NaN";
  }
  if (!Number.isFinite(v)) {
    if (!allowNan) throw new Error("Out of range float values are not JSON compliant");
    return v > 0 ? "Infinity" : "-Infinity";
  }
  // `String(-0)` is "0" and loses the sign a float legitimately carries.
  if (Object.is(v, -0)) return "-0";
  return String(v);
}

/**
 * Serialize *value* the way `json.dumps` would.
 *
 * `undefined` members are dropped, which is how an optional block that was not
 * built stays out of the file — Python simply never puts the key in the dict.
 */
export function dumps(value: unknown, opts: DumpOptions = {}): string {
  const [itemSep, keySep] = opts.separators ?? [", ", ": "];
  const allowNan = opts.allowNan ?? true;
  const indent = opts.indent;
  const pretty = indent !== undefined;
  // Python drops the trailing space from the item separator when indenting,
  // because the newline supplies it.
  const item = pretty ? itemSep.replace(/\s+$/, "") : itemSep;
  const out: string[] = [];

  const walk = (v: unknown, depth: number): void => {
    if (v === null || v === undefined) { out.push("null"); return; }
    switch (typeof v) {
      case "boolean": out.push(v ? "true" : "false"); return;
      case "number": out.push(num(v, allowNan)); return;
      case "bigint": out.push(v.toString()); return;
      case "string": out.push(quote(v)); return;
    }
    const nl = pretty ? "\n" + " ".repeat(indent! * (depth + 1)) : "";
    const close = pretty ? "\n" + " ".repeat(indent! * depth) : "";
    if (Array.isArray(v)) {
      if (v.length === 0) { out.push("[]"); return; }
      out.push("[");
      for (let i = 0; i < v.length; i++) {
        if (i) out.push(item);
        out.push(nl);
        walk(v[i], depth + 1);
      }
      out.push(close, "]");
      return;
    }
    if (v instanceof Map) {
      const rows = [...v.entries()].filter(([, val]) => val !== undefined);
      if (!rows.length) { out.push("{}"); return; }
      out.push("{");
      rows.forEach(([k, val], i) => {
        if (i) out.push(item);
        out.push(nl, quote(String(k)), keySep);
        walk(val, depth + 1);
      });
      out.push(close, "}");
      return;
    }
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    if (!keys.length) { out.push("{}"); return; }
    out.push("{");
    keys.forEach((k, i) => {
      if (i) out.push(item);
      out.push(nl, quote(k), keySep);
      walk(obj[k], depth + 1);
    });
    out.push(close, "}");
  };

  walk(value, 0);
  return out.join("");
}

/** `json.dumps(x, allow_nan=False)` — the default `bundle.py` writes with. */
export function dumpsStrict(value: unknown): string {
  return dumps(value, { allowNan: false });
}

/** `json.dumps(x, separators=(",", ":"))` — the glTF JSON chunk. */
export function dumpsTight(value: unknown): string {
  return dumps(value, { separators: [",", ":"] });
}

/** `json.dumps(x, indent=1)` — `manifest.json` and a loose `.gltf`. */
export function dumpsIndented(value: unknown, indent = 1): string {
  return dumps(value, { indent });
}
