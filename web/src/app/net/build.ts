/**
 * Which code this page is, for the netplay handshake. `vite.config.ts`
 * defines it at build time; a test bundled by esbuild has no definition and
 * says so.
 */
declare const __HOTD2_BUILD__: string | undefined;

export function buildId(): string {
  return typeof __HOTD2_BUILD__ === "string" ? __HOTD2_BUILD__ : "undefined-build";
}
