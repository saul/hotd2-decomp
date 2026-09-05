/**
 * SHA-256, for the manifest's `sources` block and the `Hod2.exe` build gate.
 *
 * `crypto.subtle` rather than a seam: it is one API with one answer, present
 * in node 20 and in every browser this player runs in, and a digest is the
 * least host-specific thing in the package. It is async, which is the only
 * reason this is a module and not a call site.
 *
 * The browser requires a secure context for it. `localhost` is one, so the dev
 * server is fine; a bundle served over plain HTTP from another host is not,
 * and the failure is loud rather than a wrong digest.
 */

/** Lowercase hex, the way `hashlib.sha256(...).hexdigest()` spells it. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data.buffer
    : data.slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", buf as ArrayBuffer);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
